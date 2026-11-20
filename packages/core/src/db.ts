import path from 'path'
import fs from 'fs'
import { Client, types as pgTypes } from 'pg'
import { recordSnapshotStats } from './csv'
import type { Ctx, Handlers } from './context'

const H: Handlers = {}
export const dbHandlers = H

// ── DB 슬롯 ───────────────────────────────────────────────────────────────────
// DB 슬롯은 4개이다. 저장 방법(데스크톱: 암호화 파일, Web: 메모리)은 ctx.slots가 정한다.
// 비밀번호는 렌더러로 돌려보내지 않는다.

export const SLOT_IDS = ['db1', 'db2', 'db3', 'db4'] as const
export type SlotId = typeof SLOT_IDS[number]

export interface SshConfig { host: string; port: string; username: string; pemPath: string }
export interface DbSlotConfig {
  name: string
  // CSV를 저장할 폴더 이름. DB-downloads 아래에 이 이름의 폴더를 만든다.
  folderName: string
  host: string
  port: string
  database: string
  user: string
  password: string
  ssh: SshConfig
  // true면 TLS로 연결하고 서버 인증서를 반드시 확인한다 (원래 호스트 이름 기준). 공인망의 DB는 켜는 것을 권한다.
  ssl: boolean
  // 연결 확인을 통과한 상태. 접속 값이 바뀌면 false로 되돌린다.
  verified: boolean
}
export type DbSlots = Record<SlotId, DbSlotConfig>

const EMPTY_SSH: SshConfig = { host: '', port: '22', username: '', pemPath: '' }

export function isSlotId(value: unknown): value is SlotId {
  return typeof value === 'string' && (SLOT_IDS as readonly string[]).includes(value)
}

function emptySlot(id: SlotId): DbSlotConfig {
  return {
    name: id.toUpperCase(),
    folderName: id.toUpperCase(),
    host: '',
    port: '5432',
    database: '',
    user: '',
    password: '',
    ssh: { ...EMPTY_SSH },
    ssl: false,
    verified: false,
  }
}

// 저장된 값(일부만 있을 수 있음)을 빈 슬롯 위에 덮어 4개 슬롯을 모두 채운다.
export function normalizeSlots(saved: Partial<Record<SlotId, Partial<DbSlotConfig>>>, legacyDevSsh?: Partial<SshConfig>): DbSlots {
  const slots = {} as DbSlots
  for (const id of SLOT_IDS) {
    const base = emptySlot(id)
    const item = saved[id] ?? {}
    slots[id] = { ...base, ...item, ssh: { ...base.ssh, ...(item.ssh ?? {}) } }
    // 저장 폴더 이름이 없던 슬롯은 슬롯 이름을 기본값으로 쓴다.
    if (item.folderName === undefined && item.name) slots[id].folderName = safeSegment(item.name)
  }
  if (legacyDevSsh) slots.db1.ssh = { ...slots.db1.ssh, ...legacyDevSsh }
  return slots
}

// 슬롯 목록 — 버튼 이름 표시용
H['db:listSlots'] = (ctx: Ctx) => {
  const slots = ctx.slots.load()
  return SLOT_IDS.map((id) => ({
    id,
    name: slots[id].name,
    configured: !!(slots[id].host && slots[id].database),
  }))
}

// 슬롯 한 개 불러오기 — 비밀번호 값은 제외한다.
H['db:loadSlot'] = (ctx: Ctx, id: SlotId) => {
  if (!isSlotId(id)) throw new Error('잘못된 DB 슬롯입니다.')
  const { password, ...rest } = ctx.slots.load()[id]
  return { ...rest, hasPassword: password !== '' }
}

