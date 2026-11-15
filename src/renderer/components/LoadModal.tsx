import { useState, useEffect, useMemo, useRef } from 'react'
import { FileText, RefreshCw, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { Modal } from './Modal'
import { uiId } from '../ui/uiId'

interface PresetItem {
  name: string
  mtime: number
  product?: string
}

interface AccordionGroup {
  key: string
  label: string
  items: PresetItem[]
  kind: 'product' | 'none' | 'deprecated'
}

interface LoadModalProps {
  open: boolean
  onClose: () => void
  onLoad: (name: string) => Promise<void>
  currentJson?: string | null
  categories: string[]
}

function formatDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function LoadModal({ open, onClose, onLoad, currentJson, categories }: LoadModalProps) {
  const [presets, setPresets] = useState<PresetItem[]>([])
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const expandedInitRef = useRef(false)

  const fetchPresets = async () => {
    setLoading(true)
    try {
      const list = await window.electronAPI.localListPresets()
      setPresets(list.filter((p) => p.name !== 'sheet-settings.json'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      expandedInitRef.current = false
      fetchPresets()
    } else {
      setExpandedGroups(new Set())
    }
  }, [open])

  const groups = useMemo<AccordionGroup[]>(() => {
    const categorySet = new Set(categories)
    const result: AccordionGroup[] = []

    for (const cat of categories) {
      const items = presets.filter(p => p.product === cat)
      if (items.length > 0) {
        result.push({ key: `product:${cat}`, label: cat, items, kind: 'product' })
      }
    }

    const noneItems = presets.filter(p => !p.product)
    if (noneItems.length > 0) {
      result.push({ key: 'none', label: 'none', items: noneItems, kind: 'none' })
    }

    const deprecatedItems = presets.filter(p => p.product && !categorySet.has(p.product))
    if (deprecatedItems.length > 0) {
      result.push({ key: 'deprecated', label: 'deprecated', items: deprecatedItems, kind: 'deprecated' })
    }

    return result
  }, [presets, categories])

  // Expand all groups on first load
  useEffect(() => {
    if (groups.length > 0 && !expandedInitRef.current) {
      expandedInitRef.current = true
      setExpandedGroups(new Set(groups.map(g => g.key)))
    }
  }, [groups])

  if (!open) return null

  const busy = applying !== null || deleting !== null

  const handleLoad = async (name: string) => {
    setApplying(name)
    try {
      await onLoad(name)
    } finally {
      setApplying(null)
    }
  }

  const handleDelete = async (name: string) => {
    setDeleting(name)
    setConfirmTarget(null)
    try {
      await window.electronAPI.localDeletePreset(name)
      await fetchPresets()
    } finally {
      setDeleting(null)
    }
  }

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const renderPresetItem = (p: PresetItem, showProduct = false) => (
    <li key={p.name} className="load-preset-item" {...uiId('LD.preset', p.name)}>
      <FileText size={14} className="load-preset-icon" />
      <div className="load-preset-info">
        <span className="load-preset-name">
          {p.name === 'local.json' ? 'local.json (자동 저장)' : p.name}
        </span>
        <span className="load-preset-date">{formatDate(p.mtime)}</span>
        {showProduct && p.product && (
          <span className="load-preset-product">{p.product}</span>
        )}
      </div>
      <button
        className="load-preset-delete-btn" {...uiId('LD.preset-delete')}
        title="삭제"
        disabled={busy || p.name === 'local.json'}
        onClick={() => setConfirmTarget(p.name)}
      >
        {deleting === p.name
          ? <RefreshCw size={12} className="spin" />
          : <Trash2 size={13} />}
      </button>
      <button
        className="load-preset-btn"
        disabled={busy}
        onClick={() => handleLoad(p.name)}
      >
        {applying === p.name ? '적용 중...' : '불러오기'}
      </button>
    </li>
  )

  const renderBody = () => {
    if (loading) {
      return (
        <div className="load-modal-empty">
          <RefreshCw size={18} className="spin" />
          <span>목록 읽는 중...</span>
        </div>
      )
    }
    if (presets.length === 0) {
      return (
        <div className="load-modal-empty">
          <span>저장된 프리셋이 없습니다</span>
        </div>
      )
    }
    if (groups.length === 0) {
      // categories not yet loaded — flat list
      return (
        <ul className="load-preset-list">
          {presets.map(p => renderPresetItem(p, true))}
        </ul>
      )
    }
    return (
      <div className="load-accordion">
        {groups.map(group => {
          const isExpanded = expandedGroups.has(group.key)
          return (
            <div key={group.key} className="load-accordion-group" {...uiId('LD.group')}>
              <button
                className={`load-accordion-header load-accordion-header--${group.kind}`}
                onClick={() => toggleGroup(group.key)}
              >
                {isExpanded
                  ? <ChevronDown size={13} className="load-accordion-chevron" />
                  : <ChevronRight size={13} className="load-accordion-chevron" />}
                <span className="load-accordion-label">{group.label}</span>
                <span className="load-accordion-count">{group.items.length}</span>
              </button>
              {isExpanded && (
                <ul className="load-preset-list load-accordion-body">
                  {group.items.map(p => renderPresetItem(p, group.kind === 'deprecated'))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <>
      <Modal title="프리셋 불러오기" uiCode="LD" onClose={onClose} cardClassName="load-modal-card">
        <div className="load-modal-body">
          {renderBody()}
        </div>
        <div className="modal-footer load-modal-footer" {...uiId('LD.footer')}>
          {currentJson && (
            <span className="load-modal-current-json" {...uiId('LD.current')}>현재: {currentJson}</span>
          )}
          <button className="modal-btn modal-btn--cancel" onClick={onClose}>닫기</button>
        </div>
      </Modal>

      {confirmTarget && (
        <Modal
          title="프리셋 삭제"
          onClose={() => setConfirmTarget(null)}
          cardClassName="confirm-modal-card"
          draggable={false}
          showCloseButton={false}
        >
          <div className="confirm-modal-body" {...uiId('LD.confirm')}>
            <p className="confirm-modal-msg">
              <strong>{confirmTarget}</strong> 을(를) 삭제하시겠습니까?
            </p>
            <p className="confirm-modal-sub">이 작업은 되돌릴 수 없습니다.</p>
          </div>
          <div className="modal-footer">
            <button className="modal-btn modal-btn--cancel" onClick={() => setConfirmTarget(null)}>
              취소
            </button>
            <button className="modal-btn modal-btn--danger" onClick={() => handleDelete(confirmTarget)}>
              삭제
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
