import path from 'path'
import fs from 'fs'
import { Client } from 'pg'
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
    next.ssh.pemPath !== current.ssh.pemPath
  if (connectionChanged) next.verified = false
  all[id] = next
  ctx.slots.save(all)
  if (connectionChanged) ctx.tunnel?.close(id)
  return next.verified
}

// requireVerified가 true이면 연결 확인을 통과한 슬롯만 사용할 수 있다.
async function withDb<T>(
  ctx: Ctx,
  slotId: SlotId,
  fn: (client: Client) => Promise<T>,
  requireVerified = true,
): Promise<T> {
  if (!isSlotId(slotId)) throw new Error('잘못된 DB 슬롯입니다.')
  const slot = ctx.slots.load()[slotId]
  if (!slot.host || !slot.database) throw new Error('접속 정보가 비어 있습니다.')
  if (requireVerified && !slot.verified) throw new Error('연결 확인을 먼저 통과해야 합니다.')

  let host = slot.host
  let port = parseInt(slot.port) || 5432

  if (slot.ssh.host) {
    if (!ctx.tunnel) throw new Error('이 환경에서는 SSH 터널을 쓸 수 없습니다.')
    const localPort = await ctx.tunnel.open(slotId, slot.ssh, host, port)
    host = '127.0.0.1'
    port = localPort
  }

  const client = new Client({
    host,
    port,
    database: slot.database,
    user: slot.user,
    password: slot.password || undefined,
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
  }).join(',')
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

  return cells.join(',')
}

H['db:abortExport'] = (ctx: Ctx) => { ctx.state.exportAborted = true }

const escape = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"` : s
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
// 파일을 처음 쓰는 순간 state.wrote를 true로 바꾼다.
async function writeTableCsv(
  client: Client,
  ctx: Ctx,
  schema: string,
  table: string,
  baseDir: string,
  pos: ExportPosition,
  state: { wrote: boolean; rows: number; columns: number },
): Promise<string | null> {
  if (ctx.state.exportAborted) throw new Error('EXPORT_ABORTED')

  const countRes = await client.query(`SELECT COUNT(*) FROM ${quoteIdent(schema)}.${quoteIdent(table)}`)
  const totalRows = parseInt(countRes.rows[0].count, 10)
  const csvPath = path.join(baseDir, `${safeSegment(table)}.csv`)
  const sendProgress = (rowsDone: number, total: number) =>
    ctx.emit('db:exportProgress', { ...pos, table, rowsDone, totalRows: total })

  if (totalRows === 0) {
    const headerRes = await client.query(`SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(table)} LIMIT 0`)
    const headers = headerRes.fields.map((f: { name: string }) => f.name)
    let saved: string | null = null
    if (headers.length > 0) {
      const constraintRow = await queryConstraintRow(client, schema, table, headers)
      const typeRow = await queryTypeRow(client, schema, table, headers)
      state.wrote = true
      fs.writeFileSync(csvPath, headers.join(',') + '\n' + constraintRow + '\n' + typeRow + '\n', 'utf-8')
      state.columns = headers.length
      state.rows = 0
      saved = csvPath
    }
    sendProgress(0, 0)
    return saved
  }

  let headers: string[] = []
  let rowsDone = 0
  let firstChunk = true

  sendProgress(0, totalRows)

  while (rowsDone < totalRows) {
    if (ctx.state.exportAborted) throw new Error('EXPORT_ABORTED')

    const result = await client.query(
      `SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(table)} LIMIT $1 OFFSET $2`,
      [CHUNK_SIZE, rowsDone]
    )
    if (result.rows.length === 0) break

    if (firstChunk) {
      headers = result.fields.map((f: { name: string }) => f.name)
      const constraintRow = await queryConstraintRow(client, schema, table, headers)
      const typeRow = await queryTypeRow(client, schema, table, headers)
      state.wrote = true
      fs.writeFileSync(csvPath, headers.join(',') + '\n' + constraintRow + '\n' + typeRow + '\n', 'utf-8')
      state.columns = headers.length
      firstChunk = false
    }

    const lines = result.rows.map((row: Record<string, unknown>) =>
      headers.map(h => escape(row[h])).join(',')
    )
    fs.appendFileSync(csvPath, lines.join('\n') + '\n', 'utf-8')

    rowsDone += result.rows.length
    state.rows = rowsDone
    sendProgress(rowsDone, totalRows)

    // 마지막 청크가 아니면 대기 (DB 부하 분산)
    if (rowsDone < totalRows) {
      await new Promise(r => setTimeout(r, CHUNK_DELAY_MS))
    }
  }

  return firstChunk ? null : csvPath
}

