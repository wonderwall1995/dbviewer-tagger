const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { saveWorkspaceBackup, restoreWorkspaceBackup, backupDirectory } = require('../packages/core/dist/workspaceBackup.js')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-backup-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (name, value) => {
    const target = path.join(root, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, value)
  }
  const read = name => fs.readFileSync(path.join(root, name), 'utf8')
  const contents = {
    'local/presets/work.json': JSON.stringify({ fileComments: { 'sample.csv': '직접 쓴 주석' } }),
    'docs/keyinfo/sample/keynotes.json': JSON.stringify({ notes: [
      { id: 'draft', status: 'draft', definition: '직접 쓴 정의', body: '본문', valueMeanings: '값 의미' },
      { id: 'hold', status: 'suspended', body: '보류한 내용' },
      { id: 'confirmed', status: 'confirmed', body: '확인한 내용' },
    ] }),
    'docs/keyinfo/sample/keyinfo.json': JSON.stringify({ pinnedColumns: [{ columnKey: 'key', comment: '핀 주석' }], folders: [{ id: 'folder', name: '직접 정한 이름' }] }),
    'docs/keyinfo/relations.json': '[{"title":"관계"}]',
    'docs/lorebook/sample/table_key.json': '사람이 쓴 컬럼 주석',
  }
  for (const [name, content] of Object.entries(contents)) write(name, content)
  return { root, write, read, contents }
}

function noStaging(root) {
  assert(!fs.readdirSync(root).some(n => n.startsWith('.restoring-')))
  assert(!fs.readdirSync(path.join(root, 'backups')).some(n => n.startsWith('.saving-')))
}

test('save and restore preserve notes, pins, comments, and exact snapshot contents', t => {
  const f = fixture(t)
  f.write('CED/sample/sample.md', '생성 문서')
  f.write('DB-downloads/sample.csv', '데이터')
  f.write('docs/unrelated/keep.txt', '다른 문서')
  const meta = saveWorkspaceBackup(f.root, '  제목  ', '  설명  ')
  const dir = backupDirectory(f.root, meta.id)
  assert.equal(meta.title, '제목')
  assert.equal(meta.comment, '설명')
  assert.deepEqual(meta.scopes, ['local', 'docs/keyinfo', 'docs/lorebook'])
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'))), meta)
  for (const [name, content] of Object.entries(f.contents)) {
    assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), content)
    f.write(name, '백업 이후 수정')
  }
  f.write('docs/keyinfo/later/keynotes.json', '새로 추가한 노트')
  f.write('docs/lorebook/later.json', '새로 추가한 주석')
  restoreWorkspaceBackup(f.root, meta.id)
  for (const [name, content] of Object.entries(f.contents)) assert.equal(f.read(name), content)
  assert(!fs.existsSync(path.join(f.root, 'docs/keyinfo/later')))
  assert(!fs.existsSync(path.join(f.root, 'docs/lorebook/later.json')))
  assert.equal(f.read('CED/sample/sample.md'), '생성 문서')
  assert.equal(f.read('docs/unrelated/keep.txt'), '다른 문서')
  assert(!fs.existsSync(path.join(dir, 'CED')))
  assert(!fs.existsSync(path.join(dir, 'DB-downloads')))
  noStaging(f.root)
})

test('legacy local-only backup keeps current Keyinfo and Lorebook', t => {
  const f = fixture(t)
  const id = 'backup_123'
  f.write(`backups/${id}/meta.json`, JSON.stringify({ id, title: '예전 백업', date: '2020-01-01' }))
  f.write(`backups/${id}/local/presets/work.json`, '예전 설정')
  restoreWorkspaceBackup(f.root, id)
  assert.equal(f.read('local/presets/work.json'), '예전 설정')
  for (const [name, content] of Object.entries(f.contents).filter(([name]) => name.startsWith('docs/'))) {
    assert.equal(f.read(name), content)
  }
  noStaging(f.root)
})

