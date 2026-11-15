import { useState, useRef, useCallback } from 'react'

export function useDraggable() {
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const posRef = useRef({ x: 0, y: 0 })

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()

    const startX = e.clientX - posRef.current.x
    const startY = e.clientY - posRef.current.y

    const onMove = (ev: MouseEvent) => {
      const next = { x: ev.clientX - startX, y: ev.clientY - startY }
      posRef.current = next
      setPos(next)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }

    document.body.style.cursor = 'grabbing'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  return {
    handleProps: { onMouseDown },
    cardStyle: { transform: `translate(${pos.x}px, ${pos.y}px)` } as React.CSSProperties,
  }
}
