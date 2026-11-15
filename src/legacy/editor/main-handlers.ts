// 보류 (LEGACY): 이 파일은 2026-10-14에 src/legacy로 옮겼다.
// 이유: 화면에서 호출하는 곳이 없다 (EditorOverlay 컴포넌트가 이미 없다).
// 이 폴더는 빌드와 typecheck에 포함되지 않는다.
// 복원 방법은 같은 폴더의 README.md를 참조한다.

// 원래 위치: src/main/main.ts (backup:delete 핸들러와 Key 연관 그룹 구역 사이)

const EDITOR_DIR = path.join(app.getAppPath(), 'local', 'editor')

ipcMain.handle('editor:listTemplates', (): unknown[] => {
  if (!fs.existsSync(EDITOR_DIR)) return []
  return fs.readdirSync(EDITOR_DIR)
    .filter(f => f.endsWith('.editor.json'))
    .map(f => {
      try {
        const raw = fs.readFileSync(path.join(EDITOR_DIR, f), 'utf-8')
        const t = JSON.parse(raw)
        return { id: t.id, name: t.name, updatedAt: t.updatedAt, sheetAName: t.sheetAName ?? null, sheetBName: t.sheetBName ?? null }
      } catch { return null }
    })
    .filter(Boolean)
    .sort((a: unknown, b: unknown) => {
      const ta = (a as { updatedAt: string }).updatedAt
      const tb = (b as { updatedAt: string }).updatedAt
      return tb.localeCompare(ta)
    })
})

ipcMain.handle('editor:loadTemplate', (_event, id: string): unknown => {
  const p = path.join(EDITOR_DIR, `${id}.editor.json`)
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
})

ipcMain.handle('editor:saveTemplate', (_event, template: unknown): unknown => {
  fs.mkdirSync(EDITOR_DIR, { recursive: true })
  const t = template as Record<string, unknown>
  t.updatedAt = new Date().toISOString()
  const id = t.id as string
  fs.writeFileSync(path.join(EDITOR_DIR, `${id}.editor.json`), JSON.stringify(t, null, 2), 'utf-8')
  return t
})

ipcMain.handle('editor:deleteTemplate', (_event, id: string) => {
  const p = path.join(EDITOR_DIR, `${id}.editor.json`)
  if (fs.existsSync(p)) fs.unlinkSync(p)
})

