// 보류 (LEGACY): 이 파일은 2026-10-14에 src/legacy로 옮겼다.
// 이유: 커스텀 테이블(제품 뷰어) 기능은 현재 범위에서 제외했다.
// 이 폴더는 빌드와 typecheck에 포함되지 않는다.
// 복원 방법은 같은 폴더의 README.md를 참조한다.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { X, Plus, Trash2, Download, ChevronRight, ChevronDown, RefreshCw, Maximize2, RotateCcw, Folder, FolderPlus } from 'lucide-react'
import { toast } from 'sonner'
import { parseCsvContent } from '../hooks/useCsvParser'
import type { ParsedCsv, FileSource } from '../../shared/types'

interface Props {
  fileSources: Record<string, FileSource>
  activeProduct: string | null
  products: string[]
  onClose: () => void
  fileComments?: Record<string, string>
  standalone?: boolean
  initialTableId?: string
}

type ScopeMode = 'product' | 'all'

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}
function makeAnchorCol(): CustomTableColumn {
  return { id: makeId('col'), keyinfoKey: '', csvFile: null, csvColumn: null, isAnchor: true, label: null }
}
function makeBlankTable(product: string | null): CustomTable {
  return { id: makeId('ct'), name: '새 테이블', product, columns: [makeAnchorCol()], rows: [] }
}

