import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronRight, ChevronDown, Loader2, Search, Download, Table2, Database, FolderOpen, FolderCog, KeyRound, RefreshCw, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { useDraggable } from '../hooks/useDraggable'
import { ModalOverlay } from './ModalOverlay'
import { uiId } from '../ui/uiId'
import { api, caps } from '../api'

type Step = 'slots' | 'schemas' | 'tables'

interface DBBrowserProps {
  open: boolean
  onClose: () => void
  onLoading: (msg: string | null) => void
  onOpenWorkspace?: () => void
}

const EMPTY_SSH: SshConfig = { host: '', port: '22', username: '', pemPath: '' }
const EMPTY_FORM: DbSlotView = {
  name: '', folderName: '', host: '', port: '5432', database: '', user: '', hasPassword: false, verified: false, ssh: EMPTY_SSH,
}
const DEFAULT_SLOTS: DbSlotSummary[] = (['db1', 'db2', 'db3', 'db4'] as DbSlotId[]).map(id => ({
  id, name: id.toUpperCase(), configured: false,
}))

// 스키마 목록 캐시. 모달을 닫았다 열어도 유지한다.
// 키는 슬롯과 검색어이다. 접속 값이 바뀌거나 새로고침하면 그 슬롯의 캐시를 지운다.
const schemaCache = new Map<string, DbSchemaPage>()
const schemaCacheKey = (id: DbSlotId, keyword: string) => `${id}\n${keyword}`
function clearSchemaCache(id: DbSlotId) {
  for (const key of Array.from(schemaCache.keys())) {
    if (key.startsWith(`${id}\n`)) schemaCache.delete(key)
  }
}

const SEARCH_DEBOUNCE_MS = 250