// 슬롯 한 개 저장 — 비밀번호가 비어 있으면 기존 값을 유지한다.
// 접속 값이 하나라도 바뀌면 연결 확인 상태를 해제한다. 이름만 바꾸면 유지한다.
// 반환값은 저장 후의 연결 확인 상태이다.
H['db:saveSlot'] = (ctx: Ctx, id: SlotId, cfg: Omit<DbSlotConfig, 'verified'>) => {
  if (!isSlotId(id)) throw new Error('잘못된 DB 슬롯입니다.')
  const all = ctx.slots.load()
  const current = all[id]
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const next: DbSlotConfig = {
    name: text(cfg.name) || id.toUpperCase(),
    folderName: text(cfg.folderName) || id.toUpperCase(),
    host: text(cfg.host),
    port: text(cfg.port),
    database: text(cfg.database),
    user: text(cfg.user),
    password: typeof cfg.password === 'string' && cfg.password !== '' ? cfg.password : current.password,
    ssh: {
      host: text(cfg.ssh?.host),
      port: text(cfg.ssh?.port),
      username: text(cfg.ssh?.username),
      pemPath: text(cfg.ssh?.pemPath),
    },
    ssl: cfg.ssl === true,
    verified: current.verified,
  }
  const connectionChanged =
    next.host !== current.host ||
    next.port !== current.port ||
    next.database !== current.database ||
    next.user !== current.user ||
    next.password !== current.password ||
    next.ssh.host !== current.ssh.host ||
    next.ssh.port !== current.ssh.port ||
    next.ssh.username !== current.ssh.username ||
    next.ssh.pemPath !== current.ssh.pemPath ||
    next.ssl !== current.ssl
  if (connectionChanged) next.verified = false
  all[id] = next
  ctx.slots.save(all)
  if (connectionChanged) ctx.tunnel?.close(id)
  return next.verified
}

function isIpLiteral(host: string): boolean {
  return /^[0-9.]+$/.test(host) || host.includes(':')
}

