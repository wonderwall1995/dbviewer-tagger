import { CHANNELS } from './channels'

// Web용 TaggerApi. 같은 약속을 HTTP로 구현한다.
//   일반 함수   → POST /api/call/<채널> { args }
//   진행률 구독 → GET /api/events (SSE) 하나를 열어 채널별로 나눠 준다
//   파일 올리기 → POST /api/upload?name=
// 서버에 없는 기능(데스크톱 전용)은 서버가 404로 답하고, 여기서는 오류로 바꾼다. 화면은 caps로 그 버튼을 숨긴다.

async function call(channel: string, args: unknown[]): Promise<unknown> {
  const res = await fetch(`/api/call/${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ args }),
  })
  if (res.status === 404) throw new Error('Web에서는 쓸 수 없는 기능입니다.')
  if (res.status === 413) throw new Error('요청이 너무 큽니다.')
  const body = await res.json().catch(() => null) as { ok: boolean; value?: unknown; error?: string } | null
  if (!body) throw new Error('서버 응답을 읽지 못했습니다.')
  if (!body.ok) throw new Error(body.error || '요청이 실패했습니다.')
  return body.value
}

async function upload(file: File): Promise<{ name: string; path: string }> {
  const res = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    body: file,
  })
  if (res.status === 413) throw new Error('파일이 너무 큽니다.')
  const body = await res.json().catch(() => null) as { ok: boolean; value?: { name: string; path: string }; error?: string } | null
  if (!body?.ok || !body.value) throw new Error(body?.error || '파일을 올리지 못했습니다.')
  return body.value
}

// 파일 선택 창(브라우저). 고르지 않고 닫으면 null.
function pickCsvFiles(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv,text/csv'
    input.multiple = true
    input.addEventListener('change', () => resolve(input.files && input.files.length > 0 ? Array.from(input.files) : null))
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

// ── 진행률 알림 (SSE) ─────────────────────────────────────────────────────────
type Listener = (data: unknown) => void
const listeners = new Map<string, Listener>()
let source: EventSource | null = null

function subscribe(channel: string, cb: Listener) {
  listeners.set(channel, cb)
  if (!source) {
    source = new EventSource('/api/events', { withCredentials: true })
    source.onmessage = (e) => {
      try {
        const { channel: ch, data } = JSON.parse(e.data) as { channel: string; data: unknown }
        listeners.get(ch)?.(data)
      } catch { /* 형식이 다른 알림은 버린다. */ }
    }
  }
}

function unsubscribe(channel: string) {
  listeners.delete(channel)
  if (listeners.size === 0 && source) {
    source.close()
    source = null
  }
}

// ── 조립 ──────────────────────────────────────────────────────────────────────
const special: Partial<TaggerApi> = {
  openCsv: async () => {
    const files = await pickCsvFiles()
    return files ? Promise.all(files.map(upload)) : null
  },
  importDroppedFile: (file: File) => upload(file),
  onExportProgress: (cb) => subscribe('db:exportProgress', cb as Listener),
  offExportProgress: () => unsubscribe('db:exportProgress'),
  onKeyinfoProgress: (cb) => subscribe('keyinfo:progress', cb as Listener),
  offKeyinfoProgress: () => unsubscribe('keyinfo:progress'),
  // GitHub 버튼은 Web에서 새 탭으로 연다.
  openGithub: async () => { window.open('https://github.com/wonderwall1995', '_blank', 'noopener') },
}

export function createHttpApi(): TaggerApi {
  const api: Record<string, unknown> = { ...special }
  for (const [method, channel] of Object.entries(CHANNELS)) {
    if (method in api) continue
    api[method] = (...args: unknown[]) => call(channel, args)
  }
  return api as unknown as TaggerApi
}
