// D-3: Web 견본 작업 폴더(samples/workspace)가 공개해도 되는 상태이고, 면접관이 바로 쓸 수 있는지 확인한다.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const Papa = require('papaparse')
const { SECRET_MASK, SECRET_COLUMNS, PHONE_COLUMNS, META_ROWS, maskPhone } = require('./sample-mask.cjs')
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

const sampleCsvs = () => allFiles(path.join(SAMPLE, 'DB-downloads')).map((file) => ({
  file: path.relative(SAMPLE, file).split(path.sep).join('/'),
  rows: Papa.parse(fs.readFileSync(file, 'utf8'), { skipEmptyLines: true }).data,
}))
const userRowCount = () => sampleCsvs().find((c) => c.file.endsWith('public/users.csv')).rows.length - META_ROWS

test('전화번호 가리기: 여러 모양의 번호에서 앞 두 자리씩만 남고, 모르는 모양은 모두 가린다', () => {
  assert.equal(maskPhone('010-1234-5678'), '010-12■■-56■■')
  assert.equal(maskPhone('01012345678'), '010-12■■-56■■')
  assert.equal(maskPhone('+82 10-1234-5678'), '+82 10-12■■-56■■')
  assert.equal(maskPhone('(02) 123-4567'), '(02) 12■-45■■')
  assert.equal(maskPhone('+821012345678'), '+■■■■■■■■■■■■')
  assert.equal(maskPhone('1234-5678'), '■■■■-■■■■')
})

test('견본 CSV의 비밀번호, 토큰 해시, 전화번호는 모두 가려져 있고 이메일은 비어 있다', () => {
  let secrets = 0
  let phones = 0
  for (const { file, rows } of sampleCsvs()) {
    for (const row of rows.slice(META_ROWS)) {
      rows[0].forEach((column, i) => {
        const cell = row[i] ?? ''
        // 값은 오류 문구에 찍지 않는다.
        const where = `${file} ${column}`
        if (SECRET_COLUMNS.has(column) && cell) { secrets++; assert.ok(cell === SECRET_MASK, where) }
        if (PHONE_COLUMNS.has(column) && cell) { phones++; assert.ok(/■/.test(cell) && !/\d{4}/.test(cell), where) }
        if (column === 'email') assert.ok(cell === '', where)
        // 다른 열에 섞여 들어간 비밀번호 해시와 전화번호도 찾는다.
        assert.ok(!/\$2[aby]\$\d\d\$/.test(cell), `비밀번호 해시: ${where}`)
        assert.ok(!/(^|\D)010[-. ]?\d{4}[-. ]?\d{4}(\D|$)/.test(cell), `전화번호: ${where}`)
      })
    }
  }
  assert.ok(secrets > 0 && phones > 0)
})

test('견본 사이드바는 견본 CSV 전부를 스키마 폴더에 넣어 보여 준다', () => {
  const preset = JSON.parse(fs.readFileSync(path.join(SAMPLE, 'local', 'presets', 'local.json'), 'utf8'))
  assert.deepEqual(Object.values(preset.fileSources).map((s) => s.path).sort(), sampleCsvs().map((c) => c.file).sort())
  assert.deepEqual(preset.folders.map((f) => f.name).sort(), ['웹데모.public', '웹데모.testschema'])
  for (const [name, src] of Object.entries(preset.fileSources)) {
    const folder = preset.folders.find((f) => f.id === preset.fileToFolder[name])
    assert.equal(folder?.name, `웹데모.${src.path.split('/')[2]}`, name)
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
  assert.equal(sources.length, sampleCsvs().length)
  // 프리셋의 상대 경로가 세션 폴더 기준으로 풀리고, 그 파일을 읽을 수 있다
  const users = sources.find((s) => s.path.endsWith('users.csv'))
  assert.match(await call('local:readFile', users.path), /^id,uuid,firstName/)
  assert.equal((await call('csv:stats', users.path)).rows, userRowCount())

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

test('견본 재생성: 지운 CSV가 새 견본 복사본으로 돌아오고, 세션 수는 늘지 않으며, 예전 폴더는 지운다', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-'))
  const { server, sessions } = createTaggerServer({ dataDir, sampleDir: SAMPLE, openAccess: true })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); fs.rmSync(dataDir, { recursive: true, force: true }) }))
  const base = `http://127.0.0.1:${server.address().port}`
  let cookie = ''
  const keep = (res) => { const c = res.headers.get('set-cookie'); if (c) cookie = c.split(';')[0] }
  const call = async (channel, ...args) => {
    const res = await fetch(`${base}/api/call/${channel}`, { method: 'POST', headers: { cookie }, body: JSON.stringify({ args }) })
    keep(res)
    return (await res.json()).value
  }
  // 세션 없이 재생성은 거절
  assert.equal((await fetch(`${base}/api/reset`, { method: 'POST' })).status, 401)

  keep(await fetch(`${base}/api/session`))
  const users = Object.values((await call('local:load')).fileSources).find((s) => s.path.endsWith('users.csv'))
  await call('local:deleteDownload', users.path)
  assert.equal((await call('csv:stats', users.path)).missing, true)
  const oldRoot = [...sessions.values()][0].root
  const oldCookie = cookie

  const res = await fetch(`${base}/api/reset`, { method: 'POST', headers: { cookie } })
  assert.equal(res.status, 200)
  keep(res)
  assert.notEqual(cookie, oldCookie)
  assert.equal(sessions.size, 1)
  assert.equal(fs.existsSync(oldRoot), false)
  // 새 세션에서는 견본 CSV가 다시 있다
  const fresh = Object.values((await call('local:load')).fileSources).find((s) => s.path.endsWith('users.csv'))
  assert.equal((await call('csv:stats', fresh.path)).rows, userRowCount())
  // 예전 세션 번호는 서버에서 사라졌다 (예전 쿠키로는 지운 세션에 다시 닿지 못한다)
  assert.ok(!sessions.has(oldCookie.split('=')[1]))
})
