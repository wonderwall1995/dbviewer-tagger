// 검토 보고서(report.html, 03b7284 기준)가 재현한 문제가 다시 생기지 않는지 확인한다.
// N01 디스크 한도 우회, N02 IPv6 표기 우회, N03 소켓 로그인 제한 공유, N04 캐시 쓰기 실패로 프로세스 종료,
// N06 내보내기 실패 시 이전 CSV 소실, N07 일관된 읽기, N08 CSV 직렬화, N09 DB 작업 상한, 화면 읽기 크기 상한.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { isPublicAddress, ipv6ToBytes } = require('../packages/core/dist/netguard.js')
const { makeWorkspace } = require('../packages/core/dist/workspace.js')
const { makeSessionState } = require('../packages/core/dist/context.js')
const { csvHandlers } = require('../packages/core/dist/csv.js')
const { localHandlers } = require('../packages/core/dist/local.js')
const { exportOneTable, csvValue, csvCell } = require('../packages/core/dist/db.js')
const { createTaggerServer, clientKey, dirSize } = require('../apps/server/dist/server.js')
const { writeAccess } = require('../apps/server/dist/access.js')

function tmpdir(t, prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(d, { recursive: true, force: true }))
  return d
}

function ctxFor(root, extra = {}) {
  return { ws: makeWorkspace(root), state: makeSessionState(), emit: () => {}, allowOutsidePaths: false, cedDir: () => path.join(root, 'CED'), ...extra }
}

// ── N02 ───────────────────────────────────────────────────────────────────────
test('N02: 같은 내부 주소의 다른 IPv6 표기도 막는다', () => {
  const blocked = [
    '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001', '::ffff:7f00:1', '::ffff:a9fe:a9fe',
    '0:0:0:0:0:ffff:127.0.0.1', '::ffff:10.0.0.1', '::127.0.0.1', '::a9fe:a9fe', '2002:7f00:1::', '2002:a9fe:a9fe::1',
    '64:ff9b::7f00:1', '2001:0:4136::1', 'FE80::1', 'fe80::1%eth0', 'fd12:3456::1', 'fec0::1', '::',
  ]
  for (const ip of blocked) assert.equal(isPublicAddress(ip), false, ip)
  for (const ip of ['2606:4700:4700::1111', '2a00:1450:4001::200e', '::ffff:8.8.8.8', '2002:0808:0808::1']) assert.equal(isPublicAddress(ip), true, ip)
  assert.deepEqual(ipv6ToBytes('::ffff:127.0.0.1'), ipv6ToBytes('0:0:0:0:0:ffff:7f00:0001'))
})

// ── N03 ───────────────────────────────────────────────────────────────────────
test('N03: 소켓으로 온 요청은 Nginx가 넣은 X-Real-IP로 접속자를 나눈다', () => {
  const req = (remoteAddress, ip) => ({ socket: { remoteAddress }, headers: ip ? { 'x-real-ip': ip } : {} })
  assert.notEqual(clientKey(req(undefined, '1.1.1.1')), clientKey(req(undefined, '2.2.2.2')))
  assert.equal(clientKey(req('127.0.0.1', '1.1.1.1')), 'ip:1.1.1.1')
  // TCP로 바깥에서 직접 온 요청의 머리글은 믿지 않는다
  assert.equal(clientKey(req('203.0.113.5', '1.1.1.1')), 'ip:203.0.113.5')
})

