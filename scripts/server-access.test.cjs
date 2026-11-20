// D1: Web 입장 코드 (공용 비밀번호 하나, 기본 60일, 만료 전 여러 번 입장).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { generateCode, writeAccess, readAccess, checkCode, revokeAccess, LoginLimiter, accessFile } = require('../apps/server/dist/access.js')
const { createTaggerServer } = require('../apps/server/dist/server.js')

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'access-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('코드 형식과 저장: 원문은 저장하지 않고, 기본 만료는 60일', (t) => {
  const dir = tmp(t)
  const code = generateCode()
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
  const now = new Date('2026-11-20T00:00:00Z')
  const r = writeAccess(dir, code, undefined, now)
  assert.equal(r.expiresAt, '2027-01-19T00:00:00.000Z')
  const raw = fs.readFileSync(accessFile(dir), 'utf8')
  assert.ok(!raw.includes(code) && !raw.includes(code.replace(/-/g, '')))
  assert.deepEqual(readAccess(dir), r)
})

test('코드 확인: 맞음, 틀림, 만료, 없음. 소문자·공백·하이픈 없이 넣어도 맞다', (t) => {
  const dir = tmp(t)
  const r = writeAccess(dir, 'ABCD-EFGH-JKMN', 60, new Date('2026-11-20T00:00:00Z'))
  const day = Date.parse('2026-12-01T00:00:00Z')
  assert.equal(checkCode(r, 'ABCD-EFGH-JKMN', day), 'ok')
  assert.equal(checkCode(r, ' abcd efgh jkmn ', day), 'ok')
  assert.equal(checkCode(r, 'ABCDEFGHJKMN', day), 'ok')
  assert.equal(checkCode(r, 'ABCD-EFGH-JKMP', day), 'wrong')
  assert.equal(checkCode(r, 12345, day), 'wrong')
  assert.equal(checkCode(r, 'x'.repeat(100), day), 'wrong')
  assert.equal(checkCode(r, 'ABCD-EFGH-JKMN', Date.parse('2027-02-01T00:00:00Z')), 'expired')
  assert.equal(checkCode(null, 'ABCD-EFGH-JKMN'), 'no-code')
  assert.equal(revokeAccess(dir), true)
  assert.equal(readAccess(dir), null)
})

test('입장 실패 제한: 10분 동안 10번 틀리면 막고, 시간이 지나면 풀린다', () => {
  const l = new LoginLimiter(3, 1000)
  for (let i = 0; i < 3; i++) l.fail('a', 0)
  assert.equal(l.blocked('a', 10), true)
  assert.equal(l.blocked('b', 10), false)
  assert.equal(l.blocked('a', 2000), false)
})

