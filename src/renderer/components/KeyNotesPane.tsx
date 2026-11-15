import { useState, useEffect, useRef, useCallback } from 'react'
import { Check, X, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { uiId } from '../ui/uiId'

interface Props {
  // null이면 제품 미지정
  product: string | null
  onProgress?: (confirmed: number, total: number) => void
}

const KIND_LABEL: Record<KeyCandidate['kind'], string> = { fk: 'FK', ref: '추정', name: '이름' }
const memberText = (m: KeyNoteMember) => `${m.fileName.replace(/\.csv$/i, '')}.${m.columnKey}`

export function KeyNotesPane({ product, onProgress }: Props) {
  const [notes, setNotes] = useState<KeyNote[]>([])
  const [candidates, setCandidates] = useState<KeyCandidate[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [keywordDraft, setKeywordDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  // 저장하지 않은 편집. 제품이 바뀌어도 원래 제품에 저장하도록 제품 이름과 함께 담는다.
  const pendingRef = useRef<{ product: string | null; notes: KeyNote[] } | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notesRef = useRef<KeyNote[]>([])
  const productRef = useRef(product)
  productRef.current = product
  notesRef.current = notes

  const reload = useCallback(async () => {
    const [n, c] = await Promise.all([
      window.electronAPI.keynoteList(product),
      window.electronAPI.keynoteCandidates(product),
    ])
    setNotes(n)
    setCandidates(c)
    return n
  }, [product])

  const flush = useCallback(async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    await window.electronAPI.keynoteSave(pending.product, pending.notes)
  }, [])

  // 제품이 바뀌면 저장하지 않은 편집을 먼저 저장하고 다시 읽는다.
  useEffect(() => {
    setSelectedId(null)
    setNotes([])
    setCandidates([])
    reload()
    return () => { void flush() }
  }, [product, reload, flush])

  useEffect(() => {
    onProgress?.(notes.filter(n => n.status === 'confirmed').length, notes.length)
  }, [notes, onProgress])

  const selected = notes.find(n => n.id === selectedId) ?? null

  const edit = (patch: Partial<KeyNote>) => {
    if (!selected) return
    const next = notesRef.current.map(n => (n.id === selected.id ? { ...n, ...patch } : n))
    notesRef.current = next
    setNotes(next)
    pendingRef.current = { product: productRef.current, notes: next }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void flush() }, 600)
  }

  const accept = async (c: KeyCandidate) => {
    await flush()
    const note = await window.electronAPI.keynoteAcceptCandidate(product, c.signature)
    if (!note) { toast.warning('이미 노트에 들어간 후보예요.') }
    await reload()
    if (note) { setSelectedId(note.id); setConfirmDelete(false) }
  }

  const reject = async (c: KeyCandidate) => {
    await flush()
    await window.electronAPI.keynoteRejectCandidate(product, c.signature)
    setCandidates(prev => prev.filter(x => x.signature !== c.signature))
  }

  const removeNote = async () => {
    if (!selected) return
    const rest = notes.filter(n => n.id !== selected.id)
    setNotes(rest)
    setSelectedId(null)
    setConfirmDelete(false)
    pendingRef.current = null
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    await window.electronAPI.keynoteSave(product, rest)
    setCandidates(await window.electronAPI.keynoteCandidates(product))
  }

  const removeMember = (m: KeyNoteMember) => {
    if (!selected || selected.members.length <= 1) return
    edit({ members: selected.members.filter(x => !(x.fileName === m.fileName && x.columnKey === m.columnKey)) })
    // 빠진 컬럼은 저장 뒤 후보로 돌아온다.
    setTimeout(async () => { await flush(); setCandidates(await window.electronAPI.keynoteCandidates(product)) }, 700)
  }

  const addKeyword = () => {
    const k = keywordDraft.trim()
    if (!selected || !k) return
    if (!selected.keywords.includes(k)) edit({ keywords: [...selected.keywords, k] })
    setKeywordDraft('')
  }

  const confirmed = notes.filter(n => n.status === 'confirmed').length

  return (
    <div className="kn-pane" {...uiId('KI.notes')}>
      <div className="kn-left">
        <div className="kn-section-title" {...uiId('KI.candidates-head')}>후보 <span className="kn-count">{candidates.length}</span></div>
        <div className="kn-candidates" {...uiId('KI.candidates')}>
          {candidates.length === 0 && <div className="kn-empty">제안할 후보가 없습니다. 핀 보기에서 색인을 먼저 실행하세요.</div>}
          {candidates.map(c => (
            <div key={c.signature} className="kn-cand" title={`${c.reason}\n${c.members.map(memberText).join('\n')}`} {...uiId('KI.candidate', c.title)}>
              <span className={`kn-badge kn-badge--${c.kind}`}>{KIND_LABEL[c.kind]}</span>
              <span className="kn-cand-title">{c.title}</span>
              <span className="kn-cand-count">{c.members.length}개</span>
              <button className="kn-icon-btn kn-icon-btn--ok" onClick={() => accept(c)} title="수락해서 초안 노트로 만들기"><Check size={12} /></button>
              <button className="kn-icon-btn" onClick={() => reject(c)} title="거절 (다시 보이지 않음)"><X size={12} /></button>
            </div>
          ))}
        </div>

        <div className="kn-section-title" {...uiId('KI.notelist-head')}>
          노트 <span className="kn-count">{notes.length}</span>
          <span className="kn-progress" {...uiId('KI.progress')}>Key {notes.length}개 중 {confirmed}개 확인됨</span>
        </div>
        <div className="kn-notes" {...uiId('KI.notelist')}>
          {notes.length === 0 && <div className="kn-empty">수락한 노트가 여기에 나옵니다.</div>}
          {notes.map(n => (
            <button
              key={n.id}
              className={`kn-note${n.id === selectedId ? ' kn-note--active' : ''}`}
              onClick={() => { void flush(); setSelectedId(n.id); setConfirmDelete(false) }}
              {...uiId('KI.note', n.title)}
            >
              <span className={`kn-status kn-status--${n.status}`}>{n.status === 'confirmed' ? '확인' : '초안'}</span>
              <span className="kn-cand-title">{n.title || '(제목 없음)'}</span>
              <span className="kn-cand-count">{n.members.length}개</span>
            </button>
          ))}
        </div>
      </div>

      <div className="kn-right" {...uiId('KI.note-editor')}>
        {!selected ? (
          <div className="kn-empty kn-empty--center">왼쪽에서 후보를 수락하거나 노트를 고르세요.</div>
        ) : (
          <>
            <label className="kn-field">
              <span>제목</span>
              <input className="kn-input" value={selected.title} onChange={e => edit({ title: e.target.value })} />
            </label>
            <label className="kn-field">
              <span>한 줄 정의</span>
              <input className="kn-input" value={selected.definition} onChange={e => edit({ definition: e.target.value })} placeholder="이 Key가 무엇인지 한 줄로" />
            </label>
            <label className="kn-field kn-field--grow">
              <span>본문</span>
              <textarea className="kn-textarea" value={selected.body} onChange={e => edit({ body: e.target.value })} placeholder="마크다운으로 적습니다. 개념 노트는 [[키워드]]로 이어집니다." />
            </label>
            <div className="kn-field">
              <span>키워드</span>
              <div className="kn-keywords">
                {selected.keywords.map(k => (
                  <span key={k} className="kn-chip">
                    {k}
                    <button onClick={() => edit({ keywords: selected.keywords.filter(x => x !== k) })} title="키워드 빼기"><X size={10} /></button>
                  </span>
                ))}
                <input
                  className="kn-input kn-input--kw"
                  value={keywordDraft}
                  placeholder="키워드 추가"
                  onChange={e => setKeywordDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKeyword() } }}
                />
                <button className="kn-icon-btn" onClick={addKeyword} title="키워드 추가"><Plus size={12} /></button>
              </div>
            </div>
            <label className="kn-field">
              <span>값 의미</span>
              <textarea className="kn-textarea kn-textarea--short" value={selected.valueMeanings} onChange={e => edit({ valueMeanings: e.target.value })} placeholder="예: 0 = 대기, 1 = 완료" />
            </label>
            <div className="kn-field">
              <span>원천 테이블</span>
              <input className="kn-input" value={selected.sourceTable} onChange={e => edit({ sourceTable: e.target.value })} />
            </div>
            <div className="kn-field">
              <span>출현 목록 <span className="kn-count">{selected.members.length}</span></span>
              <div className="kn-members">
                {selected.members.map(m => (
                  <span key={memberText(m)} className="kn-member">
                    {memberText(m)}
                    {selected.members.length > 1 && (
                      <button onClick={() => removeMember(m)} title="이 컬럼 빼기 (후보로 돌아갑니다)"><X size={10} /></button>
                    )}
                  </span>
                ))}
              </div>
            </div>
            <div className="kn-actions">
              <div className="kn-status-switch" {...uiId('KI.note-status')}>
                <button className={selected.status === 'draft' ? 'on' : ''} onClick={() => edit({ status: 'draft' })}>초안</button>
                <button className={selected.status === 'confirmed' ? 'on' : ''} onClick={() => edit({ status: 'confirmed' })}>확인됨</button>
              </div>
              {confirmDelete ? (
                <span className="kn-delete-confirm">
                  노트를 지울까요?
                  <button className="kn-link kn-link--danger" onClick={removeNote}>지움</button>
                  <button className="kn-link" onClick={() => setConfirmDelete(false)}>취소</button>
                </span>
              ) : (
                <button className="kn-link" onClick={() => setConfirmDelete(true)}><Trash2 size={12} /> 노트 삭제</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
