import { useState } from 'react'
import { Pencil, Trash2, Plus, Check, X } from 'lucide-react'
import { Modal } from './Modal'
import { uiId } from '../ui/uiId'
import { api } from '../api'

interface Props {
  categories: string[]
  onCategoriesChange: (cats: string[]) => void
  onClose: () => void
}

export function ProductModal({ categories, onCategoriesChange, onClose }: Props) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  const persist = (next: string[]) => {
    onCategoriesChange(next)
    api.lorebookSetCategories(next).catch(() => {})
  }

  const startEdit = (idx: number) => {
    setEditingIdx(idx)
    setEditValue(categories[idx])
  }

  const commitEdit = (idx: number) => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== categories[idx]) {
      const next = [...categories]
      next[idx] = trimmed
      persist(next)
    }
    setEditingIdx(null)
  }

  const commitAdd = () => {
    const trimmed = newName.trim()
    if (trimmed && !categories.includes(trimmed)) {
      persist([...categories, trimmed])
    }
    setAdding(false)
    setNewName('')
  }

  const handleDelete = (idx: number) => {
    persist(categories.filter((_, i) => i !== idx))
    setConfirmDelete(null)
  }

  return (
    <>
      <Modal
        uiCode="PD"
        title="Products"

        onClose={onClose}
        cardClassName="product-modal-card"
        floating
      >
        <div className="product-modal-body">
          {categories.length === 0 && !adding ? (
            <div className="product-modal-empty">제품이 없습니다</div>
          ) : (
            <ul className="product-list" {...uiId('PD.list')}>
              {categories.map((cat, idx) => (
                <li key={`${cat}-${idx}`} className="product-item" {...uiId('PD.item', cat)}>
                  {editingIdx === idx ? (
                    <>
                      <input
                        className="product-edit-input"
                        value={editValue}
                        autoFocus
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitEdit(idx)
                          if (e.key === 'Escape') setEditingIdx(null)
                        }}
                        onBlur={() => commitEdit(idx)}
                      />
                      <div className="product-item-actions" {...uiId('PD.item-actions')}>
                        <button className="product-icon-btn" onMouseDown={e => e.preventDefault()} onClick={() => commitEdit(idx)} title="저장">
                          <Check size={12} />
                        </button>
                        <button className="product-icon-btn" onMouseDown={e => e.preventDefault()} onClick={() => setEditingIdx(null)} title="취소">
                          <X size={12} />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="product-item-name">{cat}</span>
                      <div className="product-item-actions" {...uiId('PD.item-actions')}>
                        <button className="product-icon-btn" onClick={() => startEdit(idx)} title="수정">
                          <Pencil size={12} />
                        </button>
                        <button className="product-icon-btn product-icon-btn--danger" onClick={() => setConfirmDelete(idx)} title="삭제">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {adding && (
            <div className="product-add-row" {...uiId('PD.add')}>
              <input
                className="product-add-input" {...uiId('PD.add-input')}
                value={newName}
                autoFocus
                placeholder="새 제품명..."
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitAdd()
                  if (e.key === 'Escape') { setAdding(false); setNewName('') }
                }}
              />
              <button className="product-icon-btn" onMouseDown={e => e.preventDefault()} onClick={commitAdd} title="추가">
                <Check size={12} />
              </button>
              <button className="product-icon-btn" onMouseDown={e => e.preventDefault()} onClick={() => { setAdding(false); setNewName('') }} title="취소">
                <X size={12} />
              </button>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {!adding && (
            <button className="product-add-btn" {...uiId('PD.add-btn')} onClick={() => setAdding(true)}>
              <Plus size={12} />
              제품 추가
            </button>
          )}
          <button className="modal-btn modal-btn--cancel" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>
      </Modal>

      {confirmDelete !== null && (
        <Modal
          title="제품 삭제"
          draggable={false}
          showCloseButton={false}
        >
          <div className="confirm-modal-body" {...uiId('PD.confirm')}>
            <p className="confirm-modal-msg">
              <strong>{categories[confirmDelete]}</strong> 을(를) 삭제하시겠습니까?
            </p>
            <p className="confirm-modal-sub">저장된 .json 파일도 함께 삭제됩니다.</p>
          </div>
          <div className="modal-footer">
            <button className="modal-btn modal-btn--cancel" onClick={() => setConfirmDelete(null)}>취소</button>
            <button className="modal-btn modal-btn--danger" onClick={() => handleDelete(confirmDelete)}>삭제</button>
          </div>
        </Modal>
      )}
    </>
  )
}
