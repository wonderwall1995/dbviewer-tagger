const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { makeWorkspace } = require('../dist/main/core/workspace.js')
const { makeSessionState } = require('../dist/main/core/context.js')
const { dbHandlers: h, normalizeSlots } = require('../dist/main/core/db.js')

// Web처럼 슬롯을 메모리에만 두는 ctx
function memoryCtx(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-db-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let stored = normalizeSlots({})
  return {
    ws: makeWorkspace(root), state: makeSessionState(), emit: () => {}, allowOutsidePaths: false,
    slots: { load: () => structuredClone(stored), save: (s) => { stored = structuredClone(s) } },
  }
}

const cfg = (over = {}) => ({ name: '면접 DB', folderName: 'interview', host: 'db.example.com', port: '5432', database: 'shop', user: 'reader', password: 'pw1', ssh: { host: '', port: '22', username: '', pemPath: '' }, ...over })

test('슬롯 저장: 비밀번호는 돌려주지 않고, 비워 보내면 기존 값을 유지한다', (t) => {
  const ctx = memoryCtx(t)
  h['db:saveSlot'](ctx, 'db1', cfg())
  const view = h['db:loadSlot'](ctx, 'db1')
  assert.equal(view.password, undefined)
  assert.equal(view.hasPassword, true)
  h['db:saveSlot'](ctx, 'db1', cfg({ name: '새 이름', password: '' }))
  assert.equal(ctx.slots.load().db1.password, 'pw1')
  assert.equal(h['db:listSlots'](ctx)[0].name, '새 이름')
})

test('슬롯 저장: 접속 값이 바뀌면 연결 확인 상태를 해제한다', (t) => {
  const ctx = memoryCtx(t)
  h['db:saveSlot'](ctx, 'db1', cfg())
  const all = ctx.slots.load(); all.db1.verified = true; ctx.slots.save(all)
  assert.equal(h['db:saveSlot'](ctx, 'db1', cfg({ name: '이름만' })), true)
  assert.equal(h['db:saveSlot'](ctx, 'db1', cfg({ host: 'other.example.com' })), false)
})

test('잘못된 슬롯 이름은 거절한다', (t) => {
  const ctx = memoryCtx(t)
  assert.throws(() => h['db:loadSlot'](ctx, '../db1'))
})

test('터널이 없는 환경(Web)에서는 SSH를 쓰는 슬롯을 연결하지 않는다', async (t) => {
  const ctx = memoryCtx(t)
  h['db:saveSlot'](ctx, 'db2', cfg({ ssh: { host: 'bastion.example.com', port: '22', username: 'u', pemPath: '/k.pem' } }))
  const r = await h['db:testConnection'](ctx, 'db2')
  assert.equal(r.ok, false)
  assert.match(r.message, /SSH/)
})

test('내보내기 중단 표시는 사용자마다 따로 있다', (t) => {
  const a = memoryCtx(t)
  const b = memoryCtx(t)
  h['db:abortExport'](a)
  assert.equal(a.state.exportAborted, true)
  assert.equal(b.state.exportAborted, false)
})
