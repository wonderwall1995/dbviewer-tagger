import { useState, useEffect, useRef, useCallback } from 'react'
import { Check, X, Plus, Pause, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { uiId } from '../ui/uiId'
import type { KeyinfoColumnSchema } from '@tagger/shared'
import { api } from '../api'

interface Props {
  // null이면 제품 미지정
  product: string | null
  // 컬럼 스키마. 값 의미 입력 칸의 안내 문구를 컬럼 타입에 맞출 때 쓴다.
  schema: Record<string, Record<string, { dbType?: string }>>
  // 새로고침으로 색인할 파일들. 보고 있는 제품이 지금 작업 중인 제품일 때만 넘긴다. (아니면 null)
  fileSources: Record<string, { type: string; path?: string; localPath?: string }> | null
  onSchemaUpdated?: (schema: Record<string, Record<string, KeyinfoColumnSchema>>) => void
  onProgress?: (confirmed: number, total: number) => void
}

const KIND_LABEL: Record<KeyCandidate['kind'], string> = { fk: 'FK', ref: '추정', name: '이름', hold: '보류' }
const memberText = (m: KeyNoteMember) => `${m.fileName.replace(/\.csv$/i, '')}.${m.columnKey}`

// 컬럼 타입에 맞는 값 의미 안내 문구. 타입 이름은 CSV 3번째 줄의 {타입}에서 온다. 알려진 이름 밖은 DB의 enum 이름으로 본다.
function valueMeaningHint(dbType: string | undefined): string {
  const t = (dbType ?? '').toLowerCase()
  if (t === 'boolean' || t === 'bool') return '참/거짓이 각각 무엇을 뜻하는지 적습니다.\n예: true = 공개, false = 비공개'
  if (/^(integer|int\d*|bigint|smallint|serial|numeric|decimal|float\d*|double|real)/.test(t)) {
    return '숫자가 무엇을 뜻하는지 적습니다. 금액이나 개수면 단위를, 상태 코드면 값마다 뜻을 적습니다.\n예: 0 = 대기, 1 = 완료'
  }
  if (/^(timestamp|date|time)/.test(t)) return '이 시각이 언제를 뜻하는지, 기준 시간대는 무엇인지 적습니다.\n예: 계좌를 만든 시각 (UTC)'
  if (t === 'string' || /^(text|varchar|char|uuid)/.test(t)) return '이 값이 무엇인지 풀어서 적습니다.\n예: 사용자를 구분하는 고유 번호 (UUID 형식)'
  if (t) return '이 컬럼에 들어갈 수 있는 값을 모두 적고, 값마다 뜻을 적습니다.\n예: PENDING = 승인 대기, DONE = 완료'
  return '값이 무엇을 뜻하는지 풀어서 적습니다.\n예: 0 = 대기, 1 = 완료'
}

// 값 예시: 고른 테이블의 CSV 앞부분 행에서 이 노트의 컬럼(Key) 값만 작게 보여 준다. 읽기 전용이다.
// 파일 경로는 불러온 프리셋 JSON의 fileSources에서 온다. 셀을 누르면 값이 클립보드에 복사된다.
type FileSourcesProp = Props['fileSources']

function ValueExamples({ note, fileSources }: { note: KeyNote; fileSources: FileSourcesProp }) {
  const tables = [...new Set(note.members.map(m => m.fileName))].sort((a, b) => a.localeCompare(b))
  const [table, setTable] = useState(tables[0] ?? '')
  const [data, setData] = useState<{ columns: string[]; rows: string[][] } | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'missing' | 'unreadable'>('idle')
  const [copied, setCopied] = useState<string | null>(null)
  const [skipBlank, setSkipBlank] = useState(false)   // 빈 값과 0을 뺀 행만 보여 준다.
  const [total, setTotal] = useState(0)                // 필터를 적용한 전체 행 수
  const [truncated, setTruncated] = useState(false)     // 파일이 너무 커서 앞쪽만 읽었는가
  const [sort, setSort] = useState<{ column: string; dir: 'asc' | 'desc' } | null>(null)   // 컬럼 머리글을 눌러 정렬
  const [hasMore, setHasMore] = useState(false)       // 아래에 더 불러올 행이 있는가
  const [loadingMore, setLoadingMore] = useState(false)
  const genRef = useRef(0)                              // 조건이 바뀌면 올려서, 늦게 온 이전 응답을 버린다.
  const [reloadTick, setReloadTick] = useState(0)   // 올리면 CSV를 다시 읽는다. (파일이 바뀌어도 자동으로 읽지는 않는다)
  const columnKeys = note.members.filter(m => m.fileName === table).map(m => m.columnKey)
  const columnSig = columnKeys.join('\u0000')

  // 노트가 바뀌면 첫 테이블로 돌아간다. 고른 테이블이 목록에서 사라져도 마찬가지다.
  useEffect(() => {
    if (!tables.includes(table)) setTable(tables[0] ?? '')
  }, [note.id, tables.join('\u0000')])  // eslint-disable-line react-hooks/exhaustive-deps

  const source = fileSources?.[table]
  const filePath = source ? (source.type === 'local' ? source.path : source.localPath) : undefined

  const PAGE = 50   // 한 번에 불러오는 행 수. 스크롤이 끝에 닿으면 50행씩 더 불러온다. 파일 끝까지 이어진다.

  // 고른 테이블에서 정렬 중인 컬럼이 없어지면 정렬을 푼다.
  useEffect(() => {
    setSort(cur => (cur && !columnKeys.includes(cur.column) ? null : cur))
  }, [columnSig])  // eslint-disable-line react-hooks/exhaustive-deps

  // 표를 처음부터 읽는다. 테이블, 컬럼, 필터, 새로고침이 바뀌면 바로 로딩 상태로 들어간다.
  useEffect(() => {
    const gen = ++genRef.current
    setData(null)
    setHasMore(false)
    setLoadingMore(false)
    if (!table || !filePath || columnKeys.length === 0) { setState('idle'); return }
    setState('loading')
    api.keynoteSampleRows(filePath, columnKeys, PAGE, skipBlank, 0, sort)
      .then(r => {
        if (gen !== genRef.current) return
        if (!r.ok) { setState(r.reason === 'missing' ? 'missing' : 'unreadable'); return }
        setData({ columns: r.columns, rows: r.rows })
        setTotal(r.total)
        setTruncated(r.truncated)
        setHasMore(r.hasMore)
        setState('idle')
      })
      .catch(() => { if (gen === genRef.current) setState('unreadable') })
  }, [table, filePath, columnSig, reloadTick, skipBlank, sort])  // eslint-disable-line react-hooks/exhaustive-deps

  // 스크롤이 아래 끝에 가까워지면 다음 20행을 불러온다.
  const loadMore = () => {
    if (!data || !hasMore || loadingMore || !filePath) return
    const gen = genRef.current
    setLoadingMore(true)
    api.keynoteSampleRows(filePath, columnKeys, PAGE, skipBlank, data.rows.length, sort)
      .then(r => {
        if (gen !== genRef.current) return
        if (r.ok) {
          setData(d => (d ? { columns: d.columns, rows: [...d.rows, ...r.rows] } : d))
          setHasMore(r.hasMore)
        } else {
          setHasMore(false)
        }
        setLoadingMore(false)
      })
      .catch(() => { if (gen === genRef.current) { setHasMore(false); setLoadingMore(false) } })
  }

  const onGridScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) loadMore()
  }

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      // 데이터 그리드와 같은 문구와 id를 써서, 연달아 눌러도 알림이 하나만 보인다.
      toast.success('클립보드에 저장했습니다', { id: 'cell-copy' })
      setCopied(key)
      setTimeout(() => setCopied(c => (c === key ? null : c)), 700)
    } catch {
      toast.error('클립보드에 저장하지 못했습니다', { id: 'cell-copy' })
    }
  }

  let body: React.ReactNode
  if (!fileSources) body = <div className="kn-ex-empty">지금 불러온 프리셋의 제품에서만 예시를 볼 수 있어요.</div>
  else if (!source || !filePath) body = <div className="kn-ex-empty">이 프리셋에 {table || '테이블'}의 파일 경로가 없어요.</div>
  else if (state === 'missing') body = <div className="kn-ex-empty">파일을 찾을 수 없어요. 경로: {filePath}</div>
  else if (state === 'unreadable') body = <div className="kn-ex-empty">파일을 읽지 못했어요.</div>
  else if (state === 'loading' || !data) body = <div className="kn-ex-empty">불러오는 중…</div>
  else if (data.columns.length === 0) body = <div className="kn-ex-empty">이 파일에서 해당 컬럼을 찾지 못했어요.</div>
  else if (data.rows.length === 0) body = <div className="kn-ex-empty">{skipBlank ? '빈 값과 0이 아닌 값이 없어요.' : '보여 줄 행이 없어요.'}</div>
  else {
    body = (
      <div className="kn-ex-scroll" onScroll={onGridScroll}>
        <table className="kn-ex-grid" {...uiId('KI.examples-grid')}>
          <thead>
            <tr>
              <th className="kn-ex-rownum">#</th>
              {data.columns.map(c => {
                const dir = sort?.column === c ? sort.dir : null
                return (
                  <th
                    key={c}
                    className="kn-ex-sortable"
                    title="눌러서 정렬: 작은 값부터 → 큰 값부터 → 해제"
                    onClick={() => setSort(cur => (cur?.column !== c ? { column: c, dir: 'asc' } : cur.dir === 'asc' ? { column: c, dir: 'desc' } : null))}
                  >
                    {c}<span className="kn-ex-sort">{dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : ''}</span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, ri) => (
              <tr key={ri}>
                <td className="kn-ex-rownum">{ri + 1}</td>
                {r.map((v, ci) => {
                  const key = `${ri}:${ci}`
                  return (
                    <td
                      key={ci}
                      className={`kn-ex-cell${copied === key ? ' kn-ex-cell--copied' : ''}`}
                      title={v === '' ? '(빈 값) 눌러서 복사' : `${v}\n눌러서 복사`}
                      onClick={() => { if (v !== '' && !window.getSelection()?.toString()) void copy(key, v) }}
                    >{v === '' ? <span className="kn-ex-null">(빈 값)</span> : v}</td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {loadingMore && <div className="kn-ex-more">불러오는 중…</div>}
        {!hasMore && !loadingMore && <div className="kn-ex-more">총 {total.toLocaleString()}행{truncated ? ' · 파일이 커서 앞쪽 32MB만 읽었어요' : ''}</div>}
      </div>
    )
  }

  return (
    <div className="kn-field kn-field--examples" {...uiId('KI.examples')}>
      <span className="kn-ex-head">
        값 예시
        <select className="kn-input kn-ex-select" value={table} onChange={e => setTable(e.target.value)} {...uiId('KI.examples-table')}>
          {tables.map(t => <option key={t} value={t}>{t.replace(/\.csv$/i, '')}</option>)}
        </select>
        <label className="kn-ex-toggle" title="고른 컬럼의 값이 비었거나 0인 행을 뺍니다" {...uiId('KI.examples-skip')}>
          <input type="checkbox" checked={skipBlank} onChange={e => setSkipBlank(e.target.checked)} />
          빈 값·0 제외
        </label>
        <button
          className={`kn-icon-btn kn-ex-refresh${state === 'loading' ? ' kn-refresh--busy' : ''}`}
          onClick={() => setReloadTick(t => t + 1)}
          disabled={state === 'loading' || !fileSources}
          title="CSV 파일을 다시 읽어 예시를 갱신합니다"
          {...uiId('KI.examples-refresh')}
        ><RefreshCw size={11} /></button>
      </span>
      {body}
    </div>
  )
}

export function KeyNotesPane({ product, schema, fileSources, onSchemaUpdated, onProgress }: Props) {
  const [notes, setNotes] = useState<KeyNote[]>([])
  const [candidates, setCandidates] = useState<KeyCandidate[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [keywordDraft, setKeywordDraft] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  // 저장하지 않은 편집. 제품이 바뀌어도 원래 제품에 저장하도록 제품 이름과 함께 담는다.
  const pendingRef = useRef<{ product: string | null; notes: KeyNote[] } | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notesRef = useRef<KeyNote[]>([])
  const productRef = useRef(product)
  productRef.current = product
  notesRef.current = notes

  const reload = useCallback(async () => {
    const [n, c] = await Promise.all([
      api.keynoteList(product),
      api.keynoteCandidates(product),
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
    await api.keynoteSave(pending.product, pending.notes)
  }, [])

  // 제품이 바뀌면 저장하지 않은 편집을 먼저 저장하고 다시 읽는다.
  useEffect(() => {
    setSelectedId(null)
    setNotes([])
    setCandidates([])
    reload()
    return () => { void flush() }
  }, [product, reload, flush])

  // 작업 일시 중단한 노트는 노트 목록에서 빠진다. 후보 목록에 보류로 나타난다.
  const visibleNotes = notes.filter(n => n.status !== 'suspended')

  useEffect(() => {
    const visible = notes.filter(n => n.status !== 'suspended')
    onProgress?.(visible.filter(n => n.status === 'confirmed').length, visible.length)
  }, [notes, onProgress])

  const selected = visibleNotes.find(n => n.id === selectedId) ?? null

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
    const note = await api.keynoteAcceptCandidate(product, c.signature)
    if (!note) { toast.warning('이미 노트에 들어갔거나 핀이 없어진 후보예요.') }
    await reload()
    if (note) setSelectedId(note.id)
  }

  // 작업 일시 중단: 노트를 후보 목록으로 옮긴다. 적은 내용은 그대로 두고, 다시 수락하면 돌아온다.
  const suspend = async () => {
    if (!selected) return
    const title = selected.title
    edit({ status: 'suspended' })
    setSelectedId(null)
    await flush()
    setCandidates(await api.keynoteCandidates(product))
    toast.info(`"${title}" 노트를 후보로 옮겼어요. 다시 수락하면 적은 내용 그대로 돌아와요.`)
  }

  // 사용자가 뺀 컬럼은 excluded에 적어 새로고침이 다시 넣지 않게 한다. 빠진 컬럼은 저장 뒤 후보로 돌아온다.
  const removeMember = (m: KeyNoteMember) => {
    if (!selected || selected.members.length <= 1) return
    edit({
      members: selected.members.filter(x => !(x.fileName === m.fileName && x.columnKey === m.columnKey)),
      excluded: [...selected.excluded, m],
    })
    setTimeout(async () => { await flush(); setCandidates(await api.keynoteCandidates(product)) }, 700)
  }

  // 새로고침: 아직 색인하지 않은 테이블을 색인하고, 노트의 출현 목록에 새 테이블의 같은 Key를 넣고, 후보를 다시 계산한다.
  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await flush()
      if (fileSources) {
        const data = await api.keyinfoIndex(product, fileSources)
        onSchemaUpdated?.(data.schema ?? {})
      }
      const changed = await api.keynoteRefreshMembers(product)
      const keepId = selectedId
      const n = await reload()
      if (keepId && !n.some(x => x.id === keepId)) setSelectedId(null)
      toast.success(changed > 0 ? `노트 ${changed}개의 출현 목록을 갱신했어요.` : '새로 추가된 테이블이 없어요.')
    } catch {
      toast.error('새로고침하지 못했어요.')
    } finally {
      setRefreshing(false)
    }
  }

  const addKeyword = () => {
    const k = keywordDraft.trim()
    if (!selected || !k) return
    if (!selected.keywords.includes(k)) edit({ keywords: [...selected.keywords, k] })
    setKeywordDraft('')
  }

  const confirmed = visibleNotes.filter(n => n.status === 'confirmed').length

  // 값 의미 안내 문구: 출현 컬럼들의 타입을 모아, 타입마다 안내를 보여 준다.
  const hintFor = (note: KeyNote) => {
    const types = [...new Set(note.members.map(m => schema[m.fileName]?.[m.columnKey]?.dbType ?? ''))]
    return types.map(valueMeaningHint).filter((h, i, all) => all.indexOf(h) === i).join('\n\n')
  }

  return (
    <div className="kn-pane" {...uiId('KI.notes')}>
      <div className="kn-left">
        <div className="kn-section-title" {...uiId('KI.candidates-head')}>
          후보 <span className="kn-count">{candidates.length}</span>
          <button
            className={`kn-icon-btn kn-refresh${refreshing ? ' kn-refresh--busy' : ''}`}
            onClick={refresh}
            disabled={refreshing}
            title="새로고침 — 새로 생긴 테이블을 색인하고, 노트의 출현 목록과 후보를 갱신합니다"
            {...uiId('KI.refresh')}
          >
            <RefreshCw size={12} />
          </button>
        </div>
        <div className="kn-candidates" {...uiId('KI.candidates')}>
          {candidates.length === 0 && <div className="kn-empty">후보가 없습니다. 핀 보기에서 키를 핀으로 고정하면 같은 키의 후보가 나옵니다.</div>}
          {candidates.map(c => (
            <div key={c.signature} className="kn-cand" title={`${c.reason}\n${c.members.map(memberText).join('\n')}`} {...uiId('KI.candidate', c.title)}>
              <span className={`kn-badge kn-badge--${c.kind}`}>{KIND_LABEL[c.kind]}</span>
              <span className="kn-cand-title">{c.title}</span>
              <span className="kn-cand-count">{c.members.length}개</span>
              <button
                className="kn-icon-btn kn-icon-btn--ok"
                onClick={() => accept(c)}
                title={c.kind === 'hold' ? '다시 노트로 (적은 내용 그대로)' : '수락해서 초안 노트로 만들기'}
              ><Check size={12} /></button>
            </div>
          ))}
        </div>

        <div className="kn-section-title" {...uiId('KI.notelist-head')}>
          노트 <span className="kn-count">{visibleNotes.length}</span>
          <span className="kn-progress" {...uiId('KI.progress')}>Key {visibleNotes.length}개 중 {confirmed}개 확인됨</span>
        </div>
        <div className="kn-notes" {...uiId('KI.notelist')}>
          {visibleNotes.length === 0 && <div className="kn-empty">수락한 노트가 여기에 나옵니다.</div>}
          {visibleNotes.map(n => (
            <button
              key={n.id}
              className={`kn-note${n.id === selectedId ? ' kn-note--active' : ''}`}
              onClick={() => { void flush(); setSelectedId(n.id) }}
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
            <div className="kn-row" {...uiId('KI.note-head')}>
              <label className="kn-field kn-field--title">
                <span>제목</span>
                <input className="kn-input kn-input--readonly" value={selected.title} readOnly title="제목은 바꿀 수 없습니다" />
              </label>
              <label className="kn-field kn-field--def">
                <span>한 줄 정의</span>
                <input className="kn-input" value={selected.definition} onChange={e => edit({ definition: e.target.value })} placeholder="이 Key가 무엇인지 한 줄로" />
              </label>
            </div>
            <label className="kn-field kn-field--grow">
              <span>본문</span>
              <textarea className="kn-textarea" value={selected.body} onChange={e => edit({ body: e.target.value })} placeholder="이 Key가 무엇이고 어디에서 어떻게 쓰이는지 평문으로 적습니다. 마크다운 문법은 필요 없습니다." />
            </label>
            <div className="kn-field">
              <span>키워드</span>
              <div className="kn-keywords" {...uiId('KI.keywords')}>
                <input
                  className="kn-input kn-input--kw"
                  value={keywordDraft}
                  placeholder="키워드 추가"
                  onChange={e => setKeywordDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKeyword() } }}
                />
                <button className="kn-icon-btn" onClick={addKeyword} title="키워드 추가"><Plus size={12} /></button>
                {selected.keywords.map(k => (
                  <span key={k} className="kn-chip">
                    {k}
                    <button onClick={() => edit({ keywords: selected.keywords.filter(x => x !== k) })} title="키워드 빼기"><X size={10} /></button>
                  </span>
                ))}
              </div>
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
              <span className="kn-hint">이 Key가 나오는 모든 컬럼입니다. 키워드와 함께 맥락 문서의 값으로 들어갑니다. 새로고침하면 새로 생긴 테이블의 같은 Key를 찾아 넣습니다.</span>
            </div>
            <div className="kn-row kn-row--meaning" {...uiId('KI.meaning-row')}>
              <label className="kn-field kn-field--meaning">
                <span>값 의미</span>
                <textarea className="kn-textarea kn-textarea--meaning" value={selected.valueMeanings} onChange={e => edit({ valueMeanings: e.target.value })} placeholder={hintFor(selected)} />
              </label>
              <ValueExamples note={selected} fileSources={fileSources} />
            </div>
            <div className="kn-actions">
              <div className="kn-status-switch" {...uiId('KI.note-status')}>
                <button className={selected.status === 'draft' ? 'on' : ''} onClick={() => edit({ status: 'draft' })}>초안</button>
                <button className={selected.status === 'confirmed' ? 'on' : ''} onClick={() => edit({ status: 'confirmed' })}>확인됨</button>
              </div>
              <button className="kn-link" onClick={suspend} title="노트를 후보 목록으로 옮깁니다. 적은 내용은 그대로 남습니다" {...uiId('KI.note-suspend')}>
                <Pause size={12} /> 작업 일시 중단
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