// ── 검색 가능한 키 선택 컴포넌트 ──────────────────────────────────────────────
function KeySelector({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = '-- 키 검색/선택 --',
  comments = {},
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
  disabled?: boolean
  placeholder?: string
  comments?: Record<string, string>
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() =>
    search.trim()
      ? options.filter(o => o.toLowerCase().includes(search.toLowerCase()))
      : options,
    [options, search]
  )

  const handleSelect = (key: string) => {
    onChange(key)
    setOpen(false)
    setSearch('')
  }

  return (
    <div className="pview-key-selector">
      <input
        className={`pview-key-search${open ? ' pview-key-search--open' : ''}`}
        value={open ? search : value}
        placeholder={value || placeholder}
        disabled={disabled}
        onFocus={() => { setOpen(true); setSearch('') }}
        onChange={e => setSearch(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        readOnly={!open}
      />
      {open && (
        <div className="pview-key-dropdown">
          {filtered.length === 0 ? (
            <div className="pview-key-option pview-key-option--empty">검색 결과 없음</div>
          ) : (
            filtered.map((o, i) => (
              <div key={o}>
                {i > 0 && <div className="pview-key-item-divider" />}
                <div
                  className={`pview-key-option${o === value ? ' pview-key-option--selected' : ''}`}
                  onMouseDown={() => handleSelect(o)}
                >
                  <span className="pview-key-option-name">{o}</span>
                  <span className="pview-key-option-comment">{comments[o] ?? ''}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── CSV 파일 선택 드롭다운 (주석 2열 표시) ────────────────────────────────────────
function CsvFileSelector({
  value,
  options,
  usedFiles,
  onChange,
  disabled = false,
  comments = {},
}: {
  value: string
  options: string[]
  usedFiles: Set<string>
  onChange: (v: string) => void
  disabled?: boolean
  comments?: Record<string, string>
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const sorted = useMemo(() => {
    const used = options.filter(f => usedFiles.has(f))
    const unused = options.filter(f => !usedFiles.has(f))
    return [...used, ...unused]
  }, [options, usedFiles])

  const filtered = useMemo(() =>
    search.trim() ? sorted.filter(f => f.toLowerCase().includes(search.toLowerCase()) || (comments[f] ?? '').toLowerCase().includes(search.toLowerCase())) : sorted,
    [sorted, search, comments]
  )

  const handleSelect = (f: string) => { onChange(f); setOpen(false); setSearch('') }

  return (
    <div className="pview-key-selector">
      <input
        className={`pview-key-search${open ? ' pview-key-search--open' : ''}`}
        value={open ? search : value}
        placeholder={value || '-- CSV 선택 --'}
        disabled={disabled}
        onFocus={() => { setOpen(true); setSearch('') }}
        onChange={e => setSearch(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        readOnly={!open}
      />
      {open && (
        <div className="pview-key-dropdown">
          <div
            className="pview-key-option pview-csv-clear-option"
            onMouseDown={() => handleSelect('')}
          >
            <span className="pview-key-option-name" style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>-- 선택 해제 --</span>
            <span className="pview-key-option-comment" />
          </div>
          {filtered.length === 0 ? (
            <div className="pview-key-option pview-key-option--empty">검색 결과 없음</div>
          ) : (
            filtered.map((f, i) => (
              <div key={f}>
                <div className="pview-key-item-divider" />
                <div
                  className={`pview-key-option${f === value ? ' pview-key-option--selected' : ''}`}
                  onMouseDown={() => handleSelect(f)}
                  style={usedFiles.has(f) && f !== value ? { color: '#fbbf24' } : undefined}
                >
                  <span className="pview-key-option-name" style={usedFiles.has(f) && f !== value ? { color: '#fbbf24', fontWeight: 600 } : undefined}>{f}</span>
                  <span className="pview-key-option-comment">{comments[f] ?? ''}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── 폴더 총괄 뷰어 (read-only 아코디언) ────────────────────────────────────────
function FolderViewer({
  folder,
  folderMetas,
  activeProduct,
  availableKeys,
  effectiveComments,
  fileComments,
  csvsByKey,
}: {
  folder: CustomTableFolder
  folderMetas: CustomTableMeta[]
  activeProduct: string | null
  availableKeys: string[]
  effectiveComments: Record<string, string>
  fileComments: Record<string, string>
  csvsByKey: (key: string) => string[]
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(folderMetas.map(m => m.id)))
  const [tables, setTables] = useState<Record<string, CustomTable | null>>({})

  const metaKey = folderMetas.map(m => m.id).join(',')
  useEffect(() => {
    setTables({})
    setExpanded(new Set(folderMetas.map(m => m.id)))
    folderMetas.forEach(async m => {
      const t = await window.electronAPI.customtableLoad(activeProduct, m.id)
      setTables(prev => ({ ...prev, [m.id]: t ?? null }))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaKey, activeProduct])

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <div className="pview-folder-viewer">
      <div className="pview-fv-header">
        <Folder size={13} />
        <span className="pview-fv-name">{folder.name}</span>
        <span className="pview-fv-count">테이블 {folderMetas.length}개</span>
      </div>
      {folderMetas.length === 0 ? (
        <div className="pview-fv-empty">이 폴더에 테이블이 없습니다<br /><small>테이블 우클릭 → 폴더로 이동</small></div>
      ) : folderMetas.map(meta => {
        const t = tables[meta.id]
        const isOpen = expanded.has(meta.id)
        const anchorCol = t?.columns.find(c => c.isAnchor)
        const dispCols = t?.columns.filter(c => !c.isAnchor) ?? []
        const anchorKey = anchorCol?.keyinfoKey ?? ''
        return (
          <div key={meta.id} className="pview-accordion-item">
            <div className="pview-accordion-hd" onClick={() => toggle(meta.id)}>
              {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              <span className="pview-accordion-title">{meta.name}</span>
              <span className="pview-accordion-stats">{meta.rowCount}행 · {meta.columnCount}열</span>
            </div>
            {isOpen && (
              <div className="pview-accordion-body">
                {!t ? (
                  <div className="pview-accordion-loading">불러오는 중...</div>
                ) : (
                  <>
                    {/* Row 1: 앵커 설명 | CSV 파일 설명 */}
                    <div className="pview-col-row pview-fv-desc-row">
                      <div className="pview-col-cell pview-col-cell--anchor">
                        <div className="pview-fv-cell pview-fv-cell--desc">
                          <span className="pview-fv-key" title={anchorKey || undefined}>{anchorKey || '—'}</span>
                          {effectiveComments[anchorKey] && (
                            <span className="pview-fv-comment" title={effectiveComments[anchorKey]}>{effectiveComments[anchorKey]}</span>
                          )}
                        </div>
                      </div>
                      {dispCols.map(col => (
                        <div key={col.id} className="pview-col-cell">
                          <div className="pview-fv-cell pview-fv-cell--desc">
                            <span className="pview-fv-key" title={col.csvFile || undefined}>{col.csvFile || '—'}</span>
                            {col.csvFile && fileComments[col.csvFile] && (
                              <span className="pview-fv-comment" title={fileComments[col.csvFile]}>{fileComments[col.csvFile]}</span>
                            )}
                          </div>
                        </div>
                      ))}
                      <div className="pview-col-spacer" />
                    </div>
                    {/* Row 2: (빈칸) | 칼럼명 */}
                    <div className="pview-col-row pview-fv-col-row">
                      <div className="pview-col-cell pview-col-cell--anchor">
                        <div className="pview-fv-cell pview-fv-cell--col" />
                      </div>
                      {dispCols.map(col => (
                        <div key={col.id} className="pview-col-cell">
                          <div className="pview-fv-cell pview-fv-cell--col" title={col.csvColumn || undefined}>
                            {col.csvColumn || <span style={{ opacity: 0.4 }}>—</span>}
                          </div>
                        </div>
                      ))}
                      <div className="pview-col-spacer" />
                    </div>
                    {/* Data rows */}
                    {t.rows.length === 0 ? (
                      <div className="pview-accordion-nodata">데이터 없음</div>
                    ) : t.rows.map((row, idx) => (
                      <div key={idx} className="pview-col-row pview-data-row">
                        {t.columns.map(col => (
                          <div key={col.id} className={`pview-col-cell${col.isAnchor ? ' pview-col-cell--anchor' : ''}`}>
                            <div className="pview-data-cell" title={row[col.id] || undefined}>{row[col.id] ?? ''}</div>
                          </div>
                        ))}
                        <div className="pview-col-spacer" />
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────
export function ProductViewer({ fileSources, activeProduct, products, onClose, fileComments = {}, standalone = false, initialTableId }: Props) {
  const [metas, setMetas] = useState<CustomTableMeta[]>([])
  const [table, setTable] = useState<CustomTable | null>(null)

  const [schema, setSchema] = useState<Record<string, Record<string, KeyinfoColumnSchema>>>({})
  const [keyComments, setKeyComments] = useState<Record<string, string>>({})
  const [allSchemas, setAllSchemas] = useState<Record<string, Record<string, Record<string, KeyinfoColumnSchema>>>>({})
  const [allKeyComments, setAllKeyComments] = useState<Record<string, Record<string, string>>>({})
  const [allSchemasLoading, setAllSchemasLoading] = useState(false)
  const [schemaRefreshing, setSchemaRefreshing] = useState(false)
  const [scopeMode, setScopeMode] = useState<ScopeMode>('product')
  const [scopeWarning, setScopeWarning] = useState(false)

  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set())
  const [anchorInput, setAnchorInput] = useState('')
  const [lookupRow, setLookupRow] = useState<Record<string, string>>({})
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // ── Folder state ─────────────────────────────────────────────────────────
  const [folders, setFolders] = useState<CustomTableFolder[]>([])
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [folderCtxMenu, setFolderCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renamingFolder, setRenamingFolder] = useState<{ id: string; text: string } | null>(null)

  const tableRef = useRef<CustomTable | null>(null)
  tableRef.current = table
  const csvCacheRef = useRef<Record<string, ParsedCsv>>({})
  const lookupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Schema loading ────────────────────────────────────────────────────────

  const buildComments = (d: KeyinfoData | null): Record<string, string> => {
    const comments: Record<string, string> = {}
    d?.pinnedColumns?.forEach(p => {
      if (p.comment && !comments[p.columnKey]) comments[p.columnKey] = p.comment
    })
    return comments
  }

  const loadProductSchema = useCallback(async () => {
    try {
      const d = await window.electronAPI.keyinfoLoad(activeProduct)
      setSchema(d?.schema ?? {})
      setKeyComments(buildComments(d))
    } catch {
      setSchema({}); setKeyComments({})
    }
  }, [activeProduct])

  const loadAllSchemas = useCallback(async () => {
    setAllSchemasLoading(true)
    try {
      const targets: Array<string | null> = [...products, null]
      const schemaEntries: Record<string, Record<string, Record<string, KeyinfoColumnSchema>>> = {}
      const commentEntries: Record<string, Record<string, string>> = {}
      await Promise.all(targets.map(async p => {
        try {
          const d = await window.electronAPI.keyinfoLoad(p)
          if (d?.schema) schemaEntries[p ?? '__null__'] = d.schema
          commentEntries[p ?? '__null__'] = buildComments(d)
        } catch {}
      }))
      setAllSchemas(schemaEntries)
      setAllKeyComments(commentEntries)
    } finally {
      setAllSchemasLoading(false)
    }
  }, [products])

  const refreshSchema = useCallback(async () => {
    setSchemaRefreshing(true)
    try {
      await loadProductSchema()
      if (scopeMode === 'all') await loadAllSchemas()
    } finally {
      setSchemaRefreshing(false)
    }
  }, [loadProductSchema, loadAllSchemas, scopeMode])

  useEffect(() => {
    window.electronAPI.customtableList(activeProduct).then(ms => {
      setMetas(ms)
      if (initialTableId && ms.some(m => m.id === initialTableId)) {
        loadTable(initialTableId)
      }
    })
    window.electronAPI.customtableListFolders(activeProduct).then(setFolders)
    setTable(null); setSelectedFolderId(null); setAnchorInput(''); setLookupRow({}); setDirty(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProduct])

  useEffect(() => { loadProductSchema() }, [loadProductSchema])

  const handleScopeChange = useCallback((mode: ScopeMode) => {
    if (mode === 'all' && !activeProduct) {
      setScopeWarning(true)
      return
    }
    setScopeMode(mode)
    setScopeWarning(false)
    if (mode === 'all' && Object.keys(allSchemas).length === 0) loadAllSchemas()
  }, [activeProduct, allSchemas, loadAllSchemas])

  useEffect(() => {
    if (scopeMode === 'all' && !activeProduct) setScopeMode('product')
  }, [activeProduct, scopeMode])

  useEffect(() => {
    const timer = setInterval(() => {
      const t = tableRef.current
      if (t) window.electronAPI.customtableAutosave(t).catch(() => {})
    }, 10 * 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  // ── Effective schema (scope-aware) ────────────────────────────────────────

  const effectiveSchema = useMemo((): Record<string, Record<string, KeyinfoColumnSchema>> => {
    if (scopeMode === 'product') return schema
    // 'all' mode: fileSources에 존재하는 CSV 파일만 포함 (Sheet에 로드된 제품 범위로 한정)
    const sheetFiles = new Set(Object.keys(fileSources))
    const merged: Record<string, Record<string, KeyinfoColumnSchema>> = {}
    Object.values(allSchemas).forEach(ps => {
      Object.entries(ps).forEach(([file, fileSchema]) => {
        if (!sheetFiles.has(file)) return
        if (!merged[file]) merged[file] = {}
        Object.entries(fileSchema).forEach(([col, cs]) => {
          if (!merged[file][col]) merged[file][col] = cs
        })
      })
    })
    return merged
  }, [scopeMode, schema, allSchemas, fileSources])

  const effectiveComments = useMemo((): Record<string, string> => {
    if (scopeMode === 'product') return keyComments
    const merged: Record<string, string> = {}
    Object.values(allKeyComments).forEach(productComments => {
      Object.entries(productComments).forEach(([key, comment]) => {
        if (!merged[key]) merged[key] = comment
      })
    })
    return merged
  }, [scopeMode, keyComments, allKeyComments])

  const availableKeys = useMemo(() => {
    const keys = new Set<string>()
    Object.values(effectiveSchema).forEach(fs => Object.keys(fs).forEach(k => keys.add(k)))
    return Array.from(keys).sort()
  }, [effectiveSchema])

  const csvsByKey = useCallback((key: string) => {
    if (!key) return []
    return Object.keys(effectiveSchema).filter(file => key in effectiveSchema[file])
  }, [effectiveSchema])

  const colsForCsv = useCallback((file: string) => Object.keys(effectiveSchema[file] ?? {}), [effectiveSchema])

  // ── CSV lookup ────────────────────────────────────────────────────────────

  const loadCsv = useCallback(async (fileName: string): Promise<ParsedCsv | null> => {
    if (csvCacheRef.current[fileName]) return csvCacheRef.current[fileName]
    const src = fileSources[fileName]
    if (!src) return null
    const filePath = src.type === 'local' ? src.path : src.type === 's3' ? (src.localPath ?? null) : null
    if (!filePath) return null
    setLoadingFiles(prev => new Set([...prev, fileName]))
    try {
      const disk = await window.electronAPI.cacheLoad(filePath)
      if (disk) { csvCacheRef.current[fileName] = disk; return disk }
      const content = await window.electronAPI.localReadFile(filePath)
      const parsed = parseCsvContent(fileName, content)
      await window.electronAPI.cacheSave(filePath, parsed)
      csvCacheRef.current[fileName] = parsed
      return parsed
    } catch { return null }
    finally { setLoadingFiles(prev => { const s = new Set(prev); s.delete(fileName); return s }) }
  }, [fileSources])

  const doLookup = useCallback(async (anchorValue: string): Promise<Record<string, string>> => {
    const t = tableRef.current
    if (!t || !anchorValue.trim()) return {}
    const anchorCol = t.columns.find(c => c.isAnchor)
    if (!anchorCol?.keyinfoKey) return {}
    const result: Record<string, string> = { [anchorCol.id]: anchorValue }
    for (const col of t.columns) {
      if (col.isAnchor) continue
      if (!col.csvFile || !col.csvColumn) { result[col.id] = ''; continue }
      const data = await loadCsv(col.csvFile)
      if (!data) { result[col.id] = '—'; continue }
      const found = data.rows.find(r => r[anchorCol.keyinfoKey] === anchorValue)
      result[col.id] = found?.[col.csvColumn] ?? '—'
    }
    return result
  }, [loadCsv])

  const handleAnchorChange = (value: string) => {
    setAnchorInput(value)
    if (lookupTimerRef.current) clearTimeout(lookupTimerRef.current)
    if (!value.trim()) { setLookupRow({}); return }
    lookupTimerRef.current = setTimeout(async () => {
      const result = await doLookup(value)
      setLookupRow(result)
    }, 250)
  }

  // ── Table operations ──────────────────────────────────────────────────────

  const addRow = useCallback(async () => {
    const t = tableRef.current
    if (!t || !anchorInput.trim()) return
    const result = await doLookup(anchorInput)
    if (!Object.keys(result).length) return
    const updated = { ...t, rows: [...t.rows, result] }
    setTable(updated)
    setMetas(prev => prev.map(m => m.id === updated.id ? { ...m, rowCount: updated.rows.length } : m))
    setDirty(true); setAnchorInput(''); setLookupRow({})
  }, [anchorInput, doLookup])

  const deleteRow = useCallback((idx: number) => {
    const t = tableRef.current
    if (!t) return
    const updated = { ...t, rows: t.rows.filter((_, i) => i !== idx) }
    setTable(updated)
    setMetas(prev => prev.map(m => m.id === updated.id ? { ...m, rowCount: updated.rows.length } : m))
    setDirty(true)
  }, [])

  const saveTableNow = useCallback(async () => {
    const toSave = tableRef.current
    if (!toSave) return
    setSaving(true)
    try {
      await window.electronAPI.customtableSave(toSave)
      setMetas(prev => prev.map(m => m.id === toSave.id
        ? { ...m, name: toSave.name, columnCount: toSave.columns.length, rowCount: toSave.rows.length }
        : m
      ))
      setDirty(false)
      toast.success('저장되었습니다')
    } finally { setSaving(false) }
  }, [])

  const handleClose = async () => {
    const t = tableRef.current
    if (t) await window.electronAPI.customtableAutosave(t).catch(() => {})
    onClose()
  }

  const handleRestore = async () => {
    if (!table) return
    const t = await window.electronAPI.customtableRestore(activeProduct, table.id)
    if (!t) { toast.error('저장된 버전이 없습니다'); return }
    setTable(t); setAnchorInput(''); setLookupRow({}); setDirty(false)
    toast.success('마지막 저장 시점으로 복원되었습니다')
  }

  const createTable = async () => {
    const blank = makeBlankTable(activeProduct)
    await window.electronAPI.customtableSave(blank)
    setMetas(prev => [...prev, { id: blank.id, name: blank.name, product: blank.product, columnCount: 1, rowCount: 0, folderId: null }])
    setTable(blank); setSelectedFolderId(null); setAnchorInput(''); setLookupRow({}); setDirty(false)
  }

  const createFolder = async () => {
    const folder: CustomTableFolder = { id: makeId('folder'), name: '새 폴더' }
    await window.electronAPI.customtableSaveFolder(activeProduct, folder)
    setFolders(prev => [...prev, folder])
    setExpandedFolders(prev => new Set([...prev, folder.id]))
    setRenamingFolder({ id: folder.id, text: folder.name })
  }

  const deleteFolder = async (id: string) => {
    await window.electronAPI.customtableDeleteFolder(activeProduct, id)
    setFolders(prev => prev.filter(f => f.id !== id))
    setMetas(prev => prev.map(m => m.folderId === id ? { ...m, folderId: null } : m))
    if (selectedFolderId === id) setSelectedFolderId(null)
    setFolderCtxMenu(null)
  }

  const renameFolder = async (id: string, name: string) => {
    const folder = { id, name }
    await window.electronAPI.customtableSaveFolder(activeProduct, folder)
    setFolders(prev => prev.map(f => f.id === id ? folder : f))
  }

  const assignTableToFolder = async (tableId: string, folderId: string | null) => {
    await window.electronAPI.customtableAssignFolder(activeProduct, tableId, folderId)
    setMetas(prev => prev.map(m => m.id === tableId ? { ...m, folderId } : m))
    if (tableRef.current?.id === tableId) setTable(prev => prev ? { ...prev, folderId } : prev)
    setCtxMenu(null)
  }

  const toggleFolderExpand = (id: string) => setExpandedFolders(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const selectFolder = (id: string) => {
    if (selectedFolderId === id) { setSelectedFolderId(null); return }
    setSelectedFolderId(id)
    setTable(null); setAnchorInput(''); setLookupRow({}); setDirty(false)
  }

  const deleteTable = async (id: string) => {
    await window.electronAPI.customtableDelete(activeProduct, id)
    setMetas(prev => prev.filter(m => m.id !== id))
    if (tableRef.current?.id === id) { setTable(null); setAnchorInput(''); setLookupRow({}); setDirty(false) }
    setCtxMenu(null)
  }

  const cloneTable = async (id: string) => {
    const t = await window.electronAPI.customtableLoad(activeProduct, id)
    if (!t) return
    const cloned: CustomTable = { ...t, id: makeId('ct'), name: `${t.name} (복사본)` }
    await window.electronAPI.customtableSave(cloned)
    setMetas(prev => [...prev, { id: cloned.id, name: cloned.name, product: cloned.product, columnCount: cloned.columns.length, rowCount: cloned.rows.length }])
    setCtxMenu(null)
    toast.success(`"${cloned.name}" 복제 완료`)
  }

  const loadTable = async (id: string) => {
    const [t, hasAutosave] = await Promise.all([
      window.electronAPI.customtableLoad(activeProduct, id),
      window.electronAPI.customtableHasAutosave(activeProduct, id),
    ])
    setTable(t ?? null); setAnchorInput(''); setLookupRow({}); setDirty(false)
    if (hasAutosave) {
      toast.warning('자동저장 버전으로 불러왔습니다. 복원 버튼으로 마지막 저장 시점으로 되돌릴 수 있습니다.')
    } else if (t && t.rows.length > 0) {
      toast.warning(`저장된 행 ${t.rows.length}개가 있습니다.`)
    }
  }

  const updateColumn = (colId: string, patch: Partial<CustomTableColumn>) => {
    setTable(prev => {
      if (!prev) return prev
      const updated = { ...prev, columns: prev.columns.map(c => c.id === colId ? { ...c, ...patch } : c) }
      tableRef.current = updated
      return updated
    })
    setDirty(true)
  }

  const addColumn = () => {
    const t = tableRef.current; if (!t) return
    const col: CustomTableColumn = { id: makeId('col'), keyinfoKey: anchorKey, csvFile: null, csvColumn: null, isAnchor: false, label: null }
    setTable(prev => prev ? { ...prev, columns: [...prev.columns, col] } : prev)
    setDirty(true)
  }

  const removeColumn = (colId: string) => {
    setTable(prev => prev ? { ...prev, columns: prev.columns.filter(c => c.id !== colId) } : prev)
    setDirty(true)
  }

  const exportCsv = () => {
    const t = tableRef.current; if (!t || !t.rows.length) return
    const cols = t.columns
    const headers = cols.map(c => c.label ?? c.csvColumn ?? c.keyinfoKey)
    const escape = (v: string) => v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v
    const lines = [headers.join(','), ...t.rows.map(row => cols.map(c => escape(row[c.id] ?? '')).join(','))]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${t.name}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const anchorCol = table?.columns.find(c => c.isAnchor)
  const displayCols = table?.columns.filter(c => !c.isAnchor) ?? []
  const anchorKey = anchorCol?.keyinfoKey ?? ''


  return (
    <div className={`pview-overlay${standalone ? ' pview-overlay--standalone' : ''}`} onClick={() => { setCtxMenu(null); setFolderCtxMenu(null) }}>
      {/* Sidebar */}
      <div className="pview-sidebar">
        <div className="pview-sidebar-header">
          <div className="pview-sidebar-header-top">
            {activeProduct
              ? <span className="pview-sidebar-product">{activeProduct}</span>
              : <span className="pview-sidebar-product pview-sidebar-product--none">없음</span>
            }
            <button
              className={`pview-refresh-btn${schemaRefreshing ? ' spinning' : ''}`}
              onClick={refreshSchema}
              disabled={schemaRefreshing || allSchemasLoading}
              title="Keyinfo 스키마 새로고침"
            >
              <RefreshCw size={12} />
            </button>
          </div>
          <div className="pview-sidebar-actions">
            <button className="pview-new-table-btn" onClick={createTable}>
              <Plus size={13} />새 테이블
            </button>
            <button className="pview-new-folder-btn" onClick={createFolder} title="새 폴더">
              <FolderPlus size={13} />
            </button>
          </div>
        </div>

        <div className="pview-sidebar-body">
          {/* ── Folders ── */}
          {folders.map(folder => {
            const folderMetas = metas.filter(m => m.folderId === folder.id)
            const isExpanded = expandedFolders.has(folder.id)
            const isActive = selectedFolderId === folder.id
            return (
              <div key={folder.id}>
                <div
                  className={`pview-folder-row${isActive ? ' active' : ''}`}
                  onClick={() => selectFolder(folder.id)}
                  onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setFolderCtxMenu({ id: folder.id, x: e.clientX, y: e.clientY }) }}
                >
                  <button className="pview-folder-toggle" onClick={e => { e.stopPropagation(); toggleFolderExpand(folder.id) }}>
                    {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  </button>
                  <Folder size={11} className="pview-folder-icon" />
                  {renamingFolder?.id === folder.id ? (
                    <input
                      className="pview-rename-input"
                      value={renamingFolder.text}
                      autoFocus
                      onClick={e => e.stopPropagation()}
                      onChange={e => setRenamingFolder({ id: folder.id, text: e.target.value })}
                      onBlur={() => {
                        const text = renamingFolder.text.trim()
                        if (text) renameFolder(folder.id, text)
                        setRenamingFolder(null)
                      }}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    />
                  ) : (
                    <span className="pview-folder-name">{folder.name}</span>
                  )}
                  <span className="pview-folder-count">{folderMetas.length}</span>
                </div>
                {isExpanded && folderMetas.map(m => (
                  <button
                    key={m.id}
                    className={`pview-table-item pview-table-item--nested${table?.id === m.id ? ' active' : ''}`}
                    onClick={() => { setSelectedFolderId(null); if (table?.id !== m.id) loadTable(m.id) }}
                    onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ id: m.id, x: e.clientX, y: e.clientY }) }}
                  >
                    {renaming?.id === m.id ? (
                      <input
                        className="pview-rename-input"
                        value={renaming.text}
                        autoFocus
                        onClick={e => e.stopPropagation()}
                        onChange={e => setRenaming({ id: m.id, text: e.target.value })}
                        onBlur={() => {
                          const text = renaming.text.trim()
                          if (!text) { setRenaming(null); return }
                          const t = tableRef.current
                          if (t && t.id === m.id) setTable({ ...t, name: text })
                          setMetas(prev => prev.map(x => x.id === m.id ? { ...x, name: text } : x))
                          setRenaming(null); setDirty(true)
                        }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      />
                    ) : (
                      <>
                        <span className="pview-table-name">{m.name}</span>
                        <span className="pview-table-meta">{m.rowCount}행</span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            )
          })}

          {/* ── Ungrouped tables ── */}
          {folders.length > 0 && metas.some(m => !m.folderId) && (
            <div className="pview-ungrouped-label">미분류</div>
          )}
          {metas.filter(m => !m.folderId).map(m => (
            <button
              key={m.id}
              className={`pview-table-item${table?.id === m.id ? ' active' : ''}`}
              onClick={() => { setSelectedFolderId(null); if (table?.id !== m.id) loadTable(m.id) }}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ id: m.id, x: e.clientX, y: e.clientY }) }}
            >
              {renaming?.id === m.id ? (
                <input
                  className="pview-rename-input"
                  value={renaming.text}
                  autoFocus
                  onClick={e => e.stopPropagation()}
                  onChange={e => setRenaming({ id: m.id, text: e.target.value })}
                  onBlur={() => {
                    const text = renaming.text.trim()
                    if (!text) { setRenaming(null); return }
                    const t = tableRef.current
                    if (t && t.id === m.id) setTable({ ...t, name: text })
                    setMetas(prev => prev.map(x => x.id === m.id ? { ...x, name: text } : x))
                    setRenaming(null); setDirty(true)
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                />
              ) : (
                <>
                  <span className="pview-table-name">{m.name}</span>
                  <span className="pview-table-meta">{m.rowCount}행</span>
                </>
              )}
            </button>
          ))}

          {metas.length === 0 && folders.length === 0 && (
            <div className="pview-sidebar-empty">테이블 없음</div>
          )}
        </div>
      </div>

      {/* Table context menu */}
      {ctxMenu && (
        <div className="pview-ctx-menu" style={{ top: ctxMenu.y, left: ctxMenu.x }} onClick={e => e.stopPropagation()}>
          <button onClick={() => { setRenaming({ id: ctxMenu.id, text: metas.find(m => m.id === ctxMenu.id)?.name ?? '' }); setCtxMenu(null) }}>이름 변경</button>
          {folders.length > 0 && (
            <>
              <div className="pview-ctx-divider" />
              <div className="pview-ctx-section-label">폴더로 이동</div>
              {folders.map(f => (
                <button key={f.id} onClick={() => assignTableToFolder(ctxMenu.id, f.id)}>{f.name}</button>
              ))}
              {metas.find(m => m.id === ctxMenu.id)?.folderId && (
                <button onClick={() => assignTableToFolder(ctxMenu.id, null)}>폴더 해제</button>
              )}
              <div className="pview-ctx-divider" />
            </>
          )}
          <button onClick={() => cloneTable(ctxMenu.id)}>복제</button>
          <button className="danger" onClick={() => deleteTable(ctxMenu.id)}>삭제</button>
        </div>
      )}

      {/* Folder context menu */}
      {folderCtxMenu && (
        <div className="pview-ctx-menu" style={{ top: folderCtxMenu.y, left: folderCtxMenu.x }} onClick={e => e.stopPropagation()}>
          <button onClick={() => { setRenamingFolder({ id: folderCtxMenu.id, text: folders.find(f => f.id === folderCtxMenu.id)?.name ?? '' }); setFolderCtxMenu(null) }}>이름 변경</button>
          <button className="danger" onClick={() => deleteFolder(folderCtxMenu.id)}>삭제</button>
        </div>
      )}

      {/* Main area */}
      <div className="pview-main">
        <div className="pview-main-topbar">
          <div className="pview-main-title">
            {selectedFolderId ? (
              <span className="pview-folder-view-title">
                <Folder size={13} />
                {folders.find(f => f.id === selectedFolderId)?.name}
              </span>
            ) : table ? (
              <input className="pview-table-name-input" value={table.name} onChange={e => { setTable(prev => prev ? { ...prev, name: e.target.value } : prev); setDirty(true) }} />
            ) : (
              <span>제품 뷰어</span>
            )}
          </div>
          <div className="pview-main-actions">
            {loadingFiles.size > 0 && <span className="pview-loading-indicator">CSV 로딩 중 ({loadingFiles.size})</span>}
            {table && !selectedFolderId && (
              <button
                className={`pview-btn pview-btn--save${dirty ? ' pview-btn--save-dirty' : ''}`}
                onClick={() => saveTableNow()}
                disabled={saving || !dirty}
              >
                {saving ? '저장 중...' : dirty ? '● 저장' : '저장됨'}
              </button>
            )}
            {table && !selectedFolderId && (
              <button
                className="pview-btn pview-btn--restore"
                onClick={handleRestore}
                title="마지막 수동 저장 시점으로 복원"
              >
                <RotateCcw size={12} />복원
              </button>
            )}
            {table && !selectedFolderId && (
              <button className="pview-btn pview-btn--export" onClick={exportCsv} disabled={!table.rows.length} title="CSV 내보내기">
                <Download size={12} />CSV 내보내기
              </button>
            )}
            {!standalone && (
              <button
                className="pview-btn pview-btn--fullview"
                onClick={() => window.electronAPI.customtableOpenViewer(activeProduct, table?.id)}
                title="별도 창에서 전체보기"
              >
                <Maximize2 size={12} />전체보기
              </button>
            )}
          </div>
          {!standalone && <button className="pview-close-btn" onClick={handleClose}><X size={15} /></button>}
        </div>

        {selectedFolderId ? (
          <div className="pview-table-area">
            <div className="pview-table-scroll">
              <FolderViewer
                folder={folders.find(f => f.id === selectedFolderId)!}
                folderMetas={metas.filter(m => m.folderId === selectedFolderId)}
                activeProduct={activeProduct}
                availableKeys={availableKeys}
                effectiveComments={effectiveComments}
                fileComments={fileComments}
                csvsByKey={csvsByKey}
              />
            </div>
          </div>
        ) : !table ? (
          <div className="pview-main-empty">
            <ChevronRight size={22} />
            <span>좌측에서 테이블을 선택하거나 새로 만드세요</span>
          </div>
        ) : (
          <div className="pview-table-area">
            <div className="pview-table-scroll">

              {/* ── Scope toggle — Keyinfo 키 드롭다운 바로 위 ── */}
              <div className="pview-config-scope-bar">
                <div className="pview-scope-toggle">
                  <button
                    className={`pview-scope-btn${scopeMode === 'product' ? ' active' : ''}`}
                    onClick={() => handleScopeChange('product')}
                  >
                    Keyinfo 참조
                  </button>
                  <button
                    className={`pview-scope-btn${scopeMode === 'all' ? ' active' : ''}`}
                    onClick={() => handleScopeChange('all')}
                  >
                    {allSchemasLoading ? '로딩...' : '전체 참조'}
                  </button>
                </div>
                {scopeWarning ? (
                  <span className="pview-scope-warning">
                    ⚠ Sheet가 불량입니다. 제품 값 등록해주세요.
                    <button className="pview-scope-warning-close" onClick={() => setScopeWarning(false)}>×</button>
                  </span>
                ) : (
                  <span className="pview-scope-desc">
                    {scopeMode === 'product'
                      ? `${activeProduct ?? '없음'} Keyinfo`
                      : `Sheet 내 CSV 교차 (${Object.keys(effectiveSchema).length}개 파일)`}
                  </span>
                )}
              </div>

              {/* ── Config row 1: anchor key selector + CSV file selectors ── */}
              <div className="pview-col-row pview-col-row--config1">
                <div className="pview-col-cell pview-col-cell--anchor">
                  <label className="pview-cell-label">Keyinfo 키 (앵커)</label>
                  <KeySelector
                    value={anchorCol?.keyinfoKey ?? ''}
                    options={availableKeys}
                    comments={effectiveComments}
                    onChange={key => {
                      setTable(prev => {
                        if (!prev) return prev
                        const updated = {
                          ...prev,
                          columns: prev.columns.map(c =>
                            c.isAnchor
                              ? { ...c, keyinfoKey: key }
                              : { ...c, keyinfoKey: key, csvFile: null, csvColumn: null }
                          ),
                        }
                        tableRef.current = updated
                        return updated
                      })
                      setDirty(true); setLookupRow({})
                    }}
                  />
                </div>

                {displayCols.map(col => (
                  <div key={col.id} className="pview-col-cell">
                    <div className="pview-col-cell-top">
                      <label className="pview-cell-label">CSV 파일</label>
                      <button className="pview-remove-col-btn" onClick={() => removeColumn(col.id)}>×</button>
                    </div>
                    <CsvFileSelector
                      value={col.csvFile ?? ''}
                      options={csvsByKey(anchorKey)}
                      usedFiles={new Set(displayCols.map(c => c.csvFile).filter(Boolean) as string[])}
                      comments={fileComments}
                      disabled={!anchorKey}
                      onChange={v => updateColumn(col.id, { csvFile: v || null, csvColumn: null })}
                    />
                  </div>
                ))}

                <button className="pview-add-col-btn" onClick={addColumn} disabled={!anchorKey} title="표시 칼럼 추가">
                  <Plus size={12} color="#f5f0e8" />
                </button>
              </div>

              {/* ── Config row 2: anchor key name + column selectors ── */}
              <div className="pview-col-row pview-col-row--config2">
                <div className="pview-col-cell pview-col-cell--anchor">
                  <span
                    className="pview-anchor-key-label"
                    title={anchorKey && effectiveComments[anchorKey] ? effectiveComments[anchorKey] : undefined}
                  >{anchorKey || '(키 미선택)'}</span>
                </div>
                {displayCols.map(col => (
                  <div key={col.id} className="pview-col-cell">
                    <select
                      className="pview-col-select"
                      value={col.csvColumn ?? ''}
                      onChange={e => updateColumn(col.id, { csvColumn: e.target.value || null })}
                      disabled={!col.csvFile}
                    >
                      <option value="">-- 표시 칼럼 --</option>
                      {col.csvFile ? (() => {
                        const allCols = colsForCsv(col.csvFile!)
                        const usedCols = new Set(
                          displayCols.filter(c => c.csvFile === col.csvFile && c.csvColumn).map(c => c.csvColumn as string)
                        )
                        const used = allCols.filter(c => usedCols.has(c))
                        const unused = allCols.filter(c => !usedCols.has(c))
                        return [...used, ...unused].map(c => (
                          <option key={c} value={c} style={usedCols.has(c) ? { color: '#fbbf24', fontWeight: 600 } : undefined}>
                            {c}
                          </option>
                        ))
                      })() : null}
                    </select>
                  </div>
                ))}
                <div className="pview-col-spacer" />
              </div>

              {/* ── Input row ── */}
              <div className="pview-col-row pview-col-row--input">
                <div className="pview-col-cell pview-col-cell--anchor">
                  <input
                    className="pview-anchor-input"
                    placeholder={anchorKey ? `${anchorKey} 값...` : '키를 먼저 선택하세요'}
                    value={anchorInput}
                    onChange={e => handleAnchorChange(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addRow() }}
                    disabled={!anchorKey}
                  />
                </div>
                {displayCols.map(col => (
                  <div key={col.id} className="pview-col-cell">
                    <div className={`pview-display-cell${loadingFiles.has(col.csvFile ?? '') ? ' pview-display-cell--loading' : ''}`}>
                      {loadingFiles.has(col.csvFile ?? '') ? '로딩...' : (lookupRow[col.id] ?? '—')}
                    </div>
                  </div>
                ))}
                <button className="pview-add-row-btn" onClick={addRow} disabled={!anchorInput.trim()}>추가</button>
              </div>

              {/* ── Accumulated data rows ── */}
              {table.rows.length > 0 ? (
                <div className="pview-data-rows">
                  {table.rows.map((row, idx) => (
                    <div key={idx} className="pview-col-row pview-data-row">
                      {table.columns.map(col => (
                        <div key={col.id} className={`pview-col-cell${col.isAnchor ? ' pview-col-cell--anchor' : ''}`}>
                          <div className="pview-data-cell" title={row[col.id] || undefined}>{row[col.id] ?? ''}</div>
                        </div>
                      ))}
                      <button className="pview-delete-row-btn" onClick={() => deleteRow(idx)}><Trash2 size={11} /></button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="pview-no-rows">아직 수집된 데이터가 없습니다</div>
              )}
            </div>

            <div className="pview-bottom-bar">
              <span>{table.rows.length}행 수집됨</span>
              {table.rows.length > 0 && (
                <button className="pview-clear-rows-btn" onClick={() => {
                  setTable(prev => prev ? { ...prev, rows: [] } : prev)
                  setMetas(prev => prev.map(m => m.id === table.id ? { ...m, rowCount: 0 } : m))
                  setDirty(true)
                }}>행 초기화</button>
              )}
              {availableKeys.length === 0 && !schemaRefreshing && !allSchemasLoading && (
                <span className="pview-schema-warn">⚠ Keyinfo 색인 없음</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
