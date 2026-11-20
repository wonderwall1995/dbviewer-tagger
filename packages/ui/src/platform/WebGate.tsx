import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { isDesktop } from '../api'
import { uiId } from '../ui/uiId'

// Web 입장 화면. 공용 입장 코드를 넣어야 앱이 열린다. 데스크톱에서는 아무것도 하지 않는다.
// 쓰는 중에 세션이 끝나면(서버가 401로 답하면) httpApi가 'tagger:need-login'을 알리고, 다시 이 화면을 띄운다.
type GateState = 'checking' | 'login' | 'open'

export function WebGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>(isDesktop ? 'open' : 'checking')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (isDesktop) return
    fetch('/api/session', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((b: { value?: { loggedIn: boolean; open: boolean } }) => setState(b.value?.loggedIn || b.value?.open ? 'open' : 'login'))
      .catch(() => { setState('login'); setError('서버에 연결하지 못했어요.') })
    const onNeedLogin = () => { setState('login'); setError('세션이 끝났어요. 입장 코드를 다시 넣어 주세요.') }
    window.addEventListener('tagger:need-login', onNeedLogin)
    return () => window.removeEventListener('tagger:need-login', onNeedLogin)
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || code.trim() === '') return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const body = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null
      if (res.ok && body?.ok) {
        setCode('')
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
      <form className="web-gate-card" onSubmit={submit} {...uiId('WG.card')}>
        <div className="web-gate-title">DBViewer-tagger</div>
        <ul className="web-gate-notice" {...uiId('WG.notice')}>
          <li>시연을 위해 배포된 웹입니다. 웹 안에는 자신의 주요 정보를 남기지 않으시는 게 좋습니다.</li>
          <li>Key 노트 창엔 Hermes - Obsidian 환경 전송 버튼을 가렸습니다.</li>
          <li>DB는 실제 연결하지 않으시는 것을 권합니다. 준비된 CSV 파일이 약소하게 있습니다.</li>
          <li>입장 코드는 배포자의 이력서에 있습니다.</li>
        </ul>
        <input
          className="web-gate-input" {...uiId('WG.code')}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="XXXX-XXXX-XXXX"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
        />
        {error && <div className="web-gate-error" {...uiId('WG.error')}>{error}</div>}
        <button className="web-gate-btn" type="submit" disabled={busy || code.trim() === ''} {...uiId('WG.enter')}>
          {busy ? '확인 중…' : '들어가기'}
        </button>
      </form>
    </div>
  )
}
