import path from 'path'
import fs from 'fs'
import zlib from 'zlib'
import { promisify } from 'util'
import { userPath, isDbExportPath } from './context'
import type { Ctx, Handlers } from './context'

// ── ParsedCsv 디스크 캐시 (local/tmp/cache/) ──────────────────────────────
// 캐시 키: 파일명 + mtime + size → 파일 변경 시 자동 무효화

function cacheKeyFor(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath)
    const base = path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_')
    // v2: 메타 행을 DB 내보내기 파일에서만 찾도록 바뀐 뒤의 캐시. 예전 캐시는 쓰지 않는다.
    return `v2_${base}_${stat.mtimeMs.toFixed(0)}_${stat.size}`
  } catch {
    return null
  }
}

// cache:load — 캐시 히트 시 ParsedCsv 반환, miss 시 null
const cacheLoad = (ctx: Ctx, filePath: string) => {
  const key = cacheKeyFor(userPath(ctx, filePath))
  if (!key) return null
  const cachePath = path.join(ctx.ws.cacheDir, key + '.gz')
  if (!fs.existsSync(cachePath)) return null
  try {
    const compressed = fs.readFileSync(cachePath)
    const json = zlib.gunzipSync(compressed).toString('utf-8')
    const { fileName, columns, totalRows, keys, values } = JSON.parse(json)
    const rows: Record<string, string>[] = values.map((vals: string[]) => {
      const row: Record<string, string> = {}
      keys.forEach((k: string, i: number) => { row[k] = vals[i] ?? '' })
      return row
    })
    return { fileName, columns, rows, totalRows }
  } catch {
    return null
  }
}

