import type { ReactNode } from 'react'
import { useOverlayClose } from '../hooks/useOverlayClose'

interface ModalOverlayProps {
  className: string
  onClose?: () => void
  // true이면 배경에서 시작한 mousedown이 부모로 전달되지 않는다.
  stopMouseDown?: boolean
  children: ReactNode
}

// 모달 배경(오버레이)의 공용 틀.
// 마우스를 누른 곳과 뗀 곳이 모두 배경일 때만 onClose를 호출한다.
// 새 모달의 배경은 직접 onClick으로 닫지 말고 이 컴포넌트를 사용한다.
export function ModalOverlay({ className, onClose, stopMouseDown = false, children }: ModalOverlayProps) {
  const overlayClose = useOverlayClose(onClose)

  return (
    <div
      className={className}
      onMouseDown={e => {
        if (stopMouseDown) e.stopPropagation()
        overlayClose.onMouseDown(e)
      }}
      onMouseUp={overlayClose.onMouseUp}
      onClick={overlayClose.onClick}
    >
      {children}
    </div>
  )
}
