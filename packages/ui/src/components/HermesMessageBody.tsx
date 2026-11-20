import { Component, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { uiId } from '../ui/uiId'

export type ReadMode = 'md' | 'txt'

type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'think'; text: string; meta: string }

const lineCount = (s: string) => (s ? s.split('\n').length : 0)

// 도구 실행 결과처럼 JSON 객체 하나로만 이루어진 글인지 본다. 맞으면 읽을 글만 꺼낸다.
function tryJsonBlock(text: string): { text: string; meta: string } | null {
  const t = text.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return null
  let value: unknown
  try { value = JSON.parse(t) } catch { return null }
  if (value === null || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
  // {"output": "...", "exit_code": 0, "error": null} 모양
  if (typeof obj.output === 'string' && keys.every(k => ['output', 'exit_code', 'error'].includes(k))) {
    const code = obj.exit_code !== undefined ? `exit ${String(obj.exit_code)} · ` : ''
    const err = typeof obj.error === 'string' && obj.error ? `\n\n[error] ${obj.error}` : ''
    return { text: obj.output + err, meta: `${code}${lineCount(obj.output)}줄` }
  }
  const pretty = JSON.stringify(value, null, 2)
  return { text: pretty, meta: `${lineCount(pretty)}줄` }
}

// 서버가 보내는 content는 문자열이 아닐 수 있다. (글 없이 도구만 부른 응답은 null, 일부 서버는 글 조각의 배열)
function toText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) {
    return value
      .map(part => (typeof part === 'string' ? part : typeof (part as { text?: unknown })?.text === 'string' ? (part as { text: string }).text : ''))
      .filter(Boolean)
      .join('\n')
  }
  try { return JSON.stringify(value, null, 2) } catch { return '' }
}

// 메시지를 일반 글과 "생각 / 도구 결과" 블록으로 나눈다.
function splitMessage(role: string, rawContent: unknown): Segment[] {
  const content = toText(rawContent)
  if (role !== 'user' && role !== 'assistant') {
    const j = tryJsonBlock(content)
    return [{ kind: 'think', text: j ? j.text : content, meta: j ? j.meta : `${lineCount(content)}줄` }]
  }
  const segments: Segment[] = []
  const pushText = (raw: string) => {
    if (!raw.trim()) return
    const j = tryJsonBlock(raw)
    if (j) segments.push({ kind: 'think', text: j.text, meta: j.meta })
    else segments.push({ kind: 'text', text: raw.replace(/^\n+|\n+$/g, '') })
  }
  // <think>...</think> 태그. 닫는 태그가 없으면 끝까지 생각으로 본다.
  const re = /<think>([\s\S]*?)(?:<\/think>|$)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    pushText(content.slice(last, m.index))
    const inner = m[1].trim()
    if (inner) segments.push({ kind: 'think', text: inner, meta: `${lineCount(inner)}줄` })
    last = m.index + m[0].length
  }
  pushText(content.slice(last))
  return segments
}

function ThinkBlock({ text, meta }: { text: string; meta: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="hermes-think" {...uiId('HM.think')}>
      <button className="hermes-think-head" onClick={() => setOpen(v => !v)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>Thinking ...</span>
        <span className="hermes-think-meta">{meta}</span>
      </button>
      {open && <pre className="hermes-think-body">{text}</pre>}
    </div>
  )
}

// ── 아주 작은 마크다운 표시기 ─────────────────────────────────────────────
// 제목, 목록, 코드 블록, 굵은 글씨, 인라인 코드만 다룬다. HTML은 만들지 않는다.
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) return <code key={i}>{part.slice(1, -1)}</code>
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>
    return part
  })
}

function MiniMarkdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let para: string[] = []
  let key = 0
  const flushPara = () => {
    if (para.length) out.push(<p key={key++}>{inline(para.join('\n'))}</p>)
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      flushPara()
      const code: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++])
      out.push(<pre key={key++} className="hermes-md-code"><code>{code.join('\n')}</code></pre>)
      continue
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      flushPara()
      out.push(<div key={key++} className={`hermes-md-h hermes-md-h${h[1].length}`}>{inline(h[2])}</div>)
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      flushPara()
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))
        i++
      }
      i--
      const Tag = ordered ? 'ol' : 'ul'
      out.push(<Tag key={key++}>{items.map((it, n) => <li key={n}>{inline(it)}</li>)}</Tag>)
      continue
    }
    if (!line.trim()) { flushPara(); continue }
    para.push(line)
  }
  flushPara()
  return <div className="hermes-md">{out}</div>
}

// 메시지 하나를 그리다 오류가 나도 창 전체가 내려가지 않게 한다.
class MessageGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown) { console.error('Hermes 메시지를 표시하지 못했어요', error) }
  render() {
    if (this.state.failed) return <div className="hermes-msg-failed" {...uiId('HM.message-failed')}>표시할 수 없음</div>
    return this.props.children
  }
}

export function HermesMessageBody(props: { role: string; content: unknown; mode: ReadMode }) {
  return <MessageGuard><MessageContent {...props} /></MessageGuard>
}

function MessageContent({ role, content, mode }: { role: string; content: unknown; mode: ReadMode }) {
  const segments = splitMessage(role, content)
  return (
    <>
      {segments.map((s, i) =>
        s.kind === 'think' ? (
          <ThinkBlock key={i} text={s.text} meta={s.meta} />
        ) : mode === 'md' ? (
          <MiniMarkdown key={i} text={s.text} />
        ) : (
          <div key={i} className="hermes-txt">{s.text}</div>
        ),
      )}
    </>
  )
}
