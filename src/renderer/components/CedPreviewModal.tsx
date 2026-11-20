import { useState } from 'react'
import { Download, FileText } from 'lucide-react'
import { Modal } from './Modal'
import { uiId } from '../ui/uiId'
import { makeZip, downloadBlob } from '../platform/zip'

// Web의 CED 'Local 저장': 만든 문서를 화면에서 보고, zip으로 내려받는다.
// 목차 파일(제품 이름.md)을 맨 위에 둔다.
export function CedPreviewModal({ folder, files, onClose }: {
  folder: string
  files: Array<{ name: string; content: string }>
  onClose: () => void
}) {
  const ordered = [...files].sort((a, b) => {
    const ai = a.name === `${folder}.md` ? 0 : 1
    const bi = b.name === `${folder}.md` ? 0 : 1
    return ai - bi || a.name.localeCompare(b.name, 'ko')
  })
  const [selected, setSelected] = useState(ordered[0]?.name ?? '')
  const current = ordered.find((f) => f.name === selected)

  const download = () => {
    downloadBlob(makeZip(ordered.map((f) => ({ name: `${folder}/${f.name}`, content: f.content }))), `${folder}-CED.zip`)
  }

  return (
    <Modal title={`CED 미리보기 — ${folder}`} uiCode="CP" onClose={onClose} cardClassName="ced-preview-card">
      <div className="ced-preview-body" {...uiId('CP.body')}>
        <ul className="ced-preview-list" {...uiId('CP.list')}>
          {ordered.map((f) => (
            <li key={f.name}>
              <button
                className={`ced-preview-item${f.name === selected ? ' ced-preview-item--on' : ''}`}
                onClick={() => setSelected(f.name)}
                title={f.name}
              >
                <FileText size={12} />
                <span>{f.name.replace(/\.md$/, '')}</span>
              </button>
            </li>
          ))}
        </ul>
        <pre className="ced-preview-text" {...uiId('CP.text')}>{current?.content ?? ''}</pre>
      </div>
      <div className="modal-footer" {...uiId('CP.footer')}>
        <span className="ced-preview-count">문서 {ordered.length}개</span>
        <button className="modal-btn modal-btn--save" onClick={download} {...uiId('CP.download')}>
          <Download size={12} /> zip 내려받기
        </button>
      </div>
    </Modal>
  )
}