async function start(t, opts = {}) {
  const dataDir = tmp(t)
  const made = createTaggerServer({ dataDir, ...opts })
  await new Promise((r) => made.server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise((r) => { made.server.closeAllConnections?.(); made.server.close(r) }))
  const base = `http://127.0.0.1:${made.server.address().port}`
  const client = () => {
    let cookie = ''
    const keep = (res) => { const c = res.headers.get('set-cookie'); if (c) cookie = c.split(';')[0] }
    return {
      async login(code) {
        const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
        keep(res)
        return { status: res.status, body: await res.json() }
      },
      async session() { return (await (await fetch(`${base}/api/session`, { headers: { cookie } })).json()).value },
      async call(channel, ...args) {
        const res = await fetch(`${base}/api/call/${channel}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ args }) })
        keep(res)
        return { status: res.status, body: await res.json() }
      },
      async upload() {
        const res = await fetch(`${base}/api/upload?name=a.csv`, { method: 'POST', headers: { cookie }, body: 'a\n1\n' })
        return res.status
      },
      async events() {
        const res = await fetch(`${base}/api/events`, { headers: { cookie } })
        const s = res.status
        await res.body?.cancel()
        return s
      },
    }
  }
  return { ...made, dataDir, client }
}

test('입장 코드를 쓰는 서버: 입장 전에는 모든 API가 401, 세션도 만들지 않는다', async (t) => {
  const { client, sessions, dataDir } = await start(t)
  writeAccess(dataDir, 'ABCD-EFGH-JKMN')
  const c = client()
  assert.deepEqual(await c.session(), { loggedIn: false, open: false })
  assert.equal((await c.call('local:load')).status, 401)
  assert.equal(await c.upload(), 401)
  assert.equal(await c.events(), 401)
  assert.equal(sessions.size, 0)
})

test('맞는 코드로 입장하면 세션이 생기고 API를 쓸 수 있다. 같은 코드로 여러 사람이 각자 입장한다', async (t) => {
  const { client, sessions, dataDir } = await start(t)
  writeAccess(dataDir, 'ABCD-EFGH-JKMN')
  const a = client(); const b = client()
  assert.equal((await a.login('abcd-efgh-jkmn')).status, 200)
  assert.equal((await b.login('ABCD-EFGH-JKMN')).status, 200)
  assert.equal(sessions.size, 2)
  assert.equal((await a.session()).loggedIn, true)
  assert.equal((await a.call('local:load')).status, 200)
  // 이미 들어온 사람이 다시 입장해도 세션이 늘지 않는다
  await a.login('ABCD-EFGH-JKMN')
  assert.equal(sessions.size, 2)
})

test('틀린 코드, 만료된 코드, 코드 없음', async (t) => {
  const { client, dataDir } = await start(t)
  const c = client()
  assert.equal((await c.login('ABCD-EFGH-JKMN')).status, 503)
  writeAccess(dataDir, 'ABCD-EFGH-JKMN')
  const wrong = await c.login('ZZZZ-ZZZZ-ZZZZ')
  assert.equal(wrong.status, 401)
  assert.match(wrong.body.error, /맞지 않/)
  writeAccess(dataDir, 'ABCD-EFGH-JKMN', 1, new Date('2020-01-01T00:00:00Z'))
  const expired = await c.login('ABCD-EFGH-JKMN')
  assert.equal(expired.status, 401)
  assert.match(expired.body.error, /만료/)
})

test('같은 곳에서 10번 틀리면 맞는 코드도 잠시 막는다', async (t) => {
  const { client, dataDir } = await start(t)
  writeAccess(dataDir, 'ABCD-EFGH-JKMN')
  const c = client()
  for (let i = 0; i < 10; i++) await c.login('ZZZZ-ZZZZ-ZZZZ')
  assert.equal((await c.login('ABCD-EFGH-JKMN')).status, 429)
})

test('관리 명령: set-code는 코드를 한 번 보여 주고, status와 revoke가 동작한다', (t) => {
  const dataDir = tmp(t)
  const env = { ...process.env, TAGGER_DATA_DIR: dataDir, NODE_ENV: 'production' }
  const run = (...args) => spawnSync(process.execPath, ['apps/server/dist/admin.js', ...args], { env, encoding: 'utf8', timeout: 10_000 })
  const set = run('set-code', '--days', '60')
  assert.equal(set.status, 0)
  const code = set.stdout.match(/[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/)[0]
  assert.equal(checkCode(readAccess(dataDir), code), 'ok')
  assert.match(run('status').stdout, /있음/)
  assert.ok(!run('status').stdout.includes(code))
  assert.equal(run('set-code', '--days', '0').status, 1)
  assert.match(run('revoke').stdout, /지웠습니다/)
  assert.match(run('status').stdout, /없습니다/)
})

test('열린 서버(개발용): /api/session이 세션을 하나 만들고, 그 뒤 동시에 보낸 요청은 같은 세션을 쓴다', async (t) => {
  const { server, sessions } = await start(t, { openAccess: true })
  const base = `http://127.0.0.1:${server.address().port}`
  // 화면(WebGate)이 하는 순서: /api/session 먼저 → 받은 쿠키로 앱의 요청을 동시에 보낸다
  const res = await fetch(`${base}/api/session`)
  assert.deepEqual((await res.json()).value, { loggedIn: true, open: true })
  const cookie = res.headers.get('set-cookie').split(';')[0]
  const results = await Promise.all(Array.from({ length: 10 }, () =>
    fetch(`${base}/api/call/local:load`, { method: 'POST', headers: { cookie }, body: '{"args":[]}' }).then((r) => r.status)))
  assert.deepEqual([...new Set(results)], [200])
  assert.equal(sessions.size, 1)
})
