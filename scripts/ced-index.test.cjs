const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const Module = require('node:module')
const { writeCedIndex } = require('../dist/main/cedIndex.js')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ced-index-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const notesPath = path.join(root, 'docs/keyinfo/sample/keynotes.json')
  fs.mkdirSync(path.dirname(notesPath), { recursive: true })
  const notes = [{ id: 'sample-note', title: 'sampleKey', definition: '한 줄 정의',
    status: 'confirmed', body: '설명', valueMeanings: '값 의미',
    members: [{ fileName: 'sample.csv', columnKey: 'sampleKey' }],
    createdAt: '2001-01-01T00:00:00.000Z', updatedAt: '2001-01-01T00:00:00.000Z' }]
  const save = () => fs.writeFileSync(notesPath, JSON.stringify({ notes }))
  save()
  const handlers = new Map()
  const original = Module._load
  Module._load = function (id, parent, isMain) {
    if (id === 'electron') return {
      app: { isPackaged: false, getAppPath: () => root, getPath: () => path.join(root, 'userdata'),
        whenReady: () => ({ then() {} }), on() {} },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    }
    return original.call(this, id, parent, isMain)
  }
  const main = require.resolve('../dist/main/main.js')
  try { delete require.cache[main]; require(main) }
  finally { Module._load = original; delete require.cache[main] }
  const generate = () => handlers.get('ced:generate')(undefined, 'sample')
  const file = path.join(root, 'CED/sample/sample.md')
  const read = () => fs.readFileSync(file, 'utf8')
  const markOld = () => {
    const content = read().replace(/^generated: .+$/m, 'generated: "2001-01-01T00:00:00.000Z"')
    fs.writeFileSync(file, content)
    fs.utimesSync(file, new Date('2001-01-01T00:00:00Z'), new Date('2001-01-01T00:00:00Z'))
    return { content, mtime: fs.statSync(file).mtimeMs }
  }
  return { root, notes, save, generate, file, read, markOld }
}

test('repeated CED generation preserves index bytes, timestamp, and file mtime', t => {
  const f = fixture(t)
  const first = f.generate()
  assert(first.files.includes('sample.md'))
  const before = f.markOld()
  f.generate()
  assert.equal(f.read(), before.content)
  assert.equal(fs.statSync(f.file).mtimeMs, before.mtime)
})

test('definition and confirmed note list changes update the index timestamp', t => {
  const f = fixture(t)
  f.generate()
  const before = f.markOld()
  f.notes[0].definition = '바꾼 정의'
  f.save()
  f.generate()
  assert(f.read().includes('바꾼 정의'))
  assert(!f.read().includes('generated: "2001-01-01T00:00:00.000Z"'))
  assert.notEqual(f.read(), before.content)
  f.markOld()
  f.notes[0].status = 'draft'
  f.save()
  f.generate()
  assert(f.read().includes('notes: 0'))
  assert(!f.read().includes('[[sampleKey]]'))
  assert(!f.read().includes('generated: "2001-01-01T00:00:00.000Z"'))
})

test('note body changes update the note while leaving the unchanged index alone', t => {
  const f = fixture(t)
  f.generate()
  const before = f.markOld()
  f.notes[0].body = '새 본문'
  f.save()
  f.generate()
  assert.equal(f.read(), before.content)
  assert.equal(fs.statSync(f.file).mtimeMs, before.mtime)
  assert(fs.readFileSync(path.join(f.root, 'CED/sample/sampleKey.md'), 'utf8').includes('새 본문'))
})

test('body lines named generated are compared as content', t => {
  const f = fixture(t)
  f.generate()
  const before = f.markOld()
  fs.writeFileSync(f.file, before.content + 'generated: body text\n')
  writeCedIndex(f.file, before.content + 'generated: changed body text\n')
  assert(f.read().endsWith('generated: changed body text\n'))
})

test('missing or invalid generated metadata is regenerated', t => {
  const f = fixture(t)
  f.generate()
  const original = f.read()
  for (const replacement of ['', 'generated: "invalid"', 'generated: "2001-01-01T00:00:00.000Z"\ngenerated: "2001-01-01T00:00:00.000Z"']) {
    fs.writeFileSync(f.file, original.replace(/^generated: .+$/m, replacement))
    f.generate()
    const fields = f.read().match(/^generated: .+$/gm)
    assert.equal(fields.length, 1)
    assert(Number.isFinite(Date.parse(JSON.parse(fields[0].slice('generated: '.length)))))
  }
})
