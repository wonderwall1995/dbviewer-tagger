import { useEffect, useState, type ReactNode } from 'react'
import { isDesktop } from '../api'
import { HelpList, HelpTitle } from '../components/HelpModal'
import { uiId } from '../ui/uiId'

// Web 입장 화면. 도움말(Help!)을 먼저 보여 주고 "들어가기"를 누르면 세션이 생긴다. 데스크톱에서는 아무것도 하지 않는다.
// 쓰는 중에 세션이 끝나면(서버가 401로 답하면) httpApi가 'tagger:need-login'을 알리고, 다시 이 화면을 띄운다.
type GateState = 'checking' | 'login' | 'open'

export function WebGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>(isDesktop ? 'open' : 'checking')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (isDesktop) return
    fetch('/api/session', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((b: { value?: { loggedIn: boolean; open: boolean } }) => setState(b.value?.loggedIn || b.value?.open ? 'open' : 'login'))
      .catch(() => { setState('login'); setError('서버에 연결하지 못했어요.') })
    const onNeedLogin = () => { setState('login'); setError('세션이 끝났어요. 다시 들어와 주세요.') }
    window.addEventListener('tagger:need-login', onNeedLogin)
    return () => window.removeEventListener('tagger:need-login', onNeedLogin)
  }, [])

  const enter = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        credentials: 'same-origin',
      })
      const body = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null
      if (res.ok && body?.ok) {
        setState('open')
      } else {
        setError(body?.error || '입장하지 못했어요.')
      }
    } catch {
      setError('서버에 연결하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  if (state === 'open') return <>{children}</>
  if (state === 'checking') return <div className="web-gate" />

  return (
    <div className="web-gate" {...uiId('WG.frame')}>
      <div className="web-gate-card" {...uiId('WG.card')}>
        <div className="web-gate-title">DBViewer-tagger</div>
        <div className="web-gate-help" {...uiId('WG.help')}>
          <div className="web-gate-help-head"><HelpTitle /></div>
          <HelpList />
        </div>
        {error && <div className="web-gate-error" {...uiId('WG.error')}>{error}</div>}
        <button className="web-gate-btn" type="button" onClick={enter} disabled={busy} {...uiId('WG.enter')}>
          {busy ? '들어가는 중…' : '들어가기'}
        </button>
      </div>
    </div>
  )
}
