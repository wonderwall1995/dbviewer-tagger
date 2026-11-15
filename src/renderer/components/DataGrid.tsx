import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ParsedCsv, ColumnMeta, PinnedColumn, KeyinfoColumnSchema } from '../../shared/types'
import { LorebookCreateModal } from './LorebookCreateModal'
import { Modal } from './Modal'
import { uiId } from '../ui/uiId'
import { toast } from 'sonner'

interface DataGridProps {
  data: ParsedCsv
  searchQuery: string
  initialColumnWidths?: Record<string, number>
  onColumnWidthsChange?: (widths: Record<string, number>) => void
  initialPageSize?: number
  onPageSizeChange?: (size: number) => void
  lorebookCategories: string[]
  onCategoriesChange: (cats: string[]) => void
  onEraseColumn?: (colKey: string) => Promise<void>
  hiddenColumnKeys?: string[]
  onHideColumn?: (colKey: string) => void
  deletedColumnKeys?: string[]
  onResetDeletedColumn?: (colKey: string) => void
  onLorebookCreated?: (csvName: string, colKey: string, product: string) => void
  columnComments?: Record<string, string>
  activeProduct?: string
  onOpenLorebook?: () => void
  pinnedColumns?: PinnedColumn[]
  onPinColumn?: (columnKey: string) => void
  columnSchema?: Record<string, KeyinfoColumnSchema>
}

const PAGE_SIZES = [100, 500, 1000, 2500]
const SHOW_ALL = 0
const FILTER_RESULT_LIMIT = 200
const MIN_COL_WIDTH = 1
const MIN_COL_DRAG_WIDTH = 12
const ROW_NUM_WIDTH = 50
const ROW_HEIGHT = 28
// 복사 피드백 삼각형의 한 변 길이. 행 높이의 1/4이다.
const COPY_MARK_SIZE = ROW_HEIGHT / 4

// 컬럼 기본 너비를 값의 글자 수에 맞출 때의 설정
const DATA_FONT_SIZE = 11.5          // .data-table 글자 크기 (styles.css와 같아야 한다)
const CELL_PADDING = 20 + 16         // 셀 좌우 여백 20px + 이슈 아이콘 자리 16px
const EXTRA_CHARS = 1                // 가장 긴 값이 칸 끝에 닿지 않도록 글자 1개만큼 더 넓힌다
const AUTO_WIDTH_MAX = 520           // 자동으로 넓히는 너비의 상한 (px)
const AUTO_WIDTH_SAMPLE_ROWS = 5000  // 너비 계산에 쓰는 행 수 (앞에서부터)
const LONG_VALUE_MIN_CHARS = 200     // 이 글자 수 이상이고 칸을 넘치면 셀 안에서 스크롤한다

// 값 한 개가 차지하는 폭(px). ASCII만 있으면 글자 수 × 글자 폭이고, 한글처럼 고정폭 글꼴에 없는 글자가
// 있으면 실제 글꼴로 잰다. (한글은 영문보다 넓어서 글자 수만으로는 폭이 모자란다)
const NON_ASCII = /[^\x00-\x7f]/
function valueTextWidth(value: string, monoCharW: number): number {
  if (!NON_ASCII.test(value)) return value.length * monoCharW
  return textWidth(value, `${DATA_FONT_SIZE}px ${cssVar('--font-mono', 'monospace')}`)
}

// 데이터 그리드(고정폭 글꼴)의 글자 한 개 폭을 잰다.
function measureMonoCharWidth(): number {
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return 7
    const family = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace'
    ctx.font = `${DATA_FONT_SIZE}px ${family}`
    return ctx.measureText('0'.repeat(20)).width / 20
  } catch {
    return 7
  }
}

// ── 머리글 너비 (1단계 기준) ──────────────────────────────────────────────────
// 머리글(컬럼 이름, 제약 뱃지, 타입 뱃지, 정렬 버튼)이 잘리지 않는 너비를 글자 폭을 직접 재어 계산한다.
// 이 값이 컬럼 너비의 바닥이다. 값(셀) 기준 너비는 이 위에서 더 넓힐 때만 쓴다. (2단계 기준)
const HEADER_WIDTH_MIN = 72   // 머리글 기준 너비의 하한 (px)
const HEADER_WIDTH_MAX = 420  // 머리글 기준 너비의 상한 (px). 이보다 긴 이름은 말줄임으로 잘린다.

let measureCtx: CanvasRenderingContext2D | null | undefined
function textWidth(text: string, font: string): number {
  if (measureCtx === undefined) {
    try { measureCtx = document.createElement('canvas').getContext('2d') } catch { measureCtx = null }
  }
  if (!measureCtx) return text.length * 7
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

function cssVar(name: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  } catch {
    return fallback
  }
}

