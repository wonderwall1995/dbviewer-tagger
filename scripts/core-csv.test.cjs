const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { makeWorkspace } = require('../packages/core/dist/workspace.js')
const { makeSessionState } = require('../packages/core/dist/context.js')
const { csvHandlers: h } = require('../packages/core/dist/csv.js')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-csv-'))
  const ctx = { ws: makeWorkspace(root), state: makeSessionState(), emit: () => {}, allowOutsidePaths: false }
  t.after(() => {
    if (ctx.state.csvStats.timer) clearTimeout(ctx.state.csvStats.timer)
    fs.rmSync(root, { recursive: true, force: true })
  })
  return { root, ctx }
}

function writeCsv(root, name, text) {
  const file = path.join(root, 'S3-downloads', name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return file
}

test('csv:stats: DB에서 내보낸 CSV는 제약 행과 타입 행을 빼고 세며, 없는 파일은 실종으로 알린다', async (t) => {
  const { root, ctx } = fixture(t)
  const file = path.join(root, 'DB-downloads', 'db', 'public', 'a.csv')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, 'id,name\n[PK],\n{integer},{text}\n1,"x\ny"\n2,z\n')
  assert.deepEqual(await h['csv:stats'](ctx, file), { rows: 2, columns: 2, partial: false })
  assert.deepEqual(await h['csv:stats'](ctx, path.join(root, 'S3-downloads', 'none.csv')), { rows: 0, columns: 0, partial: false, missing: true })
})

test('csv:stats: 일반 CSV는 첫 행이 {..}나 [..] 모양이어도 데이터로 센다 (보고서 N08)', async (t) => {
  const { root, ctx } = fixture(t)
  const file = writeCsv(root, 'plain.csv', 'value\n{real_data}\nnormal\n')
  assert.deepEqual(await h['csv:stats'](ctx, file), { rows: 2, columns: 1, partial: false })
})

test('csv:stats 캐시는 사용자마다 따로 있다', async (t) => {
  const a = fixture(t)
  const b = fixture(t)
  await h['csv:stats'](a.ctx, writeCsv(a.root, 'a.csv', 'x\n1\n'))
  assert.equal(a.ctx.state.csvStats.memory.size, 1)
  assert.equal(b.ctx.state.csvStats.memory.size, 0)
})

test('csv:stats: Web 정책에서 작업 폴더 밖 파일은 세지 않는다', async (t) => {
  const { ctx } = fixture(t)
  assert.equal(await h['csv:stats'](ctx, path.join(os.tmpdir(), '..', 'x.csv')), null)
})

test('cache: 저장한 ParsedCsv를 다시 불러오고, 파일이 바뀌면 캐시를 쓰지 않는다', async (t) => {
  const { root, ctx } = fixture(t)
  const file = writeCsv(root, 'c.csv', 'a,b\n1,2\n')
  const parsed = { fileName: 'c.csv', columns: [{ key: 'a' }, { key: 'b' }], rows: [{ a: '1', b: '2' }], totalRows: 1 }
  await h['cache:save'](ctx, file, parsed)
  assert.deepEqual(await h['cache:load'](ctx, file), parsed)
  fs.writeFileSync(file, 'a,b\n1,2\n3,4\n')
  assert.equal(await h['cache:load'](ctx, file), null)
})