export function DBBrowser({ open, onClose, onLoading, onOpenWorkspace }: DBBrowserProps) {
  const [step, setStep] = useState<Step>('slots')
  const [slot, setSlot] = useState<DbSlotId | null>(null)
  const [slots, setSlots] = useState<DbSlotSummary[]>(DEFAULT_SLOTS)

  // 스키마
  const [schemas, setSchemas] = useState<DbSchemaItem[]>([])
  const [schemasHasMore, setSchemasHasMore] = useState(false)
  const [schemasLoading, setSchemasLoading] = useState(false)
  const [schemasLoadingMore, setSchemasLoadingMore] = useState(false)
  // 통째로 저장할 스키마. 검색이나 더 보기를 해도 유지한다.
  const [selectedSchemas, setSelectedSchemas] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const schemaReq = useRef(0)

  // 테이블
  const [selectedSchema, setSelectedSchema] = useState<string | null>(null)
  const [tables, setTables] = useState<string[]>([])
  const [tablesLoading, setTablesLoading] = useState(false)
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set())
  const selectAllRef = useRef<HTMLInputElement>(null)

  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [testingConn, setTestingConn] = useState(false)

  // 슬롯 접속 설정 (슬롯별 로드, 저장)
  const [form, setForm] = useState<DbSlotView>(EMPTY_FORM)
  const [password, setPassword] = useState('')
  const [connOpen, setConnOpen] = useState(false)
  const formRef = useRef<DbSlotView>(EMPTY_FORM)
  const passwordRef = useRef('')
  const slotRef = useRef<DbSlotId | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSave = useRef<{ id: DbSlotId; payload: DbSlotConfig } | null>(null)

  const { handleProps, cardStyle } = useDraggable()

  const refreshSlots = useCallback(() => {
    api.dbListSlots().then(setSlots).catch(() => {})
  }, [])

  // 대기 중인 저장 내용을 즉시 기록한다.
  const flushSave = useCallback(async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    const pending = pendingSave.current
    if (!pending) return
    pendingSave.current = null
    const verified = await api.dbSaveSlot(pending.id, pending.payload).catch(() => null)
    // 더 새로운 입력이 없을 때만 저장 결과를 화면에 반영한다.
    if (verified !== null && slotRef.current === pending.id && !pendingSave.current) {
      const next = { ...formRef.current, verified }
      formRef.current = next
      setForm(next)
    }
  }, [])

  // 입력 변경 후 600ms 뒤에 저장한다.
  const queueSave = (nextForm: DbSlotView, pw: string) => {
    const id = slotRef.current
    if (!id) return
    const { hasPassword: _hasPassword, verified: _verified, ...rest } = nextForm
    pendingSave.current = { id, payload: { ...rest, password: pw } }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void flushSave() }, 600)
  }

  // 이름과 저장 폴더 이름만 바꾸면 연결 확인 상태를 유지하고, 그 외 접속 값이 바뀌면 해제한다.
  const updateForm = (patch: Partial<Omit<DbSlotView, 'ssh' | 'hasPassword' | 'verified'>>) => {
    const onlyName = Object.keys(patch).every(k => k === 'name' || k === 'folderName')
    const next = { ...formRef.current, ...patch, verified: onlyName ? formRef.current.verified : false }
    if (!onlyName && slotRef.current) clearSchemaCache(slotRef.current)
    formRef.current = next
    setForm(next)
    queueSave(next, passwordRef.current)
  }

  const updateSsh = (patch: Partial<SshConfig>) => {
    const next = { ...formRef.current, ssh: { ...formRef.current.ssh, ...patch }, verified: false }
    if (slotRef.current) clearSchemaCache(slotRef.current)
    formRef.current = next
    setForm(next)
    queueSave(next, passwordRef.current)
  }

  const updatePassword = (value: string) => {
    passwordRef.current = value
    setPassword(value)
    if (value) {
      if (slotRef.current) clearSchemaCache(slotRef.current)
      const next = { ...formRef.current, hasPassword: true, verified: false }
      formRef.current = next
      setForm(next)
    }
    queueSave(formRef.current, value)
  }

  const handlePickPem = async () => {
    const p = await api.sshPickPemFile()
    if (p) updateSsh({ pemPath: p })
  }

  // 패널 열릴 때 초기화
  useEffect(() => {
    if (!open) return
    slotRef.current = null
    pendingSave.current = null
    formRef.current = EMPTY_FORM
    passwordRef.current = ''
    if (searchTimer.current) { clearTimeout(searchTimer.current); searchTimer.current = null }
    setStep('slots')
    setSlot(null)
    setSchemas([])
    setSchemasHasMore(false)
    setSelectedSchemas(new Set())
    setSearch('')
    setSelectedSchema(null)
    setTables([])
    setSelectedTables(new Set())
    setError(null)
    setForm(EMPTY_FORM)
    setPassword('')
    setConnOpen(false)
    setSlots(DEFAULT_SLOTS)
    refreshSlots()
  }, [open, refreshSlots])

  // 스키마 단계 진입 시 포커스
  useEffect(() => {
    if (step === 'schemas' && form.verified) setTimeout(() => searchRef.current?.focus(), 80)
  }, [step, form.verified])

  // select-all indeterminate 처리
  useEffect(() => {
    if (!selectAllRef.current) return
    const all = tables.length > 0 && selectedTables.size === tables.length
    const some = selectedTables.size > 0 && selectedTables.size < tables.length
    selectAllRef.current.checked = all
    selectAllRef.current.indeterminate = some
  }, [selectedTables, tables])

  // 스키마 목록 조회 — 검색어가 비어 있으면 전체 목록이다. 50개씩 불러온다.
  // 같은 슬롯과 검색어의 결과가 캐시에 있으면 DB에 묻지 않는다. force이면 캐시를 지우고 다시 조회한다.
  const loadSchemas = useCallback(async (value: string, id: DbSlotId, force = false) => {
    const keyword = value.trim()
    if (force) clearSchemaCache(id)
    const reqId = ++schemaReq.current
    setError(null)

    const cached = schemaCache.get(schemaCacheKey(id, keyword))
    if (cached) {
      setSchemas(cached.items)
      setSchemasHasMore(cached.hasMore)
      setSchemasLoading(false)
      return
    }

    setSchemasLoading(true)
    try {
      await flushSave()
      const page = await api.dbListSchemas(id, keyword, 0)
      if (reqId !== schemaReq.current) return
      schemaCache.set(schemaCacheKey(id, keyword), page)
      setSchemas(page.items)
      setSchemasHasMore(page.hasMore)
    } catch {
      if (reqId !== schemaReq.current) return
      setError('DB 연결에 실패했습니다. 접속 정보를 확인해주세요.')
      setSchemas([])
      setSchemasHasMore(false)
    } finally {
      if (reqId === schemaReq.current) setSchemasLoading(false)
    }
  }, [flushSave])

  // 다음 50개를 이어서 불러온다.
  const loadMoreSchemas = async () => {
    if (!slot || schemasLoadingMore || !schemasHasMore) return
    const id = slot
    const keyword = search.trim()
    const reqId = schemaReq.current
    setSchemasLoadingMore(true)
    try {
      const page = await api.dbListSchemas(id, keyword, schemas.length)
      if (reqId !== schemaReq.current) return
      const merged: DbSchemaPage = { items: [...schemas, ...page.items], hasMore: page.hasMore }
      schemaCache.set(schemaCacheKey(id, keyword), merged)
      setSchemas(merged.items)
      setSchemasHasMore(merged.hasMore)
    } catch {
      if (reqId === schemaReq.current) setError('스키마 목록을 더 불러오지 못했습니다.')
    } finally {
      setSchemasLoadingMore(false)
    }
  }

  // 연결 확인을 통과한 슬롯에 들어오면 전체 목록을 바로 불러온다.
  useEffect(() => {
    if (step === 'schemas' && slot && form.verified) loadSchemas(search, slot)
    // search는 입력 지연 처리에서 따로 조회하므로 의존성에서 뺀다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, slot, form.verified, loadSchemas])

  // 검색어 입력 후 잠시 멈추면 조회한다.
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setSearch(raw)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { loadSchemas(raw, slot!) }, SEARCH_DEBOUNCE_MS)
  }

  const enterSlot = async (id: DbSlotId) => {
    slotRef.current = id
    passwordRef.current = ''
    formRef.current = EMPTY_FORM
    setSlot(id)
    setStep('schemas')
    setError(null)
    setSchemas([])
    setSchemasHasMore(false)
    setSelectedSchemas(new Set())
    setSearch('')
    setPassword('')
    setForm(EMPTY_FORM)
    try {
      const view = await api.dbLoadSlot(id)
      formRef.current = view
      setForm(view)
      // 연결 확인을 통과하지 않은 슬롯은 설정 칸을 펼친다.
      setConnOpen(!view.verified)
    } catch {
      setConnOpen(true)
    }
  }

  const selectSchema = async (schema: string) => {
    setSelectedSchema(schema)
    setStep('tables')
    setSelectedTables(new Set())
    setError(null)
    setTablesLoading(true)
    try {
      await flushSave()
      const list = await api.dbListTables(slot!, schema)
      setTables(list)
    } catch {
      setError('테이블 목록을 불러오지 못했습니다.')
    } finally {
      setTablesLoading(false)
    }
  }

  const toggleTable = (t: string) => {
    setSelectedTables(prev => {
      const next = new Set(prev)
      next.has(t) ? next.delete(t) : next.add(t)
      return next
    })
  }

  const toggleSchema = (name: string) => {
    setSelectedSchemas(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const toggleAll = () => {
    setSelectedTables(
      selectedTables.size === tables.length && tables.length > 0
        ? new Set()
        : new Set(tables)
    )
  }

  const handleExport = async () => {
    if (!slot || !selectedSchema || selectedTables.size === 0) return
    const list = Array.from(selectedTables)
    const exportSlot = slot
    const exportSchema = selectedSchema
    setExporting(true)

    // 클릭 즉시 모달 표시 — IPC 첫 이벤트를 기다리지 않음
    setExportProgress({ ti: 0, total: list.length, schema: exportSchema, table: list[0] ?? '', rowsDone: 0, totalRows: 0 })

    api.onExportProgress((p) => setExportProgress(p))

    try {
      await flushSave()
      const paths = await api.dbExportTables(exportSlot, exportSchema, list)
      toast.success(`${paths.length}개 테이블 CSV 저장 완료 (${formRef.current.folderName || slotLabel}\\${exportSchema})`)
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('EXPORT_ABORTED')) toast.info('저장을 중단하고, 이번에 만든 파일을 삭제했습니다.')
      else toast.error('내보내기에 실패했습니다.')
    } finally {
      api.offExportProgress()
      setExporting(false)
      setExportProgress(null)
    }
  }

  // 선택한 스키마의 테이블 전체를 저장한다. 실패한 테이블은 건너뛰고 끝에 알려준다.
  const handleExportSchemas = async () => {
    if (!slot || selectedSchemas.size === 0) return
    const list = Array.from(selectedSchemas)
    const exportSlot = slot
    setExporting(true)

    // 테이블 수는 저장을 시작해야 알 수 있으므로 첫 진행 이벤트 전에는 준비 중으로 표시한다.
    setExportProgress({ ti: 0, total: 0, schema: '', table: '', rowsDone: 0, totalRows: 0 })

    api.onExportProgress((p) => setExportProgress(p))

    try {
      await flushSave()
      const { saved, failed } = await api.dbExportSchemas(exportSlot, list)
      if (saved.length === 0 && failed.length === 0) {
        toast.info('선택한 스키마에 저장할 테이블이 없습니다.')
        return
      }
      toast.success(`스키마 ${list.length}개, 테이블 ${saved.length}개 CSV 저장 완료 (DB-downloads)`)
      if (failed.length > 0) {
        const names = failed.slice(0, 5).map(f => `${f.schema}.${f.table}`).join(', ')
        const rest = failed.length > 5 ? ` 외 ${failed.length - 5}개` : ''
        toast.warning(`저장하지 못한 테이블 ${failed.length}개: ${names}${rest}`, { duration: 12000 })
      }
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('EXPORT_ABORTED')) toast.info('저장을 중단하고, 이번에 만든 파일을 삭제했습니다.')
      else toast.error('내보내기에 실패했습니다.')
    } finally {
      api.offExportProgress()
      setExporting(false)
      setExportProgress(null)
    }
  }

  const handleAbortExport = () => {
    api.dbAbortExport().catch(() => {})
  }

  const handleClose = () => {
    void flushSave()
    if (slotRef.current) api.dbCloseTunnel(slotRef.current).catch(() => {})
    onClose()
  }

  const goBack = () => {
    setError(null)
    if (step === 'tables') {
      setStep('schemas'); setSelectedSchema(null); setTables([]); setSelectedTables(new Set())
    } else if (step === 'schemas') {
      void flushSave().then(refreshSlots)
      if (slotRef.current) api.dbCloseTunnel(slotRef.current).catch(() => {})
      slotRef.current = null
      formRef.current = EMPTY_FORM
      passwordRef.current = ''
      if (searchTimer.current) { clearTimeout(searchTimer.current); searchTimer.current = null }
      setStep('slots'); setSlot(null); setSchemas([]); setSchemasHasMore(false); setSelectedSchemas(new Set()); setSearch(''); setForm(EMPTY_FORM); setPassword('')
    }
  }

  const slotLabel = form.name || (slot ? slot.toUpperCase() : '')
  const handleTestConnection = async () => {
    if (!slot || testingConn) return
    setTestingConn(true)
    try {
      await flushSave()
      const result = await api.dbTestConnection(slot)
      if (result.ok) {
        const next = { ...formRef.current, verified: true }
        formRef.current = next
        setForm(next)
        toast.success(`${slotLabel} 연결 성공`)
      } else {
        toast.error(`연결 실패: ${result.message ?? '알 수 없는 오류'}`)
      }
    } catch {
      toast.error('연결 테스트 중 오류가 발생했습니다.')
    } finally {
      setTestingConn(false)
    }
  }

  const panelTitle = step === 'slots' ? 'Database' : 'DB'

  if (!open) return null

  return (
    <>
      <ModalOverlay className="browser-overlay db-overlay" onClose={handleClose}>
        <div
          className={`db-panel${step !== 'slots' ? ' db-panel--expanded' : ''}`} {...uiId('DB.frame')}
          style={cardStyle}
          onClick={e => e.stopPropagation()}
        >
          {/* 헤더 */}
          <div className="db-header" {...uiId('DB.header')} {...handleProps}>
            <div className="db-header-left">
              {step !== 'slots' && (
                <button className="browser-back-btn" {...uiId('DB.back')} onMouseDown={e => e.stopPropagation()} onClick={goBack}>←</button>
              )}
              <Database size={13} className="db-header-icon" />
              <span className="db-header-title" {...uiId('DB.title')}>{panelTitle}</span>
              {slot && step !== 'slots' && (
                <span className="db-slot-tag" {...uiId('DB.slot-tag')}>{slotLabel}</span>
              )}
            </div>
            <div className="db-header-right">
              {onOpenWorkspace && (
                <button
                  className="db-icon-btn" {...uiId('DB.workspace')}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={onOpenWorkspace}
                  title="작업 폴더"
                >
                  <FolderCog size={13} />
                </button>
              )}
              {step === 'schemas' && (
                <button
                  className="db-icon-btn" {...uiId('DB.refresh')}
                  disabled={!form.verified || schemasLoading}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => loadSchemas(search, slot!, true)}
                  title="새로고침"
                >
                  <RefreshCw size={13} />
                </button>
              )}
              {step !== 'slots' && (
                <button
                  className="db-icon-btn" {...uiId('DB.test')}
                  disabled={testingConn}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={handleTestConnection}
                  title="연결 테스트"
                >
                  {testingConn ? <Loader2 size={13} className="spin" /> : <Zap size={13} />}
                </button>
              )}
              <button
                className="browser-close-btn" {...uiId('DB.close')}
                onMouseDown={e => e.stopPropagation()}
                onClick={handleClose}
              >✕</button>
            </div>
          </div>

          {/* 바디 */}
          <div className="browser-panel-body">
            {error && <div className="browser-error">{error}</div>}

            {/* 슬롯 선택 (2 x 2) */}
            {step === 'slots' && (
              <div className="db-slot-grid" {...uiId('DB.slot-grid')}>
                {slots.map(s => (
                  <button key={s.id} className="db-slot-btn" {...uiId('DB.slot', s.id)} onClick={() => enterSlot(s.id)}>
                    <span className="db-slot-label">{s.name}</span>
                  </button>
                ))}
              </div>
            )}

            {/* 스키마 검색 */}
            {step === 'schemas' && (
              <>
                <div className="db-search-bar" {...uiId('DB.search')}>
                  <Search size={13} className="db-search-icon" />
                  <input
                    ref={searchRef}
                    type="text"
                    className="db-search-input"
                    placeholder="스키마 검색"
                    disabled={!form.verified}
                    value={search}
                    onChange={handleSearchChange}
                    onKeyDown={e => {
                      if (e.key !== 'Escape') return
                      setSearch('')
                      if (searchTimer.current) clearTimeout(searchTimer.current)
                      loadSchemas('', slot!)
                    }}
                  />
                </div>
                {schemasLoading ? (
                  <div className="browser-loading"><Loader2 size={18} className="spin" /><span>조회 중...</span></div>
                ) : !form.verified ? (
                  <div className="browser-empty db-search-hint">접속 설정을 입력하고 상단 번개 아이콘으로 연결을 확인하세요</div>
                ) : schemas.length === 0 ? (
                  <div className="browser-empty">검색 결과가 없습니다.</div>
                ) : (
                  <>
                    {schemas.map(item => (
                      <div
                        key={item.name}
                        className={`db-schema-row${selectedSchemas.has(item.name) ? ' selected' : ''}`}
                        {...uiId('DB.schema', item.name)}
                      >
                        <input
                          type="checkbox"
                          className="browser-file-checkbox"
                          {...uiId('DB.schema-check')}
                          checked={selectedSchemas.has(item.name)}
                          onChange={() => toggleSchema(item.name)}
                          title="스키마 전체 저장 선택"
                        />
                        <button className="browser-item db-schema-main" onClick={() => selectSchema(item.name)}>
                          <span className="db-schema-dot" />
                          <span className="browser-item-name">{item.name}</span>
                          <span className="db-schema-count" {...uiId('DB.schema-count')}>{item.tableCount}</span>
                          <ChevronRight size={13} className="browser-item-arrow" />
                        </button>
                      </div>
                    ))}
                    {schemasHasMore && (
                      <button className="db-more-btn" {...uiId('DB.more')} onClick={loadMoreSchemas} disabled={schemasLoadingMore}>
                        {schemasLoadingMore ? <Loader2 size={13} className="spin" /> : '더 보기 (50개)'}
                      </button>
                    )}
                  </>
                )}
              </>
            )}

            {/* 테이블 목록 */}
            {step === 'tables' && (
              <>
                {tablesLoading ? (
                  <div className="browser-loading"><Loader2 size={18} className="spin" /><span>테이블 조회 중...</span></div>
                ) : tables.length === 0 ? (
                  <div className="browser-empty">테이블이 없습니다.</div>
                ) : (
                  <>
                    <div className="db-table-header" {...uiId('DB.table-head')}>
                      <label className="db-select-all-label">
                        <input ref={selectAllRef} type="checkbox" onChange={toggleAll} />
                        <span>전체 선택</span>
                      </label>
                      <span className="db-table-count">{tables.length}개</span>
                    </div>
                    {tables.map(t => (
                      <div
                        key={t}
                        className={`browser-file-row${selectedTables.has(t) ? ' selected' : ''}`} {...uiId('DB.table', t)}
                        onClick={() => toggleTable(t)}
                      >
                        <div className="browser-file-row-main" style={{ cursor: 'pointer' }}>
                          <Table2 size={14} className="browser-item-icon file" />
                          <span className="browser-item-name">{t}</span>
                        </div>
                        <input
                          type="checkbox"
                          className="browser-file-checkbox"
                          checked={selectedTables.has(t)}
                          onChange={() => toggleTable(t)}
                          onClick={e => e.stopPropagation()}
                        />
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </div>

          {/* 스키마 통째 저장 푸터 */}
          {step === 'schemas' && form.verified && selectedSchemas.size > 0 && (
            <div className="browser-panel-footer" {...uiId('DB.schema-footer')}>
              <span className="browser-footer-count">스키마 {selectedSchemas.size}개 선택됨</span>
              <button className="browser-download-btn" {...uiId('DB.schema-export')} onClick={handleExportSchemas} disabled={exporting}>
                <Download size={13} />
                CSV 저장
              </button>
            </div>
          )}

          {/* CSV 내보내기 푸터 */}
          {step === 'tables' && selectedTables.size > 0 && (
            <div className="browser-panel-footer" {...uiId('DB.footer')}>
              <span className="browser-footer-count">{selectedTables.size}개 선택됨</span>
              <button className="browser-download-btn" {...uiId('DB.export')} onClick={handleExport} disabled={exporting}>
                <Download size={13} />
                CSV 저장
              </button>
            </div>
          )}

          {/* 접속 설정 푸터 — 슬롯 선택 후에만 표시 */}
          {step !== 'slots' && (
            <div className="db-conn-footer" {...uiId('DB.conn')}>
              <button className="db-conn-toggle" {...uiId('DB.conn-toggle')} onClick={() => setConnOpen(o => !o)}>
                <KeyRound size={11} className="db-ssh-title-icon" />
                <span>접속 설정</span>
                {connOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              {connOpen && (
                <div className="db-conn-body">
                  <div className="db-ssh-field" {...uiId('DB.conn-name')}>
                    <label className="db-ssh-label">이름</label>
                    <input
                      className="db-ssh-input"
                      placeholder={slot ? slot.toUpperCase() : ''}
                      value={form.name}
                      onChange={e => updateForm({ name: e.target.value })}
                    />
                  </div>
                  <div className="db-ssh-field" {...uiId('DB.conn-folder')}>
                    <label className="db-ssh-label">저장 폴더 이름 (CSV는 이 폴더 아래 스키마별로 저장돼요)</label>
                    <input
                      className="db-ssh-input"
                      placeholder={slot ? slot.toUpperCase() : ''}
                      value={form.folderName}
                      onChange={e => updateForm({ folderName: e.target.value })}
                    />
                  </div>
                  <div className="db-ssh-row">
                    <div className="db-ssh-field db-ssh-field--grow" {...uiId('DB.conn-host')}>
                      <label className="db-ssh-label">DB 호스트</label>
                      <input
                        className="db-ssh-input"
                        value={form.host}
                        onChange={e => updateForm({ host: e.target.value })}
                      />
                    </div>
                    <div className="db-ssh-field db-ssh-field--port" {...uiId('DB.conn-port')}>
                      <label className="db-ssh-label">포트</label>
                      <input
                        className="db-ssh-input"
                        placeholder="5432"
                        value={form.port}
                        onChange={e => updateForm({ port: e.target.value.replace(/[^0-9]/g, '') })}
                      />
                    </div>
                  </div>
                  <div className="db-ssh-field" {...uiId('DB.conn-database')}>
                    <label className="db-ssh-label">DB 이름</label>
                    <input
                      className="db-ssh-input"
                      value={form.database}
                      onChange={e => updateForm({ database: e.target.value })}
                    />
                  </div>
                  <div className="db-ssh-row">
                    <div className="db-ssh-field db-ssh-field--grow" {...uiId('DB.conn-user')}>
                      <label className="db-ssh-label">사용자 이름</label>
                      <input
                        className="db-ssh-input"
                        value={form.user}
                        onChange={e => updateForm({ user: e.target.value })}
                      />
                    </div>
                    <div className="db-ssh-field db-ssh-field--grow" {...uiId('DB.conn-password')}>
                      <label className="db-ssh-label">비밀번호</label>
                      <input
                        className="db-ssh-input"
                        type="password"
                        autoComplete="off"
                        placeholder={form.hasPassword ? '저장됨' : ''}
                        value={password}
                        onChange={e => updatePassword(e.target.value)}
                      />
                    </div>
                  </div>

                  {caps.ssh && <>
                  <div className="db-conn-sub" {...uiId('DB.ssh')}>SSH 터널 (선택)</div>
                  <div className="db-ssh-row">
                    <div className="db-ssh-field db-ssh-field--grow" {...uiId('DB.ssh-host')}>
                      <label className="db-ssh-label">호스트</label>
                      <input
                        className="db-ssh-input"
                        value={form.ssh.host}
                        onChange={e => updateSsh({ host: e.target.value })}
                      />
                    </div>
                    <div className="db-ssh-field db-ssh-field--port" {...uiId('DB.ssh-port')}>
                      <label className="db-ssh-label">포트</label>
                      <input
                        className="db-ssh-input"
                        placeholder="22"
                        value={form.ssh.port}
                        onChange={e => updateSsh({ port: e.target.value.replace(/[^0-9]/g, '') })}
                      />
                    </div>
                  </div>
                  <div className="db-ssh-field" {...uiId('DB.ssh-user')}>
                    <label className="db-ssh-label">사용자 이름</label>
                    <input
                      className="db-ssh-input"
                      value={form.ssh.username}
                      onChange={e => updateSsh({ username: e.target.value })}
                    />
                  </div>
                  <div className="db-ssh-field" {...uiId('DB.ssh-key-field')}>
                    <label className="db-ssh-label">키 경로</label>
                    <div className="db-ssh-pem-row" {...uiId('DB.ssh-key')}>
                      <span className="db-ssh-pem-path" title={form.ssh.pemPath}>
                        {form.ssh.pemPath || '등록된 키가 없습니다'}
                      </span>
                      <button className="db-ssh-pem-btn" onClick={handlePickPem} title="PEM 파일 선택">
                        <FolderOpen size={13} />
                      </button>
                    </div>
                  </div>
                  </>}
                </div>
              )}
            </div>
          )}
        </div>
      </ModalOverlay>

      {/* 내보내기 진행 모달 — 외부 클릭 차단, 중단 버튼만으로 취소 */}
      {exportProgress && (() => {
        const counting = exportProgress.totalRows === 0
        const pct = !counting
          ? Math.round((exportProgress.rowsDone / exportProgress.totalRows) * 100)
          : 0
        return (
          <div className="db-export-overlay">
            <div className="db-export-card" {...uiId('DB.progress')}>
              <p className="db-export-title">CSV 내보내기 진행 중</p>
              <p className="db-export-table-name">
                {exportProgress.total === 0
                  ? '준비 중...'
                  : `[${exportProgress.ti + 1} / ${exportProgress.total}]  ${exportProgress.schema}.${exportProgress.table}`}
              </p>
              <div className="db-export-bar-track">
                <div
                  className={`db-export-bar-fill${counting ? ' db-export-bar-fill--pulse' : ''}`}
                  style={{ width: counting ? '100%' : `${pct}%` }}
                />
              </div>
              <p className="db-export-stats">
                {counting
                  ? '행 수 집계 중...'
                  : `${exportProgress.rowsDone.toLocaleString()} / ${exportProgress.totalRows.toLocaleString()} rows (${pct}%)`
                }
              </p>
              <button className="db-export-abort-btn" {...uiId('DB.abort')} onClick={handleAbortExport}>
                중단
              </button>
            </div>
          </div>
        )
      })()}
    </>
  )
}
