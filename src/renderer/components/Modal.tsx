import type { ReactNode } from 'react'
import { useDraggable } from '../hooks/useDraggable'
import { ModalOverlay } from './ModalOverlay'
import { uiId } from '../ui/uiId'

interface ModalProps {
  title: ReactNode
  children: ReactNode
  onClose?: () => void
  cardClassName?: string
  overlayClassName?: string
  icon?: ReactNode
  leftSlot?: ReactNode
  leftPanel?: ReactNode
  draggable?: boolean
  showCloseButton?: boolean
  stopOverlayMouseDown?: boolean
  floating?: boolean
  // 영역 코드 (예: 'KI'). 지정하면 {코드}.frame, {코드}.title, {코드}.close ID를 붙인다.
  uiCode?: string
}

export function Modal({
  title,
  children,
  onClose,
  cardClassName = '',
  overlayClassName = '',
  icon,
  leftSlot,
  leftPanel,
  draggable = true,
  showCloseButton = true,
  stopOverlayMouseDown = false,
  floating = false,
  uiCode,
}: ModalProps) {
  const { handleProps, cardStyle } = useDraggable()

  const cardRow = (
    <div
      className="modal-card-row"
      style={draggable ? cardStyle : undefined}
      onClick={e => e.stopPropagation()}
    >
      {leftPanel}
      <div className={['modal-card', cardClassName].filter(Boolean).join(' ')} {...(uiCode ? uiId(`${uiCode}.frame`) : {})}>
        <div
          className="modal-header"
          data-draggable={draggable ? '' : undefined}
          {...(draggable ? handleProps : {})}
        >
          {leftSlot}
          {icon}
          <span className="modal-title" {...(uiCode ? uiId(`${uiCode}.title`) : {})}>{title}</span>
          {showCloseButton && onClose && (
            <button className="modal-close-btn" onClick={onClose} {...(uiCode ? uiId(`${uiCode}.close`) : {})}>✕</button>
          )}
        </div>
        {children}
      </div>
    </div>
  )

  if (floating) {
    return (
      <div className="modal-floating-wrapper">
        {cardRow}
      </div>
    )
  }

  return (
    <ModalOverlay
      className={['modal-overlay', overlayClassName].filter(Boolean).join(' ')}
      onClose={onClose}
      stopMouseDown={stopOverlayMouseDown}
    >
      {cardRow}
    </ModalOverlay>
  )
}