// 테이블 하나를 CSV로 저장한다. 중간에 실패하거나 중단되면 저장하다 멈춘 불완전한 파일은 지운다.
// 이번 실행에서 파일을 쓰기 전에 실패한 경우에는 기존 파일을 건드리지 않는다.
async function exportOneTable(
  client: Client,
  ctx: Ctx,
  schema: string,
  table: string,
  baseDir: string,
  pos: ExportPosition,
): Promise<string | null> {
  const state = { wrote: false, rows: 0, columns: 0 }
  try {
    const saved = await writeTableCsv(client, ctx, schema, table, baseDir, pos, state)
    if (saved) void recordSnapshotStats(ctx, saved, state.rows, state.columns)
    return saved
  } catch (e) {
    if (state.wrote) {
      try { fs.rmSync(path.join(baseDir, `${safeSegment(table)}.csv`), { force: true }) } catch { /* 삭제 실패는 무시한다. */ }
    }
    throw e
  }
}

// 저장을 중단했을 때 이번 실행에서 완성한 파일을 모두 지운다. 비게 된 폴더도 함께 지운다.
function removeExportedFiles(ctx: Ctx, paths: string[]): void {
  const dirs = new Set<string>()
  for (const p of paths) {
    try { fs.rmSync(p, { force: true }) } catch { /* 삭제 실패는 무시한다. */ }
    dirs.add(path.dirname(p))
  }
  // rmdirSync는 폴더가 비어 있을 때만 지운다. 스키마 폴더를 지운 뒤 비게 된 DB 폴더도 지운다.
  for (const dir of dirs) {
    try { fs.rmdirSync(dir) } catch { /* 다른 파일이 남아 있으면 그대로 둔다. */ }
    const parent = path.dirname(dir)
    if (parent !== ctx.ws.dbDownloadsRoot) {
      try { fs.rmdirSync(parent) } catch { /* 다른 파일이 남아 있으면 그대로 둔다. */ }
    }
  }
}

// 선택한 테이블들을 CSV로 내보낸다. 오류가 나면 즉시 중단한다.
// 중단하면 이번 실행에서 만든 파일을 모두 지운다.
H['db:exportTables'] = async (ctx: Ctx, slot: SlotId, schema: string, tables: string[]) => {
  ctx.state.exportAborted = false
  return withDb(ctx, slot, async (client) => {
    const baseDir = path.join(slotDownloadDir(ctx, slot), safeSegment(schema))
    fs.mkdirSync(baseDir, { recursive: true })
    const savedPaths: string[] = []

    try {
      for (let ti = 0; ti < tables.length; ti++) {
        const saved = await exportOneTable(client, ctx, schema, tables[ti], baseDir, {
          ti,
          total: tables.length,
          schema,
        })
        if (saved) savedPaths.push(saved)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'EXPORT_ABORTED') removeExportedFiles(ctx, savedPaths)
      throw e
    }

    return savedPaths
  })
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
      // 중단하면 이번 실행에서 만든 파일을 모두 지운다.
      if (e instanceof Error && e.message === 'EXPORT_ABORTED') removeExportedFiles(ctx, saved)
      throw e
    }

    return { saved, failed }
  })
}
