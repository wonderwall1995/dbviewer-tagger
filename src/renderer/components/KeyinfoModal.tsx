import { useState, useRef, useCallback, useEffect } from 'react'
import { RefreshCw, BookOpen, Tag, ChevronDown, ChevronUp, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from './Modal'
import { LorebookCreateManyModal } from './LorebookCreateManyModal'
import { KeyNotesPane } from './KeyNotesPane'
import type { ParsedCsv, PinnedColumn, KeyinfoColumnSchema, DbConstraints, KeyinfoData, KeyinfoFolder } from '../../shared/types'
import { uiId } from '../ui/uiId'
import { api, caps } from '../api'

interface Props {
  parsedMap: Record<string, ParsedCsv>
  pinnedColumns: PinnedColumn[]
  keyinfoSchema: Record<string, Record<string, KeyinfoColumnSchema>>
  activeProduct: string
  products: string[]
  fileSources: Record<string, { type: string; path?: string; localPath?: string }>
  folders: KeyinfoFolder[]
  activeFile: string | null
  initialTab?: 'pins' | 'notes'
  onClose: () => void
  onOpenCsv: (fileName: string) => void
  onSchemaUpdated: (schema: KeyinfoData['schema']) => void
  onLayoutChange: (pins: PinnedColumn[], folders: KeyinfoFolder[]) => void
}

// ── 제품별 요약 패널 ──────────────────────────────────────────────────────────
type ProductSnapshot = {
  product: string
  pins: PinnedColumn[]
  schema: Record<string, Record<string, KeyinfoColumnSchema>>
  loading: boolean
  error: boolean
}

function ProductSummaryPanel({ products, activeProduct, selectedProduct }: { products: string[]; activeProduct: string; selectedProduct: string }) {
  const [open, setOpen] = useState(false)
  const [snapshots, setSnapshots] = useState<ProductSnapshot[]>([])
  const loadedRef = useRef(false)

  const load = async () => {
    if (loadedRef.current) return
    loadedRef.current = true
    setSnapshots(products.map(p => ({ product: p, pins: [], schema: {}, loading: true, error: false })))
    const results = await Promise.all(
      products.map(async (product): Promise<ProductSnapshot> => {
        try {
          const data = await api.keyinfoLoad(product)
          return { product, pins: data.pinnedColumns ?? [], schema: data.schema ?? {}, loading: false, error: false }
        } catch {
          return { product, pins: [], schema: {}, loading: false, error: true }
        }
      })
    )
    setSnapshots(results)
  }

  const handleToggle = () => {
    if (!open) load()
    setOpen(v => !v)
  }

  const csvCount = (snap: ProductSnapshot) => Object.keys(snap.schema).length

  return (
    <div className="keyinfo-product-panel" {...uiId('KI.summary')}>
      <button className="keyinfo-product-toggle" onClick={handleToggle}>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        제품별 조회
        {products.length > 0 && <span className="keyinfo-product-toggle-count">{products.length}</span>}
      </button>

      {open && (
        <div className="keyinfo-product-scroll">
          {products.length === 0 && (
            <div className="keyinfo-product-empty">등록된 제품이 없습니다 — Footer의 P 버튼에서 추가하세요</div>
          )}
          {snapshots.map(snap => (
            <div key={snap.product} className={`keyinfo-product-card${snap.product === selectedProduct ? ' keyinfo-product-card--active' : ''}`} {...uiId('KI.summary-card')}>
              <div className="keyinfo-product-card-header">
                <span className="keyinfo-product-name">{snap.product}</span>
                {snap.product === activeProduct && <span className="keyinfo-product-current-tag">활성</span>}
                {snap.product === selectedProduct && snap.product !== activeProduct && <span className="keyinfo-product-current-tag" style={{background:'rgba(16,185,129,0.15)',color:'#10b981'}}>선택</span>}
                {!snap.loading && !snap.error && (
                  <>
                    <span className="keyinfo-product-stat">핀 {snap.pins.length}</span>
                    <span className="keyinfo-product-stat">CSV {csvCount(snap)}</span>
                  </>
                )}
              </div>
              {snap.loading && <div className="keyinfo-product-loading">로딩 중…</div>}
              {snap.error && <div className="keyinfo-product-loading error">불러오기 실패</div>}
              {!snap.loading && !snap.error && snap.pins.length === 0 && (
                <div className="keyinfo-product-loading">색인된 핀 없음</div>
              )}
              {!snap.loading && !snap.error && snap.pins.length > 0 && (
                <ul className="keyinfo-product-pins">
                  {snap.pins.map(pin => (
                    <li key={pin.pinId} className="keyinfo-product-pin">
                      <span className="keyinfo-product-pin-num">#{pin.pinId}</span>
                      <div className="keyinfo-product-pin-info">
                        <span className="keyinfo-product-pin-col">{pin.columnKey}</span>
                        <span className="keyinfo-product-pin-file">{pin.fileName.replace(/\.csv$/i, '')}</span>
                        {pin.comment && <span className="keyinfo-product-pin-comment">{pin.comment}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

type DropTarget =
  | { kind: 'pin'; pinId: number; position: 'before' | 'after' }
  | { kind: 'folder'; folderId: string }
  | { kind: 'ungrouped' }

type PinCtx = { pinIds: number[]; x: number; y: number } | null

function constraintBadges(entry: KeyinfoColumnSchema) {
  return (
    <>
      {entry.isPK && <span className="col-cb col-cb--pk">PK</span>}
      {entry.isFK && <span className="col-cb col-cb--fk">FK</span>}
      {entry.isUnique && <span className="col-cb col-cb--uq">UQ</span>}
      {entry.isNotNull && <span className="col-cb col-cb--nn">NN</span>}
      {entry.backrefs?.length && <span className="col-cb col-cb--ref">REF</span>}
    </>
  )
}

// ── 핀 컨텍스트 메뉴 ─────────────────────────────────────────────────────────
function PinContextMenu({
  ctx,
  onDelete,
  onComment,
  onClose,
}: {
  ctx: NonNullable<PinCtx>
  onDelete: () => void
  onComment: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCloseRef.current()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current() }
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const left = Math.min(ctx.x, window.innerWidth - 160)
  const top = Math.min(ctx.y, window.innerHeight - 100)
  const isSingle = ctx.pinIds.length === 1

  return (
    <div ref={ref} className="col-ctx-menu" style={{ left, top }}>
      {isSingle && (
        <button className="col-ctx-item" onClick={() => { onComment(); onClose() }}>
          주석
        </button>
      )}
      <button className="col-ctx-item col-ctx-danger" onClick={() => { onDelete(); onClose() }}>
        {ctx.pinIds.length > 1 ? `삭제 (${ctx.pinIds.length}개)` : '삭제'}
      </button>
    </div>
  )
}

export function KeyinfoModal({
  parsedMap, pinnedColumns, keyinfoSchema, activeProduct, products,
  fileSources, folders, activeFile, initialTab = 'pins', onClose, onOpenCsv, onSchemaUpdated, onLayoutChange,
}: Props) {
  // 우측 패널 선택
  const [selectedKey, setSelectedKey] = useState<{ fileName: string; columnKey: string } | null>(null)

  // DnD
  const [dragPinIds, setDragPinIds] = useState<number[]>([])
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  // 다중 선택
  const [selectedPinIds, setSelectedPinIds] = useState<Set<number>>(new Set())
  const lastClickedPinIdRef = useRef<number | null>(null)

  // 폴더
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set())
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameFolderName, setRenameFolderName] = useState('')

  // 컨텍스트 메뉴 & 삭제 확인
  const [pinCtx, setPinCtx] = useState<PinCtx>(null)
  const [confirmDelete, setConfirmDelete] = useState<number[] | null>(null)

  // 주석 편집
  const [commentEditPinId, setCommentEditPinId] = useState<number | null>(null)
  const [commentText, setCommentText] = useState('')

  // Lorebook
  const [lorebookOpen, setLorebookOpen] = useState(false)
  const [tagLoading, setTagLoading] = useState(false)

  // 탭: 핀 보기 / Key 노트
  const [tab, setTab] = useState<'pins' | 'notes'>(initialTab)
  const [sending, setSending] = useState(false)   // 맥락 문서를 볼트로 보내는 중
  const [noteProgress, setNoteProgress] = useState({ confirmed: 0, total: 0 })
  const handleNoteProgress = useCallback((confirmed: number, total: number) => setNoteProgress({ confirmed, total }), [])

  // ── 제품 선택 (모달 내부) ─────────────────────────────────────────────────
  const [localProduct, setLocalProduct] = useState(activeProduct)
  const [productData, setProductData] = useState<{
    pins: PinnedColumn[]
    schema: Record<string, Record<string, KeyinfoColumnSchema>>
    folders: KeyinfoFolder[]
  } | null>(null)
  const [productLoading, setProductLoading] = useState(false)

  // product = null (제품 미지정) 핀 목록
  const [nullProductData, setNullProductData] = useState<{
    pins: PinnedColumn[]
    schema: Record<string, Record<string, KeyinfoColumnSchema>>
    folders: KeyinfoFolder[]
  } | null>(null)

  useEffect(() => {
    api.keyinfoLoad(null).then(data => {
      if ((data.pinnedColumns?.length ?? 0) > 0) {
        setNullProductData({
          pins: data.pinnedColumns ?? [],
          schema: data.schema ?? {},
          folders: data.folders ?? [],
        })
      }
    }).catch(() => {})
  }, [])

  // '__null__' 는 제품 미지정 뷰의 내부 sentinel
  const isOwnProduct = !localProduct || localProduct === activeProduct
  const effectivePins    = isOwnProduct ? pinnedColumns   : (productData?.pins ?? [])
  const effectiveSchema  = isOwnProduct ? keyinfoSchema   : (productData?.schema ?? {})
  const effectiveFolders = isOwnProduct ? folders         : (productData?.folders ?? [])

  // 미색인 핀 — 핀은 있으나 schema 엔트리가 없는 것
  const unindexedPins = effectivePins.filter(
    pin => !effectiveSchema[pin.fileName]?.[pin.columnKey]
  )

  const handleSelectProduct = async (product: string) => {
    if (product === localProduct) return
    setLocalProduct(product)
    setSelectedKey(null)
    setSelectedPinIds(new Set())
    setExpandedFolderIds(new Set())
    if (product === activeProduct) { setProductData(null); return }
    if (product === '__null__') { setProductData(nullProductData); return }
    setProductLoading(true)
    try {
      const data = await api.keyinfoLoad(product)
      setProductData({ pins: data.pinnedColumns ?? [], schema: data.schema ?? {}, folders: data.folders ?? [] })
    } catch {}
    setProductLoading(false)
  }

  // stable key → pin
  const sel = selectedKey
    ? effectivePins.find(p => p.fileName === selectedKey.fileName && p.columnKey === selectedKey.columnKey) ?? null
    : null

  const selCol = sel
    ? parsedMap[sel.fileName]?.columns.find(c => c.key === sel.columnKey) ?? null
    : null

  const schemaEntry = sel ? (effectiveSchema[sel.fileName]?.[sel.columnKey] ?? null) : null
  const displayDbType = selCol?.dbType ?? schemaEntry?.dbType
  const displayConstraints: DbConstraints | undefined = selCol?.dbConstraints ?? (
    schemaEntry && (schemaEntry.isPK || schemaEntry.isFK || schemaEntry.isUnique || schemaEntry.isNotNull || schemaEntry.backrefs?.length)
      ? { isPK: schemaEntry.isPK, isFK: schemaEntry.isFK, fkRef: schemaEntry.fkRef, isUnique: schemaEntry.isUnique, isNotNull: schemaEntry.isNotNull, backrefs: schemaEntry.backrefs }
      : undefined
  )

  const crossFiles = (sel && localProduct)
    ? Object.entries(effectiveSchema)
        .filter(([, fileSchema]) => sel.columnKey in fileSchema)
        .map(([fileName, fileSchema]) => ({ fileName, entry: fileSchema[sel.columnKey] }))
        .sort((a, b) => {
          if (a.fileName === sel.fileName) return -1
          if (b.fileName === sel.fileName) return 1
          if (a.entry.isPK && !b.entry.isPK) return -1
          if (!a.entry.isPK && b.entry.isPK) return 1
          return a.fileName.localeCompare(b.fileName)
        })
    : []

  // ── 핀 클릭 — CSV 자동 열기 없음 ────────────────────────────────────────
  const handlePinClick = useCallback((pin: PinnedColumn, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      setSelectedPinIds(prev => {
        const next = new Set(prev)
        next.has(pin.pinId) ? next.delete(pin.pinId) : next.add(pin.pinId)
        return next
      })
      lastClickedPinIdRef.current = pin.pinId
    } else if (e.shiftKey && lastClickedPinIdRef.current !== null) {
      const allIds = effectivePins.map(p => p.pinId)
      const lastIdx = allIds.indexOf(lastClickedPinIdRef.current)
      const thisIdx = allIds.indexOf(pin.pinId)
      const [from, to] = lastIdx <= thisIdx ? [lastIdx, thisIdx] : [thisIdx, lastIdx]
      setSelectedPinIds(new Set(allIds.slice(from, to + 1)))
    } else {
      setSelectedPinIds(new Set([pin.pinId]))
      setSelectedKey({ fileName: pin.fileName, columnKey: pin.columnKey })
      lastClickedPinIdRef.current = pin.pinId
    }
  }, [effectivePins])

  // ── 핀 우클릭 ────────────────────────────────────────────────────────────
  const handlePinCtx = (e: React.MouseEvent, pin: PinnedColumn) => {
    e.preventDefault()
    e.stopPropagation()
    const targetIds = (selectedPinIds.has(pin.pinId) && selectedPinIds.size > 1)
      ? Array.from(selectedPinIds)
      : [pin.pinId]
    setPinCtx({ pinIds: targetIds, x: e.clientX, y: e.clientY })
  }

  // ── 핀 삭제 ──────────────────────────────────────────────────────────────
  // 핀이 Key 노트가 존재하는 조건이다. 남은 핀이 하나도 없는 노트는 핀을 거둘 때 함께 지운다.
  const pruneNotes = (product: string | null, remainingPins: PinnedColumn[]) => {
    api.keynotePruneByPins(product, remainingPins)
      .then(removed => {
        if (removed.length > 0) toast.info(`핀이 없어진 Key 노트 ${removed.length}개를 함께 지웠어요: ${removed.join(', ')}`, { duration: 6000 })
      })
      .catch(() => {})
  }

  const handleDeletePins = (pinIds: number[]) => {
    if (sel) {
      const selPin = effectivePins.find(p => p.fileName === sel.fileName && p.columnKey === sel.columnKey)
      if (selPin && pinIds.includes(selPin.pinId)) setSelectedKey(null)
    }
    setSelectedPinIds(new Set())
    setConfirmDelete(null)

    if (localProduct === '__null__') {
      // null product — props 경로가 없으므로 IPC 직접 호출
      const remaining = (nullProductData?.pins ?? [])
        .filter(p => !pinIds.includes(p.pinId))
        .map((p, i) => ({ ...p, pinId: i + 1 }))
      const remainingFolders = nullProductData?.folders ?? []
      api.keyinfoSaveLayout(null, remaining, remainingFolders)
      pruneNotes(null, remaining)
      if (remaining.length === 0) {
        setNullProductData(null)
        setProductData(null)
        setLocalProduct(activeProduct)
      } else {
        const updated = { pins: remaining, schema: nullProductData?.schema ?? {}, folders: remainingFolders }
        setNullProductData(updated)
        setProductData(updated)
      }
      return
    }

    const remaining = pinnedColumns
      .filter(p => !pinIds.includes(p.pinId))
      .map((p, i) => ({ ...p, pinId: i + 1 }))
    onLayoutChange(remaining, folders)
    pruneNotes(activeProduct || null, remaining)
  }

  // ── 주석 ─────────────────────────────────────────────────────────────────
  const openCommentEdit = (pinId: number) => {
    const pin = pinnedColumns.find(p => p.pinId === pinId)
    if (!pin) return
    setCommentEditPinId(pinId)
    setCommentText(pin.comment ?? '')
  }

  const handleSaveComment = () => {
    if (commentEditPinId === null) return
    const updated = pinnedColumns.map(p =>
      p.pinId === commentEditPinId ? { ...p, comment: commentText } : p
    )
    onLayoutChange(updated, folders)
    setCommentEditPinId(null)
  }

  // ── DnD (isOwnProduct 일 때만 실제 적용) ──────────────────────────────────
  const handleDragStart = (e: React.DragEvent, pin: PinnedColumn) => {
    if (!isOwnProduct) return
    const ids = (selectedPinIds.has(pin.pinId) && selectedPinIds.size > 1)
      ? Array.from(selectedPinIds)
      : [pin.pinId]
    setDragPinIds(ids)
    e.dataTransfer.effectAllowed = 'move'
    if (!selectedPinIds.has(pin.pinId)) setSelectedPinIds(new Set([pin.pinId]))
  }

  const handlePinDragOver = (e: React.DragEvent, pin: PinnedColumn) => {
    if (!isOwnProduct) return
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDropTarget({ kind: 'pin', pinId: pin.pinId, position })
  }

  const handleFolderDragOver = (e: React.DragEvent, folderId: string) => {
    if (!isOwnProduct) return
    e.preventDefault()
    e.stopPropagation()
    setDropTarget({ kind: 'folder', folderId })
  }

  const handleUngroupedDragOver = (e: React.DragEvent) => {
    if (!isOwnProduct) return
    e.preventDefault()
    e.stopPropagation()
    setDropTarget({ kind: 'ungrouped' })
  }

  const commitDrop = () => {
    if (!isOwnProduct || !dropTarget || dragPinIds.length === 0) {
      setDropTarget(null); setDragPinIds([]); return
    }
    const dragging = pinnedColumns.filter(p => dragPinIds.includes(p.pinId))
    const rest = pinnedColumns.filter(p => !dragPinIds.includes(p.pinId))
    let newPins: PinnedColumn[]

    if (dropTarget.kind === 'folder') {
      const folderLastIdx = rest.reduce((max, p, i) => (p.folderId === dropTarget.folderId ? i : max), -1)
      const result = [...rest]
      result.splice(folderLastIdx + 1, 0, ...dragging.map(p => ({ ...p, folderId: dropTarget.folderId })))
      newPins = result
    } else if (dropTarget.kind === 'pin') {
      const targetIdx = rest.findIndex(p => p.pinId === dropTarget.pinId)
      if (targetIdx < 0) {
        newPins = rest
      } else {
        const targetPin = rest[targetIdx]
        const insertIdx = dropTarget.position === 'before' ? targetIdx : targetIdx + 1
        const result = [...rest]
        result.splice(insertIdx, 0, ...dragging.map(p => ({ ...p, folderId: targetPin.folderId })))
        newPins = result
      }
    } else {
      newPins = [...rest, ...dragging.map(p => ({ ...p, folderId: undefined }))]
    }

    onLayoutChange(newPins.map((p, i) => ({ ...p, pinId: i + 1 })), folders)
    setDragPinIds([])
    setDropTarget(null)
  }

  const handleDragEnd = () => { setDragPinIds([]); setDropTarget(null) }

  // ── 폴더 관리 (isOwnProduct 일 때만) ─────────────────────────────────────
  const handleCreateFolder = () => {
    if (!isOwnProduct) return
    const name = newFolderName.trim()
    if (!name) return
    const newFolder: KeyinfoFolder = { id: `folder_${Date.now()}`, name }
    onLayoutChange(pinnedColumns, [...folders, newFolder])
    setExpandedFolderIds(prev => new Set([...prev, newFolder.id]))
    setCreatingFolder(false)
    setNewFolderName('')
  }

  const handleDeleteFolder = (folderId: string) => {
    if (!isOwnProduct) return
    const updatedPins = pinnedColumns.map(p => p.folderId === folderId ? { ...p, folderId: undefined } : p)
    onLayoutChange(updatedPins, folders.filter(f => f.id !== folderId))
  }

  const startRename = (folder: KeyinfoFolder) => {
    setRenamingFolderId(folder.id)
    setRenameFolderName(folder.name)
  }

  const commitRename = (folderId: string) => {
    if (!isOwnProduct) { setRenamingFolderId(null); return }
    const name = renameFolderName.trim()
    if (name) onLayoutChange(pinnedColumns, folders.map(f => f.id === folderId ? { ...f, name } : f))
    setRenamingFolderId(null)
  }

  const toggleFolder = (folderId: string) => {
    setExpandedFolderIds(prev => {
      const next = new Set(prev)
      next.has(folderId) ? next.delete(folderId) : next.add(folderId)
      return next
    })
  }

  // ── keyinfo 액션 ──────────────────────────────────────────────────────────
  const handleLoad = async () => {
    if (!activeProduct) return   // 제품이 없으면 색인하지 않는다.
    try { const updated = await api.keyinfoReindex(activeProduct || null, fileSources); onSchemaUpdated(updated.schema) } catch {}
  }

  const handleTag = async () => {
    if (!sel || crossFiles.length === 0) return
    setTagLoading(true)
    try {
      const scopedSources: Record<string, { type: string; path?: string; localPath?: string }> = {}
      for (const { fileName } of crossFiles) {
        if (fileSources[fileName]) scopedSources[fileName] = fileSources[fileName]
      }
      const updated = await api.keyinfoIndex(activeProduct || null, scopedSources)
      onSchemaUpdated(updated.schema)
    } catch {}
    setTagLoading(false)
  }

  // ── 핀 아이템 렌더 ────────────────────────────────────────────────────────
  const renderPinItem = (pin: PinnedColumn) => {
    const isMultiSel = selectedPinIds.has(pin.pinId)
    const isDetail = pin.fileName === selectedKey?.fileName && pin.columnKey === selectedKey?.columnKey
    const isDragging = dragPinIds.includes(pin.pinId)
    const isDropBefore = dropTarget?.kind === 'pin' && dropTarget.pinId === pin.pinId && dropTarget.position === 'before'
    const isDropAfter  = dropTarget?.kind === 'pin' && dropTarget.pinId === pin.pinId && dropTarget.position === 'after'
    const isUnindexed = !effectiveSchema[pin.fileName]?.[pin.columnKey]

    return (
      <li
        key={pin.pinId}
        className={[
          'keyinfo-item',
          isDetail      ? 'keyinfo-item--active'      : '',
          isMultiSel    ? 'keyinfo-item--selected'    : '',
          isDragging    ? 'keyinfo-item--dragging'    : '',
          isDropBefore  ? 'keyinfo-item--drop-before' : '',
          isDropAfter   ? 'keyinfo-item--drop-after'  : '',
          isUnindexed   ? 'keyinfo-item--unindexed'   : '',
        ].filter(Boolean).join(' ')}
        draggable
        onDragStart={e => handleDragStart(e, pin)}
        onDragOver={e => handlePinDragOver(e, pin)}
        onDrop={e => { e.stopPropagation(); commitDrop() }}
        onDragEnd={handleDragEnd}
        onClick={e => handlePinClick(pin, e)}
        onContextMenu={e => handlePinCtx(e, pin)}
      >
        <span className="keyinfo-pin-num">#{pin.pinId}</span>
        <div className="keyinfo-item-info" {...uiId('KI.pin', pin.columnKey)}>
          <div className="keyinfo-item-col">{pin.columnKey}</div>
          <div className="keyinfo-item-file">{pin.fileName.replace(/\.csv$/i, '')}</div>
        </div>
        {isUnindexed && <span className="keyinfo-item-warn" title="schema 미색인">⚠</span>}
      </li>
    )
  }

  const ungroupedPins = effectivePins.filter(p => !p.folderId)
  const isEmpty = effectivePins.length === 0 && effectiveFolders.length === 0

  return (
    <>
      <Modal
        title="Keyinfo"
        uiCode="KI" onClose={onClose} cardClassName="keyinfo-modal-card" floating>

        {/* ── 제품 선택 바 + 연관 편집 토글 (항상 표시) ── */}
        <div className="keyinfo-product-bar" {...uiId('KI.product-bar')}>
          {productLoading && <span className="keyinfo-product-bar-loading">…</span>}
          {products.map(p => (
            <button
              key={p}
              className={[
                'keyinfo-product-bar-btn',
                localProduct === p ? 'keyinfo-product-bar-btn--active' : '',
                p === activeProduct ? 'keyinfo-product-bar-btn--global' : '',
              ].filter(Boolean).join(' ')} {...uiId('KI.product-chip', p)}
              onClick={() => handleSelectProduct(p)}
            >
              {p}
              {p === activeProduct && <span className="keyinfo-product-bar-dot" title="현재 활성 제품" />}
            </button>
          ))}
          {nullProductData && (
            <button
              className={[
                'keyinfo-product-bar-btn',
                'keyinfo-product-bar-btn--issue',
                localProduct === '__null__' ? 'keyinfo-product-bar-btn--active' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => handleSelectProduct('__null__')}
              title="제품 미지정 핀 목록 — Key 노트를 작성하려면 제품을 지정하세요"
            >
              ⚠ 없음
              <span className="keyinfo-issue-count" {...uiId('KI.issue-count')}>{nullProductData.pins.length}</span>
            </button>
          )}
          <div className="keyinfo-tabs" {...uiId('KI.tabs')}>
            <button className={`keyinfo-tab${tab === 'pins' ? ' keyinfo-tab--on' : ''}`} onClick={() => setTab('pins')}>핀 보기</button>
            <button className={`keyinfo-tab${tab === 'notes' ? ' keyinfo-tab--on' : ''}`} onClick={() => setTab('notes')}>
              Key 노트
              {noteProgress.total > 0 && <span className="keyinfo-tab-count">{noteProgress.confirmed}/{noteProgress.total}</span>}
            </button>
          </div>
          {/* 제품 맥락 문서 전송: 지금 고른 제품의 확인된 Key 노트로 맥락 문서(CED)를 만들어 Hermes 서버의 Obsidian 볼트로 보낸다.
              볼트 경로와 SSH는 Hermes 설정에서 정한다. 볼트에서 사람이 고친 파일은 덮어쓰지 않는다. */}
          {caps.hermes && <button
            className={`keyinfo-export-btn${sending ? ' keyinfo-export-btn--busy' : ''}`} {...uiId('KI.export')}
            disabled={sending}
            onClick={async () => {
              if (!localProduct || localProduct === '__null__') {
                toast.warning('제품을 고른 뒤 전송할 수 있어요.')
                return
              }
              setSending(true)
              try {
                const r = await api.cedSend(localProduct)
                if (!r.ok) {
                  toast.error(`볼트로 보내지 못했어요: ${r.message}`, { duration: 8000 })
                  return
                }
                if (r.noNotes) {
                  toast.warning(`확인된 Key 노트가 없어요. 노트를 확인 상태로 바꾼 뒤 다시 눌러 주세요.${r.skippedDrafts > 0 ? ` (초안 ${r.skippedDrafts}개)` : ''}`)
                  return
                }
                const sent = r.written.length + r.updated.length
                toast.success(`볼트로 보냈어요: 새 문서 ${r.written.length}개, 갱신 ${r.updated.length}개, 변경 없음 ${r.unchanged.length}개${sent === 0 ? ' (보낼 변경이 없어요)' : ''}`, { duration: 6000 })
                if (r.conflicts.length > 0) {
                  toast.warning(`볼트에서 고친 문서는 덮어쓰지 않았어요: ${r.conflicts.join(', ')}`, { duration: 9000 })
                }
                if (r.leftover.length > 0) {
                  toast.info(`앱에서 빠졌지만 볼트에 남겨 둔 문서: ${r.leftover.join(', ')}`, { duration: 9000 })
                }
              } catch {
                toast.error('볼트로 보내지 못했어요.')
              } finally {
                setSending(false)
              }
            }}
            title="지금 고른 제품의 맥락 문서를 만들어 Hermes 서버의 Obsidian 볼트(CED 폴더)로 보냅니다"
          >
            <Upload size={12} />
            {sending ? '전송 중…' : '제품 맥락 문서 전송'}
          </button>}
        </div>

        {tab === 'notes' && (!localProduct || localProduct === '__null__') && (
          <div className="kn-pane" {...uiId('KI.notes')}>
            <div className="kn-empty kn-empty--center">제품이 지정되지 않은 프리셋에는 Key 노트를 만들 수 없어요. 프리셋을 제품과 함께 저장한 뒤 이용해 주세요.</div>
          </div>
        )}
        {tab === 'notes' && !!localProduct && localProduct !== '__null__' && (
          <KeyNotesPane
            product={localProduct === '__null__' ? null : localProduct}
            schema={effectiveSchema}
            fileSources={isOwnProduct && localProduct !== '__null__' ? fileSources : null}
            onSchemaUpdated={onSchemaUpdated}
            onProgress={handleNoteProgress}
          />
        )}
        <div className="keyinfo-modal-inner" style={tab === 'notes' ? { display: 'none' } : undefined}>
        <div className="keyinfo-modal-main">
        <div className="keyinfo-body">
          {/* ── 좌측: 폴더 + 핀 리스트 ── */}
          <div className="keyinfo-left" {...uiId('KI.left')}>
            <div className="keyinfo-left-header" {...uiId('KI.left-head')}>
              {creatingFolder ? (
                <div className="keyinfo-folder-create">
                  <input
                    className="keyinfo-folder-input"
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreateFolder()
                      if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName('') }
                    }}
                    placeholder="폴더 이름"
                    autoFocus
                  />
                  <button className="keyinfo-folder-confirm" onClick={handleCreateFolder} title="확인">✓</button>
                  <button className="keyinfo-folder-cancel" onClick={() => { setCreatingFolder(false); setNewFolderName('') }} title="취소">✕</button>
                </div>
              ) : isOwnProduct ? (
                <button className="keyinfo-new-folder-btn" {...uiId('KI.folder-new')} onClick={() => setCreatingFolder(true)}>
                  + 폴더
                </button>
              ) : localProduct === '__null__' ? (
                <span className="keyinfo-null-badge">⚠ 제품 미지정</span>
              ) : (
                <span className="keyinfo-readonly-badge" {...uiId('KI.readonly')}>읽기 전용</span>
              )}

              {unindexedPins.length > 0 && (
                <div className="keyinfo-issue-notice">
                  <span>⚠</span>
                  <span>미색인 {unindexedPins.length}개 — Load로 색인하세요</span>
                </div>
              )}
            </div>

            {isEmpty ? (
              <div className="keyinfo-empty">
                {isOwnProduct
                  ? <>핀 고정된 칼럼 없음<br />칼럼 헤더를 클릭 후<br />K 버튼으로 고정하세요</>
                  : <>이 제품에 색인된 핀 없음</>}
              </div>
            ) : (
              <ul
                className="keyinfo-list" {...uiId('KI.list')}
                onDragOver={e => e.preventDefault()}
                onDrop={commitDrop}
                onDragEnd={handleDragEnd}
              >
                {effectiveFolders.map(folder => {
                  const folderPins = effectivePins.filter(p => p.folderId === folder.id)
                  const isExpanded = expandedFolderIds.has(folder.id)
                  const isFolderDrop = dropTarget?.kind === 'folder' && dropTarget.folderId === folder.id
                  const isRenaming = renamingFolderId === folder.id

                  return (
                    <li key={folder.id} className="keyinfo-folder-item" {...uiId('KI.folder', folder.name)}>
                      <div
                        className={['keyinfo-folder-header', isFolderDrop ? 'keyinfo-folder-header--drop' : ''].filter(Boolean).join(' ')}
                        onClick={() => { if (!isRenaming) toggleFolder(folder.id) }}
                        onDragOver={e => handleFolderDragOver(e, folder.id)}
                        onDrop={e => { e.stopPropagation(); commitDrop() }}
                      >
                        <span className="keyinfo-folder-toggle">
                          {isExpanded ? '▾' : '▸'}
                        </span>
                        {isRenaming ? (
                          <input
                            className="keyinfo-folder-rename-input"
                            value={renameFolderName}
                            onChange={e => setRenameFolderName(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') commitRename(folder.id)
                              if (e.key === 'Escape') setRenamingFolderId(null)
                            }}
                            onBlur={() => commitRename(folder.id)}
                            autoFocus
                            onClick={e => e.stopPropagation()}
                          />
                        ) : (
                          <span className="keyinfo-folder-name" onDoubleClick={e => { if (!isOwnProduct) return; e.stopPropagation(); startRename(folder) }}>
                            {folder.name}
                          </span>
                        )}
                        <span className="keyinfo-folder-count">{folderPins.length}</span>
                        {isOwnProduct && (
                          <button
                            className="keyinfo-folder-delete" {...uiId('KI.folder-delete')}
                            onClick={e => { e.stopPropagation(); handleDeleteFolder(folder.id) }}
                            title="폴더 삭제 (핀은 미분류로 이동)"
                          >
                            ×
                          </button>
                        )}
                      </div>

                      {isExpanded && (
                        <ul className="keyinfo-folder-pins">
                          {folderPins.length === 0 ? (
                            <li
                              className={['keyinfo-folder-empty-drop', isFolderDrop ? 'keyinfo-folder-empty-drop--active' : ''].filter(Boolean).join(' ')}
                              onDragOver={e => handleFolderDragOver(e, folder.id)}
                              onDrop={e => { e.stopPropagation(); commitDrop() }}
                            >
                              핀을 드래그하여 넣기
                            </li>
                          ) : (
                            folderPins.map(pin => renderPinItem(pin))
                          )}
                        </ul>
                      )}
                    </li>
                  )
                })}

                {effectiveFolders.length > 0 && (
                  <li
                    className={['keyinfo-ungrouped-zone', dropTarget?.kind === 'ungrouped' ? 'keyinfo-ungrouped-zone--drop' : ''].filter(Boolean).join(' ')}
                    onDragOver={handleUngroupedDragOver}
                    onDrop={e => { e.stopPropagation(); commitDrop() }}
                  >
                    <span className="keyinfo-ungrouped-label">미분류</span>
                  </li>
                )}

                {ungroupedPins.map(pin => renderPinItem(pin))}
              </ul>
            )}
          </div>

          {/* ── 우측: 선택된 핀 상세 ── */}
          <div className="keyinfo-right" {...uiId('KI.right')}>
            {!sel ? (
              <div className="keyinfo-detail-empty">← 좌측에서 핀을 선택하세요</div>
            ) : (
              <div className="keyinfo-detail" {...uiId('KI.detail')}>
                <div className="keyinfo-detail-top">
                  <span className="keyinfo-pin-badge-lg">#{sel.pinId}</span>
                  <span className="keyinfo-detail-colname">{sel.columnKey}</span>
                  {displayDbType && <span className="col-db-type-badge">{displayDbType}</span>}
                  <span className="keyinfo-detail-filename">{sel.fileName.replace(/\.csv$/i, '')}</span>
                </div>

                {/* 주석 표시 (detail-top 바로 아래) */}
                {sel.comment && (
                  <textarea
                    className="keyinfo-pin-comment-display" {...uiId('KI.detail-comment')}
                    value={sel.comment}
                    disabled
                    readOnly
                  />
                )}

                {displayConstraints && (
                  <div className="keyinfo-constraints" {...uiId('KI.constraints')}>
                    {displayConstraints.isPK && (
                      <div className="keyinfo-row">
                        <span className="col-cb col-cb--pk">PK</span>
                        <span className="keyinfo-row-desc">Primary Key</span>
                      </div>
                    )}
                    {displayConstraints.isFK && (
                      <div className="keyinfo-row">
                        <span className="col-cb col-cb--fk">FK</span>
                        <span className="keyinfo-row-desc">Foreign Key → {displayConstraints.fkRef}</span>
                      </div>
                    )}
                    {displayConstraints.isNotNull && (
                      <div className="keyinfo-row">
                        <span className="col-cb col-cb--nn">NN</span>
                        <span className="keyinfo-row-desc">Not Null</span>
                      </div>
                    )}
                    {displayConstraints.isUnique && (
                      <div className="keyinfo-row">
                        <span className="col-cb col-cb--uq">UQ</span>
                        <span className="keyinfo-row-desc">Unique</span>
                      </div>
                    )}
                    {displayConstraints.backrefs?.map(ref => (
                      <div key={ref} className="keyinfo-row">
                        <span className="col-cb col-cb--ref">REF</span>
                        <span className="keyinfo-row-desc">Referenced by {ref}</span>
                      </div>
                    ))}
                  </div>
                )}

                {activeProduct && (
                  <div className="keyinfo-cross" {...uiId('KI.cross')}>
                    <div className="keyinfo-cross-header">
                      <span className="keyinfo-cross-title">파일 목록</span>
                      {crossFiles.length > 0 && <span className="keyinfo-cross-count">{crossFiles.length}</span>}
                      <div className="keyinfo-cross-actions" {...uiId('KI.cross-actions')}>
                        <button className="keyinfo-action-btn" onClick={handleLoad} title="전체 프리셋 재색인">
                          <RefreshCw size={11} />Load
                        </button>
                        <button
                          className="keyinfo-action-btn keyinfo-action-btn--lore"
                          onClick={() => setLorebookOpen(true)}
                          disabled={crossFiles.length === 0}
                          title="Lorebook 항목 생성"
                        >
                          <BookOpen size={11} />Lore
                        </button>
                        <button
                          className={['keyinfo-action-btn keyinfo-action-btn--tag', tagLoading ? 'keyinfo-action-btn--loading' : ''].filter(Boolean).join(' ')}
                          onClick={handleTag}
                          disabled={tagLoading || crossFiles.length === 0}
                          title="연관 파일 색인"
                        >
                          <Tag size={11} />Tag
                        </button>
                      </div>
                    </div>

                    {crossFiles.length > 0 && (
                      <ul className="keyinfo-cross-list">
                        {crossFiles.map(({ fileName, entry }) => {
                          const isOrigin = fileName === sel.fileName   // 핀을 고정한 파일
                          const isViewing = fileName === activeFile   // 지금 화면에서 보고 있는 파일
                          return (
                            <li
                              key={fileName}
                              className={['keyinfo-cross-item', isOrigin ? 'keyinfo-cross-item--current' : '', isViewing ? 'keyinfo-cross-item--viewing' : ''].filter(Boolean).join(' ')}
                              onClick={() => !isViewing && onOpenCsv(fileName)}
                              aria-selected={isViewing}
                            >
                              <span className="keyinfo-cross-filename">
                                {fileName.replace(/\.csv$/i, '')}
                                {isOrigin && <span className="keyinfo-cross-cur-tag">핀 고정</span>}
                                {isViewing && <span className="keyinfo-cross-view-tag">선택됨</span>}
                              </span>
                              <span className="keyinfo-cross-badges">{constraintBadges(entry)}</span>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    {crossFiles.length === 0 && (
                      <div className="keyinfo-cross-empty">Load 또는 Tag로 연관 파일을 색인하세요</div>
                    )}
                  </div>
                )}

                <button className="keyinfo-open-btn" onClick={() => onOpenCsv(sel.fileName)}>
                  이 파일 열기
                </button>
              </div>
            )}
          </div>
        </div>

        {tab === 'pins' && <ProductSummaryPanel products={products} activeProduct={activeProduct} selectedProduct={localProduct} />}

        {lorebookOpen && sel && (
          <LorebookCreateManyModal
            columnKey={sel.columnKey}
            product={activeProduct || 'none'}
            crossFiles={crossFiles}
            onClose={() => setLorebookOpen(false)}
          />
        )}
        </div>{/* keyinfo-modal-main */}

        </div>{/* keyinfo-modal-inner */}
      </Modal>

      {/* ── 핀 컨텍스트 메뉴 ── */}
      {pinCtx && (
        <PinContextMenu
          ctx={pinCtx}
          onDelete={() => setConfirmDelete(pinCtx.pinIds)}
          onComment={() => openCommentEdit(pinCtx.pinIds[0])}
          onClose={() => setPinCtx(null)}
        />
      )}

      {/* ── 삭제 확인 모달 ── */}
      {confirmDelete && (
        <Modal
          title="핀 삭제"
          onClose={() => setConfirmDelete(null)}
          cardClassName="confirm-modal-card"
          draggable={false}
          showCloseButton={false}
        >
          <div className="confirm-modal-body" {...uiId('KI.confirm')}>
            <p className="confirm-modal-msg">
              {confirmDelete.length > 1
                ? `선택한 핀 ${confirmDelete.length}개를 삭제하시겠습니까?`
                : `핀 #${confirmDelete[0]}을(를) 삭제하시겠습니까?`}
            </p>
            <p className="confirm-modal-sub">Lorebook 요소는 삭제되지 않습니다. 이 핀에만 연결된 Key 노트는 함께 삭제됩니다. 진행합니까?</p>
          </div>
          <div className="modal-footer">
            <button className="modal-btn modal-btn--cancel" onClick={() => setConfirmDelete(null)}>취소</button>
            <button className="modal-btn modal-btn--danger" onClick={() => handleDeletePins(confirmDelete)}>삭제</button>
          </div>
        </Modal>
      )}

      {/* ── 주석 편집 모달 ── */}
      {commentEditPinId !== null && (
        <Modal
          title="핀 주석"
          onClose={() => setCommentEditPinId(null)}
          cardClassName="keyinfo-comment-modal-card"
          draggable={false}
          showCloseButton={false}
        >
          <div className="keyinfo-comment-modal-body" {...uiId('KI.comment')}>
            <textarea
              className="keyinfo-comment-textarea"
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              placeholder="주석 내용을 입력하세요..."
              autoFocus
              onKeyDown={e => { if (e.key === 'Escape') setCommentEditPinId(null) }}
            />
          </div>
          <div className="modal-footer">
            <button className="modal-btn modal-btn--cancel" onClick={() => setCommentEditPinId(null)}>취소</button>
            <button className="modal-btn modal-btn--save" onClick={handleSaveComment}>저장</button>
          </div>
        </Modal>
      )}
    </>
  )
}
