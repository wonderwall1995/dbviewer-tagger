// B8: 운영 설정 검사, Secure 쿠키, 응답 머리글.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { loadConfig } = require('../apps/server/dist/config.js')
const { createTaggerServer } = require('../apps/server/dist/server.js')

test('기본값 (개발)', () => {
  const c = loadConfig({}, '/work')
  assert.equal(c.port, 6201)
  assert.equal(c.production, false)
  assert.equal(c.server.secureCookie, false)
  assert.equal(c.server.maxSessions, 10)
  assert.equal(c.server.sessionDiskBytes, 200 * 1024 * 1024)
})

test('운영 모드는 TAGGER_DATA_DIR 절대 경로가 필요하고, 쿠키에 Secure를 붙인다', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /TAGGER_DATA_DIR/)
  assert.throws(() => loadConfig({ NODE_ENV: 'production', TAGGER_DATA_DIR: 'relative/dir' }), /TAGGER_DATA_DIR/)
  const abs = path.resolve(os.tmpdir(), 'tagger-prod')
  const c = loadConfig({ NODE_ENV: 'production', TAGGER_DATA_DIR: abs })
  assert.equal(c.server.dataDir, abs)
  assert.equal(c.server.secureCookie, true)
})

test('숫자 설정이 범위를 벗어나면 시작하지 않는다', () => {
  assert.throws(() => loadConfig({ TAGGER_PORT: '80' }), /TAGGER_PORT/)
  assert.throws(() => loadConfig({ TAGGER_PORT: 'abc' }), /TAGGER_PORT/)
  assert.throws(() => loadConfig({ TAGGER_MAX_SESSIONS: '0' }), /TAGGER_MAX_SESSIONS/)
  assert.throws(() => loadConfig({ TAGGER_SESSION_MB: '1.5' }), /TAGGER_SESSION_MB/)
})

test('설정 오류가 있으면 서버 프로세스가 종료 코드 1로 멈춘다', () => {
  const r = spawnSync(process.execPath, ['apps/server/dist/index.js'], { env: { ...process.env, NODE_ENV: 'production', TAGGER_DATA_DIR: '' }, encoding: 'utf8', timeout: 10_000 })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /설정 오류/)
})

test('Secure 쿠키와 응답 머리글(no-store, nosniff)', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'))
  const { server } = createTaggerServer({ dataDir, secureCookie: true })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); fs.rmSync(dataDir, { recursive: true, force: true }) }))
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/call/local:load`, { method: 'POST', body: '{"args":[]}' })
  assert.match(res.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Path=\/; Secure/)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
})