// 머리글 하나가 잘리지 않는 너비. 값(셀)은 보지 않는다.
// typeText: 타입 뱃지에 보이는 글자. hasDbTypeBadge가 true이면 테두리 없는 DB 타입 뱃지이다.
function headerColWidth(
  label: string,
  typeText: string,
  hasDbTypeBadge: boolean,
  constraintLabels: string[],
): number {
  const ui = cssVar('--font-ui', 'sans-serif')
  const mono = cssVar('--font-mono', 'monospace')

  // 컬럼 이름: 11px, 굵기 600, UI 글꼴
  const labelW = textWidth(label, `600 11px ${ui}`)

  // 뱃지: 고정폭 글꼴 글자 폭 + letter-spacing 0.03em 을 글자마다 더하고 좌우 여백과 테두리를 더한다.
  const badgeW = (text: string, sizePx: number, padX: number, border: number) =>
    text.length * (textWidth('0', `${sizePx}px ${mono}`) + 0.03 * sizePx) + padX * 2 + border * 2

  const typeW = badgeW(typeText, 9, 4, hasDbTypeBadge ? 0 : 1)
  const constraintW = constraintLabels.length > 0
    ? constraintLabels.reduce((sum, t) => sum + badgeW(t, 8, 3, 0), 0) + (constraintLabels.length - 1) * 2
    : 0

  const SORT_BTN = 15   // 아이콘 11px + 좌우 여백 2px × 2
  const GAP = 6         // 머리글 안 항목 사이 간격
  const INNER_PAD = 20  // 머리글 안쪽 좌우 여백 10px × 2
  const BORDER = 2      // 머리글 칸 좌우 테두리
  const BUFFER = 6
  const items = 3 + (constraintW > 0 ? 1 : 0) // 이름, [제약 뱃지], 타입 뱃지, 정렬 버튼
  const total = BORDER + INNER_PAD + labelW + constraintW + typeW + SORT_BTN + (items - 1) * GAP + BUFFER
  return Math.min(HEADER_WIDTH_MAX, Math.max(HEADER_WIDTH_MIN, Math.ceil(total)))
}

const EMPTY_COLUMN_SCHEMA: Record<string, KeyinfoColumnSchema> = {}

// ── Column right-click context menu ──────────────────────────────────────────

