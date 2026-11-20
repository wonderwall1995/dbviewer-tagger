// B5·B6·B7: 세션 수·용량 상한, 세션 만료와 견본 복사, 오류 문구의 경로 가리기.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createTaggerServer, publicError } = require('../apps/server/dist/server.js')

async function start(t, opts = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-lim-'))
  const made = createTaggerServer({ dataDir, ...opts })
  await new Promise((r) => made.server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise((r) => { made.server.closeAllConnections?.(); made.server.close(r); fs.rmSync(dataDir, { recursive: true, force: true }) }))
  const base = `http://127.0.0.1:${made.server.address().port}`
  const client = () => {
    let cookie = ''
    const keep = (res) => { const c = res.headers.get('set-cookie'); if (c) cookie = c.split(';')[0] }
    return {
      async call(channel, ...args) {
        const res = await fetch(`${base}/api/call/${channel}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ args }) })
        keep(res)
        return { status: res.status, body: await res.json() }
      },
      async upload(name, content) {
        const res = await fetch(`${base}/api/upload?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { cookie }, body: content })
        keep(res)
        return { status: res.status, body: await res.json() }
      },
      async raw(channel, text) {
        const res = await fetch(`${base}/api/call/${channel}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: text })
        keep(res)
        return { status: res.status, body: await res.json() }
      },
    }
  }
  return { ...made, base, client, dataDir }
}

test('세션 수 상한을 넘으면 새 사용자를 받지 않는다 (기존 사용자는 계속 쓴다)', async (t) => {
  const { client } = await start(t, { maxSessions: 2 })
  const a = client(); const b = client(); const c = client()
  assert.equal((await a.call('local:load')).status, 200)
  assert.equal((await b.call('local:load')).status, 200)
  const r = await c.call('local:load')
  assert.equal(r.status, 503)
  assert.match(r.body.error, /많아요/)
  assert.equal((await a.call('local:load')).status, 200)
})

test('세션 용량 상한: 업로드가 넘치면 거절하고, 지우면 다시 올릴 수 있다', async (t) => {
  const { client } = await start(t, { sessionDiskBytes: 1000, maxUploadBytes: 10_000 })
  const a = client()
  const first = await a.upload('a.csv', 'x'.repeat(600))
  assert.equal(first.body.ok, true)
  const second = await a.upload('b.csv', 'y'.repeat(600))
  assert.equal(second.status, 507)
  assert.match(second.body.error, /용량/)
  // 용량이 차도 지우기(작은 요청)는 된다
  assert.equal((await a.call('local:deleteDownload', first.body.value.path)).body.ok, true)
  assert.equal((await a.upload('b.csv', 'y'.repeat(600))).body.ok, true)
})

test('세션 용량 상한: DB 내보내기 쓰기도 reserveDisk로 멈춘다', async (t) => {
  const { client, sessions } = await start(t, { sessionDiskBytes: 1000 })
  const a = client()
  await a.call('local:load')
  const s = [...sessions.values()][0]
  // 내보내기가 실제로 900바이트를 쓴 상태
  s.ctx.reserveDisk(900)
  fs.mkdirSync(s.ctx.ws.dbDownloadsRoot, { recursive: true })
  fs.writeFileSync(path.join(s.ctx.ws.dbDownloadsRoot, 't.csv'), 'z'.repeat(900))
  assert.throws(() => s.ctx.reserveDisk(200), /용량/)
  // 예약만 하고 쓰지 않은 양은 실제로 다시 재서 바로잡는다
  fs.rmSync(path.join(s.ctx.ws.dbDownloadsRoot, 't.csv'))
  assert.doesNotThrow(() => s.ctx.reserveDisk(200))
})

test('세션 만료: 오래 쓰지 않은 세션은 폴더와 함께 지운다', async (t) => {
  const { client, sessions, sweep } = await start(t, { sessionIdleMs: 1000 })
  const a = client()
  await a.call('local:load')
  const s = [...sessions.values()][0]
  assert.ok(fs.existsSync(s.root))
  sweep(Date.now() + 5000)
  assert.equal(sessions.size, 0)
  assert.equal(fs.existsSync(s.root), false)
})

test('서버를 다시 시작하면 주인 없는 예전 세션 폴더를 비운다', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-restart-'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const old = path.join(dataDir, 'sessions', 'old-session')
  fs.mkdirSync(old, { recursive: true })
  const keep = path.join(dataDir, 'keep.txt')
  fs.writeFileSync(keep, 'x')
  const { server } = createTaggerServer({ dataDir })
  server.close()
  assert.equal(fs.existsSync(old), false)
  assert.ok(fs.existsSync(keep))
})

test('견본 폴더: 모든 세션이 같은 견본의 복사본으로 시작하고, 서로의 수정이 섞이지 않는다', async (t) => {
  const sampleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-'))
  t.after(() => fs.rmSync(sampleDir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(sampleDir, 'local', 'presets'), { recursive: true })
  fs.writeFileSync(path.join(sampleDir, 'local', 'presets', 'local.json'), JSON.stringify({ folders: [{ id: 's', name: '견본', expanded: true }], fileToFolder: {}, fileSources: {} }))
  const { client } = await start(t, { sampleDir })
  const a = client(); const b = client()
  assert.equal((await a.call('local:load')).body.value.folders[0].name, '견본')
  await a.call('local:save', { folders: [], fileToFolder: {}, fileSources: {} })
  assert.equal((await a.call('local:load')).body.value.folders.length, 0)
  assert.equal((await b.call('local:load')).body.value.folders[0].name, '견본')
  // 원본 견본은 그대로
  assert.match(fs.readFileSync(path.join(sampleDir, 'local', 'presets', 'local.json'), 'utf8'), /견본/)
})

test('오류 문구에 서버 폴더 경로를 내보내지 않는다', async (t) => {
  const { client, dataDir } = await start(t)
  const a = client()
  await a.call('local:load')
  // 세션 폴더 안의 없는 파일을 읽으면 fs 오류(전체 경로 포함)가 난다
  const missing = path.join(dataDir, 'sessions')
  const r = await a.call('lorebook:getColumnComments', 'x.csv')
  assert.equal(r.body.ok, true)
  const e = publicError(new Error(`ENOENT: no such file or directory, open '${path.join(dataDir, 'sessions', 'abc', 'x.csv')}'`), dataDir)
  assert.ok(!e.includes(dataDir), e)
  assert.ok(!e.includes(missing))
  assert.match(publicError(new Error("EACCES: permission denied, open 'C:\\Windows\\x'"), dataDir), /'\(경로\)'/)
  assert.match(publicError(new Error("EACCES: permission denied, open '/etc/shadow'"), dataDir), /'\(경로\)'/)
})

test('잘못된 JSON 본문은 400', async (t) => {
  const { client } = await start(t)
  const a = client()
  assert.equal((await a.raw('local:load', '{not json')).status, 400)
})