test('missing source directories are stored as empty snapshots', t => {
  const f = fixture(t)
  fs.rmSync(path.join(f.root, 'docs'), { recursive: true })
  const meta = saveWorkspaceBackup(f.root, '', '')
  f.write('docs/keyinfo/later/keynotes.json', '나중에 쓴 노트')
  restoreWorkspaceBackup(f.root, meta.id)
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'docs/keyinfo')), [])
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'docs/lorebook')), [])
})

test('incomplete modern backup is rejected before live data changes', t => {
  const f = fixture(t)
  const meta = saveWorkspaceBackup(f.root, '', '')
  fs.rmSync(path.join(backupDirectory(f.root, meta.id), 'docs/lorebook'), { recursive: true })
  assert.throws(() => restoreWorkspaceBackup(f.root, meta.id))
  for (const [name, content] of Object.entries(f.contents)) assert.equal(f.read(name), content)
  noStaging(f.root)
})

test('failed save leaves current data and no completed backup', t => {
  const f = fixture(t)
  const original = fs.copyFileSync
  fs.copyFileSync = () => { throw new Error('copy failed') }
  try { assert.throws(() => saveWorkspaceBackup(f.root, '', ''), /copy failed/) }
  finally { fs.copyFileSync = original }
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'backups')), [])
  for (const [name, content] of Object.entries(f.contents)) assert.equal(f.read(name), content)
})

test('failed restore preparation keeps current data', t => {
  const f = fixture(t)
  const meta = saveWorkspaceBackup(f.root, '', '')
  f.write('local/presets/work.json', '현재 설정')
  const original = fs.copyFileSync
  fs.copyFileSync = () => { throw new Error('copy failed') }
  try { assert.throws(() => restoreWorkspaceBackup(f.root, meta.id), /copy failed/) }
  finally { fs.copyFileSync = original }
  assert.equal(f.read('local/presets/work.json'), '현재 설정')
  assert.equal(f.read('docs/keyinfo/sample/keynotes.json'), f.contents['docs/keyinfo/sample/keynotes.json'])
  noStaging(f.root)
})

test('failed directory replacement rolls every scope back', t => {
  const f = fixture(t)
  const meta = saveWorkspaceBackup(f.root, '', '')
  for (const name of Object.keys(f.contents)) f.write(name, '유지할 현재 값')
  const original = fs.renameSync
  let failed = false
  fs.renameSync = (from, to) => {
    if (!failed && from.includes(path.join('next', 'docs', 'keyinfo'))) {
      failed = true
      throw new Error('replace failed')
    }
    return original(from, to)
  }
  try { assert.throws(() => restoreWorkspaceBackup(f.root, meta.id), /replace failed/) }
  finally { fs.renameSync = original }
  assert(failed)
  for (const name of Object.keys(f.contents)) assert.equal(f.read(name), '유지할 현재 값')
  noStaging(f.root)
})

test('rollback failure retains previous data for recovery', t => {
  const f = fixture(t)
  const meta = saveWorkspaceBackup(f.root, '', '')
  f.write('local/presets/work.json', '유지할 현재 값')
  const original = fs.renameSync
  fs.renameSync = (from, to) => {
    if (from.includes(path.join('next', 'docs', 'keyinfo')) || from.includes(path.join('previous', 'docs', 'keyinfo'))) {
      throw new Error('rename failed')
    }
    return original(from, to)
  }
  try { assert.throws(() => restoreWorkspaceBackup(f.root, meta.id), /이전 데이터를 보관/) }
  finally { fs.renameSync = original }
  const retained = fs.readdirSync(f.root).find(n => n.startsWith('.restoring-'))
  assert(retained)
  assert.equal(f.read(`${retained}/previous/local/presets/work.json`), '유지할 현재 값')
})

test('backup IDs cannot point outside the backup directory', t => {
  const f = fixture(t)
  for (const id of ['../other', '..', 'backup_1/../other', 'backup_1\\..\\other', '/tmp/other']) {
    assert.throws(() => restoreWorkspaceBackup(f.root, id))
  }
  for (const [name, content] of Object.entries(f.contents)) assert.equal(f.read(name), content)
})
