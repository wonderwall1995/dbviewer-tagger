import { useState, useEffect, useRef, useMemo } from 'react'
import { Pencil, Trash2, ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react'
import { Modal } from './Modal'
import { uiId } from '../ui/uiId'
import { api } from '../api'

interface LorebookEntry {
  name: string
  path: string
  folder: string
}

type View =
  | { type: 'list' }
  | { type: 'edit'; entry: LorebookEntry; content: string }

interface Props {
  onClose: () => void
}

function parseEntryName(name: string): { csv: string; col: string } | null {
  const idx = name.indexOf('_')
  if (idx < 0) return null
  return { csv: name.slice(0, idx), col: name.slice(idx + 1) }
}

export function LorebookModal({ onClose }: Props) {
  const [entries, setEntries] = useState<LorebookEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>({ type: 'list' })
  const [selectedEntry, setSelectedEntry] = useState<LorebookEntry | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<LorebookEntry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 필터 상태
  const [filterProduct, setFilterProduct] = useState('')
  const [search, setSearch] = useState('')
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set())

  const loadEntries = async () => {
    setLoading(true)
    try {
      const list = await api.lorebookList()
      setEntries(list)
    } catch {
      setError('목록을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadEntries() }, [])

  useEffect(() => {
    if (view.type === 'edit') {
      setTimeout(() => { textareaRef.current?.focus() }, 50)
    }
  }, [view])

  const openEdit = async (entry: LorebookEntry) => {
    setError(null)
    try {
      const content = await api.lorebookRead(entry.path)
      setView({ type: 'edit', entry, content })
    } catch {
      setError('파일을 읽지 못했습니다.')
    }
  }

  const handleSave = async () => {
    if (view.type !== 'edit') return
    setSaving(true)
    setError(null)
    try {
      await api.lorebookWrite(view.entry.path, view.content)
      await loadEntries()
      setView({ type: 'list' })
    } catch {
      setError('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (entry: LorebookEntry) => {
    setDeleting(true)
    setError(null)
    try {
      await api.lorebookDelete(entry.path)
      await loadEntries()
      setConfirmDelete(null)
      setSelectedEntry(prev => prev?.path === entry.path ? null : prev)
      if (view.type === 'edit' && view.entry.path === entry.path) {
        setView({ type: 'list' })
      }
    } catch {
      setError('삭제에 실패했습니다.')
    } finally {
      setDeleting(false)
    }
  }

  // product → entries 그루핑
  const grouped = useMemo(() => {
    const map: Record<string, LorebookEntry[]> = {}
    for (const e of entries) {
      const key = e.folder || '(루트)'
      map[key] = [...(map[key] ?? []), e]
    }
    return map
  }, [entries])

  const products = useMemo(() => Object.keys(grouped).sort(), [grouped])

  // filterProduct 바꿀 때 해당 아코디언 자동 열기
  const handleFilterProductChange = (product: string) => {
    setFilterProduct(product)
    if (product) {
      setExpandedProducts(prev => new Set([...prev, product]))
    }
  }

  const toggleExpand = (product: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev)
      next.has(product) ? next.delete(product) : next.add(product)
      return next
    })
  }

  const q = search.toLowerCase()

  // 보여줄 그룹 목록 (product 필터 + 검색 결과 있는 것만)
  const visibleGroups = useMemo(() => {
    return products
      .filter(p => !filterProduct || p === filterProduct)
      .map(p => ({
        product: p,
        items: (grouped[p] ?? []).filter(e => !q || e.name.toLowerCase().includes(q)),
      }))
      .filter(g => g.items.length > 0)
  }, [products, filterProduct, grouped, q])

  const backBtn = view.type === 'edit' ? (
    <button className="lb-back-btn" {...uiId('LB.back')} onClick={() => { setView({ type: 'list' }); setError(null) }}>
      <ChevronLeft size={14} />
    </button>
  ) : undefined

  return (
    <>
      <Modal
        uiCode="LB"
        title={view.type === 'list' ? '로어북' : view.entry.name}

        leftSlot={backBtn}
        onClose={onClose}
        cardClassName="lb-modal-card"
        floating
      >
        <div className="lb-body">
          {error && <div className="lb-error">{error}</div>}

          {view.type === 'list' ? (
            <>
              {/* 필터 바 */}
              <div className="lb-filter-bar" {...uiId('LB.filter')}>
                <select
                  className="lb-product-select" {...uiId('LB.product')}
                  value={filterProduct}
                  onChange={e => handleFilterProductChange(e.target.value)}
                >
                  <option value="">전체</option>
                  {products.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <div className="lb-search-wrap" {...uiId('LB.search')}>
                  <Search size={12} className="lb-search-icon" />
                  <input
                    className="lb-search-input"
                    placeholder="검색..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onKeyDown={e => e.key === 'Escape' && setSearch('')}
                  />
                </div>
              </div>

              {/* 아코디언 리스트 */}
              {loading ? (
                <div className="lb-loading"><Loader2 size={18} className="spin" /></div>
              ) : entries.length === 0 ? (
                <div className="lb-empty">항목이 없습니다.</div>
              ) : visibleGroups.length === 0 ? (
                <div className="lb-empty">검색 결과가 없습니다.</div>
              ) : (
                <div className="lb-list" {...uiId('LB.list')}>
                  {visibleGroups.map(({ product, items }) => {
                    const isExpanded = expandedProducts.has(product)
                    return (
                      <div key={product} className="lb-accordion" {...uiId('LB.group', product)}>
                        <button
                          className={`lb-accordion-header${isExpanded ? ' lb-accordion-header--open' : ''}`}
                          onClick={() => toggleExpand(product)}
                        >
                          <ChevronRight
                            size={13}
                            className={`lb-accordion-chevron${isExpanded ? ' lb-accordion-chevron--open' : ''}`}
                          />
                          <span className="lb-accordion-title">{product}</span>
                          <span className="lb-accordion-count">{items.length}</span>
                        </button>
                        {isExpanded && (
                          <div className="lb-accordion-body">
                            {items.map(entry => (
                              <div
                                key={entry.path}
                                className={`lb-item${selectedEntry?.path === entry.path ? ' lb-item--selected' : ''}`} {...uiId('LB.item', entry.name)}
                                onClick={() => setSelectedEntry(entry)}
                              >
                                {(() => {
                                  const parsed = parseEntryName(entry.name)
                                  return parsed ? (
                                    <span className="lb-item-name">
                                      <span className="lb-item-csv">{parsed.csv}</span>
                                      <span className="lb-item-sep"> › </span>
                                      <span className="lb-item-col">{parsed.col}</span>
                                    </span>
                                  ) : (
                                    <span className="lb-item-name">{entry.name}</span>
                                  )
                                })()}
                                <div className="lb-item-actions" {...uiId('LB.item-actions')}>
                                  <button
                                    className="lb-icon-btn"
                                    onClick={e => { e.stopPropagation(); openEdit(entry) }}
                                    title="수정"
                                  >
                                    <Pencil size={12} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="lb-edit-form" {...uiId('LB.form')}>
              <div className="lb-field">
                <label className="lb-label">항목 이름</label>
                <input className="lb-input" value={view.entry.name} readOnly />
              </div>
              <div className="lb-field lb-field--grow">
                <label className="lb-label">내용 (Markdown)</label>
                <textarea
                  ref={textareaRef}
                  className="lb-textarea"
                  value={view.content}
                  onChange={e => setView(v => v.type === 'edit' ? { ...v, content: e.target.value } : v)}
                  placeholder="항목 내용을 입력하세요..."
                />
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer" {...uiId('LB.footer')}>
          {view.type === 'list' ? (
            <>
              <button
                className="modal-btn modal-btn--danger"
                onClick={() => selectedEntry && setConfirmDelete(selectedEntry)}
                disabled={!selectedEntry}
              >
                <Trash2 size={13} />
                삭제
              </button>
              <div />
            </>
          ) : (
            <>
              <button className="modal-btn modal-btn--cancel" onClick={() => { setView({ type: 'list' }); setError(null) }}>
                취소
              </button>
              <button className="modal-btn modal-btn--primary" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 size={13} className="spin" /> : '저장'}
              </button>
            </>
          )}
        </div>
      </Modal>

      {confirmDelete && (
        <Modal
          title="항목 삭제"
          onClose={() => setConfirmDelete(null)}
          cardClassName="confirm-modal-card"
          draggable={false}
          showCloseButton={false}
        >
          <div className="confirm-modal-body" {...uiId('LB.confirm')}>
            <p className="confirm-modal-msg">
              <strong>{confirmDelete.name}</strong> 항목을 삭제하시겠습니까?
            </p>
            <p className="confirm-modal-sub">이 작업은 되돌릴 수 없습니다.</p>
          </div>
          <div className="modal-footer">
            <button className="modal-btn modal-btn--cancel" onClick={() => setConfirmDelete(null)}>취소</button>
            <button className="modal-btn modal-btn--danger" onClick={() => handleDelete(confirmDelete)} disabled={deleting}>
              {deleting ? <Loader2 size={13} className="spin" /> : '삭제'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
