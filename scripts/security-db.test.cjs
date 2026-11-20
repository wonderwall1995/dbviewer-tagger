// B3: Web에서 DB 연결로 서버 안쪽 주소를 두드리지 못하게 막는지 확인한다.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { isPublicAddress, isAllowedDbPort, resolvePublicHost } = require('../packages/core/dist/netguard.js')
const { createTaggerServer, webDbGuard } = require('../apps/server/dist/server.js')

test('공인 주소가 아닌 IPv4·IPv6는 막는다', () => {
  const blocked = ['127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.10', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', 'not-an-ip']
  for (const ip of blocked) assert.equal(isPublicAddress(ip), false, ip)
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '9.9.9.9', '2606:4700:4700::1111']) assert.equal(isPublicAddress(ip), true, ip)
})

test('DB 포트는 5432와 1024 이상만', () => {
  for (const p of [5432, 6543, 25060, 65535]) assert.equal(isAllowedDbPort(p), true, String(p))
  for (const p of [22, 80, 443, 0, 70000, 1.5, NaN]) assert.equal(isAllowedDbPort(p), false, String(p))
})

test('호스트 이름이 내부 주소로 풀리면 거절한다', async () => {
  await assert.rejects(() => resolvePublicHost('localhost'), /공인/)
  await assert.rejects(() => resolvePublicHost('127.0.0.1'), /공인/)
  await assert.rejects(() => resolvePublicHost('169.254.169.254'), /공인/)
  assert.equal(await resolvePublicHost('8.8.8.8'), '8.8.8.8')
})

test('webDbGuard: 검사한 IP와 읽기 전용·시간 제한 옵션을 돌려준다', async () => {
  const g = await webDbGuard('8.8.8.8', 5432)
  assert.equal(g.host, '8.8.8.8')
  assert.match(g.clientOptions.options, /default_transaction_read_only=on/)
  assert.ok(g.clientOptions.statement_timeout > 0)
  await assert.rejects(() => webDbGuard('8.8.8.8', 22), /포트/)
})

test('Web 서버: 127.0.0.1(같은 서버의 DB)로 연결 확인을 하면 거절된다', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-db-'))
  const { server } = createTaggerServer({ dataDir })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); fs.rmSync(dataDir, { recursive: true, force: true }) }))
  const base = `http://127.0.0.1:${server.address().port}`
  let cookie = ''
  const call = async (channel, ...args) => {
    const res = await fetch(`${base}/api/call/${channel}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ args }) })
    const c = res.headers.get('set-cookie'); if (c) cookie = c.split(';')[0]
    return res.json()
  }
  const slot = { name: 'x', folderName: 'x', host: '127.0.0.1', port: '5432', database: 'rwa', user: 'rwa', password: 'p', ssh: { host: '', port: '22', username: '', pemPath: '' } }
  await call('db:saveSlot', 'db1', slot)
  const r = await call('db:testConnection', 'db1')
  assert.equal(r.value.ok, false)
  assert.match(r.value.message, /공인/)
  await call('db:saveSlot', 'db1', { ...slot, host: 'localhost' })
  assert.match((await call('db:testConnection', 'db1')).value.message, /공인/)
})
