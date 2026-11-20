// 배포용 묶음(apps/server/bundle)이 node_modules 없이 혼자 도는지, TCP와 소켓 두 방식으로 받는지 확인한다.
// 먼저 pnpm bundle:server 로 묶음을 만든다 (pnpm test가 만든다).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { spawn, spawnSync } = require('node:child_process')

const BUNDLE = path.join(__dirname, '..', 'apps', 'server', 'bundle')

// 저장소 밖 빈 폴더로 복사한다. 여기에는 node_modules가 없다.
// 정리 순서: 띄운 서버를 끝내고, 끝날 때까지 기다린 뒤 폴더를 지운다 (Windows는 쓰는 중인 폴더를 못 지운다).
function isolatedCopy(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'))
  const children = []
  t.after(async () => {
    for (const c of children) {
      if (c.exitCode === null && c.signalCode === null) {
        const exited = new Promise((r) => c.once('exit', r))
        c.kill()
        await exited
      }
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  for (const f of ['tagger-server.js', 'tagger-admin.js']) fs.copyFileSync(path.join(BUNDLE, f), path.join(dir, f))
  return { dir, children }
}

function get(options) {
  return new Promise((resolve, reject) => {
    // agent: false — 연결을 붙잡아 두지 않는다 (붙잡으면 시험 프로세스가 끝나지 않는다).
    const req = http.get({ path: '/api/health', agent: false, ...options }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', reject)
    req.setTimeout(2000, () => req.destroy(new Error('timeout')))
  })
}

async function waitHealthy(options) {
  for (let i = 0; i < 50; i++) {
    try { return await get(options) } catch { await new Promise((r) => setTimeout(r, 100)) }
  }
  throw new Error('서버가 응답하지 않음')
}

function startServer(copy, env) {
  const child = spawn(process.execPath, [path.join(copy.dir, 'tagger-server.js')], { cwd: copy.dir, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env }, stdio: 'pipe' })
  copy.children.push(child)
  let err = ''
  child.stderr.on('data', (c) => { err += c })
  return { child, stderr: () => err }
}

test('묶음은 node_modules 없이 TCP 포트로 뜨고, 운영 모드에서는 입장 코드를 요구한다', async (t) => {
  const copy = isolatedCopy(t)
  const dir = copy.dir
  const dataDir = path.join(dir, 'data')
  const port = 17000 + Math.floor(Math.random() * 2000)
  startServer(copy, { NODE_ENV: 'production', TAGGER_DATA_DIR: dataDir, TAGGER_PORT: String(port) })
  const r = await waitHealthy({ host: '127.0.0.1', port })
  assert.equal(r.status, 200)
  const s = await get({ host: '127.0.0.1', port, path: '/api/session' })
  assert.deepEqual(JSON.parse(s.body).value, { loggedIn: false, open: false })
})

test('묶음은 소켓(유닉스 소켓, Windows는 named pipe)으로 뜬다', async (t) => {
  const copy = isolatedCopy(t)
  const dir = copy.dir
  const socketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\tagger-test-${process.pid}-${Date.now()}`
    : path.join(dir, 'tagger.sock')
  startServer(copy, { NODE_ENV: 'production', TAGGER_DATA_DIR: path.join(dir, 'data'), TAGGER_SOCKET: socketPath })
  const r = await waitHealthy({ socketPath })
  assert.equal(r.status, 200)
  if (process.platform !== 'win32') assert.equal(fs.statSync(socketPath).mode & 0o777, 0o660)
})

test('관리 명령 묶음도 혼자 돈다', (t) => {
  const copy = isolatedCopy(t)
  const dir = copy.dir
  const r = spawnSync(process.execPath, [path.join(dir, 'tagger-admin.js'), 'status'], { cwd: dir, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'production', TAGGER_DATA_DIR: path.join(dir, 'data') }, encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /입장 코드가 없습니다/)
})
