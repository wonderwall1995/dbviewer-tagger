import { useRef } from 'react'
import type { MouseEvent } from 'react'

// 배경(오버레이) 클릭으로 모달을 닫는 규칙을 한곳에 모은 훅.
// 마우스를 누른 곳과 뗀 곳이 모두 배경일 때만 닫는다.
// 모달 안에서 드래그를 시작해 배경에서 놓거나, 배경에서 드래그를 시작해 모달 안에서 놓는 경우는 닫지 않는다.
export function useOverlayClose(onClose?: () => void) {
  const pressedOnOverlay = useRef(false)
  const releasedOnOverlay = useRef(false)

  return {
    onMouseDown: (e: MouseEvent<HTMLElement>) => {
      pressedOnOverlay.current = e.target === e.currentTarget
      releasedOnOverlay.current = false
    },
    onMouseUp: (e: MouseEvent<HTMLElement>) => {
      releasedOnOverlay.current = e.target === e.currentTarget
    },
    onClick: (e: MouseEvent<HTMLElement>) => {
      const shouldClose =
        pressedOnOverlay.current && releasedOnOverlay.current && e.target === e.currentTarget
      pressedOnOverlay.current = false
      releasedOnOverlay.current = false
      if (shouldClose) onClose?.()
    },
  }
}