// cache:save — columnar gzip JSON으로 직렬화 후 저장 (비동기)
const cacheSave = async (ctx: Ctx, filePath: string, data: any) => {
  const key = cacheKeyFor(userPath(ctx, filePath))
  if (!key) return
  const { fileName, columns, rows, totalRows } = data
  const keys: string[] = columns.map((c: any) => c.key)
  const values: string[][] = rows.map((row: Record<string, string>) =>
    keys.map((k) => row[k] ?? '')
  )
  const json = JSON.stringify({ fileName, columns, totalRows, keys, values })
  // 압축과 쓰기를 차례로 await한다. (예전에는 gzip 콜백 안에서 쓰기 오류가 나면 바깥으로 전달되지 않아
  // 처리되지 않은 거부(unhandled rejection)로 서버 프로세스 전체가 끝났다)
  const compressed = await gzipAsync(Buffer.from(json, 'utf-8'), { level: 6 })
  await fs.promises.mkdir(ctx.ws.cacheDir, { recursive: true })
  // 임시 파일에 쓴 뒤 이름을 바꾼다. 쓰다 실패해도 반쯤 쓴 캐시가 남지 않는다.
  const target = path.join(ctx.ws.cacheDir, key + '.gz')
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`
  try {
    await fs.promises.writeFile(tmp, compressed)
    await fs.promises.rename(tmp, target)
  } catch (e) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

const gzipAsync = promisify(zlib.gzip) as (buf: Buffer, opts: zlib.ZlibOptions) => Promise<Buffer>

// ── CSV 통계: 행 수, 열 수 (파일을 파싱하지 않는다) ──────────────────────────
// 사이드바에 파일을 열기 전에도 "N행 · M열"을 보여주기 위해, 파일을 스트림으로 한 번 훑으며 레코드 수만 센다.
// 행 데이터를 메모리에 올리지 않는다. 큰 파일은 앞쪽 STATS_SCAN_LIMIT 바이트만 세고 partial로 표시한다.
const STATS_SCAN_LIMIT = 64 * 1024 * 1024
const STATS_HEAD_BYTES = 256 * 1024

// missing이 true이면 파일이 없는 상태(실종)이다. 이 값은 캐시에 넣지 않는다.
export interface CsvStats { rows: number; columns: number; partial: boolean; missing?: boolean }

// 앞부분 텍스트에서 레코드(행)를 따옴표 규칙대로 나눈다. 완전히 빈 줄은 건너뛴다. (PapaParse skipEmptyLines: true와 같다)
function splitCsvHead(text: string, maxRecords: number): string[][] {
  const records: string[][] = []
  let cells: string[] = []
  let cur = ''
  let inQ = false
  let recLen = 0
  const endRecord = () => {
    if (recLen > 0) { cells.push(cur); records.push(cells) }
    cells = []
    cur = ''
    recLen = 0
  }
  for (let i = 0; i < text.length && records.length < maxRecords; i++) {
    const ch = text[i]
    if (inQ) {
      recLen++
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; recLen++ } else inQ = false
      } else {
        cur += ch
      }
      continue
    }
    if (ch === '"') { inQ = true; recLen++; continue }
    if (ch === ',') { cells.push(cur); cur = ''; recLen++; continue }
    if (ch === '\n') { endRecord(); continue }
    if (ch === '\r' && text[i + 1] === '\n') continue // CRLF의 CR
    cur += ch
    recLen++
  }
  if (records.length < maxRecords) endRecord()
  return records
}

// 제약 행([PK] 등)과 타입 행({integer} 등)을 가려내는 규칙은 렌더러의 파서(useCsvParser)와 같다.
async function computeCsvStats(filePath: string): Promise<CsvStats | null> {
  const stat = await fs.promises.stat(filePath)
  if (!stat.isFile()) return null
  if (stat.size === 0) return { rows: 0, columns: 0, partial: false }

  const partial = stat.size > STATS_SCAN_LIMIT
  const end = partial ? STATS_SCAN_LIMIT - 1 : stat.size - 1
  const headChunks: Buffer[] = []
  let headBytes = 0
  let records = 0
  let recLen = 0
  let inQuote = false
  let prev = 0

  const stream = fs.createReadStream(filePath, { start: 0, end, highWaterMark: 1 << 20 })
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    if (headBytes < STATS_HEAD_BYTES) {
      const take = chunk.subarray(0, STATS_HEAD_BYTES - headBytes)
      headChunks.push(Buffer.from(take))
      headBytes += take.length
    }
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i]
      if (b === 0x22) { inQuote = !inQuote; recLen++; prev = b; continue }
      if (b === 0x0a && !inQuote) {
        // 길이가 0인 줄(CRLF의 CR만 있는 줄 포함)은 빈 줄이라 세지 않는다.
        if (!(recLen === 0 || (recLen === 1 && prev === 0x0d))) records++
        recLen = 0
        prev = b
        continue
      }
      recLen++
      prev = b
    }
    // 다른 작업(화면 요청 등)이 끼어들 틈을 준다.
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  // 끝까지 읽은 파일은 줄바꿈 없이 끝난 마지막 레코드도 센다. 중간에서 멈춘 경우는 잘린 레코드라 세지 않는다.
  if (!partial && !(recLen === 0 || (recLen === 1 && prev === 0x0d))) records++

  const head = Buffer.concat(headChunks).toString('utf-8').replace(/^\uFEFF/, '')
  const first = splitCsvHead(head, 3)
  if (first.length === 0) return { rows: 0, columns: 0, partial }

  const nonEmpty = (cells: string[]) => cells.map((c) => c.trim()).filter(Boolean)
  // 제약 행·타입 행은 DB에서 내보낸 CSV에만 있다. 일반 CSV는 모든 행을 데이터로 센다.
  const allowMeta = isDbExportPath(filePath)
  let meta = 0
  let idx = 1
  if (allowMeta && first[idx]) {
    const v = nonEmpty(first[idx])
    if (v.length > 0 && v.every((c) => /^\[.*\]$/.test(c))) { meta++; idx++ }
  }
  if (allowMeta && first[idx]) {
    const v = nonEmpty(first[idx])
    if (v.every((c) => /^\{.*\}$/.test(c))) meta++
  }

  return { rows: Math.max(0, records - 1 - meta), columns: first[0].length, partial }
}

// 계산 결과 캐시는 사용자마다 ctx.state.csvStats에 둔다. 키는 경로, 수정 시각, 크기이다. 파일이 바뀌면 키가 달라져 다시 센다.

function csvStatsFile(ctx: Ctx): string {
  return path.join(ctx.ws.cacheDir, 'csv-stats.json')
}

function loadCsvStatsCache(ctx: Ctx): void {
  const st = ctx.state.csvStats
  const file = csvStatsFile(ctx)
  if (st.loadedFrom === file) return
  st.memory.clear()
  st.loadedFrom = file
  try {
    if (!fs.existsSync(file)) return
    const saved = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, CsvStats>
    for (const [key, value] of Object.entries(saved)) st.memory.set(key, value)
  } catch { /* 읽지 못하면 빈 캐시로 시작한다. */ }
}

function scheduleCsvStatsSave(ctx: Ctx): void {
  const st = ctx.state.csvStats
  if (st.timer) return
  // 저장할 곳은 예약한 때의 작업 폴더로 정해 둔다.
  const dir = ctx.ws.cacheDir
  const file = csvStatsFile(ctx)
  st.timer = setTimeout(async () => {
    st.timer = null
    try {
      await fs.promises.mkdir(dir, { recursive: true })
      await fs.promises.writeFile(file, JSON.stringify(Object.fromEntries(st.memory)), 'utf-8')
    } catch { /* 저장하지 못해도 다음에 다시 센다. */ }
  }, 2000)
}

function csvStatsKey(filePath: string, stat: fs.Stats): string {
  return `${path.resolve(filePath)}|${Math.round(stat.mtimeMs)}|${stat.size}`
}

// 스냅샷으로 저장한 파일의 행 수와 열 수를 행 수 캐시에 기록한다.
// 저장하면서 이미 알게 된 값이라, 사이드바는 파일을 다시 읽지 않고 이 값을 바로 쓴다.
// 기록하는 값은 파일에 실제로 쓴 행 수이다. 키에 수정 시각과 크기가 들어 있어서, 파일이 바뀌면 이 기록은 쓰이지 않는다.
export async function recordSnapshotStats(ctx: Ctx, filePath: string, rows: number, columns: number): Promise<void> {
  try {
    loadCsvStatsCache(ctx)
    const stat = await fs.promises.stat(filePath)
    ctx.state.csvStats.memory.set(csvStatsKey(filePath, stat), { rows, columns, partial: false })
    scheduleCsvStatsSave(ctx)
  } catch { /* 기록하지 못해도 사이드바가 파일을 직접 세어 구한다. */ }
}

const csvStats = async (ctx: Ctx, filePath: string): Promise<CsvStats | null> => {
  try {
    filePath = userPath(ctx, filePath)
    loadCsvStatsCache(ctx)
    const stat = await fs.promises.stat(filePath)
    const key = csvStatsKey(filePath, stat)
    const cached = ctx.state.csvStats.memory.get(key)
    if (cached) return cached
    const result = await computeCsvStats(filePath)
    if (result) {
      ctx.state.csvStats.memory.set(key, result)
      scheduleCsvStatsSave(ctx)
    }
    return result
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { rows: 0, columns: 0, partial: false, missing: true }
    }
    return null
  }
}

export const csvHandlers: Handlers = {
  'cache:load': cacheLoad,
  'cache:save': cacheSave,
  'csv:stats': csvStats,
}