test('N03: 소켓 서버에서 A가 10번 틀려도 B는 맞는 코드로 들어온다', async (t) => {
  const dataDir = tmpdir(t, 'n03-')
  writeAccess(dataDir, 'ABCD-EFGH-JKMN')
  const { server } = createTaggerServer({ dataDir })
  const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\tagger-n03-${process.pid}-${Date.now()}` : path.join(dataDir, 's.sock')
  await new Promise((r) => server.listen(socketPath, r))
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r) }))
  const login = (ip, code) => new Promise((resolve, reject) => {
    const body = JSON.stringify({ code })
    const rq = http.request({ socketPath, path: '/api/login', method: 'POST', agent: false, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-real-ip': ip } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
    rq.on('error', reject)
    rq.end(body)
  })
  for (let i = 0; i < 10; i++) await login('1.1.1.1', 'ZZZZ-ZZZZ-ZZZZ')
  assert.equal(await login('1.1.1.1', 'ABCD-EFGH-JKMN'), 429)
  assert.equal(await login('2.2.2.2', 'ABCD-EFGH-JKMN'), 200)
})

// ── N04 ───────────────────────────────────────────────────────────────────────
test('N04: 캐시 파일을 쓰지 못하면 호출한 쪽으로 오류가 돌아온다 (프로세스가 끝나지 않는다)', async (t) => {
  const root = tmpdir(t, 'n04-')
  const ctx = ctxFor(root)
  const csv = path.join(root, 'S3-downloads', 'c.csv')
  fs.mkdirSync(path.dirname(csv), { recursive: true })
  fs.writeFileSync(csv, 'a\n1\n')
  // 캐시 파일 자리에 폴더를 만들어 이름 바꾸기가 실패하게 한다
  const st = fs.statSync(csv)
  const target = path.join(ctx.ws.cacheDir, `v2_c.csv_${st.mtimeMs.toFixed(0)}_${st.size}.gz`)
  fs.mkdirSync(path.join(target, 'block'), { recursive: true })
  const parsed = { fileName: 'c.csv', columns: [{ key: 'a' }], rows: [{ a: '1' }], totalRows: 1 }
  await assert.rejects(() => csvHandlers['cache:save'](ctx, csv, parsed))
  // 반쯤 쓴 임시 파일이 남지 않는다
  assert.deepEqual(fs.readdirSync(ctx.ws.cacheDir).filter((n) => n.includes('.tmp-')), [])
})

// ── 화면 읽기 상한 ──────────────────────────────────────────────────────────────
test('Web의 화면 읽기(local:readFile)는 크기 상한을 넘는 파일을 거절한다', async (t) => {
  const root = tmpdir(t, 'read-')
  const ctx = ctxFor(root, { maxReadBytes: 10 })
  const f = path.join(root, 'S3-downloads', 'big.csv')
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, 'x'.repeat(50))
  await assert.rejects(() => localHandlers['local:readFile'](ctx, f), /너무 커서/)
})

// ── N01 · N09 (서버) ──────────────────────────────────────────────────────────
async function startServer(t, opts) {
  const dataDir = tmpdir(t, 'n01-')
  const made = createTaggerServer({ openAccess: true, dataDir, ...opts })
  await new Promise((r) => made.server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise((r) => { made.server.closeAllConnections?.(); made.server.close(r) }))
  const base = `http://127.0.0.1:${made.server.address().port}`
  const res = await fetch(`${base}/api/session`)
  const cookie = res.headers.get('set-cookie').split(';')[0]
  const call = async (channel, ...args) => (await fetch(`${base}/api/call/${channel}`, { method: 'POST', headers: { cookie }, body: JSON.stringify({ args }) })).json()
  const upload = async (name, body) => (await fetch(`${base}/api/upload?name=${name}`, { method: 'POST', headers: { cookie }, body })).status
  return { ...made, call, upload, root: () => [...made.sessions.values()][0].root }
}

test('N01: 작은 저장을 여러 번 해도 세션 한도를 크게 넘지 못한다', async (t) => {
  const quota = 4096
  const s = await startServer(t, { sessionDiskBytes: quota })
  const results = []
  for (let i = 0; i < 6; i++) results.push((await s.call('local:savePreset', `p${i}`, { note: 'x'.repeat(1800) })).ok)
  assert.ok(results.includes(false), '한도에 닿으면 저장을 거절해야 한다')
  // 넘더라도 요청 하나 크기 안이다
  assert.ok(dirSize(s.root()) <= quota + 2500, `실제 사용량 ${dirSize(s.root())}`)
})

test('N01: 본문은 작지만 크게 쓰는 요청(백업)을 반복해도 결국 거절하고, 지우기는 된다', async (t) => {
  const quota = 6000
  const s = await startServer(t, { sessionDiskBytes: quota })
  await s.call('local:savePreset', 'a', { note: 'x'.repeat(2000) })
  let rejected = null
  for (let i = 0; i < 10 && !rejected; i++) {
    const r = await s.call('backup:save', `t${i}`, 'c')
    if (!r.ok) rejected = r
  }
  assert.ok(rejected, '백업을 반복하면 결국 거절해야 한다')
  assert.match(rejected.error, /용량/)
  // 넘더라도 백업 하나 크기(약 2.2KB) 안이다
  assert.ok(dirSize(s.root()) <= quota + 2500, `실제 사용량 ${dirSize(s.root())}`)
  assert.equal((await s.call('local:deletePreset', 'a.json')).ok, true)
})

test('N01: 동시에 보낸 업로드가 같은 남은 공간을 나눠 쓰지 못한다', async (t) => {
  const s = await startServer(t, { sessionDiskBytes: 1000, maxUploadBytes: 10_000 })
  const statuses = await Promise.all([s.upload('a.csv', 'a'.repeat(800)), s.upload('b.csv', 'b'.repeat(800))])
  assert.deepEqual(statuses.sort(), [200, 507])
  assert.ok(dirSize(s.root()) <= 1000)
})

test('N09: 서버 전체 DB 작업 상한을 넘으면 기다리지 않고 알린다', async (t) => {
  const s = await startServer(t, { maxDbOps: 0 })
  const r = await s.call('db:testConnection', 'db1')
  assert.equal(r.ok, false)
  assert.match(r.error, /DB 작업이 많아요/)
})

// ── N06 · N07 · N08 (DB 내보내기, 가짜 DB 연결) ─────────────────────────────────
function fakeClient({ rows, failOnFetch = 0 }) {
  const sql = []
  let fetches = 0
  let offset = 0
  return {
    sql,
    async query(text) {
      sql.push(text)
      if (/^SELECT COUNT/.test(text)) return { rows: [{ count: String(rows.length) }], fields: [] }
      if (/^FETCH FORWARD (\d+)/.test(text)) {
        fetches++
        if (failOnFetch && fetches === failOnFetch) throw new Error('connection lost')
        const n = Number(text.match(/^FETCH FORWARD (\d+)/)[1])
        const chunk = rows.slice(offset, offset + n)
        offset += chunk.length
        return { rows: chunk, fields: [{ name: 'id' }, { name: 'note, with comma' }] }
      }
      return { rows: [], fields: [] }
    },
  }
}

test('N06·N07: 두 번째 청크에서 실패해도 이전에 받은 CSV는 남고, 임시 파일은 지운다. 스냅샷 트랜잭션과 커서로 읽는다', async (t) => {
  const root = tmpdir(t, 'n06-')
  const ctx = ctxFor(root)
  const baseDir = path.join(ctx.ws.dbDownloadsRoot, 'db1', 'public')
  fs.mkdirSync(baseDir, { recursive: true })
  const csvPath = path.join(baseDir, 'users.csv')
  fs.writeFileSync(csvPath, 'OLD COPY\n')
  const rows = Array.from({ length: 3500 }, (_, i) => ({ id: i, 'note, with comma': 'n' }))
  const client = fakeClient({ rows, failOnFetch: 2 })
  await assert.rejects(() => exportOneTable(client, ctx, 'public', 'users', baseDir, { ti: 0, total: 1, schema: 'public' }), /connection lost/)
  assert.equal(fs.readFileSync(csvPath, 'utf8'), 'OLD COPY\n')
  assert.deepEqual(fs.readdirSync(baseDir), ['users.csv'])
  assert.ok(client.sql.some((q) => /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/.test(q)))
  assert.ok(client.sql.some((q) => /^DECLARE tagger_export NO SCROLL CURSOR/.test(q)))
  assert.ok(client.sql.includes('ROLLBACK'))
  assert.ok(!client.sql.some((q) => /OFFSET/.test(q)))
})

test('N06: 성공하면 새 CSV로 바꿔 끼우고, 머리글도 CSV 규칙으로 감싼다', async (t) => {
  const root = tmpdir(t, 'n06b-')
  const ctx = ctxFor(root)
  const baseDir = path.join(ctx.ws.dbDownloadsRoot, 'db1', 'public')
  fs.mkdirSync(baseDir, { recursive: true })
  fs.writeFileSync(path.join(baseDir, 'users.csv'), 'OLD COPY\n')
  const client = fakeClient({ rows: [{ id: 1, 'note, with comma': 'a' }, { id: 2, 'note, with comma': null }] })
  const saved = await exportOneTable(client, ctx, 'public', 'users', baseDir, { ti: 0, total: 1, schema: 'public' })
  const text = fs.readFileSync(saved, 'utf8')
  assert.match(text, /^id,"note, with comma"\n/)
  assert.match(text, /\n1,a\n2,\n$/)
  assert.ok(client.sql.includes('COMMIT'))
  assert.deepEqual(fs.readdirSync(baseDir), ['users.csv'])
})

test('N08: DB 값 직렬화 — 객체는 JSON, 바이너리는 16진수, 따옴표·쉼표·줄바꿈·앞뒤 공백은 감싼다', () => {
  assert.equal(csvValue({ a: 1 }), '"{""a"":1}"')
  assert.equal(csvValue([1, 'x']), '"[1,""x""]"')
  assert.equal(csvValue(Buffer.from([0xde, 0xad])), '\\xdead')
  assert.equal(csvValue(null), '')
  assert.equal(csvValue(true), 'true')
  assert.equal(csvValue('2026-11-15 05:23:06'), '2026-11-15 05:23:06')
  assert.equal(csvCell(' pad'), '" pad"')
  assert.equal(csvCell('a\nb'), '"a\nb"')
})
