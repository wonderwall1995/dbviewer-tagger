import { useState } from 'react'
import { Modal } from './Modal'
import { uiId } from '../ui/uiId'
import { api, demoBlocked } from '../api'

interface Props {
  onClose: () => void
}

export function ClearModal({ onClose }: Props) {
  const [clearing, setClearing] = useState(false)
  const [done, setDone] = useState(false)

  const handleClearTmp = async () => {
    if (clearing || done) return
    // Web(시연): 창은 그대로 두고 삭제만 막는다.
    if (demoBlocked()) return
    setClearing(true)
    try {
      await api.localClearTmp()
      setDone(true)
      setTimeout(onClose, 900)
    } catch {
      setClearing(false)
    }
  }

  return (
    <Modal
        uiCode="CL"
      title={<>Clear<span className="clear-modal-subtitle">— 캐시를 삭제합니다.</span></>}

      onClose={onClose}
      cardClassName="clear-modal-card"
    >
      <div className="clear-modal-body" {...uiId('CL.body')}>
        <button
          className="clear-submit-btn" {...uiId('CL.submit')}
          onClick={handleClearTmp}
          disabled={clearing || done}
          title="csv에 대한 캐시를 삭제합니다."
        >
          {done ? '완료' : clearing ? '삭제 중…' : '캐시 및 임시 폴더 삭제'}
        </button>
      </div>
    </Modal>
  )
}
