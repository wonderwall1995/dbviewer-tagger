// D-3: Web 견본 작업 폴더(samples/workspace)가 공개해도 되는 상태이고, 면접관이 바로 쓸 수 있는지 확인한다.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createTaggerServer } = require('../apps/server/dist/server.js')

const SAMPLE = path.join(__dirname, '..', 'samples', 'workspace')

function allFiles(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...allFiles(p))
    else out.push(p)
  }
  return out
}

test('견본에 이 PC의 절대 경로, 로그, 캐시, 백업이 없다', () => {
  const files = allFiles(SAMPLE)
  assert.ok(files.length > 0)
  for (const f of files) {
    const rel = path.relative(SAMPLE, f).split(path.sep).join('/')
    assert.ok(!/^(local\/(logs|tmp|web-data)|backups|CED)\//.test(rel), rel)
    const text = fs.readFileSync(f, 'utf8')
    assert.ok(!/[A-Za-z]:[\\/]{1,2}(Users|git-private)/i.test(text), `절대 경로: ${rel}`)
    assert.ok(!/\/home\/|\/Users\//.test(text), `절대 경로: ${rel}`)
  }
})

test('users.csv의 이메일은 비어 있고, 전화번호는 누가 봐도 가짜인 번호다', () => {
  const lines = fs.readFileSync(path.join(SAMPLE, 'DB-downloads', '웹데모', 'public', 'users.csv'), 'utf8').trim().split(/\r?\n/)
  const head = lines[0].split(',')
  const iEmail = head.indexOf('email')
  const iPhone = head.indexOf('phoneNumber')
  for (const line of lines.slice(3)) {
    const cells = line.split(',')
    assert.equal(cells[iEmail] ?? '', '')
    assert.match(cells[iPhone] ?? '', /^(|010-0000-\d{4})$/)
  }
})

test('견본으로 시작한 세션에서 CSV, Keyinfo, Key 노트, CED 미리보기가 된다', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samples-'))
  const { server } = createTaggerServer({ dataDir, sampleDir: SAMPLE, openAccess: true })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); fs.rmSync(dataDir, { recursive: true, force: true }) }))
  const base = `http://127.0.0.1:${server.address().port}`
  let cookie = ''
  const call = async (channel, ...args) => {
    const res = await fetch(`${base}/api/call/${channel}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ args }) })
    const c = res.headers.get('set-cookie'); if (c) cookie = c.split(';')[0]
    const body = await res.json()
    assert.equal(body.ok, true, `${channel}: ${body.error}`)
    return body.value
  }

  const sheets = await call('sheet:loadSettings')
  assert.equal(sheets.sheets.length, 1)
  const local = await call('local:load')
  assert.equal(local.product, 'rwa')
  const sources = Object.values(local.fileSources)
  assert.equal(sources.length, 9)
  // 프리셋의 상대 경로가 세션 폴더 기준으로 풀리고, 그 파일을 읽을 수 있다
  const users = sources.find((s) => s.path.endsWith('users.csv'))
  assert.match(await call('local:readFile', users.path), /^id,uuid,firstName/)
  assert.equal((await call('csv:stats', users.path)).rows, 6)

  assert.deepEqual(await call('lorebook:getCategories'), ['rwa'])
  const ki = await call('keyinfo:load', 'rwa')
  assert.ok(ki.pinnedColumns.length > 0)
  const notes = await call('keynote:list', 'rwa')
  assert.ok(notes.some((n) => n.status === 'confirmed'))

  const ced = await call('ced:read', 'rwa')
  assert.equal(ced.folder, 'rwa')
  assert.ok(ced.files.some((f) => f.name === 'rwa.md'))
  assert.ok(ced.files.length >= 2, '확인된 Key 노트 문서가 있어야 한다')
})
