import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ScanSearch } from 'lucide-react'
import { toast } from 'sonner'
import { UI_ID_ATTR, UI_INSTANCE_ATTR, uiId } from './uiId'

// Inspector: 화면 요소의 ID를 확인하는 개발 도구.
// 켜면 마우스를 올린 요소의 ID를 보여 주고, 클릭하면 ID를 복사한다.
// 클릭은 화면의 원래 동작을 실행하지 않는다. Esc 키 또는 토글 버튼으로 끈다.

interface Hover {
  id: string | null
  instance: string | null
  path: string[]
  hint: string
  rect: { top: number; left: number; width: number; height: number }
  mouse: { x: number; y: number }
}

const INSPECTOR_SELECTOR = '[data-ui-inspector]'

// 가장 가까운 ID 요소부터 바깥쪽으로 ID 목록을 만든다.
function collectPath(start: Element): string[] {
  const path: string[] = []
  let el: Element | null = start.closest(`[${UI_ID_ATTR}]`)
  while (el) {
    path.push(el.getAttribute(UI_ID_ATTR) as string)
    el = el.parentElement ? el.parentElement.closest(`[${UI_ID_ATTR}]`) : null
  }
  return path
}

// ID가 없는 요소를 알아볼 수 있도록 태그와 첫 클래스 이름을 돌려준다.
function describeElement(el: Element): string {
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : ''
  return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase()
}

function resolveHover(target: Element, x: number, y: number): Hover {
  const owner = target.closest(`[${UI_ID_ATTR}]`)
  const box = (owner ?? target).getBoundingClientRect()
  return {
    id: owner ? owner.getAttribute(UI_ID_ATTR) : null,
    instance: owner ? owner.getAttribute(UI_INSTANCE_ATTR) : null,
    path: collectPath(target).slice(1),
    hint: describeElement(target),
    rect: { top: box.top, left: box.left, width: box.width, height: box.height },
    mouse: { x, y },
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function InspectorOverlay({ onExit }: { onExit: () => void }) {
  const [hover, setHover] = useState<Hover | null>(null)

  const onMove = useCallback((e: MouseEvent) => {
    const target = e.target as Element | null
    if (!target || target.closest(INSPECTOR_SELECTOR)) {
      setHover(null)
      return
    }
    setHover(resolveHover(target, e.clientX, e.clientY))
  }, [])

  const onClick = useCallback((e: MouseEvent) => {
    const target = e.target as Element | null
    if (!target || target.closest(INSPECTOR_SELECTOR)) return
    // 화면의 원래 동작이 실행되지 않도록 이벤트를 여기서 멈춘다.
    e.preventDefault()
    e.stopPropagation()
    const owner = target.closest(`[${UI_ID_ATTR}]`)
    const id = owner ? owner.getAttribute(UI_ID_ATTR) : null
    if (!id) {
      toast(`ID 없음: ${describeElement(target)}`)
      return
    }
    copyText(id).then(ok => {
      if (ok) toast.success(`복사됨: ${id}`)
      else toast.error('클립보드 복사에 실패했습니다')
    })
  }, [])

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      // 모달이 같은 Esc 키로 닫히지 않도록 여기서 멈춘다.
      e.stopPropagation()
      onExit()
    }
  }, [onExit])

  useEffect(() => {
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey, true)
    document.body.classList.add('ui-inspecting')
    return () => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey, true)
      document.body.classList.remove('ui-inspecting')
    }
  }, [onMove, onClick, onKey])

  if (!hover) return null

  const tipLeft = Math.min(hover.mouse.x + 14, window.innerWidth - 300)
  const tipTop = Math.min(hover.mouse.y + 18, window.innerHeight - 110)

  return createPortal(
    <div data-ui-inspector>
      <div
        className={`ui-inspector-box${hover.id ? '' : ' ui-inspector-box--none'}`}
        style={{ top: hover.rect.top, left: hover.rect.left, width: hover.rect.width, height: hover.rect.height }}
      />
      <div className="ui-inspector-tip" style={{ top: tipTop, left: tipLeft }}>
        {hover.id ? (
          <>
            <div className="ui-inspector-tip-id">{hover.id}</div>
            {hover.instance && <div className="ui-inspector-tip-row">항목: {hover.instance}</div>}
            {hover.path.length > 0 && (
              <div className="ui-inspector-tip-row">상위: {hover.path.join(' > ')}</div>
            )}
            <div className="ui-inspector-tip-row ui-inspector-tip-hint">클릭하면 ID를 복사합니다</div>
          </>
        ) : (
          <>
            <div className="ui-inspector-tip-id ui-inspector-tip-id--none">ID 없음</div>
            <div className="ui-inspector-tip-row">{hover.hint}</div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

interface SlotRect {
  top: number
  left: number
  width: number
  height: number
}

// 헤더 안의 빈 자리(slot)의 위치를 재서 위젯을 그 위에 겹쳐 놓는다.
// 위젯은 body에 직접 그려서 모달 배경보다 위에 보인다.
function InspectorDev() {
  const [active, setActive] = useState(false)
  const [slot, setSlot] = useState<SlotRect | null>(null)
  const slotRef = useRef<HTMLSpanElement>(null)
  const exit = useCallback(() => setActive(false), [])

  useLayoutEffect(() => {
    const el = slotRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setSlot(prev =>
        prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height },
      )
    }
    measure()
    // 헤더 제목 너비나 창 크기가 바뀌면 자리가 움직이므로 다시 잰다.
    const observer = new ResizeObserver(measure)
    if (el.parentElement) observer.observe(el.parentElement)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  return (
    <>
      <span ref={slotRef} className="ui-inspector-slot" aria-hidden="true" />
      {slot && createPortal(
        <button
          data-ui-inspector
          className={`ui-inspector-btn ui-inspector-widget${active ? ' ui-inspector-btn--on' : ''}`}
          style={{ top: slot.top, left: slot.left, width: slot.width, height: slot.height }}
          onClick={() => setActive(v => !v)}
          title={active ? 'Inspector 끄기 (Esc)' : 'Inspector 켜기'}
          {...uiId('HD.inspector')}
        >
          <ScanSearch size={13} />
          <span>ID</span>
        </button>,
        document.body,
      )}
      {active && <InspectorOverlay onExit={exit} />}
    </>
  )
}

// 배포 빌드에서는 아무것도 그리지 않는다.
export function Inspector() {
  return import.meta.env.DEV ? <InspectorDev /> : null
}
