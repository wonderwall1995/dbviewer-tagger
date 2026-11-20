const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { makeWorkspace } = require('../dist/main/core/workspace.js')
const { makeSessionState } = require('../dist/main/core/context.js')
const { keyinfoHandlers: h } = require('../dist/main/core/keyinfo.js')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-ki-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const ws = makeWorkspace(root)
  return { root, ctx: { ws, state: makeSessionState(), emit: () => {}, allowOutsidePaths: false, cedDir: () => path.join(root, 'CED') } }
}

const note = { id: 'n1', title: '회원 ID', definition: '회원을 가리키는 값', status: 'confirmed', body: '', keywords: [], valueMeanings: '', members: [{ fileName: 'users.csv', columnKey: 'id' }], excluded: [] }

test('Key 노트와 CED는 사용자마다 따로 있다', (t) => {
  const a = fixture(t)
  const b = fixture(t)
  h['keynote:save'](a.ctx, 'shop', [note])
  assert.equal(h['keynote:list'](a.ctx, 'shop').length, 1)
  assert.equal(h['keynote:list'](b.ctx, 'shop').length, 0)
  const r = h['ced:generate'](a.ctx, 'shop')
  assert.equal(r.dir, path.join(a.root, 'CED', 'shop'))
  assert.ok(fs.existsSync(path.join(r.dir, '회원 ID.md')))
  assert.equal(fs.existsSync(path.join(b.root, 'CED')), false)
})

test('Key 노트 표본 캐시와 이전 표시는 사용자 상태에 있다', (t) => {
  const a = fixture(t)
  const b = fixture(t)
  h['keynote:list'](a.ctx, 'shop')
  assert.equal(a.ctx.state.keyNoteMigratedFor, a.ctx.ws.docsKeyinfoDir)
  assert.equal(b.ctx.state.keyNoteMigratedFor, '')
})
