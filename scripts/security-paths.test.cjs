// B1: 이름과 경로로 작업 폴더 밖을 가리키는 공격을 막는지 확인한다.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { makeWorkspace } = require('../packages/core/dist/workspace.js')
const { makeSessionState, checkName } = require('../packages/core/dist/context.js')
const { localHandlers } = require('../packages/core/dist/local.js')
const { lorebookHandlers } = require('../packages/core/dist/lorebook.js')
const { keyinfoHandlers } = require('../packages/core/dist/keyinfo.js')
const { quoteIdent } = require('../packages/core/dist/db.js')

function fixture(t) {
  // 작업 폴더를 한 단계 아래에 두고, 바깥 폴더(parent)에 무엇이 생기는지 본다.
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-'))
  const root = path.join(parent, 'ws')
  fs.mkdirSync(root)
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }))
  const ctx = { ws: makeWorkspace(root), state: makeSessionState(), emit: () => {}, allowOutsidePaths: false, cedDir: () => path.join(root, 'CED') }
  const outsideEntries = () => fs.readdirSync(parent).filter((n) => n !== 'ws')
  return { parent, root, ctx, outsideEntries }
}

const EVIL = ['../../evil', '..', '.', 'a/b', 'a\\b', '', 'x\u0000y']

test('checkName: 경로 구분자, 점 이름, 빈 이름, 제어 문자를 거절한다', () => {
  for (const bad of EVIL) assert.throws(() => checkName(bad), bad)
  assert.equal(checkName(' 쇼핑몰 '), '쇼핑몰')
})

test('제품 이름으로 Keyinfo·Key 노트를 작업 폴더 밖에 쓰지 못한다', async (t) => {
  const { ctx, outsideEntries } = fixture(t)
  for (const bad of ['../../evil', '../..', 'a/../../b']) {
    assert.throws(() => keyinfoHandlers['keyinfo:savePins'](ctx, bad, []), bad)
    assert.throws(() => keyinfoHandlers['keynote:save'](ctx, bad, []), bad)
    assert.throws(() => keyinfoHandlers['ced:generate'](ctx, bad), bad)
  }
  assert.deepEqual(outsideEntries(), [])
  // 정상 이름은 그대로 동작한다
  keyinfoHandlers['keynote:save'](ctx, '쇼핑몰', [])
  assert.deepEqual(keyinfoHandlers['keynote:list'](ctx, '쇼핑몰'), [])
})

test('Lorebook 제품 목록으로 제품 폴더 밖의 파일을 만들거나 지우지 못한다', (t) => {
  const { root, ctx, outsideEntries } = fixture(t)
  const victim = path.join(root, 'local', 'victim.json')
  fs.mkdirSync(path.dirname(victim), { recursive: true })
  fs.writeFileSync(victim, '{}')
  lorebookHandlers['lorebook:setCategories'](ctx, ['shop'])
  assert.throws(() => lorebookHandlers['lorebook:setCategories'](ctx, ['shop', '../victim']))
  assert.throws(() => lorebookHandlers['lorebook:setCategories'](ctx, ['../../../evil']))
  // 거절되면 아무것도 바뀌지 않는다 (shop은 남는다)
  assert.deepEqual(lorebookHandlers['lorebook:getCategories'](ctx), ['shop'])
  assert.ok(fs.existsSync(victim))
  assert.throws(() => lorebookHandlers['lorebook:newPath'](ctx, '../..', 'a.csv', 'c'))
  assert.deepEqual(outsideEntries(), [])
})

test('프리셋 이름으로 프리셋 폴더 밖을 읽거나 지우거나 쓰지 못한다', (t) => {
  const { root, ctx, outsideEntries } = fixture(t)
  const victim = path.join(root, 'local', 'presets', '..', 'victim.json')
  fs.mkdirSync(path.dirname(victim), { recursive: true })
  fs.writeFileSync(victim, '{"secret":1}')
  assert.throws(() => localHandlers['local:loadPreset'](ctx, '../victim.json'))
  assert.throws(() => localHandlers['local:deletePreset'](ctx, '../victim.json'))
  assert.throws(() => localHandlers['local:savePreset'](ctx, '../../../evil', {}))
  assert.ok(fs.existsSync(victim))
  assert.deepEqual(outsideEntries(), [])
  assert.equal(localHandlers['local:savePreset'](ctx, '내 프리셋', {}), '내 프리셋.json')
})

test('표본 행과 Keyinfo 색인은 작업 폴더 밖 CSV를 읽지 않는다', async (t) => {
  const { parent, ctx } = fixture(t)
  const outsideCsv = path.join(parent, 'secret.csv')
  fs.writeFileSync(outsideCsv, 'password\nhunter2\n')
  const r = keyinfoHandlers['keynote:sampleRows'](ctx, outsideCsv, ['password'], 10, false, 0, null)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'invalid')
  const data = await keyinfoHandlers['keyinfo:reindex'](ctx, 'shop', { 'secret.csv': { type: 'local', path: outsideCsv } })
  assert.equal(data.schema['secret.csv'], undefined)
})

test('SQL 식별자 안의 큰따옴표는 두 번 써서 감싼다', () => {
  assert.equal(quoteIdent('users'), '"users"')
  assert.equal(quoteIdent('a"; DROP TABLE x; --'), '"a""; DROP TABLE x; --"')
})
