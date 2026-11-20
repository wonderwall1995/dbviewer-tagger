import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Modal } from './Modal'
import { uiId } from '../ui/uiId'

// Web의 "견본 재생성" 확인 창. 확인하면 지금 세션을 지우고 견본의 새 복사본으로 다시 시작한 뒤 화면을 새로 불러온다.
export function ResetSampleModal({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reset = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/reset', { method: 'POST', credentials: 'same-origin' })
      const body = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null
      if (!res.ok || !body?.ok) throw new Error(body?.error || '다시 시작하지 못했어요.')
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={<span className="reset-title"><RotateCcw size={14} /> 견본 재생성</span>}
      uiCode="RS"
      onClose={onClose}
      cardClassName="reset-modal-card"
      draggable={false}
    >
      <div className="reset-body" {...uiId('RS.body')}>
        <p>지금까지의 작업(열어 둔 CSV, 핀, Key 노트, 저장한 프리셋과 백업)을 모두 지우고, 처음 들어왔을 때의 견본 데이터로 다시 시작합니다.</p>
        <p>남기고 싶은 결과가 있으면 먼저 Key 노트 창의 <b>Local 저장</b>에서 zip으로 내려받아 두세요.</p>
        {error && <p className="reset-error" {...uiId('RS.error')}>{error}</p>}
      </div>
      <div className="modal-footer" {...uiId('RS.footer')}>
        <button className="modal-btn modal-btn--cancel" onClick={onClose} disabled={busy}>취소</button>
        <button className="modal-btn modal-btn--danger reset-confirm" onClick={reset} disabled={busy} {...uiId('RS.confirm')}>
          {busy ? '다시 시작하는 중…' : '지우고 다시 시작'}
        </button>
      </div>
    </Modal>
  )
}
