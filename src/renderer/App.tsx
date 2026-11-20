import { useState, useCallback, useEffect, useRef } from 'react'
import { Toaster, toast } from 'sonner'
import { Bot, Loader2, Pin } from 'lucide-react'
import { useCsvWorker } from './hooks/useCsvWorker'
import { DataGrid } from './components/DataGrid'
import { Sidebar } from './components/Sidebar'
import { DropZone } from './components/DropZone'
import { DBButton } from './components/DBButton'
import { Inspector } from './ui/Inspector'
import { uiId } from './ui/uiId'
import { DBBrowser } from './components/DBBrowser'
import { LoadingModal } from './components/LoadingModal'
import { SaveModal } from './components/SaveModal'
import { LoadModal } from './components/LoadModal'
import { LocalFilesBrowser } from './components/LocalFilesBrowser'
import { LorebookModal } from './components/LorebookModal'
import { ProductModal } from './components/ProductModal'
import { KeyinfoModal } from './components/KeyinfoModal'
import { HermesModal } from './components/HermesModal'
import { ClearModal } from './components/ClearModal'
import { BackupModal } from './components/BackupModal'
import { WorkspaceModal } from './components/WorkspaceModal'
import type { ParsedCsv, FolderItem, FileSource, PinnedColumn, KeyinfoColumnSchema, KeyinfoFolder } from '../shared/types'
import { api, caps } from './api'

export interface PendingFileEntry {
  status: 'uploading' | 'ready' | 'parsing'
  path: string
  source: FileSource
}

type PaneId = 'A' | 'B'
interface PaneState { id: PaneId; activeFile: string | null; activeFileParsed: ParsedCsv | null; pinned: boolean }
interface PaneContext {
  folders: FolderItem[]
  fileToFolder: Record<string, string>
  fileSources: Record<string, FileSource>
  pendingFiles: Record<string, PendingFileEntry>
  parsedMap: Record<string, ParsedCsv>
  allColumnWidths: Record<string, Record<string, number>>
  allPageSettings: Record<string, number>
  hiddenFiles: Set<string>
  fileComments: Record<string, string>
  allColumnDeletions: Record<string, string[]>
  allHiddenColumns: Record<string, string[]>
  lorebookIndex: Record<string, string[]>
  activeProduct: string
}

