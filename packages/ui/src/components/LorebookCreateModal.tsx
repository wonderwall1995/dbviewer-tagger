import { useState, useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { CategoryDropdown } from './CategoryDropdown'
import { Modal } from './Modal'
import { uiId } from '../ui/uiId'
import { api } from '../api'

interface Props {
  csvName: string
  colKey: string
  colLabel: string
  initialProduct?: string
  onClose: () => void
  onCreated: (csvName: string, colKey: string, product: string) => void
  categories: string[]
  onCategoriesChange: (cats: string[]) => void
}

export function LorebookCreateModal({
  csvName,
  colKey,
  colLabel,
  initialProduct = '',
  onClose,
  onCreated,
  categories,
  onCategoriesChange,
}: Props) {
  const [product, setProduct] = useState(() => {
    if (initialProduct && categories.includes(initialProduct)) return initialProduct
    if (categories.length === 1) return categories[0]
    return ''
  })
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [])

  const handleSave = async () => {
    if (!product) { setError('제품을 선택해주세요.'); return }
    setSaving(true)
    setError(null)
    try {
      const targetPath = await api.lorebookNewPath(product, csvName, colLabel)
      const data = {
        csvFile: csvName,
        column: colKey,
        columnLabel: colLabel,
        product,
        comment,
      }
      await api.lorebookWrite(targetPath, JSON.stringify(data, null, 2))
      onCreated(csvName, colKey, product)
      onClose()
    } catch {
      setError('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
        uiCode="LN"
      title="Lorebook 색인"

      onClose={onClose}
      cardClassName="lb-create-card"
      overlayClassName="lb-create-overlay"
      stopOverlayMouseDown
    >
      <div className="lb-body">
        {error && <div className="lb-error">{error}</div>}

        <div className="lb-create-context" {...uiId('LN.context')}>
          <span className="lb-ctx-badge lb-ctx-csv" title={csvName}>{csvName}</span>
          <span className="lb-ctx-sep">›</span>
          <span className="lb-ctx-badge lb-ctx-col">{colLabel}</span>
        </div>

        <div className="lb-edit-form" {...uiId('LN.form')}>
          <div className="lb-field">
            <label className="lb-label">항목 이름</label>
            <input
              className="lb-input lb-input--readonly" {...uiId('LN.name')}
              value={`${csvName.replace(/\.csv$/i, '')}_${colLabel}`}
              readOnly
              tabIndex={-1}
            />
          </div>
          <div className="lb-field">
            <label className="lb-label">제품명</label>
            <CategoryDropdown
              uiIdValue="LN.product"
              value={product}
              onChange={setProduct}
              categories={categories}
              onCategoriesChange={onCategoriesChange}
            />
          </div>
          <div className="lb-field lb-field--grow">
            <label className="lb-label">
              주석
              <span className="lb-label-hint">칼럼 헤더 아래 표시됩니다</span>
            </label>
            <textarea
              ref={textareaRef}
              className="lb-textarea" {...uiId('LN.content')}
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="이 칼럼이 나타내는 값에 대해 설명해주세요..."
            />
          </div>
        </div>
      </div>

      <div className="modal-footer" {...uiId('LN.footer')}>
        <button className="modal-btn modal-btn--cancel" onClick={onClose}>취소</button>
        <button className="modal-btn modal-btn--primary" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 size={13} className="spin" /> : '색인'}
        </button>
      </div>
    </Modal>
  )
}
