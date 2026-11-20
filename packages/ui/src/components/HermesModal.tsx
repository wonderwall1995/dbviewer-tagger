import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Settings, Plus, Loader2, ChevronRight, ChevronDown, FolderOpen, Eye, Bot } from 'lucide-react'
import { Modal } from './Modal'
import { uiId } from '../ui/uiId'
import { HermesMessageBody } from './HermesMessageBody'
import type { ReadMode } from './HermesMessageBody'
import { api, caps } from '../api'

interface ChatMessage {
  role: string
  content: unknown
}

interface Props {
  onClose: () => void
}

type View = 'sessions' | 'config'

// 화면에서 편집 중인 프로필. keyDraft는 새로 입력했지만 아직 저장하지 않은 API 키이다.
type ProfileDraft = HermesProfileView & { keyDraft: string }

interface ConfigState {
  activeId: string
  logoutOnExit: boolean
  profiles: ProfileDraft[]
}

const MAX_PROFILES = 10
const SAVE_DELAY_MS = 500

function newId(): string {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// 사용 중이 아닌 가장 작은 번호로 "프로필 N" 이름을 만든다.
function nextProfileName(profiles: ProfileDraft[]): string {
  const used = new Set(profiles.map(p => p.name))
  for (let n = 1; n <= MAX_PROFILES + 1; n++) {
    if (!used.has(`프로필 ${n}`)) return `프로필 ${n}`
  }
  return `프로필 ${profiles.length + 1}`
}

function emptyProfile(name: string): ProfileDraft {
  return {
    id: newId(),
    name,
    serverUrl: '',
    hasKey: false,
    needsVerify: false,
    keyDraft: '',
    ssh: { enabled: false, host: '', port: '22', username: '', pemPath: '', alias: '' },
    vaultPath: '',
  }
}

// Hermes 보기 창. 세션 목록과 대화 내용을 보기만 한다. (읽기 전용)
// Web(시연)에서는 Hermes에 연결하지 않는다. 창은 열리지만 입력과 버튼을 모두 막고 안내 문구를 보여 준다.
const DEMO = !caps.hermes
const DEMO_TEXT = '시연을 위한 웹에선 연결을 막고 있습니다.'
const DEMO_PROFILE: ConfigState['profiles'][number] = {
  id: 'demo',
  name: 'Hermes',
  serverUrl: '',
  hasKey: false,
  keyDraft: '',
  ssh: { enabled: false, host: '', port: '22', username: '', pemPath: '', alias: '' },
  vaultPath: '',
  needsVerify: false,
}
// 시연이면 안내 문구, 아니면 원래 안내
const ph = (original: string) => (DEMO ? DEMO_TEXT : original)

export function HermesModal({ onClose }: Props) {
  const [view, setView] = useState<View>('sessions')
  const [cfg, setCfg] = useState<ConfigState | null>(null)
  const cfgRef = useRef<ConfigState | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef(false)

  // 프로필 이름 변경, 우클릭 메뉴, 삭제 확인
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [ctx, setCtx] = useState<{ x: number; y: number; id: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  // 설정 화면
  const [sshOpen, setSshOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  // 볼트 전송 (CED): 볼트 경로 칸, 연결 시험, 구조 보기
  const [vaultOpen, setVaultOpen] = useState(false)
  const [vaultBusy, setVaultBusy] = useState<'test' | 'list' | null>(null)
  const [vaultResult, setVaultResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [vaultTree, setVaultTree] = useState<Array<{ name: string; children: string[] }> | null>(null)

  // 세션과 대화 (읽기 전용)
  const [sessions, setSessions] = useState<HermesSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  // 대화를 읽는 방식: md = 마크다운으로 보기, txt = 받은 글자 그대로 보기
  const [readMode, setReadMode] = useState<ReadMode>('md')
  const loadSeq = useRef(0)
  const profileScrollRef = useRef<HTMLDivElement>(null)

  const updateCfg = useCallback((next: ConfigState) => {
    cfgRef.current = next
    setCfg(next)
  }, [])

  // 대기 중인 변경을 저장한다. 저장한 키는 화면의 입력값에서 지우고 "저장됨" 표시로 바꾼다.
  const flushSave = useCallback(async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    const current = cfgRef.current
    if (!current || !dirtyRef.current) return
    dirtyRef.current = false
    const sentKeys: Record<string, string> = {}
    const payload: HermesConfigInput = {
      activeId: current.activeId,
      logoutOnExit: current.logoutOnExit,
      profiles: current.profiles.map(p => {
        if (p.keyDraft) sentKeys[p.id] = p.keyDraft
        return {
          id: p.id,
          name: p.name,
          serverUrl: p.serverUrl,
          apiKey: p.keyDraft || undefined,
          ssh: p.ssh,
          vaultPath: p.vaultPath,
        }
      }),
    }
    await api.hermesSaveConfig(payload).catch(() => {})
    const latest = cfgRef.current
    if (!latest) return
    updateCfg({
      ...latest,
      profiles: latest.profiles.map(p =>
        sentKeys[p.id] && p.keyDraft === sentKeys[p.id] ? { ...p, keyDraft: '', hasKey: true } : p
      ),
    })
  }, [updateCfg])

  const changeCfg = useCallback((next: ConfigState) => {
    updateCfg(next)
    dirtyRef.current = true
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void flushSave() }, SAVE_DELAY_MS)
  }, [updateCfg, flushSave])

  const activeProfile = cfg?.profiles.find(p => p.id === cfg.activeId) ?? cfg?.profiles[0] ?? null

  const loadSessions = useCallback(async () => {
    const seq = ++loadSeq.current
    setSessionsLoading(true)
    setSessionsError(null)
    setSessions([])
    setActiveSessionId(null)
    setMessages([])
    try {
      await flushSave()
      const res = await api.hermesGetSessions()
      if (seq !== loadSeq.current) return
      setSessions(res?.data ?? [])
    } catch (e) {
      if (seq !== loadSeq.current) return
      setSessionsError(e instanceof Error ? e.message : String(e))
    } finally {
      if (seq === loadSeq.current) setSessionsLoading(false)
    }
  }, [flushSave])

  const selectSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId)
    setMessages([])
    setMessagesLoading(true)
    try {
      const res = await api.hermesGetMessages(sessionId)
      setMessages((res?.data ?? []).map((m: HermesMessage) => ({ role: m.role, content: m.content })))
    } catch (e) {
      setMessages([{ role: 'assistant', content: `대화를 불러오지 못했어요: ${e instanceof Error ? e.message : String(e)}` }])
    } finally {
      setMessagesLoading(false)
    }
  }, [])

  // 처음 열 때 설정을 불러온다. 주소나 키가 없으면 설정 화면으로, 있으면 세션 목록을 불러온다.
  useEffect(() => {
    // Web(시연): 서버에 Hermes 기능이 없다. 부르지 않고 빈 프로필 하나로 설정 화면만 보여 준다. 입력은 모두 막는다.
    if (DEMO) {
      updateCfg({ activeId: 'demo', logoutOnExit: false, profiles: [DEMO_PROFILE] })
      setView('config')
      return
    }
    api.hermesLoadConfig().then(c => {
      const next: ConfigState = {
        activeId: c.activeId,
        logoutOnExit: c.logoutOnExit,
        profiles: c.profiles.map(p => ({ ...p, keyDraft: '' })),
      }
      updateCfg(next)
      const active = next.profiles.find(p => p.id === next.activeId) ?? next.profiles[0]
      setSshOpen(!!active?.ssh.enabled)
      // 주소나 키가 없거나 연결 확인이 필요한 프로필은 설정 화면으로 간다. (연결 확인을 눌러야 세션을 불러온다)
      if (!active?.serverUrl || !active.hasKey || active.needsVerify) setView('config')
      else void loadSessions()
    }).catch(() => setView('config'))
    return () => {
      // 창을 닫을 때 남은 변경을 저장하고, 화면에 있던 세션과 대화 내용은 버린다.
      void flushSave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 선택한 프로필이 줄 밖에 있으면 보이는 위치로 스크롤한다.
  const activeProfileId = cfg?.activeId
  const profileCount = cfg?.profiles.length
  useEffect(() => {
    profileScrollRef.current
      ?.querySelector('.hermes-profile-chip--active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeProfileId, profileCount])

  // 우클릭 메뉴는 다른 곳을 누르거나 Esc를 누르면 닫는다.
  useEffect(() => {
    if (!ctx) return
    const close = () => setCtx(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctx])

  // ── 프로필 ──────────────────────────────────────────────────────────────────

  const activateProfile = (id: string) => {
    if (!cfg || cfg.activeId === id) return
    changeCfg({ ...cfg, activeId: id })
    const target = cfg.profiles.find(p => p.id === id)
    setTestResult(null)
    setSshOpen(!!target?.ssh.enabled)
    if (!target?.serverUrl || !target.hasKey || target.needsVerify) {
      setView('config')
      setSessions([])
      setActiveSessionId(null)
      setMessages([])
      setSessionsError(null)
    } else {
      setView('sessions')
      void loadSessions()
    }
  }

  const addProfile = () => {
    if (!cfg || cfg.profiles.length >= MAX_PROFILES) return
    const profile = emptyProfile(nextProfileName(cfg.profiles))
    changeCfg({ ...cfg, activeId: profile.id, profiles: [...cfg.profiles, profile] })
    setTestResult(null)
    setSshOpen(false)
    setSessions([])
    setActiveSessionId(null)
    setMessages([])
    setSessionsError(null)
    setView('config')
  }

  const commitRename = () => {
    if (!cfg || !renamingId) return
    const name = renameText.trim()
    if (name) {
      changeCfg({ ...cfg, profiles: cfg.profiles.map(p => (p.id === renamingId ? { ...p, name } : p)) })
    }
    setRenamingId(null)
  }

  const confirmDelete = () => {
    if (!cfg || !deleteTarget) return
    let profiles = cfg.profiles.filter(p => p.id !== deleteTarget)
    // 프로필이 하나도 남지 않으면 빈 프로필 1을 새로 만든다.
    if (profiles.length === 0) profiles = [emptyProfile('프로필 1')]
    const activeId = profiles.some(p => p.id === cfg.activeId) ? cfg.activeId : profiles[0].id
    changeCfg({ ...cfg, activeId, profiles })
    setDeleteTarget(null)
    if (activeId !== cfg.activeId) {
      const next = profiles.find(p => p.id === activeId)
      setSessions([])
      setActiveSessionId(null)
      setMessages([])
      setSshOpen(!!next?.ssh.enabled)
      if (!next?.serverUrl || !next.hasKey || next.needsVerify) setView('config')
      else void loadSessions()
    }
  }

  // ── 설정 입력 ───────────────────────────────────────────────────────────────

  const patchActive = (patch: Partial<ProfileDraft>) => {
    if (!cfg || !activeProfile) return
    setTestResult(null)
    changeCfg({
      ...cfg,
      profiles: cfg.profiles.map(p =>
        p.id === activeProfile.id ? { ...p, ...patch, needsVerify: cfg.logoutOnExit ? true : p.needsVerify } : p
      ),
    })
  }

  const patchSsh = (patch: Partial<HermesSshSetting>) => {
    if (!activeProfile) return
    patchActive({ ssh: { ...activeProfile.ssh, ...patch } })
  }

  const handlePickPem = async () => {
    const picked = await api.sshPickPemFile()
    if (picked) patchSsh({ pemPath: picked })
  }

  // 볼트 연결 시험과 구조 보기. 둘 다 저장한 설정으로 접속하므로 먼저 저장한다. 구조 보기는 폴더 이름만 읽는다.
  const handleVaultTest = async () => {
    if (vaultBusy) return
    setVaultBusy('test'); setVaultResult(null)
    try {
      await flushSave()
      setVaultResult(await api.hermesVaultTest())
    } finally { setVaultBusy(null) }
  }

  const handleVaultList = async () => {
    if (vaultBusy) return
    setVaultBusy('list'); setVaultResult(null); setVaultTree(null)
    try {
      await flushSave()
      const res = await api.hermesVaultList()
      if (res.ok) setVaultTree(res.tree)
      else setVaultResult({ ok: false, message: res.message })
    } finally { setVaultBusy(null) }
  }

  const handleTest = async () => {
    if (testing) return
    setTesting(true)
    setTestResult(null)
    try {
      await flushSave()
      const res = await api.hermesTestConnection()
      if (res.ok) {
        setTestResult({ ok: true, message: '연결에 성공했어요.' })
        // 이번 실행에서 연결 확인을 마친 프로필로 표시한다.
        const latest = cfgRef.current
        if (latest) {
          updateCfg({ ...latest, profiles: latest.profiles.map(p => (p.id === latest.activeId ? { ...p, needsVerify: false } : p)) })
        }
        setView('sessions')
        void loadSessions()
      } else {
        setTestResult({ ok: false, message: res.message })
      }
    } finally {
      setTesting(false)
    }
  }

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null

  return (
    <Modal
      uiCode="HM"
      title={
        <span className="hermes-modal-title">
          <Bot size={16} className="hermes-modal-icon" />
          Hermes Agent
          <span className="hermes-readonly-badge" {...uiId('HM.readonly')}>
            <Eye size={10} /> 보기 전용
          </span>
        </span>
      }
      onClose={onClose}
      cardClassName="hermes-modal-card"
      floating
      leftSlot={
        <button
          className={['hermes-tab-btn', view === 'config' ? 'hermes-tab-btn--active' : ''].filter(Boolean).join(' ')}
          onClick={() => setView(v => (v === 'config' ? 'sessions' : 'config'))}
          title="연결 설정"
        >
          <Settings size={13} />
        </button>
      }
    >
      {/* 시연(Web): 아래 모든 입력과 버튼을 막는다 (fieldset disabled는 안의 input, button을 한 번에 막는다) */}
      <fieldset className="hermes-demo-fieldset" disabled={DEMO} {...uiId('HM.demo')}>
      {/* 프로필 줄: 누르면 선택, 우클릭하면 이름 변경과 삭제 */}
      <div className="hermes-profile-bar" {...uiId('HM.profiles')}>
        {/* 프로필이 넘치면 이 안에서 가로로 스크롤한다. 스크롤바는 숨기고 마우스 휠로 넘긴다. */}
        <div
          className="hermes-profile-scroll" ref={profileScrollRef}
          onWheel={e => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
          }}
        >
        {cfg?.profiles.map(p => (
          <div key={p.id} className="hermes-profile-slot">
            {renamingId === p.id ? (
              <input
                className="hermes-profile-rename" {...uiId('HM.profile-rename')}
                autoFocus
                value={renameText}
                onChange={e => setRenameText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setRenamingId(null)
                }}
                onBlur={commitRename}
              />
            ) : (
              <button
                className={['hermes-profile-chip', cfg.activeId === p.id ? 'hermes-profile-chip--active' : ''].filter(Boolean).join(' ')}
                {...uiId('HM.profile', p.name)}
                onClick={() => activateProfile(p.id)}
                onContextMenu={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  setCtx({ x: e.clientX, y: e.clientY, id: p.id })
                }}
                title="클릭: 선택 / 우클릭: 이름 변경, 삭제"
              >
                {p.name}
              </button>
            )}
          </div>
        ))}
        </div>
        {cfg && cfg.profiles.length < MAX_PROFILES && (
          <button className="hermes-profile-add" {...uiId('HM.profile-add')} onClick={addProfile} title="프로필 추가">
            <Plus size={12} />
          </button>
        )}
      </div>

      {deleteTarget && cfg && (
        <div className="hermes-delete-bar" {...uiId('HM.profile-delete-confirm')}>
          <span>
            프로필 <strong>{cfg.profiles.find(p => p.id === deleteTarget)?.name}</strong>을 삭제할까요? 저장된 API 키도 함께 지워져요.
          </span>
          <button className="hermes-delete-btn" onClick={confirmDelete}>삭제</button>
          <button className="hermes-delete-cancel" onClick={() => setDeleteTarget(null)}>취소</button>
        </div>
      )}

      <div className="hermes-body">
        {/* 좌측: 세션 목록 (보기만) */}
        <div className="hermes-sidebar" {...uiId('HM.sessions')}>
          <div className="hermes-view-tabs" {...uiId('HM.view-tabs')}>
            <button
              className={`hermes-view-tab${readMode === 'md' ? ' hermes-view-tab--on' : ''}`}
              onClick={() => setReadMode('md')}
              title="마크다운으로 보기"
            >MD</button>
            <button
              className={`hermes-view-tab${readMode === 'txt' ? ' hermes-view-tab--on' : ''}`}
              onClick={() => setReadMode('txt')}
              title="받은 글자 그대로 보기"
            >TXT</button>
          </div>
          <ul className="hermes-session-list">
            {sessions.map(s => (
              <li
                key={s.id}
                className={['hermes-session-item', activeSessionId === s.id ? 'hermes-session-item--active' : ''].filter(Boolean).join(' ')}
                onClick={() => { setView('sessions'); void selectSession(s.id) }}
              >
                <span className="hermes-session-title" {...uiId('HM.session', s.title || '대화')}>{s.title || '대화'}</span>
              </li>
            ))}
            {sessionsLoading && (
              <li className="hermes-session-empty"><Loader2 size={12} className="spin" /> 불러오는 중...</li>
            )}
            {!sessionsLoading && sessionsError && (
              <li className="hermes-session-empty hermes-session-empty--error">
                {sessionsError}
                <button className="hermes-retry-btn" onClick={() => void loadSessions()}>다시 시도</button>
              </li>
            )}
            {!sessionsLoading && !sessionsError && sessions.length === 0 && (
              <li className="hermes-session-empty">
                {activeProfile?.needsVerify ? '연결 확인이 필요해요' : '세션 없음'}
              </li>
            )}
          </ul>
        </div>

        {/* 우측: 대화 내용 또는 연결 설정 */}
        <div className="hermes-main" {...uiId('HM.main')}>
          {view === 'config' && activeProfile ? (
            <div className="hermes-config" {...uiId('HM.config')}>
              <h3 className="hermes-config-title">{activeProfile.name} 연결 설정</h3>
              {DEMO && <p className="hermes-note hermes-note--warn" {...uiId('HM.demo-note')}>{DEMO_TEXT}</p>}

              <label className="hermes-config-label">서버 주소</label>
              <input
                className="hermes-config-input" {...uiId('HM.config-url')}
                value={activeProfile.serverUrl}
                onChange={e => patchActive({ serverUrl: e.target.value })}
                placeholder={ph('http://127.0.0.1:8642')}
              />

              <label className="hermes-config-label">
                API 키{activeProfile.hasKey && <span className="hermes-config-hint"> (저장됨 — 바꿀 때만 입력)</span>}
              </label>
              <input
                className="hermes-config-input" {...uiId('HM.config-key')}
                type="password"
                autoComplete="off"
                value={activeProfile.keyDraft}
                onChange={e => patchActive({ keyDraft: e.target.value })}
                placeholder={ph(activeProfile.hasKey ? '••••••••' : 'Bearer 키 입력')}
              />

              {/* SSH 터널: 선택 사항이라 접어 둔다 */}
              <button
                className="hermes-accordion-head" {...uiId('HM.ssh-toggle')}
                onClick={() => setSshOpen(o => !o)}
              >
                {sshOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span>SSH 터널 (선택)</span>
                {activeProfile.ssh.enabled && <span className="hermes-accordion-on">사용 중</span>}
              </button>
              {sshOpen && (
                <div className="hermes-accordion-body" {...uiId('HM.ssh')}>
                  <label className="hermes-check">
                    <input
                      type="checkbox"
                      checked={activeProfile.ssh.enabled}
                      onChange={e => patchSsh({ enabled: e.target.checked })}
                    />
                    <span>SSH 터널로 연결하기</span>
                  </label>
                  <p className="hermes-note">
                    서버 주소는 SSH로 접속한 PC 기준의 주소로 적어요. (예: http://127.0.0.1:8642)
                  </p>
                  <label className="hermes-config-label">SSH 별칭 (선택)</label>
                  <input
                    className="hermes-config-input" {...uiId('HM.ssh-alias')}
                    value={activeProfile.ssh.alias}
                    onChange={e => patchSsh({ alias: e.target.value.replace(/\s/g, '') })}
                    placeholder={ph('~/.ssh/config의 Host 이름 (예: hermes)')}
                  />
                  <p className="hermes-note">
                    별칭을 적으면 아래 호스트, 사용자, 키 칸은 쓰지 않고, 이 PC의 ssh 설정을 그대로 따라요. 키 암호는 물을 수 없어서 암호 없는 키나 ssh-agent가 필요해요. 이 PC에 OpenSSH 클라이언트(ssh)가 있어야 해요.
                  </p>
                  <div className="hermes-ssh-row">
                    <div className="hermes-ssh-field hermes-ssh-field--grow">
                      <label className="hermes-config-label">SSH 호스트</label>
                      <input className="hermes-config-input" value={activeProfile.ssh.host} onChange={e => patchSsh({ host: e.target.value })} />
                    </div>
                    <div className="hermes-ssh-field hermes-ssh-field--port">
                      <label className="hermes-config-label">포트</label>
                      <input
                        className="hermes-config-input"
                        value={activeProfile.ssh.port}
                        placeholder="22"
                        onChange={e => patchSsh({ port: e.target.value.replace(/[^0-9]/g, '') })}
                      />
                    </div>
                  </div>
                  <label className="hermes-config-label">사용자 이름</label>
                  <input className="hermes-config-input" value={activeProfile.ssh.username} onChange={e => patchSsh({ username: e.target.value })} />
                  <label className="hermes-config-label">키 경로</label>
                  <div className="hermes-pem-row">
                    <span className="hermes-pem-path" title={activeProfile.ssh.pemPath}>
                      {activeProfile.ssh.pemPath || '등록된 키가 없어요'}
                    </span>
                    <button className="hermes-pem-btn" onClick={handlePickPem} title="키 파일 선택">
                      <FolderOpen size={13} />
                    </button>
                  </div>
                </div>
              )}

              {/* 볼트 전송 (CED): 선택 사항이라 접어 둔다. 맥락 문서를 이 서버의 Obsidian 볼트로 보낼 때 쓴다. */}
              <button
                className="hermes-accordion-head" {...uiId('HM.vault-toggle')}
                onClick={() => setVaultOpen(o => !o)}
              >
                {vaultOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span>볼트 전송 (CED)</span>
                {activeProfile.vaultPath && <span className="hermes-accordion-on">설정됨</span>}
              </button>
              {vaultOpen && (
                <div className="hermes-accordion-body" {...uiId('HM.vault')}>
                  <label className="hermes-config-label">볼트 경로</label>
                  <input
                    className="hermes-config-input" {...uiId('HM.vault-path')}
                    value={activeProfile.vaultPath}
                    onChange={e => { patchActive({ vaultPath: e.target.value }); setVaultResult(null); setVaultTree(null) }}
                    placeholder={ph('/home/사용자/문서/Obsidian Vault')}
                  />
                  <p className="hermes-note">
                    SSH로 접속한 PC의 Obsidian 볼트 절대 경로예요. 문서는 이 안의 CED/제품 폴더에만 써요. SSH 터널 설정(호스트, 사용자, 키)을 같이 써요.
                  </p>
                  <div className="hermes-config-actions">
                    <button
                      className="hermes-config-save" {...uiId('HM.vault-test')}
                      onClick={handleVaultTest}
                      disabled={!!vaultBusy || !activeProfile.vaultPath.trim()}
                    >
                      {vaultBusy === 'test' ? <Loader2 size={13} className="spin" /> : '볼트 연결 시험'}
                    </button>
                    <button
                      className="hermes-config-save" {...uiId('HM.vault-list')}
                      onClick={handleVaultList}
                      disabled={!!vaultBusy || !activeProfile.vaultPath.trim()}
                      title="볼트의 폴더 이름만 보여 줘요. 노트 이름과 내용은 읽지 않아요"
                    >
                      {vaultBusy === 'list' ? <Loader2 size={13} className="spin" /> : '구조 보기'}
                    </button>
                    {vaultResult && (
                      <span className={vaultResult.ok ? 'hermes-test-ok' : 'hermes-test-fail'} {...uiId('HM.vault-result')}>
                        {vaultResult.message}
                      </span>
                    )}
                  </div>
                  {vaultTree && (
                    <ul className="hermes-vault-tree" {...uiId('HM.vault-tree')}>
                      {vaultTree.length === 0 && <li>폴더가 없어요</li>}
                      {vaultTree.map(d => (
                        <li key={d.name}>
                          {d.name}/
                          {d.children.length > 0 && (
                            <ul>{d.children.map(c => <li key={c}>{c}/</li>)}</ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="hermes-config-actions">
                <button
                  className="hermes-config-save" {...uiId('HM.config-test')}
                  onClick={handleTest}
                  disabled={testing || !activeProfile.serverUrl.trim() || (!activeProfile.hasKey && !activeProfile.keyDraft)}
                >
                  {testing ? <Loader2 size={13} className="spin" /> : '연결 확인'}
                </button>
                {testResult && (
                  <span className={testResult.ok ? 'hermes-test-ok' : 'hermes-test-fail'} {...uiId('HM.config-result')}>
                    {testResult.message}
                  </span>
                )}
              </div>
              {cfg?.logoutOnExit && activeProfile.needsVerify && activeProfile.serverUrl && (activeProfile.hasKey || activeProfile.keyDraft) && (
                <p className="hermes-note hermes-note--warn" {...uiId('HM.verify-needed')}>
                  로그아웃 상태예요. 위의 "연결 확인"을 누르면 이 프로필로 연결돼요.
                </p>
              )}
              <p className="hermes-note">설정은 이 PC에만 암호화해서 저장해요. 입력하면 자동으로 저장돼요.</p>

              {/* 개인정보 보호: 켜면 앱을 켤 때마다 연결 확인이 필요하다. 저장한 값은 지우지 않는다. */}
              <label className="hermes-check hermes-check--logout" {...uiId('HM.logout')}>
                <input
                  type="checkbox"
                  checked={!!cfg?.logoutOnExit}
                  onChange={e => {
                    if (!cfg) return
                    changeCfg({ ...cfg, logoutOnExit: e.target.checked })
                    // 켜고 끄면 어떤 프로필이 연결 확인이 필요한지가 바뀐다. 저장한 뒤 메인의 기준으로 다시 맞춘다.
                    void flushSave().then(() => api.hermesLoadConfig()).then(c => {
                      const latest = cfgRef.current
                      if (!latest) return
                      const flags = new Map(c.profiles.map(p => [p.id, p.needsVerify]))
                      updateCfg({ ...latest, profiles: latest.profiles.map(p => ({ ...p, needsVerify: flags.get(p.id) ?? p.needsVerify })) })
                    }).catch(() => {})
                  }}
                />
                <span>앱을 끄면 로그아웃 (다시 켜면 "연결 확인"을 눌러야 연결돼요. 저장한 값은 지우지 않아요)</span>
              </label>
            </div>
          ) : (
            <div className="hermes-messages" {...uiId('HM.messages')}>
              {!activeSession && !messagesLoading && (
                <div className="hermes-messages-empty">
                  {sessions.length > 0 ? '왼쪽에서 세션을 골라 대화를 보세요' : '볼 세션이 없어요'}
                </div>
              )}
              {messagesLoading && (
                <div className="hermes-messages-empty"><Loader2 size={14} className="spin" /> 불러오는 중...</div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`hermes-msg hermes-msg--${m.role}`} {...uiId('HM.message')}>
                  {m.role === 'assistant' && <Bot size={20} className="hermes-msg-avatar" />}
                  <div className="hermes-msg-bubble"><HermesMessageBody role={m.role} content={m.content} mode={readMode} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </fieldset>

      {/* 프로필 우클릭 메뉴. 창이 드래그로 움직여도 위치가 어긋나지 않게 body에 그린다. */}
      {ctx && createPortal(
        <div
          className="hermes-ctx" {...uiId('HM.profile-menu')}
          style={{ left: ctx.x, top: ctx.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            className="hermes-ctx-item"
            onClick={() => {
              const target = cfg?.profiles.find(p => p.id === ctx.id)
              setRenamingId(ctx.id)
              setRenameText(target?.name ?? '')
              setCtx(null)
            }}
          >
            이름 변경
          </button>
          <button
            className="hermes-ctx-item hermes-ctx-item--danger"
            onClick={() => { setDeleteTarget(ctx.id); setCtx(null) }}
          >
            삭제
          </button>
        </div>,
        document.body
      )}
    </Modal>
  )
}
