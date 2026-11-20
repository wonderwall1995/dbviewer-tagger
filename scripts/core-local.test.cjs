const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { makeWorkspace } = require('../dist/main/core/workspace.js')
const { makeSessionState, resolveInside, userPath } = require('../dist/main/core/context.js')
const { localHandlers: h } = require('../dist/main/core/local.js')

function fixture(t, allowOutsidePaths = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-local-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const ctx = { ws: makeWorkspace(root), state: makeSessionState(), emit: () => {}, allowOutsidePaths }
  return { root, ctx }
}

test('local.json: 처음 불러오면 빈 상태를 만들고, 저장한 경로는 작업 폴더 기준 상대경로로 남는다', (t) => {
  const { root, ctx } = fixture(t)
  assert.deepEqual(h['local:load'](ctx).folders, [])
  const csv = path.join(root, 'DB-downloads', 'db', 'public', 'a.csv')
  h['local:save'](ctx, { folders: [], fileToFolder: {}, fileSources: { 'a.csv': { type: 'local', path: csv } } })
  const stored = JSON.parse(fs.readFileSync(ctx.ws.localFile, 'utf8'))
  assert.equal(stored.fileSources['a.csv'].path, 'DB-downloads/db/public/a.csv')
  assert.equal(h['local:load'](ctx).fileSources['a.csv'].path, csv)
})

test('사용자마다 다른 작업 폴더를 쓰면 서로의 local.json이 섞이지 않는다', (t) => {
  const a = fixture(t)
  const b = fixture(t)
  h['local:save'](a.ctx, { folders: [{ id: 'f1', name: 'A', expanded: true }], fileToFolder: {}, fileSources: {} })
  assert.equal(h['local:load'](a.ctx).folders.length, 1)
  assert.equal(h['local:load'](b.ctx).folders.length, 0)
})

test('프리셋 저장, 목록, 불러오기, 삭제', (t) => {
  const { ctx } = fixture(t)
  assert.equal(h['local:savePreset'](ctx, 'mine', { product: 'p1', fileSources: {} }), 'mine.json')
  const list = h['local:listPresets'](ctx)
  assert.equal(list.length, 1)
  assert.equal(list[0].product, 'p1')
  assert.equal(h['local:loadPreset'](ctx, 'mine.json').product, 'p1')
  h['local:deletePreset'](ctx, 'mine.json')
  assert.equal(h['local:listPresets'](ctx).length, 0)
})

test('readFile: Web 정책(allowOutsidePaths=false)에서는 작업 폴더 밖을 읽지 못한다', async (t) => {
  const { root, ctx } = fixture(t)
  const inside = path.join(root, 'S3-downloads', 'x.csv')
  fs.mkdirSync(path.dirname(inside), { recursive: true })
  fs.writeFileSync(inside, 'a,b\n1,2\n')
  assert.equal(await h['local:readFile'](ctx, inside), 'a,b\n1,2\n')
  const outside = path.join(os.tmpdir(), 'core-local-outside.txt')
  fs.writeFileSync(outside, 'secret')
  t.after(() => fs.rmSync(outside, { force: true }))
  await assert.rejects(() => h['local:readFile'](ctx, outside))
  await assert.rejects(() => h['local:readFile'](ctx, path.join(root, '..', path.basename(outside))))
})

test('readFile: 데스크톱 정책(allowOutsidePaths=true)은 지금처럼 밖의 파일도 읽는다', async (t) => {
  const { ctx } = fixture(t, true)
  const outside = path.join(os.tmpdir(), 'core-local-desktop.txt')
  fs.writeFileSync(outside, 'ok')
  t.after(() => fs.rmSync(outside, { force: true }))
  assert.equal(await h['local:readFile'](ctx, outside), 'ok')
})

test('resolveInside: 상대경로 탈출과 절대경로를 거절하고, 안쪽 경로는 받는다', (t) => {
  const { root } = fixture(t)
  assert.equal(resolveInside(root, 'docs/a.md'), path.join(root, 'docs', 'a.md'))
  assert.throws(() => resolveInside(root, '../x'))
  assert.throws(() => resolveInside(root, path.parse(root).root))
  assert.throws(() => userPath({ ws: { root }, allowOutsidePaths: false }, ''))
})

test('resolveInside: 작업 폴더 안의 심볼릭 링크가 밖을 가리키면 거절한다', (t) => {
  const { root } = fixture(t)
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-local-target-'))
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }))
  try {
    fs.symlinkSync(outsideDir, path.join(root, 'link'), 'junction')
  } catch {
    t.skip('이 환경에서는 링크를 만들 수 없다')
    return
  }
  assert.throws(() => resolveInside(root, 'link/secret.txt'))
})

test('다운로드 목록과 CSV 트리는 다운로드 폴더 밖을 보여 주지 않는다', async (t) => {
  const { ctx } = fixture(t)
  const dir = path.join(ctx.ws.dbDownloadsRoot, 'db1', 'public')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 't.csv'), 'a\n1\n')
  const tree = h['local:listCsvTree'](ctx, 'db', '')
  assert.deepEqual(tree[0].segments, ['db1', 'public'])
  assert.deepEqual(h['local:listCsvTree'](ctx, 'db', '../..'), [])
  assert.deepEqual(await h['local:listDownloads'](ctx, 'db', '../..'), { folders: [], files: [] })
  await assert.rejects(() => h['local:deleteDownload'](ctx, ctx.ws.root))
})

test('eraseColumn: 컬럼 하나를 지우고 줄바꿈 방식을 유지한다', async (t) => {
  const { root, ctx } = fixture(t)
  const file = path.join(root, 'S3-downloads', 'e.csv')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, 'a,b,c\r\n1,2,3\r\n')
  await h['local:eraseColumn'](ctx, file, 'b')
  assert.equal(fs.readFileSync(file, 'utf8'), 'a,c\r\n1,3')
})
