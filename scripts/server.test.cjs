const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createTaggerServer } = require('../dist/server/server/server.js')

async function start(t, opts = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagger-web-'))
  const { server, sessions } = createTaggerServer({ dataDir, ...opts })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); fs.rmSync(dataDir, { recursive: true, force: true }) }))
  const base = `http://127.0.0.1:${server.address().port}`
  // 브라우저 한 개처럼 쿠키를 기억하는 호출기
  const client = () => {
    let cookie = ''
    const remember = (res) => { const c = res.headers.get('set-cookie'); if (c) cookie = c.split(';')[0] }
    return {
      async call(channel, ...args) {
        const res = await fetch(`${base}/api/call/${encodeURIComponent(channel)}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ args }) })
        remember(res)
        return { status: res.status, body: await res.json() }
      },
      async upload(name, content) {
        const res = await fetch(`${base}/api/upload?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { cookie }, body: content })
        remember(res)
        return { status: res.status, body: await res.json() }
      },
      get cookie() { return cookie },
    }
  }
  return { base, client, sessions, dataDir }
}

test('health', async (t) => {
  const { base } = await start(t)
  assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true })
})

test('면접관(세션)마다 작업 폴더가 따로 있다', async (t) => {
  const { client, sessions } = await start(t)
  const a = client()
  const b = client()
  await a.call('local:save', { folders: [{ id: 'f', name: 'A', expanded: true }], fileToFolder: {}, fileSources: {} })
  assert.equal((await a.call('local:load')).body.value.folders.length, 1)
  assert.equal((await b.call('local:load')).body.value.folders.length, 0)
  assert.equal(sessions.size, 2)
  assert.notEqual(a.cookie, b.cookie)
})

test('데스크톱 전용 기능과 없는 채널은 404', async (t) => {
  const { client } = await start(t)
  const c = client()
  for (const ch of ['hermes:loadConfig', 'ssh:pickPemFile', 'workspace:save', 'ced:setDir', 'dialog:openCsv', 'constructor', '__proto__']) {
    assert.equal((await c.call(ch)).status, 404, ch)
  }
})

test('작업 폴더 밖의 파일은 읽지 못한다', async (t) => {
  const { client, dataDir } = await start(t)
  const c = client()
  await c.call('local:load')
  const secret = path.join(dataDir, 'secret.txt')
  fs.writeFileSync(secret, 'secret')
  const r = await c.call('local:readFile', secret)
  assert.equal(r.body.ok, false)
  assert.ok(!JSON.stringify(r.body).includes('secret"'))
})

test('업로드: 세션 폴더에 저장하고 읽을 수 있다. 이름 검사와 크기 제한을 지킨다', async (t) => {
  const { client } = await start(t, { maxUploadBytes: 64 })
  const c = client()
  const up = await c.upload('users.csv', 'id,name\n1,a\n')
  assert.equal(up.body.ok, true)
  assert.equal((await c.call('local:readFile', up.body.value.path)).body.value, 'id,name\n1,a\n')
  assert.equal((await c.upload('../evil.csv', 'x')).status, 400)
  assert.equal((await c.upload('a/b.csv', 'x')).body.value.name, 'a_b.csv')
  assert.equal((await c.upload('note.txt', 'x')).status, 400)
  const big = await c.upload('big.csv', 'x'.repeat(200))
  assert.equal(big.status, 413)
})

test('진행률 알림은 그 세션의 SSE로만 간다', async (t) => {
  const { base, client, sessions } = await start(t)
  const a = client()
  await a.call('local:load')
  const ctrl = new AbortController()
  t.after(() => ctrl.abort())
  const res = await fetch(`${base}/api/events`, { headers: { cookie: a.cookie }, signal: ctrl.signal })
  const reader = res.body.getReader()
  await reader.read() // ': connected'
  const sa = [...sessions.values()].find((s) => s.streams.size === 1)
  sa.ctx.emit('db:exportProgress', { ti: 0 })
  const { value } = await reader.read()
  assert.match(Buffer.from(value).toString(), /"channel":"db:exportProgress"/)
})

test('ced:read는 문서 내용만 돌려주고 서버 폴더 경로는 돌려주지 않는다', async (t) => {
  const { client, dataDir } = await start(t)
  const c = client()
  const note = { id: 'n1', title: '회원 ID', definition: '정의', status: 'confirmed', body: '', keywords: [], valueMeanings: '', members: [], excluded: [] }
  await c.call('keynote:save', 'shop', [note])
  const r = await c.call('ced:read', 'shop')
  assert.equal(r.body.ok, true)
  assert.equal(r.body.value.folder, 'shop')
  assert.deepEqual(r.body.value.files.map((f) => f.name).sort(), ['shop.md', '회원 ID.md'])
  // JSON 안에서는 역슬래시가 두 개로 바뀌므로, 경로를 JSON 문자열로 바꿔서 찾는다.
  assert.ok(!JSON.stringify(r.body).includes(JSON.stringify(dataDir).slice(1, -1)))
  assert.ok(!JSON.stringify(r.body).includes('sessions'))
})

test('면접관 A는 면접관 B의 파일 경로를 알아도 읽거나 지우거나 고치지 못한다', async (t) => {
  const { client } = await start(t)
  const a = client()
  const b = client()
  const up = await b.upload('b-secret.csv', 'id\n42\n')
  const bPath = up.body.value.path
  const read = await a.call('local:readFile', bPath)
  assert.equal(read.body.ok, false)
  assert.ok(!JSON.stringify(read.body).includes('42'))
  assert.equal((await a.call('csv:stats', bPath)).body.value, null)
  assert.equal((await a.call('local:eraseColumn', bPath, 'id')).body.ok, false)
  await a.call('local:deleteDownload', bPath)
  // B의 파일은 그대로다
  assert.equal((await b.call('local:readFile', bPath)).body.value, 'id\n42\n')
})
