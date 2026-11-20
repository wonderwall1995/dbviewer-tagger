const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { makeWorkspace } = require('../dist/main/core/workspace.js')
const { makeSessionState } = require('../dist/main/core/context.js')
const { lorebookHandlers: h } = require('../dist/main/core/lorebook.js')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-lore-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, ctx: { ws: makeWorkspace(root), state: makeSessionState(), emit: () => {}, allowOutsidePaths: false } }
}

test('lorebook: 새 경로에 쓰고, 목록과 칼럼 주석으로 읽고, 지운다', async (t) => {
  const { ctx } = fixture(t)
  const p = h['lorebook:newPath'](ctx, 'shop', 'users.csv', 'email')
  await h['lorebook:write'](ctx, p, JSON.stringify({ column: 'email', comment: '로그인 주소' }))
  assert.equal((await h['lorebook:list'](ctx))[0].folder, 'shop')
  assert.deepEqual(h['lorebook:getColumnComments'](ctx, 'users.csv'), { email: '로그인 주소' })
  await h['lorebook:delete'](ctx, p)
  assert.equal((await h['lorebook:list'](ctx)).length, 0)
})

test('lorebook: lorebook 폴더 밖은 읽고 쓰지 못한다', async (t) => {
  const { root, ctx } = fixture(t)
  await assert.rejects(() => h['lorebook:read'](ctx, path.join(root, 'local', 'presets', 'local.json')))
  await assert.rejects(() => h['lorebook:write'](ctx, path.join(ctx.ws.lorebookRoot, '..', 'x.json'), '{}'))
})

test('제품 목록과 제품 설정은 사용자마다 따로 있다', (t) => {
  const a = fixture(t)
  const b = fixture(t)
  h['lorebook:setCategories'](a.ctx, ['shop', 'bank'])
  h['product:saveConfig'](a.ctx, { order: ['bank', 'shop'] })
  assert.deepEqual(h['lorebook:getCategories'](a.ctx), ['bank', 'shop'])
  assert.deepEqual(h['lorebook:getCategories'](b.ctx), [])
  assert.deepEqual(h['product:loadConfig'](b.ctx), {})
  assert.deepEqual(h['product:loadConfig'](a.ctx), { order: ['bank', 'shop'] })
})
