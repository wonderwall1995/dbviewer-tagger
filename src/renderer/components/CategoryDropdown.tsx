import { useState, useEffect, useRef } from 'react'
import { Pencil, Trash2, Plus, Check, X } from 'lucide-react'
import { uiId } from '../ui/uiId'
import { api } from '../api'

interface Props {
  value: string
  onChange: (v: string) => void
  categories: string[]
  onCategoriesChange: (cats: string[]) => void
  // 이 드롭다운에 붙일 ID (예: 'SV.product')
  uiIdValue?: string
}

export function CategoryDropdown({ value, onChange, categories, onCategoriesChange, uiIdValue }: Props) {
  const [open, setOpen] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [newCat, setNewCat] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        popoverRef.current && !popoverRef.current.contains(target) &&
        triggerRef.current && !triggerRef.current.contains(target)
      ) {
        setOpen(false)
        setEditingIdx(null)
        setAdding(false)
        setNewCat('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const persist = (next: string[]) => {
    onCategoriesChange(next)
    api.lorebookSetCategories(next).catch(() => {})
  }

  const handleSelect = (cat: string) => {
    onChange(cat)
    setOpen(false)
    setEditingIdx(null)
  }

  const handleDelete = (idx: number) => {
    const next = categories.filter((_, i) => i !== idx)
    persist(next)
    if (value === categories[idx]) onChange('')
  }

  const startEdit = (idx: number) => {
    setEditingIdx(idx)
    setEditValue(categories[idx])
  }

  const commitEdit = (idx: number) => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== categories[idx]) {
      const next = [...categories]
      const old = next[idx]
      next[idx] = trimmed
      persist(next)
      if (value === old) onChange(trimmed)
    }
    setEditingIdx(null)
  }

  const commitAdd = () => {
    const trimmed = newCat.trim()
    if (trimmed && !categories.includes(trimmed)) {
      const next = [...categories, trimmed]
      persist(next)
      onChange(trimmed)
    }
    setAdding(false)
    setNewCat('')
  }

  return (
    <div className="cat-dropdown" {...(uiIdValue ? uiId(uiIdValue) : {})}>
      <button
        ref={triggerRef}
        className="cat-trigger"
        type="button"
        onClick={() => setOpen(o => !o)}
      >
        <span className={value ? 'cat-value' : 'cat-placeholder'}>
          {value || '제품 선택...'}
        </span>
        <span className="cat-arrow">▾</span>
      </button>

      {open && (
        <div ref={popoverRef} className="cat-popover">
          <div className="cat-list">
            {categories.length === 0 && (
              <div className="cat-empty">카테고리 없음</div>
            )}
            {categories.map((cat, idx) => (
              <div
                key={`${cat}-${idx}`}
                className={`cat-item${value === cat ? ' cat-item--selected' : ''}`}
              >
                {editingIdx === idx ? (
                  <>
                    <input
                      className="cat-edit-input"
                      value={editValue}
                      autoFocus
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitEdit(idx)
                        if (e.key === 'Escape') setEditingIdx(null)
                      }}
                      onBlur={() => commitEdit(idx)}
                      onClick={e => e.stopPropagation()}
                    />
                    <div className="cat-item-actions">
                      <button
                        className="cat-icon-btn"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => commitEdit(idx)}
                        title="저장"
                      >
                        <Check size={11} />
                      </button>
                      <button
                        className="cat-icon-btn"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => setEditingIdx(null)}
                        title="취소"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="cat-item-name" onClick={() => handleSelect(cat)}>
                      {cat}
                    </span>
                    <div className="cat-item-actions">
                      <button
                        className="cat-icon-btn"
                        onClick={e => { e.stopPropagation(); startEdit(idx) }}
                        title="수정"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        className="cat-icon-btn cat-icon-btn--danger"
                        onClick={e => { e.stopPropagation(); handleDelete(idx) }}
                        title="삭제"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="cat-footer">
            {adding ? (
              <div className="cat-add-row">
                <input
                  className="cat-add-input"
                  value={newCat}
                  autoFocus
                  placeholder="새 카테고리명..."
                  onChange={e => setNewCat(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitAdd()
                    if (e.key === 'Escape') { setAdding(false); setNewCat('') }
                  }}
                />
                <button
                  className="cat-icon-btn"
                  onMouseDown={e => e.preventDefault()}
                  onClick={commitAdd}
                  title="추가"
                >
                  <Check size={11} />
                </button>
                <button
                  className="cat-icon-btn"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { setAdding(false); setNewCat('') }}
                  title="취소"
                >
                  <X size={11} />
                </button>
              </div>
            ) : (
              <button className="cat-add-btn" onClick={() => setAdding(true)}>
                <Plus size={11} />
                카테고리 추가
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
