const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

// 화면의 채널 표(packages/ui/src/platform/channels.ts)가 preload.ts와 같은지 확인한다.
test('channels.ts와 preload.ts의 함수 → 채널 표가 같다', () => {
  const preload = fs.readFileSync('src/main/preload.ts', 'utf8')
  const table = fs.readFileSync('packages/ui/src/platform/channels.ts', 'utf8')
  const fromPreload = Object.fromEntries([...preload.matchAll(/^  (\w+): \([^\n]*?ipcRenderer\.invoke\('([^']+)'/gm)].map((m) => [m[1], m[2]]))
  const fromTable = Object.fromEntries([...table.matchAll(/^  (\w+): '([^']+)',/gm)].map((m) => [m[1], m[2]]))
  assert.deepEqual(fromTable, fromPreload)
})
