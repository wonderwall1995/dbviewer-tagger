const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createCedSender } = require('../dist/main/cedTransfer.js')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ced-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dir = path.join(root, 'CED', 'sample')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'key.md'), '# Key\n')
  fs.writeFileSync(path.join(dir, 'sample.md'), '# Index\n')
  const files = new Map()
  const dirs = new Set(['/vault'])
  let closed = 0
  const missing = () => { throw Object.assign(new Error('missing'), { code: 2 }) }
  const ops = {
    async stat(p) { return dirs.has(p) ? { isDirectory: true, size: 0 } : files.has(p) ? { isDirectory: false, size: files.get(p).length } : missing() },
    async mkdir(p) { dirs.add(p) },
    async readFile(p) { return files.has(p) ? Buffer.from(files.get(p)) : missing() },
    async writeFile(p, b) { files.set(p, Buffer.from(b)) },
    async rename(a, b) { files.set(b, files.get(a)); files.delete(a) },
    async unlink(p) { files.delete(p) },
  }
  const deps = {
    dataRoot: () => root,
    generate: () => ({ dir, files: ['key.md', 'sample.md'], skippedDrafts: 0 }),
    connect: async () => ({ ops, root: '/vault', close: () => closed++, transport: 'ssh-exec' }),
    describeError: () => '전송 실패',
  }
  const logs = () => fs.readFileSync(path.join(root, 'local/logs/ced-transfer.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
  return { root, dir, files, ops, deps, logs, closed: () => closed }
}

test('resend preserves remote edits and records distinct requests', async t => {
  const f = fixture(t)
  const send = createCedSender(f.deps)
  assert.deepEqual((await send(null, 'sample')).written, ['key.md', 'sample.md'])
  assert.deepEqual((await send(null, 'sample')).unchanged, ['key.md', 'sample.md'])
  const remoteKey = '/vault/CED/sample/key.md'
  f.files.set(remoteKey, Buffer.from('# Edited in vault\n'))
  fs.writeFileSync(path.join(f.dir, 'key.md'), '# Changed in app\n')
  const result = await send(null, 'sample')
  assert.deepEqual(result.conflicts, ['key.md'])
  assert.equal(f.files.get(remoteKey).toString(), '# Edited in vault\n')
  assert.equal(f.closed(), 3)
  const logs = f.logs()
  assert.equal(new Set(logs.map(x => x.requestId)).size, 3)
  assert.equal(logs.filter(x => x.event === 'transfer.completed').length, 3)
  assert(!JSON.stringify(logs).includes(f.root))
  assert(!JSON.stringify(logs).includes('Edited in vault'))
  for (const id of new Set(logs.map(x => x.requestId))) {
    const events = logs.filter(x => x.requestId === id)
    assert.deepEqual(events.map(x => x.sequence), events.map((_, i) => i + 1))
    assert.equal(events[0].event, 'transfer.requested')
    assert.equal(events.at(-1).event, 'transfer.completed')
  }
})

test('failed write records its stage and closes the session', async t => {
  const f = fixture(t)
  f.ops.writeFile = async () => { throw new Error('private connection detail') }
  const result = await createCedSender(f.deps)(null, 'sample')
  assert.equal(result.ok, false)
  assert.equal(f.closed(), 1)
  assert.equal(f.logs().at(-1).stage, 'remote.files')
  assert(!JSON.stringify(f.logs()).includes('private connection detail'))
})

test('no confirmed notes skips the remote connection', async t => {
  const f = fixture(t)
  f.deps.generate = () => ({ dir: f.dir, files: ['sample.md'], skippedDrafts: 2 })
  f.deps.connect = async () => { throw new Error('must not connect') }
  const result = await createCedSender(f.deps)(null, 'sample')
  assert.equal(result.noNotes, true)
  assert.equal(f.logs().at(-1).noNotes, true)
})

test('local generation failure is logged and still rejects the IPC', async t => {
  const f = fixture(t)
  f.deps.generate = () => { throw new Error('generation failed') }
  await assert.rejects(createCedSender(f.deps)(null, 'sample'), /generation failed/)
  assert.equal(f.logs().at(-1).stage, 'local.generate')
})
