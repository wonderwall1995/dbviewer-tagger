// Web 입장: 코드 없이 "들어가기"(POST /api/login)로 세션을 만든다. 페이지만 여는 것으로는 세션이 생기지 않는다.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createTaggerServer } = require('../apps/server/dist/server.js')

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'access-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

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
      async login() {
        const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { cookie } })
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

test('입장 전에는 모든 API가 401이고, 페이지를 여는 것만으로 세션이 생기지 않는다', async (t) => {
  const { client, sessions } = await start(t)
  const c = client()
  assert.deepEqual(await c.session(), { loggedIn: false, open: false })
  assert.equal((await c.call('local:load')).status, 401)
  assert.equal(await c.upload(), 401)
  assert.equal(await c.events(), 401)
  assert.equal(sessions.size, 0)
})

test('코드 없이 들어가면 세션이 생기고 API를 쓸 수 있다. 사람마다 세션이 따로다', async (t) => {
  const { client, sessions } = await start(t)
  const a = client(); const b = client()
  assert.equal((await a.login()).status, 200)
  assert.equal((await b.login()).status, 200)
  assert.equal(sessions.size, 2)
  assert.equal((await a.session()).loggedIn, true)
  assert.equal((await a.call('local:load')).status, 200)
  // 이미 들어온 사람이 다시 들어와도 세션이 늘지 않는다
  await a.login()
  assert.equal(sessions.size, 2)
})

test('예전 화면이 코드를 보내도 그대로 들어간다', async (t) => {
  const { server, sessions } = await start(t)
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'x' }) })
  assert.equal(res.status, 200)
  assert.equal(sessions.size, 1)
})

test('자리가 다 차면 503으로 알리고, 이미 들어온 사람은 계속 쓴다', async (t) => {
  const { client } = await start(t, { maxSessions: 1 })
  const a = client(); const b = client()
  assert.equal((await a.login()).status, 200)
  const full = await b.login()
  assert.equal(full.status, 503)
  assert.match(full.body.error, /사용하는 사람이 많아요/)
  assert.equal((await a.call('local:load')).status, 200)
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