// requireVerified가 true이면 연결 확인을 통과한 슬롯만 사용할 수 있다.
async function withDb<T>(
  ctx: Ctx,
  slotId: SlotId,
  fn: (client: Client) => Promise<T>,
  requireVerified = true,
  types?: { getTypeParser: (oid: number, format?: 'text' | 'binary') => (value: string) => unknown },
): Promise<T> {
  if (!isSlotId(slotId)) throw new Error('잘못된 DB 슬롯입니다.')
  const slot = ctx.slots.load()[slotId]
  if (!slot.host || !slot.database) throw new Error('접속 정보가 비어 있습니다.')
  if (requireVerified && !slot.verified) throw new Error('연결 확인을 먼저 통과해야 합니다.')

  // TLS 서버 신원은 사용자가 적은 원래 호스트 이름으로 확인한다. (터널이나 검사한 IP로 접속해도 같다)
  const serverName = slot.host
  let host = slot.host
  let port = parseInt(slot.port) || 5432

  if (slot.ssh.host) {
    if (!ctx.tunnel) throw new Error('이 환경에서는 SSH 터널을 쓸 수 없습니다.')
    const localPort = await ctx.tunnel.open(slotId, slot.ssh, host, port)
    host = '127.0.0.1'
    port = localPort
  }

  // Web: 연결 직전에 주소를 검사하고(공인 주소만), 검사한 IP로 접속하며, 읽기 전용·시간 제한을 건다. 데스크톱은 없음.
  const guarded = ctx.dbGuard ? await ctx.dbGuard(host, port) : null

  const client = new Client({
    host: guarded?.host ?? host,
    port,
    database: slot.database,
    user: slot.user,
    password: slot.password || undefined,
    ...(guarded?.clientOptions ?? {}),
    ...(types ? { types } : {}),
    // rejectUnauthorized를 끄지 않는다. 인증서를 확인하지 않는 TLS는 중간자 공격을 막지 못한다.
    ...(slot.ssl ? { ssl: { rejectUnauthorized: true, servername: isIpLiteral(serverName) ? undefined : serverName } } : {}),
  })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

// DB 연결 테스트
H['db:testConnection'] = async (ctx: Ctx, slot: SlotId) => {
  try {
    await withDb(ctx, slot, async (client) => { await client.query('SELECT 1') }, false)
    // 연결 확인에 성공하면 슬롯을 확인 완료 상태로 기록한다.
    const all = ctx.slots.load()
    all[slot].verified = true
    ctx.slots.save(all)
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

// 스키마 목록 — 시스템 스키마 제외. 한 번에 SCHEMA_PAGE_SIZE개씩 돌려준다.
// 검색어가 비어 있으면 전체 스키마를 돌려준다.
// 검색어가 있으면 스키마 이름 또는 그 안의 테이블 이름이 맞는 스키마만 돌려준다.
const SCHEMA_PAGE_SIZE = 50

H['db:listSchemas'] = async (ctx: Ctx, slot: SlotId, search: string, offset = 0) => {
  const keyword = typeof search === 'string' ? search.trim() : ''
  const start = Math.max(0, Math.floor(Number(offset)) || 0)
  // LIKE 특수문자(%, _, 역슬래시)는 글자 그대로 찾는다.
  const pattern = `%${keyword.replace(/[\\%_]/g, '\\$&')}%`

  return withDb(ctx, slot, async (client) => {
    const result = await client.query(
      `SELECT s.schema_name AS name,
              (SELECT COUNT(*) FROM information_schema.tables t
                WHERE t.table_schema = s.schema_name AND t.table_type = 'BASE TABLE')::int AS table_count
         FROM information_schema.schemata s
        WHERE s.schema_name NOT IN ('pg_catalog','information_schema','pg_toast','pg_temp_1','pg_toast_temp_1')
          AND s.schema_name NOT LIKE 'pg_%'
          AND ($1 = '' OR s.schema_name ILIKE $2 OR EXISTS (
                SELECT 1 FROM information_schema.tables t
                 WHERE t.table_schema = s.schema_name
                   AND t.table_type = 'BASE TABLE'
                   AND t.table_name ILIKE $2))
        ORDER BY s.schema_name
        LIMIT $3 OFFSET $4`,
      [keyword, pattern, SCHEMA_PAGE_SIZE + 1, start]
    )
    const rows = result.rows as Array<{ name: string; table_count: number }>
    return {
      items: rows.slice(0, SCHEMA_PAGE_SIZE).map((r) => ({ name: r.name, tableCount: r.table_count })),
      hasMore: rows.length > SCHEMA_PAGE_SIZE,
    }
  })
}

// 특정 스키마의 테이블 목록
H['db:listTables'] = async (ctx: Ctx, slot: SlotId, schema: string) => {
  return withDb(ctx, slot, async (client) => {
    const result = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [schema]
    )
    return result.rows.map((r: { table_name: string }) => r.table_name)
  })
}

function normalizePgType(udt: string): string {
  const t = udt.toLowerCase().trim()
  if (/^(int2|int4|int8|integer|smallint|bigint|serial|bigserial|smallserial)$/.test(t)) return 'integer'
  if (/^(float4|float8|real|numeric|decimal|double precision|money)$/.test(t)) return 'float'
  if (/^(varchar|character varying|text|char|bpchar|name|citext)$/.test(t)) return 'string'
  if (/^(bool|boolean)$/.test(t)) return 'boolean'
  if (/^(timestamp|timestamptz)$/.test(t)) return 'timestamp'
  if (/^date$/.test(t)) return 'date'
  if (/^(time|timetz)$/.test(t)) return 'time'
  if (/^uuid$/.test(t)) return 'uuid'
  if (/^(json|jsonb)$/.test(t)) return 'json'
  if (/^bytea$/.test(t)) return 'binary'
  if (t.endsWith('[]')) return 'array'
  if (/^(inet|cidr|macaddr)$/.test(t)) return 'inet'
  return t
}

async function queryTypeRow(
  client: InstanceType<typeof import('pg').Client>,
  schema: string,
  table: string,
  headers: string[]
): Promise<string> {
  const res = await client.query(
    `SELECT column_name, udt_name
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, table]
  )
  const typeMap = new Map<string, string>()
  for (const row of res.rows) typeMap.set(row.column_name, normalizePgType(row.udt_name))
  return headers.map(col => {
    const t = typeMap.get(col)
    return t ? `{${t}}` : ''
  }).map(csvCell).join(',')
}

// 선택된 테이블들을 CSV로 내보내기 — 청크 페이지네이션으로 DB 보호
const CHUNK_SIZE = 3_000    // 쿼리당 최대 행 수
const CHUNK_DELAY_MS = 150  // 청크 간 대기 (ms) — DB 부하 분산

// 테이블의 컬럼별 제약 정보를 조회해 CSV 두 번째 행 문자열로 반환
// 형식: [PK], [FK→users.id|NN], [UQ], [NN], 빈 칸(제약 없음)
async function queryConstraintRow(
  client: InstanceType<typeof import('pg').Client>,
  schema: string,
  table: string,
  headers: string[]
): Promise<string> {
  // 정방향: 이 테이블의 컬럼별 PK / FK / UNIQUE / NOT NULL
  const fwdRes = await client.query(
    `SELECT
       c.column_name,
       c.is_nullable,
       COALESCE(BOOL_OR(tc.constraint_type = 'PRIMARY KEY'), false) AS is_pk,
       COALESCE(BOOL_OR(tc.constraint_type = 'UNIQUE'),      false) AS is_uq,
       MAX(CASE WHEN tc.constraint_type = 'FOREIGN KEY'
             THEN ccu.table_name || '.' || ccu.column_name
             ELSE NULL END) AS fk_ref
     FROM information_schema.columns c
     LEFT JOIN information_schema.key_column_usage kcu
       ON kcu.table_schema = c.table_schema
      AND kcu.table_name   = c.table_name
      AND kcu.column_name  = c.column_name
     LEFT JOIN information_schema.table_constraints tc
       ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema    = c.table_schema
      AND tc.table_name      = c.table_name
     LEFT JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name
      AND tc.constraint_type  = 'FOREIGN KEY'
     WHERE c.table_schema = $1 AND c.table_name = $2
     GROUP BY c.column_name, c.ordinal_position, c.is_nullable
     ORDER BY c.ordinal_position`,
    [schema, table]
  )

  // 역방향: 다른 테이블의 FK가 이 테이블의 어느 컬럼을 참조하는지
  // ex) orders.user_id → users.id 일 때, users 테이블 입장에서 id 컬럼에 REF←orders.user_id 기록
  const revRes = await client.query(
    `SELECT
       ccu.column_name                          AS referenced_column,
       STRING_AGG(kcu.table_name || '.' || kcu.column_name, ',' ORDER BY kcu.table_name, kcu.column_name)
                                                AS referencing_cols
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema    = tc.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND ccu.table_schema   = $1
       AND ccu.table_name     = $2
     GROUP BY ccu.column_name`,
    [schema, table]
  )

  const colMap = new Map<string, {
    is_nullable: string; is_pk: boolean; is_uq: boolean; fk_ref: string | null
  }>()
  for (const row of fwdRes.rows) colMap.set(row.column_name, row)

  const revMap = new Map<string, string>()
  for (const row of revRes.rows) revMap.set(row.referenced_column, row.referencing_cols)

  const cells = headers.map((col) => {
    const info = colMap.get(col)
    if (!info) return ''
    const parts: string[] = []
    if (info.is_pk) parts.push('PK')
    if (info.fk_ref) parts.push(`FK→${info.fk_ref}`)
    if (info.is_uq && !info.is_pk) parts.push('UQ')
    if (info.is_nullable === 'NO' && !info.is_pk) parts.push('NN')
    const rev = revMap.get(col)
    if (rev) parts.push(`REF←${rev}`)
    return parts.length > 0 ? `[${parts.join('|')}]` : ''
  })

  return cells.map(csvCell).join(',')
}

H['db:abortExport'] = (ctx: Ctx) => { ctx.state.exportAborted = true }

// CSV 칸 하나. 쉼표, 큰따옴표, 줄바꿈, 앞뒤 공백이 있으면 큰따옴표로 감싼다. 머리글과 메타 행에도 같은 규칙을 쓴다.
export function csvCell(s: string): string {
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// DB 값 하나를 CSV 칸으로 바꾼다.
// - NULL은 빈 칸이다. (빈 문자열과 구분하지 않는다. 이 도구의 CSV 형식이 정한 제한이다)
// - 날짜·시간은 DB가 준 글자 그대로 쓴다 (아래 rawDateTypes). 예전에는 PC의 지역 설정에 따라 바뀌는 글자였다.
// - JSON, 배열 같은 객체는 JSON 글자로, 바이너리는 \x 16진수로 쓴다. 예전에는 [object Object]가 되었다.
// - =, + 로 시작하는 값도 그대로 둔다. 이 CSV는 이 도구가 읽는 자료이고, 바꾸면 원래 값이 달라진다.
//   스프레드시트 프로그램으로 열 때는 수식으로 해석될 수 있으니 주의한다.
export function csvValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s: string
  if (v instanceof Date) s = Number.isNaN(v.getTime()) ? '' : v.toISOString()
  else if (Buffer.isBuffer(v)) s = '\\x' + v.toString('hex')
  else if (typeof v === 'object') s = JSON.stringify(v)
  else s = String(v)
  return csvCell(s)
}

// 날짜·시간 타입은 JS Date로 바꾸지 않고 DB의 글자를 그대로 받는다. (date, time, timestamp, timestamptz, timetz)
const RAW_DATE_OIDS = new Set([1082, 1083, 1114, 1184, 1266])
const exportTypes = {
  getTypeParser: (oid: number, format?: 'text' | 'binary') =>
    RAW_DATE_OIDS.has(oid) ? (value: string) => value : pgTypes.getTypeParser(oid, format as 'text'),
}

// 폴더나 파일 이름으로 쓸 문자열을 안전하게 바꾼다.
// 경로 구분자와 Windows에서 쓸 수 없는 글자는 밑줄로 바꾸고, 점만 있는 이름이나 예약 이름은 피한다.
// SQL 식별자(스키마, 테이블 이름)를 큰따옴표로 감싼다. 이름 안의 큰따옴표는 두 번 써서 SQL이 끼어들지 못하게 한다.
export function quoteIdent(name: string): string {
  return '"' + String(name).replace(/"/g, '""') + '"'
}

export function safeSegment(name: string): string {
  let s = String(name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
    .replace(/[. ]+$/, '')
  if (s === '' || s === '.' || s === '..') s = '_'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) s = `${s}_`
  return s
}

// 슬롯의 CSV 저장 폴더: DB-downloads/<저장 폴더 이름>
function slotDownloadDir(ctx: Ctx, slotId: SlotId): string {
  const slot = ctx.slots.load()[slotId]
  return path.join(ctx.ws.dbDownloadsRoot, safeSegment(slot.folderName || slot.name || slotId))
}

// 내보내기 진행 위치. ti는 전체 테이블 기준 순서(0부터)이고 total은 전체 테이블 수이다.
interface ExportPosition { ti: number; total: number; schema: string }

// 테이블 하나를 CSV로 쓴다. 저장한 파일 경로를 돌려준다. 저장할 내용이 없으면 null이다.
// - 한 테이블은 읽기 전용 스냅샷 트랜잭션 안에서 커서로 읽는다. 읽는 동안 원본이 바뀌어도 행이 빠지거나 겹치지 않고,
//   LIMIT/OFFSET처럼 뒤로 갈수록 느려지지 않는다.
// - 이 실행만의 임시 파일에 끝까지 쓴 뒤, 다 쓰면 원래 이름으로 바꿔 끼운다.
//   중간에 실패하거나 중단해도 이전에 받아 둔 같은 CSV는 그대로 남는다. 정리는 임시 파일만 한다.
async function writeTableCsv(
  client: Client,
  ctx: Ctx,
  schema: string,
  table: string,
  baseDir: string,
  pos: ExportPosition,
  state: { rows: number; columns: number; tmpPath: string | null },
): Promise<string | null> {
  if (ctx.state.exportAborted) throw new Error('EXPORT_ABORTED')

  const qualified = `${quoteIdent(schema)}.${quoteIdent(table)}`
  const csvPath = path.join(baseDir, `${safeSegment(table)}.csv`)
  const tmpPath = `${csvPath}.part-${process.pid}-${Date.now()}`
  const sendProgress = (rowsDone: number, total: number) =>
    ctx.emit('db:exportProgress', { ...pos, table, rowsDone, totalRows: total })

  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try {
    const countRes = await client.query(`SELECT COUNT(*) FROM ${qualified}`)
    const totalRows = parseInt(countRes.rows[0].count, 10)
    await client.query(`DECLARE tagger_export NO SCROLL CURSOR FOR SELECT * FROM ${qualified}`)

    // 열 이름은 첫 FETCH 결과에서 얻는다. 행이 없는 테이블도 열 이름은 돌려준다.
    let result = await client.query(`FETCH FORWARD ${CHUNK_SIZE} FROM tagger_export`)
    const headers: string[] = result.fields.map((f: { name: string }) => f.name)
    if (headers.length === 0) {
      sendProgress(0, 0)
      await client.query('COMMIT')
      return null
    }
    const constraintRow = await queryConstraintRow(client, schema, table, headers)
    const typeRow = await queryTypeRow(client, schema, table, headers)
    const head = headers.map(csvCell).join(',') + '\n' + constraintRow + '\n' + typeRow + '\n'
    ctx.reserveDisk?.(Buffer.byteLength(head, 'utf-8'))
    state.tmpPath = tmpPath
    fs.writeFileSync(tmpPath, head, 'utf-8')
    state.columns = headers.length

    let rowsDone = 0
    sendProgress(0, totalRows)
    while (result.rows.length > 0) {
      if (ctx.state.exportAborted) throw new Error('EXPORT_ABORTED')
      const chunkText = result.rows.map((row: Record<string, unknown>) => headers.map((h) => csvValue(row[h])).join(',')).join('\n') + '\n'
      // Web: 세션 용량 상한을 넘으면 여기서 멈춘다 (큰 DB를 통째로 내려받아 서버 디스크를 채우지 못하게).
      ctx.reserveDisk?.(Buffer.byteLength(chunkText, 'utf-8'))
      fs.appendFileSync(tmpPath, chunkText, 'utf-8')
      rowsDone += result.rows.length
      state.rows = rowsDone
      sendProgress(rowsDone, Math.max(totalRows, rowsDone))
      if (result.rows.length < CHUNK_SIZE) break
      // 다음 청크 전에 잠시 쉰다 (DB 부하 분산)
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS))
      result = await client.query(`FETCH FORWARD ${CHUNK_SIZE} FROM tagger_export`)
    }
    await client.query('CLOSE tagger_export')
    await client.query('COMMIT')

    // 다 썼으면 원래 이름으로 바꿔 끼운다.
    fs.renameSync(tmpPath, csvPath)
    state.tmpPath = null
    if (rowsDone === 0) sendProgress(0, 0)
    return csvPath
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  }
}

// 테이블 하나를 CSV로 저장한다. 중간에 실패하거나 중단되면 이 실행의 임시 파일만 지운다.
export async function exportOneTable(
  client: Client,
  ctx: Ctx,
  schema: string,
  table: string,
  baseDir: string,
  pos: ExportPosition,
): Promise<string | null> {
  const state: { rows: number; columns: number; tmpPath: string | null } = { rows: 0, columns: 0, tmpPath: null }
  try {
    const saved = await writeTableCsv(client, ctx, schema, table, baseDir, pos, state)
    if (saved) void recordSnapshotStats(ctx, saved, state.rows, state.columns)
    return saved
  } catch (e) {
    if (state.tmpPath) {
      try { fs.rmSync(state.tmpPath, { force: true }) } catch { /* 삭제 실패는 무시한다. */ }
    }
    throw e
  }
}

// 선택한 테이블들을 CSV로 내보낸다. 오류가 나면 즉시 중단한다.
// 중단하거나 실패하면 그때 쓰던 테이블의 임시 파일만 지운다. 이미 다 받은 테이블은 새 파일로 남는다.
// (예전에는 이번 실행에서 받은 파일을 모두 지웠는데, 받기 전의 파일이 이미 덮인 뒤라 둘 다 잃었다)
H['db:exportTables'] = async (ctx: Ctx, slot: SlotId, schema: string, tables: string[]) => {
  ctx.state.exportAborted = false
  return withDb(ctx, slot, async (client) => {
    const baseDir = path.join(slotDownloadDir(ctx, slot), safeSegment(schema))
    fs.mkdirSync(baseDir, { recursive: true })
    const savedPaths: string[] = []
    for (let ti = 0; ti < tables.length; ti++) {
      const saved = await exportOneTable(client, ctx, schema, tables[ti], baseDir, {
        ti,
        total: tables.length,
        schema,
      })
      if (saved) savedPaths.push(saved)
    }
    return savedPaths
  }, true, exportTypes)
}

// 선택한 스키마의 테이블 전체를 CSV로 내보낸다.
// 테이블 목록은 저장 시점에 조회한다. 테이블 하나가 실패하면 건너뛰고 계속하며, 실패 목록을 돌려준다.
H['db:exportSchemas'] = async (ctx: Ctx, slot: SlotId, schemas: string[]) => {
  ctx.state.exportAborted = false
  const names = Array.isArray(schemas)
    ? schemas.filter((v): v is string => typeof v === 'string' && v !== '')
    : []

  return withDb(ctx, slot, async (client) => {
    const plan: Array<{ schema: string; tables: string[] }> = []
    for (const schema of names) {
      const res = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
        [schema]
      )
      plan.push({ schema, tables: res.rows.map((r: { table_name: string }) => r.table_name) })
    }

    const total = plan.reduce((sum, item) => sum + item.tables.length, 0)
    const saved: string[] = []
    const failed: Array<{ schema: string; table: string; message: string }> = []
    let ti = 0

    try {
      for (const { schema, tables } of plan) {
        if (tables.length === 0) continue
        const baseDir = path.join(slotDownloadDir(ctx, slot), safeSegment(schema))
        fs.mkdirSync(baseDir, { recursive: true })

        for (const table of tables) {
          try {
            const savedPath = await exportOneTable(client, ctx, schema, table, baseDir, { ti, total, schema })
            if (savedPath) saved.push(savedPath)
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e)
            if (message === 'EXPORT_ABORTED') throw e
            failed.push({ schema, table, message })
          }
          ti++
        }
      }
    } catch (e: unknown) {
      // 중단하면 그때 쓰던 테이블의 임시 파일만 지운다 (exportOneTable). 이미 다 받은 테이블은 남긴다.
      throw e
    }

    return { saved, failed }
  }, true, exportTypes)
}
