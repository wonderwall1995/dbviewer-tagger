import { useEffect } from 'react'
import NProgress from 'nprogress'
import 'nprogress/nprogress.css'
import { uiId } from '../ui/uiId'

interface Props {
  visible: boolean
  message?: string
}

export function LoadingModal({ visible, message = '불러오는 중...' }: Props) {
  useEffect(() => {
    if (visible) {
      NProgress.configure({ showSpinner: false, speed: 400, trickleSpeed: 200 })
      NProgress.start()
    } else {
      NProgress.done()
    }
    return () => { NProgress.done() }
  }, [visible])

  if (!visible) return null

  return (
    <div className="loading-overlay">
      <div className="loading-modal-card" {...uiId('LG.card')}>
        <div className="loading-bar-track" {...uiId('LG.bar')}>
          <div className="loading-bar-fill" />
        </div>
        <span className="loading-message" {...uiId('LG.message')}>{message}</span>
      </div>
    </div>
  )
}
