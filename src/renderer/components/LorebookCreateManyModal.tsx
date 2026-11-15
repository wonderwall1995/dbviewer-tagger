import { useState } from 'react'
import { Modal } from './Modal'
import { uiId } from '../ui/uiId'

interface CrossFile {
  fileName: string
}

interface Props {
  columnKey: string
  product: string
  crossFiles: CrossFile[]
  onClose: () => void
}

export function LorebookCreateManyModal({ columnKey, product, crossFiles, onClose }: Props) {
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const handleSave = async () => {
    if (!comment.trim()) return
    setSaving(true)
    try {
      for (const { fileName } of crossFiles) {
        const csvName = fileName.replace(/\.csv$/i, '')
        const absPath = await window.electronAPI.lorebookNewPath(product, csvName, columnKey)
        await window.electronAPI.lorebookWrite(absPath, comment.trim())
      }
      setDone(true)
      setTimeout(onClose, 900)
    } catch {
      setSaving(false)
    }
  }

  return (
    <Modal
        uiCode="LM"
      title="Lorebook 항목 생성"

      onClose={onClose}
      cardClassName="lore-many-modal-card"
    >
      <div className="lore-many-body">
        <div className="lore-many-field">
          <span className="lore-many-label">항목 이름</span>
          <span className="lore-many-value lore-many-value--key" {...uiId('LM.value')}>{columnKey}</span>
        </div>
        <div className="lore-many-field">
          <span className="lore-many-label">제품</span>
          <span className="lore-many-value" {...uiId('LM.product')}>{product}</span>
        </div>
        <div className="lore-many-field lore-many-field--col">
          <span className="lore-many-label">주석</span>
          <textarea
            className="lore-many-textarea" {...uiId('LM.text')}
            placeholder={`"${columnKey}" 칼럼의 역할과 의미를 설명하세요`}
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={4}
            autoFocus
          />
        </div>
        <div className="lore-many-targets" {...uiId('LM.targets')}>
          <span className="lore-many-label">생성 대상 ({crossFiles.length}개 파일)</span>
          <ul className="lore-many-file-list">
            {crossFiles.map(({ fileName }) => (
              <li key={fileName} className="lore-many-file-item" {...uiId('LM.target')}>
                {fileName.replace(/\.csv$/i, '')}
              </li>
            ))}
          </ul>
        </div>
        <div className="lore-many-footer" {...uiId('LM.footer')}>
          <button className="lore-many-cancel" onClick={onClose} disabled={saving}>취소</button>
          <button
            className={['lore-many-save', done ? 'lore-many-save--done' : ''].filter(Boolean).join(' ')}
            onClick={handleSave}
            disabled={saving || !comment.trim() || done}
          >
            {done ? '완료' : saving ? `저장 중...` : `${crossFiles.length}개 항목 생성`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