export default function App() {
  const { parseCsv } = useCsvWorker()

  const [panes, setPanes] = useState<PaneState[]>([{ id: 'A', activeFile: null, activeFileParsed: null, pinned: false }])
  const [focusedPaneId, setFocusedPaneId] = useState<PaneId>('A')
  const [layout, setLayout] = useState<'single' | 'split-v'>('single')
  const focusedPaneIdRef = useRef<PaneId>('A')
  const panesRef = useRef<PaneState[]>([{ id: 'A', activeFile: null, activeFileParsed: null, pinned: false }])
  const [parsedMap, setParsedMap] = useState<Record<string, ParsedCsv>>({})
  const [pendingFiles, setPendingFiles] = useState<Record<string, PendingFileEntry>>({})
  const pendingFilesRef = useRef<Record<string, PendingFileEntry>>({})

  const focusedPane = panes.find(p => p.id === focusedPaneId) ?? panes[0]
  const activeFile = focusedPane?.activeFile ?? null
  const activeFileParsed = focusedPane?.activeFileParsed ?? null
  const [selectedFileNames, setSelectedFileNames] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null)
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [loadModalOpen, setLoadModalOpen] = useState(false)
  const [lorebookOpen, setLorebookOpen] = useState(false)
  const [dbOpen, setDbOpen] = useState(false)
  const [productOpen, setProductOpen] = useState(false)
  const [keyinfoOpen, setKeyinfoOpen] = useState(false)
  const [keyinfoTab, setKeyinfoTab] = useState<'pins' | 'notes'>('pins')   // 창을 열 때 먼저 보여 줄 탭
  const [hermesOpen, setHermesOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  // 배포본에서 작업 폴더를 아직 정하지 않았으면 처음 실행 안내로 연다.
  const [workspaceFirstRun, setWorkspaceFirstRun] = useState(false)

  // 작업 폴더 창 열기. 사이드바, DB 창, Local 창에서 같이 쓴다.
  const openWorkspace = useCallback(() => {
    setWorkspaceFirstRun(false)
    setWorkspaceOpen(true)
  }, [])

  useEffect(() => {
    if (!caps.workspace) return
    api.workspaceGet().then((info) => {
      if (info.needsSetup) {
        setWorkspaceFirstRun(true)
        setWorkspaceOpen(true)
      }
    }).catch(() => {})
  }, [])
  const [keyinfoFolders, setKeyinfoFolders] = useState<KeyinfoFolder[]>([])
  const [pinnedColumns, setPinnedColumns] = useState<PinnedColumn[]>([])
  const [keyinfoSchema, setKeyinfoSchema] = useState<Record<string, Record<string, KeyinfoColumnSchema>>>({})
  const keyinfoReadyRef = useRef(false)
  // 이중 뷰에서 포커스가 없는 창의 핀과 스키마. 창마다 시트 -> JSON -> 제품이 따로라서, 그 창의 제품 것을 보여 준다.
  const [otherPaneKeyinfo, setOtherPaneKeyinfo] = useState<{
    paneId: PaneId
    product: string | null
    pins: PinnedColumn[]
    schema: Record<string, Record<string, KeyinfoColumnSchema>>
  } | null>(null)
  const keyinfoLoadSeqRef = useRef(0)                                   // 핀 읽기 요청 순번
  const keyinfoLoadedProductRef = useRef<string | null | undefined>(undefined)   // 화면의 핀이 속한 제품 (undefined = 아직 읽지 않음)
  const loadKeyinfoRef = useRef(async (_product: string | null, _fileSources: Record<string, FileSource>) => {})
  const [bgTask, setBgTask] = useState<{ label: string; done: number; total: number } | null>(null)
  const bgTaskClearRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hiddenFiles, setHiddenFiles] = useState<Set<string>>(new Set())
  const [fileComments, setFileComments] = useState<Record<string, string>>({})
  const [sidebarDirty, setSidebarDirty] = useState(false)
  const [lorebookCategories, setLorebookCategories] = useState<string[]>([])
  const [lorebookIndex, setLorebookIndex] = useState<Record<string, string[]>>({})
  const [columnComments, setColumnComments] = useState<Record<string, string>>({})
  const [activeProduct, setActiveProduct] = useState('')
  const activeProductRef = useRef('')
  const pinnedColumnsRef = useRef<PinnedColumn[]>([])

  const initialSheets: Array<{ id: string; name: string; isDefault: boolean; jsonFile: string | null }> = [
    { id: 'default', name: 'default', isDefault: true, jsonFile: 'local.json' },
  ]
  const [sheets, setSheets] = useState(initialSheets)
  const [activeSheetId, setActiveSheetId] = useState('default')
  const [isDirty, setIsDirty] = useState(false)
  // 마지막으로 불러오거나 저장한 JSON 이름. 사이드바 표기에 쓰며 저장하지 않는다.
  // 시트를 바꾸면 그 시트의 연결 파일을 다시 불러오므로 값을 비운다.
  const [lastJson, setLastJson] = useState<{ sheetId: string; name: string } | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sheetId: string } | null>(null)
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [dragSheetId, setDragSheetId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; side: 'before' | 'after' } | null>(null)
  const lastSavedSheetsRef = useRef(JSON.stringify(initialSheets))
  const sheetCounterRef = useRef(0)

  // sheet-settings.json 로드
  useEffect(() => {
    api.sheetLoadSettings().then((settings) => {
      if (settings?.sheets?.length) {
        const migrated = settings.sheets.map((s: SheetMeta) => ({
          ...s,
          jsonFile: s.jsonFile ?? (s.isDefault ? 'local.json' : null),
        }))
        setSheets(migrated)
        lastSavedSheetsRef.current = JSON.stringify(migrated)
        if (settings.activeSheet) setActiveSheetId(settings.activeSheet)
        const maxNum = settings.sheets
          .filter((s: { isDefault: boolean }) => !s.isDefault)
          .reduce((max: number, s: { name: string }) => {
            const n = parseInt(s.name.replace(/[^0-9]/g, ''), 10)
            return isNaN(n) ? max : Math.max(max, n)
          }, 0)
        sheetCounterRef.current = maxNum
      }
    })
  }, [])

  // 시트 목록 변경 감지 → dirty 여부 업데이트
  useEffect(() => {
    setIsDirty(JSON.stringify(sheets) !== lastSavedSheetsRef.current)
  }, [sheets])

  // 시트를 바꾸면 마지막으로 불러온 JSON 표기를 비운다.
  useEffect(() => {
    setLastJson(null)
  }, [activeSheetId])

  const handleAddSheet = useCallback(() => {
    sheetCounterRef.current += 1
    const id = `sheet-${Date.now()}`
    const name = `시트 ${sheetCounterRef.current}`
    setSheets((prev) => [...prev, { id, name, isDefault: false, jsonFile: null }])
    setActiveSheetId(id)
  }, [])

  const handleSheetGlobalSave = useCallback(async () => {
    try {
      await api.sheetSaveSettings({ sheets, activeSheet: activeSheetId })
      lastSavedSheetsRef.current = JSON.stringify(sheets)
      setIsDirty(false)
      toast.success('시트 설정 저장')
    } catch {
      toast.error('시트 설정 저장 실패')
    }
  }, [sheets, activeSheetId])

  const handleDeleteSheet = useCallback((id: string) => {
    const target = sheetsRef.current.find((s) => s.id === id)
    setSheets((prev) => prev.filter((s) => s.id !== id))
    if (activeSheetIdRef.current === id) setActiveSheetId('default')
    if (target) {
      toast.success(
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <span className="toast-name-ellipsis">{target.name}</span>
          <span style={{ flexShrink: 0 }}>이 삭제되었습니다.</span>
        </span>
      )
    }
  }, [])

  const handleSheetReset = useCallback(async () => {
    try {
      const settings = await api.sheetLoadSettings()
      if (settings?.sheets?.length) {
        const migrated = settings.sheets.map((s: SheetMeta) => ({
          ...s,
          jsonFile: s.jsonFile ?? (s.isDefault ? 'local.json' : null),
        }))
        setSheets(migrated)
        lastSavedSheetsRef.current = JSON.stringify(migrated)
        setIsDirty(false)
        if (settings.activeSheet) setActiveSheetId(settings.activeSheet)
        sheetCounterRef.current = migrated
          .filter((s: { isDefault: boolean }) => !s.isDefault)
          .reduce((max: number, s: { name: string }) => {
            const n = parseInt(s.name.replace(/[^0-9]/g, ''), 10)
            return isNaN(n) ? max : Math.max(max, n)
          }, 0)
      } else {
        setSheets(initialSheets)
        lastSavedSheetsRef.current = JSON.stringify(initialSheets)
        setIsDirty(false)
        setActiveSheetId('default')
        sheetCounterRef.current = 0
      }
      toast.success('시트 설정 복원됨')
    } catch {
      toast.error('복원 실패')
    }
  }, [])

  const [folders, setFolders] = useState<FolderItem[]>([])
  const [fileToFolder, setFileToFolder] = useState<Record<string, string>>({})
  const [fileSources, setFileSources] = useState<Record<string, FileSource>>({})
  const [allColumnWidths, setAllColumnWidths] = useState<Record<string, Record<string, number>>>({})
  const [allPageSettings, setAllPageSettings] = useState<Record<string, number>>({})
  // CSV 칼럼 상태 기록: 파일명 기준
  const [allColumnDeletions, setAllColumnDeletions] = useState<Record<string, string[]>>({})
  const [allHiddenColumns, setAllHiddenColumns] = useState<Record<string, string[]>>({})
  const allColumnDeletionsRef = useRef<Record<string, string[]>>({})
  const allHiddenColumnsRef   = useRef<Record<string, string[]>>({})
  const fileSourcesRef        = useRef<Record<string, FileSource>>({})

  const hasLoaded = useRef(false)
  const activeSheetIdRef = useRef(activeSheetId)
  const sheetsRef = useRef(sheets)
  const sheetSwitchMountedRef = useRef(false)

  useEffect(() => { activeSheetIdRef.current = activeSheetId }, [activeSheetId])
  useEffect(() => { sheetsRef.current = sheets }, [sheets])
  useEffect(() => { allColumnDeletionsRef.current = allColumnDeletions }, [allColumnDeletions])
  useEffect(() => { allHiddenColumnsRef.current   = allHiddenColumns   }, [allHiddenColumns])
  useEffect(() => { fileSourcesRef.current        = fileSources        }, [fileSources])
  useEffect(() => { activeProductRef.current     = activeProduct      }, [activeProduct])
  useEffect(() => { pinnedColumnsRef.current     = pinnedColumns      }, [pinnedColumns])
  useEffect(() => { focusedPaneIdRef.current = focusedPaneId }, [focusedPaneId])
  useEffect(() => { panesRef.current = panes }, [panes])

  // 이중 뷰: pane별 시트 컨텍스트 추적
  const [paneSheetIds, setPaneSheetIds] = useState<Partial<Record<PaneId, string>>>({ A: 'default' })
  const paneContextsRef = useRef<Partial<Record<PaneId, PaneContext>>>({})
  const paneSheetIdsRef = useRef<Partial<Record<PaneId, string>>>({ A: 'default' })
  const blockSheetSwitchRef = useRef(false)
  const layoutRef = useRef<'single' | 'split-v'>('single')
  // 시트마다 마지막으로 보던 CSV 파일 이름. 시트로 돌아오면 이 파일을 자동으로 연다.
  const sheetLastFileRef = useRef<Record<string, string>>({})
  const handleSelectFileRef = useRef<(name: string) => void>(() => {})
  const openRememberedFileRef = useRef<(sheetId: string, data: LocalPreset | null, preferData?: boolean) => Promise<void>>(async () => {})

  useEffect(() => { paneSheetIdsRef.current = paneSheetIds }, [paneSheetIds])
  useEffect(() => { layoutRef.current = layout }, [layout])
  // 단일 모드에서 activeSheetId 변경 시 paneSheetIds.A 동기화
  useEffect(() => {
    if (layout !== 'split-v') setPaneSheetIds(prev => ({ ...prev, A: activeSheetId }))
  }, [activeSheetId, layout])

  // 현재 전역 상태 스냅샷
  const snapshotContext = useCallback((): PaneContext => ({
    folders, fileToFolder, fileSources, pendingFiles, parsedMap,
    allColumnWidths, allPageSettings, hiddenFiles,
    fileComments, allColumnDeletions, allHiddenColumns, lorebookIndex, activeProduct,
  }), [folders, fileToFolder, fileSources, pendingFiles, parsedMap,
      allColumnWidths, allPageSettings, hiddenFiles, fileComments,
      allColumnDeletions, allHiddenColumns, lorebookIndex, activeProduct])

  // 저장된 컨텍스트를 전역 상태로 복원
  const restoreContext = useCallback((ctx: PaneContext) => {
    setFolders(ctx.folders)
    setFileToFolder(ctx.fileToFolder)
    setFileSources(ctx.fileSources)
    fileSourcesRef.current = ctx.fileSources
    setPendingFiles(ctx.pendingFiles)
    pendingFilesRef.current = ctx.pendingFiles
    setParsedMap(ctx.parsedMap)
    setAllColumnWidths(ctx.allColumnWidths)
    setAllPageSettings(ctx.allPageSettings)
    setHiddenFiles(ctx.hiddenFiles)
    setFileComments(ctx.fileComments)
    setAllColumnDeletions(ctx.allColumnDeletions)
    allColumnDeletionsRef.current = ctx.allColumnDeletions
    setAllHiddenColumns(ctx.allHiddenColumns)
    allHiddenColumnsRef.current = ctx.allHiddenColumns
    setLorebookIndex(ctx.lorebookIndex)
    setActiveProduct(ctx.activeProduct)
    activeProductRef.current = ctx.activeProduct
    loadKeyinfoRef.current(ctx.activeProduct || null, ctx.fileSources)
  }, [])

  const updatePane = useCallback((paneId: PaneId, update: Partial<Omit<PaneState, 'id'>>) => {
    setPanes(prev => prev.map(p => p.id === paneId ? { ...p, ...update } : p))
  }, [])

  const openPaneB = useCallback(() => {
    const ctx = snapshotContext()
    const sid = paneSheetIdsRef.current.A ?? 'default'
    paneContextsRef.current = { A: ctx, B: ctx }
    setPaneSheetIds({ A: sid, B: sid })
    paneSheetIdsRef.current = { A: sid, B: sid }
    setPanes(prev => prev.find(p => p.id === 'B') ? prev : [...prev, { id: 'B', activeFile: null, activeFileParsed: null, pinned: false }])
    setLayout('split-v')
    setFocusedPaneId('B')
    focusedPaneIdRef.current = 'B'
  }, [snapshotContext])

  const closePaneB = useCallback(() => {
    if (focusedPaneIdRef.current === 'B') {
      // B 포커스 상태에서 닫기 — B의 현재 시트·CSV를 단일뷰 A로 이전
      const bSheetId = paneSheetIdsRef.current.B ?? 'default'
      setPaneSheetIds({ A: bSheetId })
      paneSheetIdsRef.current = { A: bSheetId }
      blockSheetSwitchRef.current = true
      setActiveSheetId(bSheetId)
      setPanes(prev => {
        const bPane = prev.find(p => p.id === 'B')
        return [{ id: 'A', activeFile: bPane?.activeFile ?? null, activeFileParsed: bPane?.activeFileParsed ?? null, pinned: false }]
      })
    } else {
      // A 포커스 상태에서 닫기 — A 그대로 유지, B만 제거
      setPanes(prev => prev.filter(p => p.id !== 'B'))
    }
    paneContextsRef.current = {}
    setLayout('single')
    setFocusedPaneId('A')
    focusedPaneIdRef.current = 'A'
  }, [])

  // 이중 뷰에서 pane 포커스 전환 시 컨텍스트 교체
  const handlePaneFocus = useCallback((paneId: PaneId) => {
    if (paneId === focusedPaneIdRef.current) return
    const outgoingId = focusedPaneIdRef.current
    paneContextsRef.current = { ...paneContextsRef.current, [outgoingId]: snapshotContext() }
    const incoming = paneContextsRef.current[paneId]
    if (incoming) restoreContext(incoming)
    setFocusedPaneId(paneId)
    focusedPaneIdRef.current = paneId
  }, [snapshotContext, restoreContext])


  // activeFile 변경 시 lorebook 주석 로드
  useEffect(() => {
    if (!activeFile) { setColumnComments({}); return }
    api.lorebookGetColumnComments(activeFile)
      .then(setColumnComments)
      .catch(() => setColumnComments({}))
  }, [activeFile])

  // 다른 영역 클릭 시 삭제 대기 초기화
  useEffect(() => {
    if (!pendingDeleteId) return
    const reset = () => setPendingDeleteId(null)
    document.addEventListener('click', reset)
    return () => document.removeEventListener('click', reset)
  }, [pendingDeleteId])

  // context menu 외부 클릭 시 닫기
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    document.addEventListener('contextmenu', close)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('contextmenu', close)
    }
  }, [contextMenu])

  const handleRenameStart = useCallback((id: string) => {
    const sheet = sheetsRef.current.find((s) => s.id === id)
    if (!sheet) return
    setEditingSheetId(id)
    setEditingName(sheet.name)
  }, [])

  const handleRenameCommit = useCallback((id: string, newName: string) => {
    const trimmed = newName.trim()
    setEditingSheetId(null)
    if (!trimmed) return
    setSheets((prev) => {
      const next = prev.map((s) => s.id === id ? { ...s, name: trimmed } : s)
      return next
    })
  }, [])

  useEffect(() => {
    pendingFilesRef.current = pendingFiles
  }, [pendingFiles])

  // keyinfo:index progress 수신
  useEffect(() => {
    api.onKeyinfoProgress(({ done, total }) => {
      if (bgTaskClearRef.current) { clearTimeout(bgTaskClearRef.current); bgTaskClearRef.current = null }
      if (done >= total) {
        setBgTask({ label: 'CSV 색인 완료', done: total, total })
        bgTaskClearRef.current = setTimeout(() => setBgTask(null), 1800)
      } else {
        setBgTask({ label: 'CSV 색인 중', done, total })
      }
    })
    return () => { api.offKeyinfoProgress() }
  }, [])

  // keyinfo 로드 함수 (ref에 저장해 applyLoadedData에서 호출 — 자동 색인 없음)
  useEffect(() => {
    // 제품마다 핀 파일이 따로 있다. 화면에 있는 핀이 어느 제품의 것인지 keyinfoLoadedProductRef에 적어 두고,
    // 저장은 그 제품에만 한다. 읽기가 겹치면 마지막 요청만 반영하고, 읽지 못하면 저장하지 않는다.
    loadKeyinfoRef.current = async (product: string | null, _fileSources: Record<string, FileSource>) => {
      const target = product || null
      const seq = ++keyinfoLoadSeqRef.current
      keyinfoReadyRef.current = false
      // 제품이 없는 프리셋은 Keyinfo(핀, 스키마)를 쓰지 않는다. 비워 두고 어디에도 저장하지 않는다.
      if (!target) {
        setPinnedColumns([])
        setKeyinfoFolders([])
        setKeyinfoSchema({})
        keyinfoLoadedProductRef.current = null
        return
      }
      try {
        const loaded = await api.keyinfoLoad(target)
        if (seq !== keyinfoLoadSeqRef.current) return   // 더 새로운 읽기가 시작됐다. 이 응답은 버린다.
        setPinnedColumns(loaded.pinnedColumns ?? [])
        setKeyinfoFolders(loaded.folders ?? [])
        setKeyinfoSchema(loaded.schema ?? {})
        keyinfoLoadedProductRef.current = target
        keyinfoReadyRef.current = true
      } catch {
        // 읽지 못하면 ready를 켜지 않는다. 이전 제품의 핀이 이 제품 파일에 저장되는 일을 막는다.
      }
    }
  }, [])

  // 포커스가 바뀌거나 이중 뷰가 켜질 때, 포커스가 없는 창의 제품 핀을 읽어 둔다. (읽기만 하고 저장하지 않는다)
  useEffect(() => {
    if (layout !== 'split-v') { setOtherPaneKeyinfo(null); return }
    const otherId: PaneId = focusedPaneId === 'A' ? 'B' : 'A'
    const product = paneContextsRef.current[otherId]?.activeProduct || null
    let cancelled = false
    api.keyinfoLoad(product)
      .then(d => {
        if (cancelled) return
        setOtherPaneKeyinfo({ paneId: otherId, product, pins: d.pinnedColumns ?? [], schema: d.schema ?? {} })
      })
      .catch(() => { if (!cancelled) setOtherPaneKeyinfo(null) })
    return () => { cancelled = true }
  }, [layout, focusedPaneId])

  // 핀·폴더 변경 시 JSON에 저장
  useEffect(() => {
    if (!keyinfoReadyRef.current || !activeProduct) return   // 제품이 없으면 저장하지 않는다.
    // 화면의 핀이 지금 제품의 것일 때만 저장한다. (제품이 바뀐 직후에 이전 제품의 핀을 쓰지 않는다)
    if (keyinfoLoadedProductRef.current !== (activeProduct || null)) return
    api.keyinfoSaveLayout(activeProduct || null, pinnedColumns, keyinfoFolders).catch(() => {})
  }, [pinnedColumns, keyinfoFolders, activeProduct])

  useEffect(() => {
    ;(async () => {
      try {
        const [cats, cfg] = await Promise.all([
          api.lorebookGetCategories(),
          api.productLoadConfig(),
        ])
        const savedOrder: string[] = cfg?.order ?? []
        const exists = new Set(cats)
        const merged = [
          ...savedOrder.filter(n => exists.has(n)),
          ...cats.filter(n => !savedOrder.includes(n)),
        ]
        setLorebookCategories(merged)
      } catch {
        api.lorebookGetCategories().then(setLorebookCategories).catch(() => {})
      }
    })()
  }, [])

  useEffect(() => {
    api.localLoad().then((data) => {
      if (data) {
        setFolders(data.folders ?? [])
        setFileToFolder(data.fileToFolder ?? {})
        const sources = (data.fileSources as Record<string, FileSource>) ?? {}
        setFileSources(sources)
        setAllColumnWidths(data.columnWidths ?? {})
        setAllPageSettings(data.pageSettings ?? {})

        // 이전 세션 파일 복원: local + s3(localPath 있는 것)
        const restored: Record<string, PendingFileEntry> = {}
        for (const [name, src] of Object.entries(sources)) {
          if (src.type === 'local' && src.path) {
            restored[name] = { status: 'ready', path: src.path, source: src }
          } else if (src.type === 's3' && src.localPath) {
            restored[name] = { status: 'ready', path: src.localPath, source: src }
          }
        }
        if (Object.keys(restored).length > 0) {
          setPendingFiles(restored)
          pendingFilesRef.current = restored
        }
        if (data.product) setActiveProduct(data.product)
        if (data.lorebookIndex) setLorebookIndex(data.lorebookIndex)
        const src = (data.fileSources as Record<string, FileSource>) ?? {}
        loadKeyinfoRef.current(data.product ?? null, src)
        if (activeSheetIdRef.current === 'default') void openRememberedFileRef.current('default', data, true)
      }
      hasLoaded.current = true
    })
  }, [])

  useEffect(() => {
    if (!hasLoaded.current) return
    if (activeSheetIdRef.current !== 'default') return
    api.localSave({ folders, fileToFolder, fileSources, columnWidths: allColumnWidths, pageSettings: allPageSettings, hiddenFiles: [...hiddenFiles], fileComments, lorebookCategories, deletedColumns: allColumnDeletions, hiddenColumns: allHiddenColumns, lorebookIndex, ...(activeProduct ? { product: activeProduct } : {}) })
  }, [folders, fileToFolder, fileSources, allColumnWidths, allPageSettings, hiddenFiles, fileComments, lorebookCategories, allColumnDeletions, allHiddenColumns, lorebookIndex, activeProduct])

  // 프리셋 데이터를 앱 상태에 적용하는 공통 헬퍼
  // keepPanes=true: 시트 전환 시 DataGrid 상태 유지 (pane/parsedMap 초기화 생략)
  // 시트에 연결된 JSON을 불러온 뒤 시트, JSON, 제품이 맞는지 본다. 맞지 않으면 어디가 어긋났는지 알려 준다.
  // - JSON을 읽지 못함: 시트가 가리키는 파일이 없거나 깨짐. 화면이 비어 보이는 이유를 알려 준다.
  // - JSON의 제품이 등록 목록에 없음: 그 제품의 Keyinfo는 읽히지만 제품 목록(P 버튼)에는 없다.
  const checkSheetLoad = useCallback(async (sheet: SheetMeta, data: LocalPreset | null) => {
    if (!sheet.jsonFile) return   // 아직 JSON에 연결하지 않은 시트는 비어 있는 것이 정상이다.
    if (!data) {
      toast.error(`시트 "${sheet.name}"에 연결된 ${sheet.jsonFile}을(를) 불러오지 못했어요. 파일이 없거나 읽을 수 없어요.`, { duration: 7000 })
      return
    }
    if (!data.product) return
    try {
      const registered = await api.lorebookGetCategories()
      if (!registered.includes(data.product)) {
        toast.warning(`${sheet.jsonFile}의 제품 "${data.product}"이(가) 등록된 제품 목록에 없어요. Footer의 P 버튼에서 확인해 주세요.`, { duration: 7000 })
      }
    } catch { /* 목록을 읽지 못하면 점검만 건너뛴다. */ }
  }, [])

  const applyLoadedData = useCallback((data: LocalPreset | null, keepPanes = false) => {
    if (!keepPanes) {
      setPanes([{ id: 'A', activeFile: null, activeFileParsed: null, pinned: false }])
      setFocusedPaneId('A')
      setLayout('single')
      setParsedMap({})
    }
    if (!data) {
      setFolders([]); setFileToFolder({}); setFileSources({})
      setAllColumnWidths({}); setAllPageSettings({})
      setPendingFiles({}); pendingFilesRef.current = {}
      return
    }
    const rawSources = (data.fileSources as Record<string, FileSource>) ?? {}
    const ftf = { ...(data.fileToFolder ?? {}) } as Record<string, string>
    const cleaned: Record<string, FileSource> = {}
    const restored: Record<string, PendingFileEntry> = {}
    for (const [name, src] of Object.entries(rawSources)) {
      if (src.type === 'local' && src.path) {
        cleaned[name] = src
        restored[name] = { status: 'ready', path: src.path, source: src }
      } else if (src.type === 's3' && src.localPath) {
        cleaned[name] = src
        restored[name] = { status: 'ready', path: src.localPath, source: src }
      } else {
        delete ftf[name]
      }
    }
    setFolders(data.folders ?? [])
    setFileToFolder(ftf)
    setFileSources(cleaned)
    setAllColumnWidths(data.columnWidths ?? {})
    setAllPageSettings(data.pageSettings ?? {})
    setHiddenFiles(new Set(data.hiddenFiles ?? []))
    setFileComments(data.fileComments ?? {})
    setAllColumnDeletions(data.deletedColumns ?? {})
    setAllHiddenColumns(data.hiddenColumns ?? {})
    allColumnDeletionsRef.current = data.deletedColumns ?? {}
    allHiddenColumnsRef.current   = data.hiddenColumns ?? {}
    setLorebookIndex(data.lorebookIndex ?? {})
    setActiveProduct(data.product ?? '')
    setPendingFiles(restored)
    pendingFilesRef.current = restored
    setSidebarDirty(false)
    loadKeyinfoRef.current(data.product ?? null, cleaned)
  }, [])

  // sheet-settings.json 동기화 헬퍼
  const syncSheetSettings = useCallback(async (updatedSheets: typeof sheets) => {
    try {
      await api.sheetSaveSettings({
        sheets: updatedSheets,
        activeSheet: activeSheetIdRef.current,
      })
      lastSavedSheetsRef.current = JSON.stringify(updatedSheets)
      setIsDirty(false)
    } catch {
      // 메인 작업 성공 후 동기화 실패는 무시
    }
  }, [])

  const handleSheetReorder = useCallback((draggingId: string, targetId: string, side: 'before' | 'after') => {
    const prev = sheetsRef.current
    const defaults = prev.filter((s) => s.isDefault)
    const customs = prev.filter((s) => !s.isDefault)
    const fromIdx = customs.findIndex((s) => s.id === draggingId)
    if (fromIdx === -1) return
    const dragged = customs[fromIdx]
    const remaining = customs.filter((s) => s.id !== draggingId)
    const newToIdx = remaining.findIndex((s) => s.id === targetId)
    if (newToIdx === -1) return
    const insertAt = side === 'before' ? newToIdx : newToIdx + 1
    remaining.splice(insertAt, 0, dragged)
    const result = [...defaults, ...remaining]
    setSheets(result)
    syncSheetSettings(result)
  }, [syncSheetSettings])

  // 이중 뷰: 포커스된 pane에 시트 로드 (applyLoadedData 이후 정의)
  const loadSheetIntoPanef = useCallback(async (sheetId: string) => {
    const pid = focusedPaneIdRef.current
    const isPinned = panesRef.current.find(p => p.id === pid)?.pinned
    if (isPinned) { toast.warning('핀 버튼이 켜 있어요.'); return }
    const sheet = sheetsRef.current.find(s => s.id === sheetId)
    if (!sheet) return
    let data: LocalPreset | null = null
    if (sheet.isDefault) data = await api.localLoad()
    else if (sheet.jsonFile) data = await api.localLoadPreset(sheet.jsonFile)
    applyLoadedData(data, true)
    void checkSheetLoad(sheet, data)
    updatePane(pid, { activeFile: null, activeFileParsed: null })
    setPaneSheetIds(prev => ({ ...prev, [pid]: sheetId }))
    paneSheetIdsRef.current = { ...paneSheetIdsRef.current, [pid]: sheetId }
    void openRememberedFileRef.current(sheetId, data)
  }, [applyLoadedData, updatePane, checkSheetLoad])

  const handleSheetTabClick = useCallback((sheetId: string) => {
    if (layoutRef.current === 'split-v') { loadSheetIntoPanef(sheetId); return }
    const isPinned = panesRef.current.find(p => p.id === focusedPaneIdRef.current)?.pinned
    if (isPinned) { toast.warning('핀 버튼이 켜 있어요.'); return }
    setActiveSheetId(sheetId)
  }, [loadSheetIntoPanef])

  // 시트 전환 → 연결된 json 자동 로드 (단일 뷰 전용; 이중 뷰는 handleSheetTabClick에서 처리)
  useEffect(() => {
    if (!sheetSwitchMountedRef.current) {
      sheetSwitchMountedRef.current = true
      return
    }
    if (blockSheetSwitchRef.current) {
      blockSheetSwitchRef.current = false
      return
    }
    const sheet = sheetsRef.current.find((s) => s.id === activeSheetId)
    if (!sheet) return
    // 단일뷰에서 시트 전환 시 pane A의 CSV 파일을 초기화 — 이전 시트의 데이터그리드 잔류 방지
    setPanes(prev => prev.map(p => p.id === 'A' ? { ...p, activeFile: null, activeFileParsed: null } : p))
    if (sheet.isDefault) {
      api.localLoad().then((d) => {
        applyLoadedData(d, true)
        void checkSheetLoad(sheet, d)
        void openRememberedFileRef.current(sheet.id, d)
      })
    } else if (sheet.jsonFile) {
      api.localLoadPreset(sheet.jsonFile).then((d) => {
        applyLoadedData(d, true)
        void checkSheetLoad(sheet, d)
        void openRememberedFileRef.current(sheet.id, d)
      })
    } else {
      applyLoadedData(null, true)
    }
  }, [activeSheetId, applyLoadedData, checkSheetLoad])

  const recordSources = useCallback(
    (newFiles: { name: string; source?: FileSource }[]) => {
      setFileSources((prev) => {
        const next = { ...prev }
        for (const f of newFiles) {
          if (f.source && !next[f.name]) next[f.name] = f.source
        }
        return next
      })
    },
    []
  )

  // 사이드바 폴더 목록의 최신 값. 한 번에 여러 폴더를 연달아 만들 때 중복 생성을 막는다.
  const foldersRef = useRef(folders)
  useEffect(() => { foldersRef.current = folders }, [folders])

  // 사이드바에 등록된 파일의 행 수, 열 수를 백그라운드에서 순서대로 센다. (파일을 파싱하지 않는다)
  // 결과는 모아서 한꺼번에 반영해, 파일이 많아도 사이드바가 계속 다시 그려지지 않게 한다.
  const [fileStats, setFileStats] = useState<Record<string, CsvStats | null>>({})
  const pendingForStatsRef = useRef(pendingFiles)
  pendingForStatsRef.current = pendingFiles
  const fileStatsRef = useRef(fileStats)
  fileStatsRef.current = fileStats
  const statsRequestedRef = useRef<Record<string, string>>({})
  const statsQueueRef = useRef<string[]>([])
  const statsRunningRef = useRef(false)
  const statsBufferRef = useRef<Record<string, CsvStats | null>>({})
  const statsFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushStats = useCallback(() => {
    statsFlushTimerRef.current = null
    const batch = statsBufferRef.current
    statsBufferRef.current = {}
    if (Object.keys(batch).length > 0) setFileStats((prev) => ({ ...prev, ...batch }))
  }, [])

  const runStatsQueue = useCallback(async () => {
    if (statsRunningRef.current) return
    statsRunningRef.current = true
    try {
      while (statsQueueRef.current.length > 0) {
        const name = statsQueueRef.current.shift()!
        const entry = pendingForStatsRef.current[name]
        if (!entry || statsRequestedRef.current[name] !== entry.path) continue
        let result: CsvStats | null = null
        try { result = await api.csvStats(entry.path) } catch { result = null }
        // 세는 동안 같은 이름에 다른 파일이 들어왔다면 결과를 버린다.
        if (pendingForStatsRef.current[name]?.path !== entry.path) continue
        statsBufferRef.current[name] = result
        if (!statsFlushTimerRef.current) statsFlushTimerRef.current = setTimeout(flushStats, 250)
      }
    } finally {
      statsRunningRef.current = false
    }
  }, [flushStats])

  useEffect(() => {
    let added = false
    for (const [name, entry] of Object.entries(pendingFiles)) {
      if (entry.status !== 'ready') continue
      if (statsRequestedRef.current[name] === entry.path) continue
      statsRequestedRef.current[name] = entry.path
      statsQueueRef.current.push(name)
      added = true
    }
    // 목록에서 빠진 파일은 기록을 지워서, 다시 등록하면 새로 센다. (바뀌지 않았다면 캐시가 바로 답한다)
    for (const name of Object.keys(statsRequestedRef.current)) {
      if (!pendingFiles[name]) delete statsRequestedRef.current[name]
    }
    if (added) void runStatsQueue()
  }, [pendingFiles, runStatsQueue])

  // 실종된 파일은 창으로 돌아올 때 다시 확인한다. (파일을 복구해 두었을 수 있다)
  useEffect(() => {
    const recheck = () => {
      let added = false
      for (const [name, stats] of Object.entries(fileStatsRef.current)) {
        if (!stats?.missing) continue
        delete statsRequestedRef.current[name]
        const entry = pendingForStatsRef.current[name]
        if (!entry) continue
        statsRequestedRef.current[name] = entry.path
        statsQueueRef.current.push(name)
        added = true
      }
      if (added) void runStatsQueue()
    }
    window.addEventListener('focus', recheck)
    return () => window.removeEventListener('focus', recheck)
  }, [runStatsQueue])

  // S3/Local 파일: 파싱 후 캐시 저장, pendingFiles 등록, 첫 파일 활성화
  // options.folder가 있으면 그 이름의 사이드바 폴더에 파일을 넣는다. 같은 이름의 폴더가 있으면 합친다.
  const handleFilesLoaded = useCallback(
    async (
      incoming: { name: string; content: string; source?: FileSource }[],
      options?: { folder?: string },
    ) => {
      // 사이드바에 같은 이름의 다른 파일이 이미 있으면 표시 이름 앞에 상위 폴더 이름을 붙인다.
      // 먼저 `스키마.파일`을 시도하고, 그것도 겹치면 `DB폴더.스키마.파일`을 쓴다.
      const normalize = (p: string) => p.replace(/\\/g, '/')
      const newFiles = incoming.map((f) => {
        const filePath = f.source?.type === 'local' ? f.source.path : null
        if (!filePath) return f
        const parts = normalize(filePath).split('/')
        const schema = parts[parts.length - 2]
        const db = parts[parts.length - 3]
        const candidates = [f.name]
        if (schema) candidates.push(`${schema}.${f.name}`)
        if (schema && db) candidates.push(`${db}.${schema}.${f.name}`)
        for (const candidate of candidates) {
          const existing = pendingFilesRef.current[candidate]
          if (!existing || normalize(existing.path) === normalize(filePath)) {
            return candidate === f.name ? f : { ...f, name: candidate }
          }
        }
        return f
      })

      const parsed = await Promise.all(
        newFiles.map((f) => parseCsv(f.name, f.content))
      )
      recordSources(newFiles.map((f) => ({ name: f.name, source: f.source })))

      const pathEntries: Record<string, PendingFileEntry> = {}
      for (let i = 0; i < parsed.length; i++) {
        const src = newFiles[i].source
        const localPath =
          src?.type === 'local' ? src.path
          : src?.type === 's3' && src.localPath ? src.localPath
          : null
        if (localPath && src && !pendingFilesRef.current[parsed[i].fileName]) {
          pathEntries[parsed[i].fileName] = { status: 'ready', path: localPath, source: src }
          api.cacheSave(localPath, parsed[i])
        }
      }
      if (Object.keys(pathEntries).length > 0) {
        setPendingFiles((prev) => ({ ...prev, ...pathEntries }))
        pendingFilesRef.current = { ...pendingFilesRef.current, ...pathEntries }
      }

      if (parsed.length > 0) {
        setParsedMap(prev => {
          const n = { ...prev }
          parsed.forEach(p => { n[p.fileName] = p })
          return n
        })
        const focused = panesRef.current.find(p => p.id === focusedPaneIdRef.current)
        if (!focused?.activeFile) {
          updatePane(focusedPaneIdRef.current, { activeFile: parsed[0].fileName, activeFileParsed: parsed[0] })
        }
      }

      // 스키마 폴더로 불러온 경우 사이드바에 같은 이름의 폴더를 만들고 파일을 넣는다.
      if (options?.folder && parsed.length > 0) {
        const folderName = options.folder
        let folderId = foldersRef.current.find((f) => f.name === folderName)?.id
        if (!folderId) {
          const newId = Date.now().toString(36) + Math.random().toString(36).slice(2)
          folderId = newId
          foldersRef.current = [...foldersRef.current, { id: newId, name: folderName, expanded: true }]
          setFolders((prev) =>
            prev.some((f) => f.name === folderName) ? prev : [...prev, { id: newId, name: folderName, expanded: true }]
          )
        }
        const targetId = folderId
        setFileToFolder((prev) => {
          const next = { ...prev }
          for (const p of parsed) next[p.fileName] = targetId
          return next
        })
      }
    },
    [recordSources, parseCsv, updatePane]
  )

  // 사이드바 파일 클릭 — 캐시 우선 로드, 없으면 on-demand 파싱 (파일 전환 시 이전 파일 메모리 해제)
  const handleSelectFile = useCallback(
    async (name: string) => {
      const paneId = focusedPaneIdRef.current
      const currentPane = panesRef.current.find(p => p.id === paneId)
      if (currentPane?.activeFile === name) return

      const pending = pendingFilesRef.current[name]
      if (!pending || pending.status !== 'ready') return

      // 실종된 파일은 열 수 없다. 어디를 찾았는지 알려준다.
      if (fileStatsRef.current[name]?.missing) {
        toast.warning(`실종된 파일이에요. 이 경로에 파일이 없어요: ${pending.path}`)
        return
      }

      updatePane(paneId, { activeFile: name, activeFileParsed: null })
      setPendingFiles((prev) => ({
        ...prev,
        [name]: { ...prev[name], status: 'parsing' },
      }))

      try {
        const cached = await api.cacheLoad(pending.path)
        if (cached) {
          updatePane(paneId, { activeFileParsed: cached })
          setParsedMap(prev => ({ ...prev, [name]: cached }))
          setPendingFiles((prev) => ({ ...prev, [name]: { ...prev[name], status: 'ready' } }))
          return
        }

        const content = await api.localReadFile(pending.path)
        let parsed = await parseCsv(name, content)
        // JSON에 기록된 삭제 칼럼이 CSV에 재등장했다면 재삭제
        const deletions = allColumnDeletionsRef.current[name] ?? []
        const toDelete = deletions.filter(dk => parsed.columns.some(c => c.key === dk))
        if (toDelete.length > 0 && pending.source?.type === 'local') {
          for (const dk of toDelete) {
            await api.localEraseColumn(pending.path, dk)
          }
          const fresh = await api.localReadFile(pending.path)
          parsed = await parseCsv(name, fresh)
        }
        updatePane(paneId, { activeFileParsed: parsed })
        setParsedMap(prev => ({ ...prev, [name]: parsed }))
        setPendingFiles((prev) => ({ ...prev, [name]: { ...prev[name], status: 'ready' } }))
        api.cacheSave(pending.path, parsed)
      } catch {
        toast.error(`${name} 파싱 실패`)
        setPendingFiles((prev) => ({ ...prev, [name]: { ...prev[name], status: 'ready' } }))
        updatePane(paneId, { activeFile: null })
      }
    },
    [parseCsv, updatePane]
  )

  handleSelectFileRef.current = handleSelectFile

  // 시트나 프리셋을 열 때 마지막으로 보던 CSV를 자동으로 연다.
  // preferData가 true이면 JSON에 기록된 파일을 우선하고, 아니면 이번 실행에서 이 시트에서 보던 파일을 우선한다.
  openRememberedFileRef.current = async (sheetId, data, preferData = false) => {
    const wanted = preferData
      ? (data?.activeFile ?? sheetLastFileRef.current[sheetId])
      : (sheetLastFileRef.current[sheetId] ?? data?.activeFile)
    if (!wanted) return
    const entry = pendingFilesRef.current[wanted]
    if (!entry || entry.status !== 'ready') return
    // 디스크에 없는 파일(실종)은 열지 않는다.
    try {
      const stats = await api.csvStats(entry.path)
      if (stats?.missing) return
    } catch { /* 확인하지 못해도 열기를 시도한다. */ }
    // 확인하는 동안 다른 시트로 넘어갔다면 열지 않는다.
    const currentSheet = layoutRef.current === 'split-v'
      ? (paneSheetIdsRef.current[focusedPaneIdRef.current] ?? 'default')
      : activeSheetIdRef.current
    if (currentSheet !== sheetId) return
    sheetLastFileRef.current[sheetId] = wanted
    handleSelectFileRef.current(wanted)
  }

  // 지금 보고 있는 파일을 그 시트의 "마지막으로 보던 파일"로 기억하고, 시트에 연결된 JSON에도 남긴다.
  // 시트를 넘기는 동안 파일이 비워지는 순간에는 기록하지 않는다. (파일이 있을 때만 기록)
  const focusedActiveFile = focusedPane.activeFile
  useEffect(() => {
    if (!focusedActiveFile) return
    const sheetId = layoutRef.current === 'split-v'
      ? (paneSheetIdsRef.current[focusedPaneIdRef.current] ?? 'default')
      : activeSheetIdRef.current
    sheetLastFileRef.current[sheetId] = focusedActiveFile
    const jsonFile = sheetsRef.current.find((s) => s.id === sheetId)?.jsonFile
    if (!jsonFile) return
    const timer = setTimeout(() => {
      api.localSetActiveFile(jsonFile, focusedActiveFile).catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [focusedActiveFile])

  // DnD 업로드 — 파일 복사만, 파싱 안 함
  const handleDrop = useCallback(
    async (droppedFiles: FileList) => {
      const csvFiles = Array.from(droppedFiles).filter((f) => f.name.endsWith('.csv'))
      if (csvFiles.length === 0) return

      // 즉시 uploading 상태로 사이드바에 표시
      setPendingFiles((prev) => {
        const next = { ...prev }
        for (const file of csvFiles) {
          if (!next[file.name]) {
            next[file.name] = { status: 'uploading', path: '', source: { type: 'local', path: '' } }
          }
        }
        return next
      })

      await Promise.all(
        csvFiles.map(async (file) => {
          try {
            const imported = await api.importDroppedFile(file)
            setPendingFiles((prev) => ({
              ...prev,
              [file.name]: {
                status: 'ready',
                path: imported.path,
                source: { type: 'local', path: imported.path },
              },
            }))
            recordSources([{ name: imported.name, source: { type: 'local', path: imported.path } }])
          } catch {
            toast.error(`${file.name} 업로드 실패`)
            setPendingFiles((prev) => {
              const next = { ...prev }
              delete next[file.name]
              return next
            })
          }
        })
      )
    },
    [recordSources]
  )

  // 파일 선택 다이얼로그 — 복사만, 파싱 안 함
  const handleOpenDialog = async () => {
    const result = await api.openCsv()
    if (!result) return
    setPendingFiles((prev) => {
      const next = { ...prev }
      for (const f of result) {
        if (!next[f.name]) {
          next[f.name] = {
            status: 'ready',
            path: f.path,
            source: { type: 'local', path: f.path },
          }
        }
      }
      return next
    })
    recordSources(
      result.map((f) => ({ name: f.name, source: { type: 'local', path: f.path } as FileSource }))
    )
  }

  const handleRemoveFile = useCallback(
    (name: string) => {
      setPanes(prev => prev.map(p => p.activeFile === name ? { ...p, activeFile: null, activeFileParsed: null } : p))
      setPendingFiles((prev) => { const n = { ...prev }; delete n[name]; return n })
      setFileSources((prev) => { const n = { ...prev }; delete n[name]; return n })
      setFileToFolder((prev) => { const n = { ...prev }; delete n[name]; return n })
      setParsedMap((prev) => { const n = { ...prev }; delete n[name]; return n })
    },
    []
  )

  const handleLorebookCreated = useCallback((csvName: string, colKey: string, _product: string) => {
    setLorebookIndex(prev => {
      const current = prev[csvName] ?? []
      if (current.includes(colKey)) return prev
      return { ...prev, [csvName]: [...current, colKey] }
    })
    // 현재 활성 파일이면 주석 즉시 갱신
    api.lorebookGetColumnComments(csvName)
      .then(setColumnComments)
      .catch(() => {})
  }, [])

  const handleDeleteFolder = useCallback(
    (folderId: string) => {
      // 폴더에 속한 파일 이름 목록 수집
      const names = Object.entries(fileToFolder)
        .filter(([, fid]) => fid === folderId)
        .map(([name]) => name)
      const nameSet = new Set(names)

      setFolders((prev) => prev.filter((f) => f.id !== folderId))
      setFileToFolder((prev) => {
        const next = { ...prev }
        for (const name of names) delete next[name]
        return next
      })
      setPendingFiles((prev) => {
        const next = { ...prev }
        for (const name of names) delete next[name]
        return next
      })
      setFileSources((prev) => {
        const next = { ...prev }
        for (const name of names) delete next[name]
        return next
      })
      setParsedMap((prev) => {
        const next = { ...prev }
        for (const name of names) delete next[name]
        return next
      })
      setPanes(prev => prev.map(p => nameSet.has(p.activeFile ?? '') ? { ...p, activeFile: null, activeFileParsed: null } : p))
    },
    [fileToFolder]
  )

  const handleCreateFolder = useCallback((name: string) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2)
    setFolders((prev) => [...prev, { id, name, expanded: true }])
  }, [])

  // 폴더 순서 바꾸기. draggedId 폴더를 targetId 폴더의 앞 또는 뒤로 옮긴다.
  // 순서는 folders 배열의 순서이며, 자동 저장과 프리셋 저장에 그대로 담긴다.
  const handleReorderFolders = useCallback(
    (draggedId: string, targetId: string, side: 'before' | 'after') => {
      setFolders((prev) => {
        const dragged = prev.find((f) => f.id === draggedId)
        if (!dragged || draggedId === targetId) return prev
        const rest = prev.filter((f) => f.id !== draggedId)
        const targetIdx = rest.findIndex((f) => f.id === targetId)
        if (targetIdx === -1) return prev
        const insertAt = side === 'before' ? targetIdx : targetIdx + 1
        const next = [...rest.slice(0, insertAt), dragged, ...rest.slice(insertAt)]
        return next.every((f, i) => f.id === prev[i].id) ? prev : next
      })
    },
    []
  )

  const handleMoveFile = useCallback((fileName: string, folderId: string | null) => {
    setFileToFolder((prev) => {
      const next = { ...prev }
      if (folderId === null) delete next[fileName]
      else next[fileName] = folderId
      return next
    })
  }, [])

  const handleToggleFolder = useCallback((folderId: string) => {
    setFolders((prev) =>
      prev.map((f) => (f.id === folderId ? { ...f, expanded: !f.expanded } : f))
    )
  }, [])

  const handleRenameFolder = useCallback((folderId: string, name: string) => {
    if (!name.trim()) return
    setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, name: name.trim() } : f)))
  }, [])

  const handleColumnWidthsChange = useCallback(
    (fileName: string, widths: Record<string, number>) => {
      setAllColumnWidths((prev) => ({ ...prev, [fileName]: widths }))
    },
    []
  )

  const handlePageSizeChange = useCallback(
    (fileName: string, size: number) => {
      setAllPageSettings((prev) => ({ ...prev, [fileName]: size }))
    },
    []
  )

  const handleCategoriesChange = useCallback((cats: string[]) => {
    setLorebookCategories(cats)
    api.productSaveConfig({ order: cats }).catch(() => {})
  }, [])

  const [dragProduct, setDragProduct] = useState<string | null>(null)
  const [productDropTarget, setProductDropTarget] = useState<{ cat: string; side: 'before' | 'after' } | null>(null)

  const handleProductReorder = useCallback((fromCat: string, toCat: string, side: 'before' | 'after') => {
    setLorebookCategories(prev => {
      const cats = [...prev]
      const fromIdx = cats.indexOf(fromCat)
      if (fromIdx === -1) return prev
      cats.splice(fromIdx, 1)
      let toIdx = cats.indexOf(toCat)
      if (toIdx === -1) return prev
      if (side === 'after') toIdx++
      cats.splice(toIdx, 0, fromCat)
      api.productSaveConfig({ order: cats }).catch(() => {})
      return cats
    })
  }, [])

  const handleHideColumn = useCallback((fileName: string, colKey: string) => {
    setAllHiddenColumns(prev => {
      const next = { ...prev }
      const list = new Set(next[fileName] ?? [])
      if (list.has(colKey)) list.delete(colKey)
      else list.add(colKey)
      next[fileName] = [...list]
      return next
    })
    setSidebarDirty(true)
  }, [])

  const handleResetDeletedColumn = useCallback((fileName: string, colKey: string) => {
    setAllColumnDeletions(prev => {
      const next = { ...prev }
      const filtered = (next[fileName] ?? []).filter(k => k !== colKey)
      if (filtered.length === 0) delete next[fileName]
      else next[fileName] = filtered
      return next
    })
    setSidebarDirty(true)
    toast.info(`"${colKey}" 삭제 기록 제거됨 — CSV 파일을 다시 다운로드해 주세요.`, { duration: 5000 })
  }, [])

  const handlePinColumn = useCallback((columnKey: string) => {
    if (!activeFile) return
    if (!activeProductRef.current) {
      toast.warning('제품이 지정된 프리셋에서만 핀을 고정할 수 있어요. 프리셋을 제품과 함께 저장한 뒤 다시 해 주세요.', { duration: 5000 })
      return
    }
    const current = pinnedColumnsRef.current
    const exactIdx = current.findIndex(p => p.fileName === activeFile && p.columnKey === columnKey)
    const isDupeKey = current.some(p => p.columnKey === columnKey)

    if (exactIdx >= 0) {
      // 해제. 핀이 Key 노트가 존재하는 조건이라서, 남은 핀이 없는 노트는 함께 지운다.
      setPinnedColumns(prev => {
        const next = prev.filter((_, i) => i !== exactIdx)
        return next.map((p, i) => ({ ...p, pinId: i + 1 }))
      })
      const remainingPins = current.filter((_, i) => i !== exactIdx)
      api.keynotePruneByPins(activeProductRef.current || null, remainingPins)
        .then(removed => {
          if (removed.length > 0) toast.info(`핀이 없어진 Key 노트 ${removed.length}개를 함께 지웠어요: ${removed.join(', ')}`, { duration: 6000 })
        })
        .catch(() => {})
    } else if (!isDupeKey) {
      // 새 핀 → 추가 + 해당 파일 단독 색인
      setPinnedColumns(prev => [...prev, { pinId: prev.length + 1, fileName: activeFile, columnKey }])
      const src = fileSourcesRef.current[activeFile]
      if (src) {
        api.keyinfoIndex(
          activeProductRef.current || null,
          { [activeFile]: src } as Record<string, { type: string; path?: string; localPath?: string }>
        ).then(updated => setKeyinfoSchema(updated.schema ?? {})).catch(() => {})
      }
    } else {
      // 다른 파일에 같은 열이 이미 핀으로 고정되어 있다. 이 파일의 열은 그 핀을 따르므로, 해제는 고정한 파일에서 해야 한다.
      const owner = current.find(p => p.columnKey === columnKey)
      if (owner) toast.info(`"${columnKey}" 열은 ${owner.fileName}의 #${owner.pinId} 핀을 따릅니다. 해제는 ${owner.fileName}에서 해 주세요.`, { duration: 5000 })
    }
  }, [activeFile])

  const handleEraseColumn = useCallback(async (colKey: string) => {
    if (!activeFile) return
    const source = fileSourcesRef.current[activeFile]
    if (source?.type !== 'local') {
      toast.error('로컬 파일만 칼럼 삭제가 가능합니다')
      return
    }
    await api.localEraseColumn(source.path, colKey)
    const content = await api.localReadFile(source.path)
    const reparsed = await parseCsv(activeFile, content)
    updatePane(focusedPaneIdRef.current, { activeFileParsed: reparsed })
    setParsedMap(prev => ({ ...prev, [activeFile]: reparsed }))
    api.cacheSave(source.path, reparsed)
    // 삭제 기록
    setAllColumnDeletions(prev => {
      const next = { ...prev }
      next[activeFile] = [...new Set([...(next[activeFile] ?? []), colKey])]
      return next
    })
    setSidebarDirty(true)
    toast.success(`"${colKey}" 칼럼 삭제 완료`)
  }, [activeFile, parseCsv, updatePane])

  const handleSetFilesHidden = useCallback((names: string[], hidden: boolean) => {
    setHiddenFiles(prev => {
      const next = new Set(prev)
      for (const name of names) {
        if (hidden) next.add(name)
        else next.delete(name)
      }
      return next
    })
    setSidebarDirty(true)
  }, [])

  const handleCommentSave = useCallback((name: string, text: string) => {
    setFileComments(prev => ({ ...prev, [name]: text }))
    setSidebarDirty(true)
  }, [])

  const handleCommentSaveMany = useCallback((names: string[], text: string) => {
    setFileComments(prev => {
      const next = { ...prev }
      for (const name of names) next[name] = text
      return next
    })
    setSidebarDirty(true)
  }, [])

  const handleSavePreset = useCallback(
    async (name: string, product: string) => {
      try {
        const savedName = await api.localSavePreset(name, {
          ...(product ? { product } : {}),
          folders,
          fileToFolder,
          fileSources,
          columnWidths: allColumnWidths,
          pageSettings: allPageSettings,
          hiddenFiles: [...hiddenFiles],
          fileComments,
          lorebookCategories,
          deletedColumns: allColumnDeletions,
          hiddenColumns: allHiddenColumns,
          // 지금 시트에서 마지막으로 보던 파일도 함께 저장한다.
          ...(sheetLastFileRef.current[activeSheetIdRef.current]
            ? { activeFile: sheetLastFileRef.current[activeSheetIdRef.current] }
            : {}),
        })
        setSidebarDirty(false)
        if (product) {
          // 제품이 바뀌면 그 제품의 Keyinfo를 읽는다. 읽지 않으면 이전 제품의 핀이 새 제품 파일에 저장된다.
          if (product !== activeProductRef.current) void loadKeyinfoRef.current(product, fileSources)
          setActiveProduct(product)
        }
        toast.success(`${savedName} 저장 완료`)
        setLastJson({ sheetId: activeSheetIdRef.current, name: savedName })
        // 이름 지정 저장 + 커스텀 시트 → 시트에 json 연결 후 sheet-settings 동기화
        if (activeSheetIdRef.current !== 'default' && savedName !== 'local.json') {
          const newSheets = sheetsRef.current.map((s) =>
            s.id === activeSheetIdRef.current ? { ...s, jsonFile: savedName } : s
          )
          setSheets(newSheets)
          await syncSheetSettings(newSheets)
        }
      } catch {
        toast.error('저장 실패')
      }
    },
    [folders, fileToFolder, fileSources, allColumnWidths, allPageSettings, hiddenFiles, fileComments, allColumnDeletions, allHiddenColumns, syncSheetSettings]
  )

  const handleLoadPreset = useCallback(
    async (name: string) => {
      const data = await api.localLoadPreset(name)
      applyLoadedData(data)
      // 불러온 JSON에 기록된 마지막 파일을 연다. (이 시트에서 보던 파일보다 JSON의 기록을 우선한다)
      if (data) void openRememberedFileRef.current(activeSheetIdRef.current, data, true)
      if (!data) {
        toast.error('프리셋을 불러올 수 없습니다')
      } else {
        toast.success(`${name} 불러옴`)
        setLastJson({ sheetId: activeSheetIdRef.current, name })
        // 커스텀 시트에서 불러오기 → 시트에 json 연결 (local.json 제외)
        if (activeSheetIdRef.current !== 'default' && name !== 'local.json') {
          const newSheets = sheetsRef.current.map((s) =>
            s.id === activeSheetIdRef.current ? { ...s, jsonFile: name } : s
          )
          setSheets(newSheets)
          await syncSheetSettings(newSheets)
        }
      }
      setLoadModalOpen(false)
    },
    [applyLoadedData, syncSheetSettings]
  )


  return (
    <div className="app-layout">
      <Toaster
        position="bottom-right"
        visibleToasts={5}
        toastOptions={{
          classNames: {
            toast:   'app-toast',
            success: 'app-toast--success',
            error:   'app-toast--error',
          },
          duration: 3000,
        }}
      />
      <LoadingModal visible={!!loadingMessage} message={loadingMessage ?? undefined} />
      <SaveModal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        onSave={handleSavePreset}
        categories={lorebookCategories}
        onCategoriesChange={handleCategoriesChange}
        currentJson={sheets.find(s => s.id === activeSheetId)?.jsonFile ?? null}
      />
      <LoadModal
        open={loadModalOpen}
        onClose={() => setLoadModalOpen(false)}
        onLoad={handleLoadPreset}
        currentJson={sheets.find(s => s.id === activeSheetId)?.jsonFile ?? null}
        categories={lorebookCategories}
      />
      <div className="logo-header" {...uiId('HD.bar')}>
        {/* 왼쪽 영역: 앱 제목, ID 버튼 */}
        <div className="header-zone header-zone--left" {...uiId('HD.zone-left')}>
          <span className="logo-header-title" {...uiId('HD.title')}>DBViewer-tagger</span>
          <Inspector />
        </div>
        <div className="header-divider" {...uiId('HD.divider', '1')} />
        {/* 가운데 영역: 왼쪽부터 버튼을 놓는다. 남는 공간은 비워 둔다. */}
        <div className="header-zone header-zone--center" {...uiId('HD.zone-center')}>
          <button
            className={`split-toggle-btn split-toggle-btn--header${layout === 'split-v' ? ' active' : ''}`} {...uiId('MN.split')}
            onClick={() => layout === 'split-v' ? closePaneB() : openPaneB()}
            title={layout === 'split-v' ? '단일 뷰로 전환' : '화면 분할'}
          >이중 뷰</button>
          {/* Key 노트로 바로 가는 두 번째 입구. 푸터 K 버튼으로 여는 것과 같은 창을 노트 탭으로 연다. */}
          <button
            className="split-toggle-btn split-toggle-btn--header" {...uiId('HD.keynote')}
            onClick={() => { setKeyinfoTab('notes'); setKeyinfoOpen(true) }}
            title="Key 노트 열기"
          >Key 노트</button>
        </div>
        <div className="header-divider" {...uiId('HD.divider', '2')} />
        {/* 오른쪽 영역: GitHub 버튼 */}
        <div className="header-zone header-zone--right" {...uiId('HD.zone-right')}>
          <button
            className="logo-copyright"
            {...uiId('HD.github')}
            onClick={() => { api.openGithub().catch(() => {}) }}
            title="GitHub 열기"
          >
            GitHub
          </button>
        </div>
      </div>
      <div className="app-content">
      <Sidebar
        files={activeFileParsed ? [activeFileParsed] : []}
        pendingFiles={pendingFiles}
        activeFile={activeFile}
        onSelectFile={handleSelectFile}
        onOpenDialog={handleOpenDialog}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        actions={<DBButton onClick={() => setDbOpen(true)} />}
        onOpenWorkspace={caps.workspace ? openWorkspace : undefined}
        folders={folders}
        fileToFolder={fileToFolder}
        onCreateFolder={handleCreateFolder}
        onMoveFile={handleMoveFile}
        onReorderFolders={handleReorderFolders}
        onToggleFolder={handleToggleFolder}
        onRemoveFile={handleRemoveFile}
        onDeleteFolder={handleDeleteFolder}
        onRenameFolder={handleRenameFolder}
        onSaveClick={() => setSaveModalOpen(true)}
        onLoadClick={() => setLoadModalOpen(true)}
        currentJsonName={
          (lastJson && lastJson.sheetId === activeSheetId ? lastJson.name : null)
            ?? sheets.find(s => s.id === activeSheetId)?.jsonFile
            ?? null
        }
        currentJsonTitle={
          activeSheetId === 'default' && lastJson && lastJson.sheetId === 'default' && lastJson.name !== 'local.json'
            ? `불러온 파일: ${lastJson.name} / 자동 저장 대상: local.json`
            : undefined
        }
        selectedFileNames={selectedFileNames}
        onSelectionChange={setSelectedFileNames}
        localFilesBrowser={
          <LocalFilesBrowser onFilesLoaded={handleFilesLoaded} onLoading={setLoadingMessage} onOpenWorkspace={caps.workspace ? openWorkspace : undefined} />
        }
        hiddenFiles={hiddenFiles}
        fileStats={fileStats}
        fileComments={fileComments}
        onSetFilesHidden={handleSetFilesHidden}
        onCommentSave={handleCommentSave}
        onCommentSaveMany={handleCommentSaveMany}
        sidebarDirty={sidebarDirty}
      />
      <main className="main-area" {...uiId('MN.root')}>
        <header className="header-main" {...uiId('MN.top')}>
          <div className="header-main-1" {...uiId('MN.product-bar')}>
            {lorebookCategories.length === 0
              ? <span className="header-main-placeholder">제품을 등록해주세요 — Footer의 P 버튼</span>
              : lorebookCategories.map(cat => {
                  const isDragging = dragProduct === cat
                  const isActiveProduct = cat === activeProduct   // 지금 불러온 프리셋(JSON)의 제품
                  const dropSide = productDropTarget?.cat === cat ? productDropTarget.side : null
                  return (
                    <button
                      key={cat}
                      className={[
                        'header-main-btn',
                        isDragging ? 'header-main-btn--dragging' : '',
                        isActiveProduct ? 'header-main-btn--active' : '',
                        dropSide === 'before' ? 'header-main-btn--drop-before' : '',
                        dropSide === 'after' ? 'header-main-btn--drop-after' : '',
                      ].filter(Boolean).join(' ')} {...uiId('MN.product', cat)}
                      draggable
                      aria-pressed={isActiveProduct}
                      title={isActiveProduct ? `활성 제품: 지금 불러온 프리셋의 제품이에요` : undefined}
                      onDragStart={e => {
                        e.dataTransfer.effectAllowed = 'move'
                        setDragProduct(cat)
                        setProductDropTarget(null)
                      }}
                      onDragOver={e => {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        if (!dragProduct || dragProduct === cat) return
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        const side = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
                        setProductDropTarget({ cat, side })
                      }}
                      onDragLeave={() => {
                        setProductDropTarget(prev => prev?.cat === cat ? null : prev)
                      }}
                      onDrop={e => {
                        e.preventDefault()
                        if (dragProduct && dragProduct !== cat) {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                          const side = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
                          handleProductReorder(dragProduct, cat, side)
                        }
                        setDragProduct(null)
                        setProductDropTarget(null)
                      }}
                      onDragEnd={() => {
                        setDragProduct(null)
                        setProductDropTarget(null)
                      }}
                    >
                      {isActiveProduct && <span className="header-main-btn-dot" aria-hidden />}
                      {cat}
                    </button>
                  )
                })
            }
          </div>

          <div className="header-main-2" {...uiId('MN.sheet-bar')}>
            {/* 고정 UI — 스크롤 컨테이너 밖 */}
            <div className="sheet-tabs-fixed">
              <button
                className={`sheet-global-save-btn${isDirty ? ' dirty' : ''}`} {...uiId('MN.sheet-save')}
                onClick={handleSheetGlobalSave}
                title={isDirty ? '시트 설정에 변경이 있습니다. 저장하세요.' : '시트 설정이 저장된 상태입니다.'}
              >
                저장
              </button>
              <button
                className={`sheet-reset-btn${isDirty ? ' dirty' : ''}`} {...uiId('MN.sheet-reset')}
                onClick={handleSheetReset}
                title="저장된 시트 설정으로 복원"
              >
                R
              </button>
              <div className="sheet-tabs" {...uiId('MN.sheet-tabs')}>
                <button
                  className={`sheet-tab sheet-tab--default${(layout === 'split-v' ? paneSheetIds[focusedPaneId] ?? 'default' : activeSheetId) === 'default' ? ' sheet-tab--active' : ''}`} {...uiId('MN.sheet-tab', 'default')}
                  onClick={() => handleSheetTabClick('default')}
                >
                  default
                </button>
              </div>
              <div className="sheet-divider" />
              <button className="sheet-tab-add" {...uiId('MN.sheet-add')} title="시트 추가" onClick={handleAddSheet}>＋</button>
            </div>

            {/* 스크롤 가능 영역 — 커스텀 시트들 */}
            <div
              className="sheet-scroll-area"
              onWheel={(e) => {
                // 스크롤바를 숨겼으므로 마우스 휠의 세로 움직임을 가로 스크롤로 바꿔 준다.
                if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
              }}
            >
              <div className="sheet-tabs sheet-tabs--custom" {...uiId('MN.sheet-tabs-custom')}>
                {sheets.filter((s) => !s.isDefault).map((sheet) => (
                  <button
                    key={sheet.id}
                    draggable={editingSheetId !== sheet.id}
                    className={[
                      'sheet-tab',
                      (layout === 'split-v' ? paneSheetIds[focusedPaneId] ?? 'default' : activeSheetId) === sheet.id ? 'sheet-tab--active' : '',
                      dragSheetId === sheet.id ? 'sheet-tab--dragging' : '',
                      dropTarget?.id === sheet.id && dropTarget.side === 'before' ? 'sheet-tab--drop-before' : '',
                      dropTarget?.id === sheet.id && dropTarget.side === 'after' ? 'sheet-tab--drop-after' : '',
                    ].filter(Boolean).join(' ')} {...uiId('MN.sheet-tab', sheet.name)}
                    onClick={() => { if (editingSheetId !== sheet.id) handleSheetTabClick(sheet.id) }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setContextMenu({ x: e.clientX, y: e.clientY, sheetId: sheet.id })
                    }}
                    onDragStart={(e) => {
                      if (editingSheetId === sheet.id) { e.preventDefault(); return }
                      e.dataTransfer.setData('sheetId', sheet.id)
                      e.dataTransfer.effectAllowed = 'move'
                      setDragSheetId(sheet.id)
                    }}
                    onDragEnd={() => {
                      setDragSheetId(null)
                      setDropTarget(null)
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      if (dragSheetId === sheet.id) return
                      const rect = e.currentTarget.getBoundingClientRect()
                      const side: 'before' | 'after' = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
                      setDropTarget((prev) =>
                        prev?.id === sheet.id && prev.side === side ? prev : { id: sheet.id, side }
                      )
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setDropTarget((prev) => (prev?.id === sheet.id ? null : prev))
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      const draggingId = e.dataTransfer.getData('sheetId')
                      if (draggingId && draggingId !== sheet.id) {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const side: 'before' | 'after' = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
                        handleSheetReorder(draggingId, sheet.id, side)
                      }
                      setDragSheetId(null)
                      setDropTarget(null)
                    }}
                  >
                    {editingSheetId === sheet.id ? (
                      <input
                        className="sheet-tab-rename-input"
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameCommit(sheet.id, editingName)
                          if (e.key === 'Escape') setEditingSheetId(null)
                        }}
                        onBlur={() => handleRenameCommit(sheet.id, editingName)}
                      />
                    ) : (
                      sheet.name
                    )}
                    <span
                      className={`sheet-tab-close${pendingDeleteId === sheet.id ? ' pending-delete' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (pendingDeleteId === sheet.id) {
                          handleDeleteSheet(sheet.id)
                          setPendingDeleteId(null)
                        } else {
                          setPendingDeleteId(sheet.id)
                        }
                      }}
                    >✕</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 시트 탭 우클릭 컨텍스트 메뉴 */}
            {contextMenu && (
              <div
                className="sheet-context-menu"
                style={{ left: contextMenu.x, top: contextMenu.y }}
                onClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.preventDefault()}
              >
                <button
                  className="sheet-context-item"
                  onClick={() => {
                    handleRenameStart(contextMenu.sheetId)
                    setContextMenu(null)
                  }}
                >
                  이름 변경
                </button>
                <button
                  className="sheet-context-item sheet-context-item--danger"
                  onClick={() => {
                    handleDeleteSheet(contextMenu.sheetId)
                    setContextMenu(null)
                  }}
                >
                  삭제
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="main-body" {...uiId('MN.body')}>
          <div className={`main-content-area${layout === 'split-v' ? ' split-v' : ''}`} {...uiId('MN.panes')}>
            {panes.map((pane) => {
              const isFocused = pane.id === focusedPaneId
              const paneFile = pane.activeFile
              const paneParsed = pane.activeFileParsed
              const panePendingStatus = paneFile ? pendingFiles[paneFile]?.status : undefined
              // 이 창의 제품과 그 제품의 핀. 포커스가 있는 창은 화면 상태를 쓰고, 없는 창은 자기 제품의 핀을 쓴다.
              // 두 창의 제품이 같으면 한쪽에서 고친 핀이 바로 보이도록 화면 상태를 같이 쓴다.
              const paneProduct = isFocused ? activeProduct : (paneContextsRef.current[pane.id]?.activeProduct ?? '')
              const useLive = isFocused || paneProduct === activeProduct
              const paneKeyinfo = !useLive && otherPaneKeyinfo?.paneId === pane.id && otherPaneKeyinfo.product === (paneProduct || null)
                ? otherPaneKeyinfo
                : null
              const panePins = useLive ? pinnedColumns : (paneKeyinfo?.pins ?? [])
              const paneSchema = useLive ? keyinfoSchema : (paneKeyinfo?.schema ?? {})
              return (
                <div
                  key={pane.id}
                  className={`main-pane${isFocused ? ' focused' : ''}`} {...uiId(pane.id === 'A' ? 'MN.pane-a' : 'MN.pane-b')}
                  onClick={() => { if (!isFocused) handlePaneFocus(pane.id) }}
                >
                  <div className="pane-header" {...uiId('MN.pane-head')} onClick={e => e.stopPropagation()}>
                    <span className="pane-label">{pane.id}</span>
                    <span className="pane-sheet-tag">{sheets.find(s => s.id === (paneSheetIds[pane.id] ?? 'default'))?.name ?? 'default'}</span>
                    {paneFile && <span className="pane-filename">{paneFile}</span>}
                    <button
                      className={`pane-pin-btn${pane.pinned ? ' active' : ''}`} {...uiId('MN.pane-pin')}
                      onClick={() => updatePane(pane.id, { pinned: !pane.pinned })}
                      title={pane.pinned ? '핀 해제' : '시트 고정'}
                    >
                      <Pin size={11} />
                    </button>
                    {pane.id === 'B' && layout === 'split-v' && (
                      <button className="pane-close-btn" {...uiId('MN.pane-close')} onClick={closePaneB}>✕</button>
                    )}
                  </div>
                  {!paneFile && (
                    <DropZone onDrop={handleDrop} onOpenDialog={handleOpenDialog} />
                  )}
                  {paneFile && !paneParsed && (
                    <div className="main-pending">
                      <Loader2 size={28} className="spin" />
                      <p className="main-pending-label">
                        {panePendingStatus === 'uploading' ? '업로드 중...' : 'CSV 파싱 중...'}
                      </p>
                    </div>
                  )}
                  {paneParsed && (
                    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                      <DataGrid
                        data={paneParsed}
                        searchQuery={isFocused ? searchQuery : ''}
                        initialColumnWidths={allColumnWidths[paneParsed.fileName] ?? {}}
                        onColumnWidthsChange={(w) => handleColumnWidthsChange(paneParsed.fileName, w)}
                        initialPageSize={allPageSettings[paneParsed.fileName] ?? 500}
                        onPageSizeChange={(s) => handlePageSizeChange(paneParsed.fileName, s)}
                        lorebookCategories={lorebookCategories}
                        onCategoriesChange={handleCategoriesChange}
                        onEraseColumn={isFocused ? handleEraseColumn : async () => {}}
                        hiddenColumnKeys={allHiddenColumns[paneParsed.fileName] ?? []}
                        onHideColumn={isFocused ? (colKey) => handleHideColumn(paneParsed.fileName, colKey) : () => {}}
                        deletedColumnKeys={allColumnDeletions[paneParsed.fileName] ?? []}
                        onResetDeletedColumn={isFocused ? (colKey) => handleResetDeletedColumn(paneParsed.fileName, colKey) : () => {}}
                        onLorebookCreated={isFocused ? handleLorebookCreated : () => {}}
                        columnComments={isFocused ? columnComments : {}}
                        columnSchema={paneSchema[paneParsed.fileName] ?? {}}
                        activeProduct={paneProduct}
                        onOpenLorebook={() => setLorebookOpen(true)}
                        pinnedColumns={panePins}
                        onPinColumn={isFocused ? handlePinColumn : () => {}}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="r-sidebar" {...uiId('MN.side-right')}>
            <div className="r-sidebar-body" />
            <div className="r-sidebar-footer" />
          </div>

        </div>
        <footer className="main-footer" {...uiId('FT.bar')}>
          {caps.hermes && <button className="footer-hermes-btn" {...uiId('FT.hermes')} onClick={() => setHermesOpen(true)}>
            <Bot size={14} className="footer-hermes-icon" aria-label="Hermes" />
            <span className="lb-tooltip">Hermes</span>
          </button>}
          <button
            className="footer-lorebook-btn" {...uiId('FT.lorebook')}
            onClick={() => setLorebookOpen(true)}
          >
            L
            <span className="lb-tooltip">Lorebook</span>
          </button>
          <button
            className="footer-product-btn" {...uiId('FT.product')}
            onClick={() => setProductOpen(true)}
          >
            P
            <span className="lb-tooltip">Product</span>
          </button>
          <button className="footer-keyinfo-btn" {...uiId('FT.keyinfo')} onClick={() => { setKeyinfoTab('pins'); setKeyinfoOpen(true) }}>
            K
            <span className="lb-tooltip">Keyinfo</span>
          </button>
          <div className="footer-progress-area" {...uiId('FT.task')}>
            {bgTask && (
              <span className={['footer-task-label', bgTask.done >= bgTask.total ? 'footer-task-label--done' : ''].filter(Boolean).join(' ')}>
                {bgTask.label}
                {bgTask.done < bgTask.total && <span className="footer-task-count">{bgTask.done} / {bgTask.total}</span>}
              </span>
            )}
            <button
              className="footer-backup-btn" {...uiId('FT.backup')}
              onClick={() => setBackupOpen(true)}
            >
              B
              <span className="lb-tooltip">Backup</span>
            </button>
            <button
              className="footer-clear-btn" {...uiId('FT.clear')}
              onClick={() => setClearOpen(true)}
            >
              C
              <span className="lb-tooltip">Clear</span>
            </button>
            <div className="footer-progress-bar" {...uiId('FT.progress')}>
              <div
                className={['footer-progress-fill', bgTask?.done != null && bgTask.done >= bgTask.total ? 'footer-progress-fill--done' : ''].filter(Boolean).join(' ')}
                style={{ width: bgTask ? `${Math.round((bgTask.done / bgTask.total) * 100)}%` : '0%' }}
              />
            </div>
          </div>
        </footer>
        {lorebookOpen && <LorebookModal onClose={() => setLorebookOpen(false)} />}
        <DBBrowser open={dbOpen} onClose={() => setDbOpen(false)} onLoading={setLoadingMessage} onOpenWorkspace={caps.workspace ? openWorkspace : undefined} />
        {productOpen && (
          <ProductModal
            categories={lorebookCategories}
            onCategoriesChange={handleCategoriesChange}
            onClose={() => setProductOpen(false)}
          />
        )}
        {keyinfoOpen && (
          <KeyinfoModal
            parsedMap={parsedMap}
            pinnedColumns={pinnedColumns}
            keyinfoSchema={keyinfoSchema}
            activeProduct={activeProduct}
            products={lorebookCategories}
            fileSources={fileSources as Record<string, { type: string; path?: string; localPath?: string }>}
            folders={keyinfoFolders}
            activeFile={activeFile}
            initialTab={keyinfoTab}
            onClose={() => setKeyinfoOpen(false)}
            onOpenCsv={handleSelectFile}
            onSchemaUpdated={(schema) => setKeyinfoSchema(schema)}
            onLayoutChange={(pins, fols) => { setPinnedColumns(pins); setKeyinfoFolders(fols) }}
          />
        )}
        {caps.hermes && hermesOpen && <HermesModal onClose={() => setHermesOpen(false)} />}
        {clearOpen && <ClearModal onClose={() => setClearOpen(false)} />}
        {backupOpen && <BackupModal onClose={() => setBackupOpen(false)} />}
        {workspaceOpen && (
          <WorkspaceModal firstRun={workspaceFirstRun} onClose={() => setWorkspaceOpen(false)} />
        )}
      </main>
      </div>
    </div>
  )
}
