// 보류 (LEGACY): 이 파일은 2026-10-14에 src/legacy로 옮겼다.
// 이유: 커스텀 테이블(제품 뷰어) 기능은 현재 범위에서 제외했다.
// 이 폴더는 빌드와 typecheck에 포함되지 않는다.
// 복원 방법은 같은 폴더의 README.md를 참조한다.

// 원래 위치: src/main/main.ts (keyinfo:reindex 핸들러와 keyinfo:index 핸들러 사이)
// 필요한 선언: let productViewerWin: BrowserWindow | null = null (main.ts 상단, isDev 선언 다음)

// ── Custom Table ────────────────────────────────────────────────────────────────
const CUSTOMTABLE_BASE = path.join(app.getAppPath(), 'local', 'customtable')

function getCustomtableDir(product: string | null): string {
  return path.join(CUSTOMTABLE_BASE, product?.trim() || 'none')
}

function loadCtFolders(product: string | null): { id: string; name: string }[] {
  const p = path.join(getCustomtableDir(product), '_folders.json')
  if (!fs.existsSync(p)) return []
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return [] }
}

function saveCtFolders(product: string | null, folders: { id: string; name: string }[]) {
  const dir = getCustomtableDir(product)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '_folders.json'), JSON.stringify(folders, null, 2), 'utf-8')
}

ipcMain.handle('customtable:openViewer', (_event, { product, tableId }: { product: string | null; tableId?: string }) => {
  if (productViewerWin && !productViewerWin.isDestroyed()) {
    productViewerWin.focus()
    return
  }
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: '제품 뷰어',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  productViewerWin = win
  win.on('closed', () => { productViewerWin = null })
  const params = new URLSearchParams()
  params.set('productViewer', '1')
  if (product) params.set('product', product)
  if (tableId) params.set('tableId', tableId)
  if (isDev) {
    win.loadURL(`http://localhost:6200/?${params.toString()}`)
  } else {
    win.loadURL(`file://${path.join(__dirname, '../renderer/index.html')}?${params.toString()}`)
  }
})

ipcMain.handle('customtable:list', (_event, product: string | null): unknown[] => {
  const dir = getCustomtableDir(product)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && !f.endsWith('.autosave.json') && f !== '_folders.json')
    .map(f => {
      try {
        const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
        return { id: t.id, name: t.name, product: t.product ?? null, columnCount: (t.columns ?? []).length, rowCount: (t.rows ?? []).length, folderId: t.folderId ?? null }
      } catch { return null }
    })
    .filter(Boolean)
    .sort((a: unknown, b: unknown) => (a as { name: string }).name.localeCompare((b as { name: string }).name))
})

ipcMain.handle('customtable:listFolders', (_event, product: string | null) => loadCtFolders(product))

ipcMain.handle('customtable:saveFolder', (_event, product: string | null, folder: { id: string; name: string }) => {
  const folders = loadCtFolders(product)
  const idx = folders.findIndex(f => f.id === folder.id)
  if (idx >= 0) folders[idx] = folder; else folders.push(folder)
  saveCtFolders(product, folders)
})

ipcMain.handle('customtable:deleteFolder', (_event, product: string | null, folderId: string) => {
  saveCtFolders(product, loadCtFolders(product).filter(f => f.id !== folderId))
  const dir = getCustomtableDir(product)
  if (!fs.existsSync(dir)) return
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.endsWith('.autosave.json') && f !== '_folders.json')) {
    const p = path.join(dir, file)
    try {
      const t = JSON.parse(fs.readFileSync(p, 'utf-8'))
      if (t.folderId === folderId) { delete t.folderId; fs.writeFileSync(p, JSON.stringify(t, null, 2), 'utf-8') }
    } catch {}
  }
})

ipcMain.handle('customtable:assignFolder', (_event, product: string | null, tableId: string, folderId: string | null) => {
  const dir = getCustomtableDir(product)
  for (const suffix of ['.json', '.autosave.json']) {
    const p = path.join(dir, `${tableId}${suffix}`)
    if (!fs.existsSync(p)) continue
    try {
      const t = JSON.parse(fs.readFileSync(p, 'utf-8'))
      if (folderId) t.folderId = folderId; else delete t.folderId
      fs.writeFileSync(p, JSON.stringify(t, null, 2), 'utf-8')
    } catch {}
  }
})

ipcMain.handle('customtable:load', (_event, product: string | null, id: string): unknown => {
  const dir = getCustomtableDir(product)
  // Prefer autosave if it exists (most recent working state)
  const autosavePath = path.join(dir, `${id}.autosave.json`)
  const mainPath = path.join(dir, `${id}.json`)
  const p = fs.existsSync(autosavePath) ? autosavePath : mainPath
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
})

ipcMain.handle('customtable:save', (_event, table: unknown): unknown => {
  const t = table as { id: string; product: string | null }
  const dir = getCustomtableDir(t.product)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${t.id}.json`), JSON.stringify(t, null, 2), 'utf-8')
  // Manual save supersedes autosave — remove draft
  const autosavePath = path.join(dir, `${t.id}.autosave.json`)
  if (fs.existsSync(autosavePath)) fs.unlinkSync(autosavePath)
  return t
})

ipcMain.handle('customtable:autosave', (_event, table: unknown) => {
  const t = table as { id: string; product: string | null }
  const dir = getCustomtableDir(t.product)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${t.id}.autosave.json`), JSON.stringify(t, null, 2), 'utf-8')
})

ipcMain.handle('customtable:hasAutosave', (_event, product: string | null, id: string): boolean => {
  const dir = getCustomtableDir(product)
  return fs.existsSync(path.join(dir, `${id}.autosave.json`))
})

ipcMain.handle('customtable:restore', (_event, product: string | null, id: string): unknown => {
  const dir = getCustomtableDir(product)
  const mainPath = path.join(dir, `${id}.json`)
  if (!fs.existsSync(mainPath)) return null
  try { return JSON.parse(fs.readFileSync(mainPath, 'utf-8')) } catch { return null }
})

ipcMain.handle('customtable:delete', (_event, product: string | null, id: string) => {
  const dir = getCustomtableDir(product)
  const main = path.join(dir, `${id}.json`)
  const draft = path.join(dir, `${id}.autosave.json`)
  if (fs.existsSync(main)) fs.unlinkSync(main)
  if (fs.existsSync(draft)) fs.unlinkSync(draft)
})