function ColumnContextMenu({
  position,
  onResetAll,
  onWidthAdjust,
  onHide,
  onDelete,
  onOpenHideReset,
  onOpenDeleteReset,
  onClose,
}: {
  position: { x: number; y: number }
  onResetAll: () => void
  onWidthAdjust: () => void
  onHide: () => void
  onDelete: () => void
  onOpenHideReset: () => void
  onOpenDeleteReset: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onCloseRef.current()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    setTimeout(() => {
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const left = Math.min(position.x, window.innerWidth - 180)
  const top = Math.min(position.y, window.innerHeight - 180)

  return (
    <div ref={ref} className="col-ctx-menu" {...uiId('MN.grid-menu')} style={{ left, top }}>
      <button className="col-ctx-item" {...uiId('MN.grid-menu-item')} onClick={() => { onWidthAdjust(); onClose() }}>
        넓이 조정
      </button>
      <button className="col-ctx-item col-ctx-warn" {...uiId('MN.grid-menu-item')} onClick={() => { onHide(); onClose() }}>
        숨김 처리
      </button>
      <button className="col-ctx-item" {...uiId('MN.grid-menu-item')} onClick={() => { onResetAll(); onClose() }}>
        폭 초기화
      </button>
      <div className="col-ctx-divider" />
      <button className="col-ctx-item col-ctx-danger" {...uiId('MN.grid-menu-item')} onClick={() => { onDelete(); onClose() }}>
        칼럼 삭제
      </button>
      <div className="col-ctx-divider" />
      <button className="col-ctx-item" {...uiId('MN.grid-menu-item')} onClick={() => { onOpenHideReset(); onClose() }}>
        숨김 초기화
      </button>
      <button className="col-ctx-item" {...uiId('MN.grid-menu-item')} onClick={() => { onOpenDeleteReset(); onClose() }}>
        삭제 초기화
      </button>
    </div>
  )
}

// ── Column filter popup ───────────────────────────────────────────────────────

interface FilterPopupProps {
  col: ColumnMeta
  csvName: string
  pageRows: Record<string, string>[]
  position: { x: number; y: number }
  currentFilter: Set<string> | null
  onApply: (colKey: string, included: Set<string> | null) => void
  onClose: () => void
  lorebookCategories: string[]
  onCategoriesChange: (cats: string[]) => void
  onLorebookCreated: (csvName: string, colKey: string, product: string) => void
  activeProduct: string
  pinnedId: number | null
  onPinColumn: () => void
}

function ColumnFilterPopup({ col, csvName, pageRows, position, currentFilter, onApply, onClose, lorebookCategories, onCategoriesChange, onLorebookCreated, activeProduct, pinnedId, onPinColumn }: FilterPopupProps) {
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<Set<string>>(() => new Set(currentFilter ?? []))
  const [lorebookCreateOpen, setLorebookCreateOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const didMount = useRef(false)
  if (!didMount.current) {
    didMount.current = true
    setTimeout(() => {
      inputRef.current?.focus()
      const onDown = (e: MouseEvent) => {
        if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
          onCloseRef.current(); cleanup()
        }
      }
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { onCloseRef.current(); cleanup() }
      }
      const cleanup = () => {
        document.removeEventListener('mousedown', onDown)
        document.removeEventListener('keydown', onKey)
      }
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
    }, 0)
  }

  // 현재 페이지 행 기준 고유값 목록 (팝업 열릴 때 한 번 계산)
  const allValues = useMemo(
    () => [...new Set(pageRows.map(r => r[col.key] ?? ''))].sort(),
    [pageRows, col.key]
  )

  // 검색어로 실시간 필터링 + 표시 상한
  const { displayValues, hasMore } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q ? allValues.filter(v => v.toLowerCase().includes(q)) : allValues
    return { displayValues: filtered.slice(0, FILTER_RESULT_LIMIT), hasMore: filtered.length > FILTER_RESULT_LIMIT }
  }, [allValues, query])

  const allChecked = displayValues.length > 0 && displayValues.every(v => checked.has(v))
  const someChecked = displayValues.some(v => checked.has(v)) && !allChecked

  // 전체 선택/해제는 현재 표시 목록에만 작용 (다른 선택 유지)
  const toggleAll = (on: boolean) => setChecked(prev => {
    const next = new Set(prev)
    if (on) displayValues.forEach(v => next.add(v))
    else displayValues.forEach(v => next.delete(v))
    return next
  })
  const toggleOne = (val: string) => setChecked(prev => {
    const next = new Set(prev)
    next.has(val) ? next.delete(val) : next.add(val)
    return next
  })

  const left = Math.min(position.x, window.innerWidth - 288)
  const top = Math.min(position.y, window.innerHeight - 440)

  return (
    <>
    <div ref={popupRef} className="cfp" {...uiId('MN.grid-filter')} style={{ left, top }}>
      <div className="cfp-header">
        <span className="cfp-title">{col.label}</span>
        <button className="cfp-close" onClick={onClose}>✕</button>
      </div>
      <div className="cfp-search-row" {...uiId('MN.grid-filter-search')}>
        <input
          ref={inputRef}
          className="cfp-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Escape' && onClose()}
          placeholder="값 검색..."
        />
      </div>
      <div className="cfp-list" {...uiId('MN.grid-filter-list')}>
        {displayValues.length === 0 ? (
          <p className="cfp-empty">검색 결과 없음</p>
        ) : (
          <>
            <label className="cfp-item cfp-all">
              <input
                type="checkbox"
                checked={allChecked}
                ref={el => { if (el) el.indeterminate = someChecked }}
                onChange={e => toggleAll(e.target.checked)}
              />
              <span>
                전체 선택
                {hasMore ? ` (${FILTER_RESULT_LIMIT}+)` : ` (${displayValues.length})`}
              </span>
            </label>
            <div className="cfp-scroll">
              {displayValues.map(val => (
                <label key={val} className="cfp-item">
                  <input type="checkbox" checked={checked.has(val)} onChange={() => toggleOne(val)} />
                  <span className="cfp-val">{val === '' ? '(빈 값)' : val}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="cfp-footer" {...uiId('MN.grid-filter-foot')}>
        <button className="cfp-btn cfp-clear" onClick={() => { onApply(col.key, null); onClose() }}>
          초기화
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="cfp-btn cfp-cancel" onClick={onClose}>취소</button>
          <button className="cfp-btn cfp-apply" onClick={() => {
            onApply(col.key, checked.size > 0 ? new Set(checked) : null)
            onClose()
          }}>적용</button>
        </div>
      </div>

      <div className="cfp-lorebook-bar" {...uiId('MN.grid-filter-lore')}>
        <button className="cfp-lb-btn" onClick={() => setLorebookCreateOpen(true)}>
          L
          <span className="cfp-lb-tooltip">Lorebook</span>
        </button>
        <button
          className={['cfp-k-btn', pinnedId !== null ? 'cfp-k-btn--pinned' : ''].filter(Boolean).join(' ')}
          onClick={onPinColumn}
        >
          {pinnedId !== null ? `#${pinnedId}` : 'K'}
          <span className="cfp-lb-tooltip">{pinnedId !== null ? `#${pinnedId} 핀 해제` : '핀 고정'}</span>
        </button>
      </div>
    </div>

    {lorebookCreateOpen && (
      <LorebookCreateModal
        csvName={csvName}
        colKey={col.key}
        colLabel={col.label}
        onClose={() => setLorebookCreateOpen(false)}
        onCreated={onLorebookCreated}
        categories={lorebookCategories}
        onCategoriesChange={onCategoriesChange}
        initialProduct={activeProduct}
      />
    )}
    </>
  )
}

// ── DataGrid ──────────────────────────────────────────────────────────────────

export function DataGrid({
  data,
  searchQuery,
  initialColumnWidths = {},
  onColumnWidthsChange,
  initialPageSize = 500,
  onPageSizeChange,
  lorebookCategories,
  onCategoriesChange,
  onEraseColumn,
  hiddenColumnKeys = [],
  onHideColumn,
  deletedColumnKeys = [],
  onResetDeletedColumn,
  onLorebookCreated,
  columnComments = {},
  activeProduct = '',
  onOpenLorebook,
  pinnedColumns = [],
  onPinColumn,
  columnSchema = EMPTY_COLUMN_SCHEMA,
}: DataGridProps) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const tableScrollRef = useRef<HTMLDivElement>(null)
  const theadRowRef = useRef<HTMLTableRowElement>(null)

  const [sortConfig, setSortConfig] = useState<{ column: string; dir: 'asc' | 'desc' } | null>(null)
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>({})
  const [filterPopup, setFilterPopup] = useState<{ col: ColumnMeta; x: number; y: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; col: ColumnMeta } | null>(null)
  const [widthModal, setWidthModal] = useState<{ col: ColumnMeta; initW: number } | null>(null)
  const [widthInput, setWidthInput] = useState(0)
  const [deleteConfirm, setDeleteConfirm] = useState<ColumnMeta | null>(null)
  const [erasing, setErasing] = useState(false)
  const [hideResetOpen, setHideResetOpen] = useState(false)
  const [deleteResetOpen, setDeleteResetOpen] = useState(false)

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(initialColumnWidths)
  const columnWidthsRef = useRef<Record<string, number>>(initialColumnWidths)
  const hasCustomWidths = Object.keys(columnWidths).length > 0

  // 숨김 칼럼 제외한 표시 칼럼
  const hiddenSet = useMemo(() => new Set(hiddenColumnKeys), [hiddenColumnKeys])
  const visibleColumns = useMemo(
    () => data.columns.filter(c => !hiddenSet.has(c.key)),
    [data.columns, hiddenSet]
  )

  // 셀을 클릭하면 값을 클립보드에 복사한다.
  // 빈 값이거나 글자를 끌어서 선택하는 중이면 복사하지 않는다. 연달아 눌러도 알림은 하나만 보인다.
  // 복사에 성공하면 그 셀의 왼쪽 위에 작은 직각 삼각형이 잠깐 떴다가 사라진다. (copyFlash)
  const [copyFlash, setCopyFlash] = useState<{ id: string; n: number } | null>(null)
  const copyFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyCellValue = useCallback(async (value: string, cellId: string) => {
    if (value === '') return
    if (window.getSelection()?.toString()) return
    try {
      await navigator.clipboard.writeText(value)
      toast.success('클립보드에 저장했습니다', { id: 'cell-copy' })
      // n을 올려서 같은 셀을 연달아 눌러도 애니메이션이 처음부터 다시 나온다.
      setCopyFlash((prev) => ({ id: cellId, n: (prev?.n ?? 0) + 1 }))
      if (copyFlashTimer.current) clearTimeout(copyFlashTimer.current)
      copyFlashTimer.current = setTimeout(() => setCopyFlash(null), 1000)
    } catch {
      toast.error('클립보드에 저장하지 못했습니다', { id: 'cell-copy' })
    }
  }, [])

  // 글꼴 로드가 끝나면 글자 폭을 다시 재도록 알린다. (로드 전에 재면 대체 글꼴 기준이 된다)
  const [fontsReady, setFontsReady] = useState(false)
  useEffect(() => {
    document.fonts?.ready.then(() => setFontsReady(true)).catch(() => {})
  }, [])

  // 고정폭 글꼴의 글자 한 개 폭
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const monoCharW = useMemo(() => measureMonoCharWidth(), [fontsReady])

  // 1단계 기준: 머리글(컬럼 이름, 제약 뱃지, 타입 뱃지, 정렬 버튼)이 잘리지 않는 너비.
  // 값이 Yes/No처럼 짧아도 이름이 긴 컬럼은 이름이 보이게 넓어지고, 이름이 짧은 컬럼은 좁아진다.
  const headerWidths = useMemo((): Record<string, number> => {
    const widths: Record<string, number> = {}
    for (const col of visibleColumns) {
      const schemaEntry = columnSchema[col.key]
      const constraints = col.dbConstraints ?? schemaEntry
      const dbType = col.dbType ?? schemaEntry?.dbType
      const labels: string[] = []
      if (constraints?.isPK) labels.push('PK')
      if (constraints?.isFK) labels.push('FK')
      if (constraints?.isUnique) labels.push('UQ')
      if (constraints?.isNotNull) labels.push('NN')
      if (constraints?.backrefs?.length) labels.push('REF')
      widths[col.key] = headerColWidth(col.label, dbType ?? col.type, !!dbType, labels)
    }
    return widths
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleColumns, columnSchema, fontsReady])

  // 2단계 기준: 값의 최대 글자 수에 맞춘 너비 (상한 AUTO_WIDTH_MAX). 값이 짧으면 0이다.
  const valueWidths = useMemo((): Record<string, number> => {
    const sample = data.rows.length > AUTO_WIDTH_SAMPLE_ROWS
      ? data.rows.slice(0, AUTO_WIDTH_SAMPLE_ROWS)
      : data.rows
    const widths: Record<string, number> = {}
    // 글자 하나는 고정폭 글자 폭의 2배를 넘지 않는다. 이 상한으로 잴 필요가 없는 값을 건너뛴다.
    const maxPerChar = monoCharW * 2
    for (const col of visibleColumns) {
      let bestPx = 0
      for (const row of sample) {
        const v = row[col.key]
        if (!v || v.length * maxPerChar <= bestPx) continue
        const w = valueTextWidth(v, monoCharW)
        if (w > bestPx) bestPx = w
      }
      widths[col.key] = bestPx === 0
        ? 0
        : Math.min(AUTO_WIDTH_MAX, Math.ceil(bestPx + EXTRA_CHARS * monoCharW + CELL_PADDING))
    }
    return widths
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.rows, visibleColumns, monoCharW, fontsReady])

  // 기본 너비: 1단계(머리글)를 바닥으로 하고, 값이 더 넓게 필요하면 2단계(값) 너비로 넓힌다.
  const autoWidths = useMemo((): Record<string, number> => {
    const widths: Record<string, number> = {}
    for (const col of visibleColumns) {
      widths[col.key] = Math.max(headerWidths[col.key] ?? HEADER_WIDTH_MIN, valueWidths[col.key] ?? 0)
    }
    return widths
  }, [visibleColumns, headerWidths, valueWidths])

  // 커스텀 너비 없으면 위의 기본 너비를 사용 (virtualization 필수)
  const effectiveWidths = useMemo((): Record<string, number> => {
    if (hasCustomWidths) return columnWidths
    return autoWidths
  }, [hasCustomWidths, columnWidths, autoWidths])

  const totalTableWidth = ROW_NUM_WIDTH + visibleColumns.reduce(
    (sum, col) => sum + (effectiveWidths[col.key] ?? 120), 0
  )

  // auto layout의 실제 <th> 너비를 DOM에서 읽어 커스텀 너비 초기화에 사용
  const captureCurrentWidths = useCallback((): Record<string, number> => {
    if (!theadRowRef.current) return {}
    const cells = Array.from(theadRowRef.current.children) as HTMLElement[]
    const widths: Record<string, number> = {}
    visibleColumns.forEach((col, i) => {
      const cell = cells[i + 1]
      if (cell) widths[col.key] = cell.offsetWidth
    })
    return widths
  }, [visibleColumns])

  const handleResizeStart = useCallback((e: React.MouseEvent, colKey: string) => {
    e.preventDefault()
    e.stopPropagation()

    const th = (e.currentTarget as HTMLElement).closest('th') as HTMLElement
    const startWidth = th.offsetWidth
    const startX = e.clientX

    if (Object.keys(columnWidthsRef.current).length === 0) {
      const captured = captureCurrentWidths()
      columnWidthsRef.current = captured
      setColumnWidths(captured)
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      const newWidth = Math.max(MIN_COL_DRAG_WIDTH, startWidth + delta)
      const next = { ...columnWidthsRef.current, [colKey]: newWidth }
      columnWidthsRef.current = next
      setColumnWidths(next)
    }

    const onUp = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      const finalWidth = Math.max(MIN_COL_DRAG_WIDTH, startWidth + delta)
      const next = { ...columnWidthsRef.current, [colKey]: finalWidth }
      columnWidthsRef.current = next
      setColumnWidths(next)
      onColumnWidthsChange?.(next)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [captureCurrentWidths, onColumnWidthsChange])

  const resetAllWidths = useCallback(() => {
    columnWidthsRef.current = {}
    setColumnWidths({})
    onColumnWidthsChange?.({})
  }, [onColumnWidthsChange])

  const applyWidth = useCallback(() => {
    if (!widthModal) return
    const newW = Math.max(MIN_COL_WIDTH, Math.min(800, widthInput))
    const next: Record<string, number> = {}
    for (const col of data.columns) next[col.key] = newW
    columnWidthsRef.current = next
    setColumnWidths(next)
    onColumnWidthsChange?.(next)
    setWidthModal(null)
  }, [widthModal, widthInput, data.columns, onColumnWidthsChange])

  const handleSort = useCallback((colKey: string) => {
    setSortConfig(prev => {
      if (!prev || prev.column !== colKey) return { column: colKey, dir: 'asc' }
      if (prev.dir === 'asc') return { column: colKey, dir: 'desc' }
      return null
    })
  }, [])

  const handleHeaderClick = useCallback((col: ColumnMeta, e: React.MouseEvent<HTMLDivElement>) => {
    const th = (e.currentTarget as HTMLElement).closest('th')
    const rect = th?.getBoundingClientRect()
    if (!rect) return
    setFilterPopup({ col, x: rect.left, y: rect.bottom + 4 })
  }, [])

  const handleApplyFilter = useCallback((colKey: string, included: Set<string> | null) => {
    setColumnFilters(prev => {
      if (!included || included.size === 0) {
        const next = { ...prev }
        delete next[colKey]
        return next
      }
      return { ...prev, [colKey]: included }
    })
  }, [])

  const filteredRows = useMemo(() => {
    let rows = data.rows.map((row, idx) => ({ row, idx }))

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      rows = rows.filter(({ row }) =>
        Object.values(row).some(v => String(v).toLowerCase().includes(q))
      )
    }

    for (const [colKey, included] of Object.entries(columnFilters)) {
      rows = rows.filter(({ row }) => included.has(row[colKey] ?? ''))
    }

    if (sortConfig) {
      const dir = sortConfig.dir === 'asc' ? 1 : -1
      rows = [...rows].sort((a, b) =>
        (a.row[sortConfig.column] ?? '').localeCompare(
          b.row[sortConfig.column] ?? '',
          undefined,
          { numeric: true }
        ) * dir
      )
    }

    return rows
  }, [data.rows, searchQuery, columnFilters, sortConfig])

  const isShowAll = pageSize === SHOW_ALL
  const totalPages = isShowAll ? 1 : Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = isShowAll ? 0 : Math.min(page, totalPages - 1)
  const pagedRows = isShowAll
    ? filteredRows
    : filteredRows.slice(safePage * pageSize, (safePage + 1) * pageSize)
  const startRow = filteredRows.length === 0 ? 0 : (isShowAll ? 1 : safePage * pageSize + 1)
  const endRow = isShowAll
    ? filteredRows.length
    : Math.min((safePage + 1) * pageSize, filteredRows.length)
  const activeFilterCount = Object.keys(columnFilters).length

  // Row virtualizer — DOM에 실제 보이는 행만 유지 (메모리 스파이크 방지)
  const rowVirtualizer = useVirtualizer({
    count: pagedRows.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  })

  return (
    <div className="grid-wrapper" {...uiId('MN.grid')}>
      {/* Stats bar */}
      <div className="stats-bar" {...uiId('MN.grid-stats')}>
        <span className="stat">
          <span className="stat-num">{data.totalRows.toLocaleString()}</span> 전체 행
        </span>
        <span className="stat">
          <span className="stat-num">{visibleColumns.length}</span> 열
        </span>
        {filteredRows.length !== data.totalRows && (
          <span className="stat stat-showing">
            표시: {filteredRows.length.toLocaleString()}행
          </span>
        )}
        {activeFilterCount > 0 && (
          <button className="stat-clear-filters" onClick={() => setColumnFilters({})}>
            필터 {activeFilterCount}개 ✕
          </button>
        )}
        <div
          className="col-legend" {...uiId('MN.grid-legend')}
          onWheel={(e) => {
            // 스크롤바를 숨겼으므로 마우스 휠의 세로 움직임을 가로 스크롤로 바꿔 준다.
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
          }}
        >
          {visibleColumns.map(col => (
            <span key={col.key} className={`col-type type-${col.type}`} title={col.key}>
              {col.label}
              <em>{col.type}</em>
            </span>
          ))}
        </div>
      </div>

      {/* Virtual table — thead sticky, tbody는 절대위치 가상행만 렌더 */}
      <div className="table-scroll" {...uiId('MN.grid-scroll')} ref={tableScrollRef}>
        <table
          className="data-table" {...uiId('MN.grid-row')}
          style={{
            display: 'grid',
            minWidth: totalTableWidth,
            borderCollapse: undefined,
          }}
        >
          <thead style={{
            display: 'grid',
            position: 'sticky',
            top: 0,
            zIndex: 3,
            background: 'var(--bg-3)',
          }}>
            <tr ref={theadRowRef} style={{ display: 'flex' }}>
              <th
                className="row-num-col"
                style={{ width: ROW_NUM_WIDTH, flexShrink: 0 }}
              >
                #
              </th>
              {visibleColumns.map(col => {
                const w = effectiveWidths[col.key] ?? 120
                const isSorted = sortConfig?.column === col.key
                const isFiltered = !!columnFilters[col.key]
                const pinInfo = pinnedColumns.find(p => p.columnKey === col.key)
                const schemaEntry = columnSchema[col.key]
                const displayConstraints = col.dbConstraints ?? schemaEntry
                const displayDbType = col.dbType ?? schemaEntry?.dbType
                return (
                  <th
                    key={col.key}
                    className={[
                      'col-header',
                      `type-${col.type}`,
                      isFiltered ? 'col-filtered' : '',
                      pinInfo ? 'col-header--pinned' : '',
                    ].filter(Boolean).join(' ')} {...uiId('MN.grid-col', col.label)}
                    style={{ width: w, minWidth: w, maxWidth: w, flexShrink: 0, boxSizing: 'border-box' }}
                    onContextMenu={e => {
                      e.preventDefault()
                      setContextMenu({ x: e.clientX, y: e.clientY, col })
                    }}
                  >
                    {pinInfo && (
                      <span className="col-pin-badge">#{pinInfo.pinId}</span>
                    )}
                    <div className="col-header-inner" onClick={e => handleHeaderClick(col, e)}>
                      <span className="col-label">{col.label}</span>
                      {displayConstraints && (displayConstraints.isPK || displayConstraints.isFK || displayConstraints.isUnique || displayConstraints.isNotNull || displayConstraints.backrefs?.length) && (
                        <span className="col-constraint-badges">
                          {displayConstraints.isPK && <span className="col-cb col-cb--pk">PK</span>}
                          {displayConstraints.isFK && <span className="col-cb col-cb--fk">FK</span>}
                          {displayConstraints.isUnique && <span className="col-cb col-cb--uq">UQ</span>}
                          {displayConstraints.isNotNull && <span className="col-cb col-cb--nn">NN</span>}
                          {displayConstraints.backrefs?.length && <span className="col-cb col-cb--ref">REF</span>}
                        </span>
                      )}
                      {displayDbType
                        ? <span className="col-db-type-badge">{displayDbType}</span>
                        : <span className={`col-type-badge type-${col.type}`}>{col.type}</span>
                      }
                      <button
                        className={`sort-btn${isSorted ? ' sort-active' : ''}`} {...uiId('MN.grid-sort')}
                        title={isSorted
                          ? sortConfig!.dir === 'asc' ? '내림차순으로' : '정렬 해제'
                          : '오름차순 정렬'}
                        onClick={e => { e.stopPropagation(); handleSort(col.key) }}
                      >
                        {isSorted
                          ? sortConfig!.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                          : <ArrowUpDown size={11} />}
                      </button>
                    </div>
                    {columnComments[col.key] && (
                      <div
                        className={`col-lorebook-comment${onOpenLorebook ? ' col-lorebook-comment--clickable' : ''}`}
                        title={columnComments[col.key]}
                        onClick={onOpenLorebook ? (e) => { e.stopPropagation(); onOpenLorebook() } : undefined}
                      >
                        {columnComments[col.key]}
                      </div>
                    )}
                    <div className="col-meta">
                      {col.nullCount + col.emptyCount > 0 && (
                        <span className="col-null-count">
                          null/빈값 {col.nullCount + col.emptyCount}
                        </span>
                      )}
                    </div>
                    <div
                      className="resize-handle" {...uiId('MN.grid-resize')}
                      onMouseDown={e => handleResizeStart(e, col.key)}
                    />
                  </th>
                )
              })}
            </tr>
          </thead>

          {/* tbody: 가상 높이 공간 확보 후 보이는 행만 절대위치 렌더 */}
          <tbody style={{
            display: 'grid',
            height: `${rowVirtualizer.getTotalSize()}px`,
            position: 'relative',
          }}>
            {rowVirtualizer.getVirtualItems().map(virtualRow => {
              const { row, idx } = pagedRows[virtualRow.index]
              return (
                <tr
                  key={idx}
                  style={{
                    display: 'flex',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    alignItems: 'stretch',
                  }}
                >
                  <td
                    className="row-num-col"
                    style={{ width: ROW_NUM_WIDTH, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}
                  >
                    {idx + 1}
                  </td>
                  {visibleColumns.map(col => {
                    const w = effectiveWidths[col.key] ?? 120
                    const value = row[col.key] ?? ''
                    // 아주 긴 값이 칸에 다 안 들어가면 말줄임 대신 셀 안에서 가로로 스크롤한다.
                    const scrollInside =
                      value.length >= LONG_VALUE_MIN_CHARS &&
                      valueTextWidth(value, monoCharW) + EXTRA_CHARS * monoCharW + CELL_PADDING > w
                    return (
                      <td
                        key={col.key}
                        className={[
                          'data-cell',
                          value === '' ? 'cell-empty' : '',
                          scrollInside ? 'data-cell--scroll' : '',
                        ].filter(Boolean).join(' ')} {...uiId('MN.grid-cell')}
                        onClick={() => copyCellValue(value, `${idx}:${col.key}`)}
                        style={{ width: w, minWidth: w, maxWidth: w, flexShrink: 0, boxSizing: 'border-box', display: 'flex', alignItems: 'center' }}
                      >
                        {value === '' ? '—' : value}
                        {copyFlash?.id === `${idx}:${col.key}` && (
                          <span
                            key={copyFlash.n}
                            className="cell-copy-mark"
                            style={{ width: COPY_MARK_SIZE, height: COPY_MARK_SIZE }}
                          />
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination bar */}
      <div className="pagination-bar" {...uiId('MN.grid-pager')}>
        <div className="pagination-info">
          {filteredRows.length === 0
            ? '결과 없음'
            : `${startRow.toLocaleString()} – ${endRow.toLocaleString()} / ${filteredRows.length.toLocaleString()} 행`}
        </div>
        <div className="pagination-nav" {...uiId('MN.grid-pager-nav')}>
          <button className="pg-btn" title="첫 페이지" disabled={safePage === 0} onClick={() => setPage(0)}>
            <ChevronsLeft size={14} />
          </button>
          <button className="pg-btn" title="이전 페이지" disabled={safePage === 0} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft size={14} />
          </button>
          <span className="pg-label">{safePage + 1} / {totalPages}</span>
          <button className="pg-btn" title="다음 페이지" disabled={safePage >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
            <ChevronRight size={14} />
          </button>
          <button className="pg-btn" title="마지막 페이지" disabled={safePage >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>
            <ChevronsRight size={14} />
          </button>
        </div>
        <div className="pagination-size" {...uiId('MN.grid-pagesize')}>
          <select value={pageSize} onChange={e => {
            const s = Number(e.target.value)
            setPageSize(s)
            setPage(0)
            onPageSizeChange?.(s)
          }}>
            {PAGE_SIZES.map(s => (
              <option key={s} value={s}>{s.toLocaleString()}행</option>
            ))}
            <option value={SHOW_ALL}>전체 보기</option>
          </select>
        </div>
      </div>

      {contextMenu && (
        <ColumnContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onResetAll={resetAllWidths}
          onWidthAdjust={() => {
            const w = effectiveWidths[contextMenu.col.key] ?? 120
            setWidthModal({ col: contextMenu.col, initW: w })
            setWidthInput(w)
          }}
          onHide={() => onHideColumn?.(contextMenu.col.key)}
          onDelete={() => setDeleteConfirm(contextMenu.col)}
          onOpenHideReset={() => setHideResetOpen(true)}
          onOpenDeleteReset={() => setDeleteResetOpen(true)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {widthModal && (
        <Modal
          uiCode="CW"
          title="전체 칼럼 넓이 조정"
          onClose={() => setWidthModal(null)}
          draggable
          showCloseButton
        >
          <div className="col-width-modal-body">
            <label className="col-width-modal-label">
              너비 (px)
              <input
                type="number"
                className="col-width-modal-input" {...uiId('CW.input')}
                value={widthInput}
                min={MIN_COL_WIDTH}
                max={800}
                autoFocus
                onChange={e => setWidthInput(Math.max(MIN_COL_WIDTH, Math.min(800, Number(e.target.value))))}
                onKeyDown={e => {
                  if (e.key === 'Enter') applyWidth()
                  if (e.key === 'Escape') setWidthModal(null)
                }}
              />
            </label>
          </div>
          <div className="modal-footer" {...uiId('CW.footer')}>
            <button className="modal-btn modal-btn--cancel" onClick={() => setWidthModal(null)}>취소</button>
            <button className="modal-btn modal-btn--primary" onClick={applyWidth}>적용</button>
          </div>
        </Modal>
      )}

      {deleteConfirm && (
        <Modal
          title="칼럼 삭제"
          onClose={() => setDeleteConfirm(null)}
          draggable={false}
          showCloseButton={false}
        >
          <div className="confirm-modal-body">
            <p className="confirm-modal-msg">
              local에 다운로드된 .csv에서 본 칼럼을 삭제합니다.<br />진행합니까?
            </p>
            <p className="confirm-modal-sub" style={{ color: '#94a3b8' }}>
              대상: <strong style={{ color: '#f5f0e8' }}>{deleteConfirm.label}</strong>
            </p>
          </div>
          <div className="modal-footer">
            <button
              className="modal-btn modal-btn--cancel"
              onClick={() => setDeleteConfirm(null)}
              disabled={erasing}
            >
              취소
            </button>
            <button
              className="modal-btn modal-btn--danger"
              disabled={erasing}
              onClick={async () => {
                if (!onEraseColumn) return
                setErasing(true)
                try {
                  await onEraseColumn(deleteConfirm.key)
                } finally {
                  setErasing(false)
                  setDeleteConfirm(null)
                }
              }}
            >
              {erasing ? '삭제 중...' : '삭제'}
            </button>
          </div>
        </Modal>
      )}

      {hideResetOpen && (
        <Modal
          uiCode="CR"
          title="숨김 초기화"
          onClose={() => setHideResetOpen(false)}
          draggable
          showCloseButton
          cardClassName="col-reset-modal-card"
        >
          {hiddenColumnKeys.length === 0 ? (
            <p className="col-reset-empty">숨김 처리된 칼럼이 없습니다.</p>
          ) : (
            <ul className="col-reset-list" {...uiId('CR.list')}>
              {hiddenColumnKeys.map(colKey => (
                <li key={colKey} className="col-reset-item" {...uiId('CR.item')}>
                  <span className="col-reset-name">{colKey}</span>
                  <button
                    className="col-reset-btn" {...uiId('CR.reset')}
                    onClick={() => onHideColumn?.(colKey)}
                  >
                    복원
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="modal-footer">
            <button className="modal-btn modal-btn--cancel" onClick={() => setHideResetOpen(false)}>닫기</button>
          </div>
        </Modal>
      )}

      {deleteResetOpen && (
        <Modal
          uiCode="CR"
          title="삭제 초기화"
          onClose={() => setDeleteResetOpen(false)}
          draggable
          showCloseButton
          cardClassName="col-reset-modal-card"
        >
          {deletedColumnKeys.length === 0 ? (
            <p className="col-reset-empty">삭제 기록된 칼럼이 없습니다.</p>
          ) : (
            <ul className="col-reset-list" {...uiId('CR.list')}>
              {deletedColumnKeys.map(colKey => (
                <li key={colKey} className="col-reset-item" {...uiId('CR.item')}>
                  <span className="col-reset-name">{colKey}</span>
                  <button
                    className="col-reset-btn" {...uiId('CR.reset')}
                    onClick={() => onResetDeletedColumn?.(colKey)}
                  >
                    복원
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="modal-footer">
            <button className="modal-btn modal-btn--cancel" onClick={() => setDeleteResetOpen(false)}>닫기</button>
          </div>
        </Modal>
      )}

      {filterPopup && (
        <ColumnFilterPopup
          col={filterPopup.col}
          csvName={data.fileName}
          pageRows={pagedRows.map(({ row }) => row)}
          position={{ x: filterPopup.x, y: filterPopup.y }}
          currentFilter={columnFilters[filterPopup.col.key] ?? null}
          onApply={handleApplyFilter}
          onClose={() => setFilterPopup(null)}
          lorebookCategories={lorebookCategories}
          onCategoriesChange={onCategoriesChange}
          onLorebookCreated={onLorebookCreated ?? (() => {})}
          activeProduct={activeProduct}
          pinnedId={pinnedColumns.find(p => p.columnKey === filterPopup.col.key)?.pinId ?? null}
          onPinColumn={() => onPinColumn?.(filterPopup.col.key)}
        />
      )}
    </div>
  )
}
