import http from 'http'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { makeWorkspace } from '../main/core/workspace'
import { makeSessionState } from '../main/core/context'
import type { Ctx, Handlers } from '../main/core/context'
import { localHandlers } from '../main/core/local'
import { csvHandlers } from '../main/core/csv'
import { lorebookHandlers } from '../main/core/lorebook'
import { dbHandlers, normalizeSlots } from '../main/core/db'
import type { DbSlots } from '../main/core/db'
import { keyinfoHandlers } from '../main/core/keyinfo'
import { isAllowedDbPort, resolvePublicHost } from '../main/core/netguard'

// Web API 서버. 화면(httpApi)이 부르는 경로는 넷뿐이다.
//   GET  /api/health          살아 있는지
//   POST /api/call/<채널>      core 처리 함수 호출. 본문은 { args: [...] }
//   GET  /api/events          진행률 알림 (SSE)
//   POST /api/upload?name=    CSV 올리기 (본문 = 파일 내용)
// 사용자(세션)마다 작업 폴더와 메모리 상태를 따로 둔다. 데스크톱 전용 기능(SSH, Hermes, 폴더 대화상자)은 없다.

export interface ServerOptions {
  // true면 세션 쿠키에 Secure를 붙인다 (HTTPS에서만 보냄). 운영(Nginx + HTTPS 뒤)에서 켠다.
  secureCookie?: boolean
  // 세션 작업 폴더들을 둘 폴더. 세션마다 <dataDir>/sessions/<id>/ 를 쓴다. 서버를 시작하면 sessions/ 를 비운다.
  dataDir: string
  // 새 세션을 시작할 때 복사해 넣을 견본 작업 폴더 (없으면 빈 폴더로 시작)
  sampleDir?: string
  // JSON 본문 최대 크기 (바이트)
  maxJsonBytes?: number
  // 업로드 파일 최대 크기 (바이트)
  maxUploadBytes?: number
  // 동시에 둘 수 있는 세션 수
  maxSessions?: number
  // 세션 하나가 쓸 수 있는 디스크 (바이트)
  sessionDiskBytes?: number
  // 이 시간 동안 요청이 없으면 세션과 그 폴더를 지운다 (밀리초)
  sessionIdleMs?: number
  // 만료 세션을 찾는 간격 (밀리초)
  sweepIntervalMs?: number
}

const SESSION_COOKIE = 'tagger_sid'
const MB = 1024 * 1024

// Web에서 부를 수 있는 채널 표. core 표만 모은다.
export const webHandlers: Handlers = {
  ...localHandlers,
  ...csvHandlers,
  ...lorebookHandlers,
  ...dbHandlers,
  ...keyinfoHandlers,
}

interface Session {
  id: string
  root: string
  ctx: Ctx
  streams: Set<http.ServerResponse>
  lastSeen: number
  // 디스크 사용량 추정값과 마지막으로 실제로 잰 시각
  usedBytes: number
  measuredAt: number
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status, expose: true })
}

// 폴더 안 파일 크기의 합 (심볼릭 링크는 따라가지 않는다)
export function dirSize(dir: string): number {
  let total = 0
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return 0 }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) total += dirSize(p)
    else if (e.isFile()) { try { total += fs.statSync(p).size } catch { /* 지워진 파일 */ } }
  }
  return total
}

export function createTaggerServer(opts: ServerOptions) {
  const maxJson = opts.maxJsonBytes ?? 20 * MB
  const maxUpload = opts.maxUploadBytes ?? 20 * MB
  const maxSessions = opts.maxSessions ?? 10
  const quota = opts.sessionDiskBytes ?? 200 * MB
  const idleMs = opts.sessionIdleMs ?? 24 * 60 * 60 * 1000
  const sessionsDir = path.join(opts.dataDir, 'sessions')
  const sessions = new Map<string, Session>()

  // 세션은 메모리에만 있으므로, 서버를 다시 시작하면 예전 세션 폴더는 주인이 없다. 시작할 때 비운다.
  fs.rmSync(sessionsDir, { recursive: true, force: true })
  fs.mkdirSync(sessionsDir, { recursive: true })

  // bytes만큼 더 써도 되는지 확인한다. 추정값으로 넘치면 실제로 다시 재고, 그래도 넘치면 거절한다.
  function ensureRoom(session: Session, bytes: number) {
    if (session.usedBytes + bytes <= quota) return
    session.usedBytes = dirSize(session.root)
    session.measuredAt = Date.now()
    if (session.usedBytes + bytes > quota) {
      throw httpError(507, `작업 공간 용량(${Math.round(quota / MB)}MB)을 넘었어요. 내려받은 파일을 지운 뒤 다시 해 주세요.`)
    }
  }

  function removeSession(session: Session) {
    sessions.delete(session.id)
    for (const res of session.streams) res.end()
    fs.rmSync(session.root, { recursive: true, force: true })
  }

  function newSession(): Session {
    if (sessions.size >= maxSessions) throw httpError(503, '지금은 사용하는 사람이 많아요. 잠시 뒤 다시 와 주세요.')
    const id = crypto.randomBytes(24).toString('base64url')
    const root = path.join(sessionsDir, id)
    fs.mkdirSync(root, { recursive: true })
    // 모든 면접관이 같은 견본으로 시작한다. 복사본이라 서로의 작업이 섞이지 않는다.
    if (opts.sampleDir && fs.existsSync(opts.sampleDir)) fs.cpSync(opts.sampleDir, root, { recursive: true })
    let slots: DbSlots = normalizeSlots({})
    const session: Session = {
      id,
      root,
      streams: new Set(),
      lastSeen: Date.now(),
      usedBytes: dirSize(root),
      measuredAt: Date.now(),
      ctx: {
        ws: makeWorkspace(root),
        state: makeSessionState(),
        emit: (channel, data) => {
          const line = `event: message\ndata: ${JSON.stringify({ channel, data })}\n\n`
          for (const res of session.streams) res.write(line)
        },
        // DB 접속 정보는 이 세션의 메모리에만 둔다. 디스크에 쓰지 않는다.
        slots: { load: () => structuredClone(slots), save: (next) => { slots = structuredClone(next) } },
        cedDir: () => path.join(root, 'CED'),
        dbGuard: webDbGuard,
        reserveDisk: (bytes) => { ensureRoom(session, bytes); session.usedBytes += bytes },
        allowOutsidePaths: false,
      },
    }
    sessions.set(id, session)
    return session
  }

  function sessionFor(req: http.IncomingMessage, res: http.ServerResponse): Session {
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE]
    const found = sid ? sessions.get(sid) : undefined
    if (found) {
      found.lastSeen = Date.now()
      return found
    }
    const created = newSession()
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${created.id}; HttpOnly; SameSite=Lax; Path=/${opts.secureCookie ? '; Secure' : ''}`)
    return created
  }

  // 오래 쓰지 않은 세션을 지운다.
  function sweep(now = Date.now()) {
    for (const s of [...sessions.values()]) {
      if (now - s.lastSeen > idleMs) removeSession(s)
    }
  }
  const sweeper = setInterval(sweep, opts.sweepIntervalMs ?? 10 * 60 * 1000)
  sweeper.unref()

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true })
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/call/')) {
      const channel = decodeURIComponent(url.pathname.slice('/api/call/'.length))
      const fn = Object.prototype.hasOwnProperty.call(webHandlers, channel) ? webHandlers[channel] : undefined
      if (!fn) return sendJson(res, 404, { ok: false, error: '없는 기능입니다.' })
      const session = sessionFor(req, res)
      const body = await readBody(req, maxJson)
      let args: unknown[] = []
      if (body.length > 0) {
        let parsed: { args?: unknown } | null = null
        try { parsed = JSON.parse(body.toString('utf8')) } catch { /* 아래에서 400 */ }
        if (!parsed || !Array.isArray(parsed.args)) return sendJson(res, 400, { ok: false, error: '요청 형식이 올바르지 않습니다.' })
        args = parsed.args
      }
      // 큰 본문(저장할 내용)은 용량을 먼저 확인한다. 작은 요청(지우기, 목록 등)은 용량이 차도 쓸 수 있게 둔다.
      if (body.length > 64 * 1024) ensureRoom(session, body.length)
      try {
        const value = await fn(session.ctx, ...args)
        return sendJson(res, 200, { ok: true, value: value === undefined ? null : value })
      } catch (e: unknown) {
        return sendJson(res, 200, { ok: false, error: publicError(e, opts.dataDir) })
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      const session = sessionFor(req, res)
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write(': connected\n\n')
      session.streams.add(res)
      req.on('close', () => session.streams.delete(res))
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const session = sessionFor(req, res)
      const name = safeCsvName(url.searchParams.get('name'))
      if (!name) return sendJson(res, 400, { ok: false, error: 'CSV 파일 이름이 올바르지 않습니다.' })
      const declared = Number(req.headers['content-length'] ?? 0)
      ensureRoom(session, Number.isFinite(declared) && declared > 0 ? Math.min(declared, maxUpload) : 0)
      const destDir = path.join(session.root, 'S3-downloads', 'local-downloads')
      fs.mkdirSync(destDir, { recursive: true })
      const dest = path.join(destDir, name)
      // 남은 용량과 업로드 상한 중 작은 값까지만 받는다.
      const room = Math.max(0, quota - session.usedBytes)
      await writeBodyToFile(req, dest, Math.min(maxUpload, room))
      session.usedBytes += fs.statSync(dest).size
      return sendJson(res, 200, { ok: true, value: { name, path: dest } })
    }

    return sendJson(res, 404, { ok: false, error: '없는 경로입니다.' })
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      const err = e as { status?: number; expose?: boolean; message?: string }
      const status = err?.status ?? 500
      // 응답을 다 보낸 뒤 연결을 닫는다. 남은 본문(큰 업로드 등)을 끝까지 받지 않기 위해서다.
      if (!res.headersSent) res.setHeader('Connection', 'close')
      res.on('finish', () => req.destroy())
      const message = err?.expose ? err.message : status === 413 ? '요청이 너무 큽니다.' : '서버 오류입니다.'
      if (!res.headersSent) sendJson(res, status, { ok: false, error: message })
      else res.end()
    })
  })
  server.on('close', () => clearInterval(sweeper))

  return { server, sessions, sweep }
}

// 화면으로 보내는 오류 문구에서 서버의 폴더 경로를 지운다. (fs 오류 문구에는 전체 경로가 들어 있다)
export function publicError(e: unknown, dataDir: string): string {
  let msg = e instanceof Error ? e.message : String(e)
  const variants = new Set([dataDir, path.resolve(dataDir), dataDir.split(path.sep).join('/'), path.resolve(dataDir).split(path.sep).join('/')])
  for (const v of variants) if (v) msg = msg.split(v).join('(작업 폴더)')
  // 따옴표로 감싼 절대 경로 ('C:\...' 또는 '/...')도 가린다.
  msg = msg.replace(/'(?:[A-Za-z]:[\\/]|\/)[^']*'/g, "'(경로)'")
  return msg
}

// Web의 DB 연결 규칙: 공인 주소와 허용 포트만, 검사한 IP로 접속, 읽기 전용, 시간 제한.
export async function webDbGuard(host: string, port: number) {
  if (!isAllowedDbPort(port)) throw new Error('이 환경에서는 5432 또는 1024 이상의 포트만 쓸 수 있습니다.')
  const ip = await resolvePublicHost(host)
  return {
    host: ip,
    clientOptions: {
      connectionTimeoutMillis: 8000,
      statement_timeout: 30000,
      query_timeout: 35000,
      // 이 연결의 모든 트랜잭션을 읽기 전용으로 연다. (면접관 DB를 바꾸지 않는다)
      options: '-c default_transaction_read_only=on',
    },
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    // 면접관의 작업 내용이 캐시에 남지 않게 하고, 응답 형식을 브라우저가 추측하지 않게 한다.
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(data)
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

function tooLarge(): Error {
  return Object.assign(new Error('too large'), { status: 413 })
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) { req.removeAllListeners('data'); reject(tooLarge()); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// 본문을 임시 파일에 쓰고, 다 받은 뒤에 제자리로 옮긴다. 크기를 넘으면 임시 파일을 지운다.
function writeBodyToFile(req: http.IncomingMessage, dest: string, limit: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmp = `${dest}.part-${crypto.randomUUID()}`
    const out = fs.createWriteStream(tmp)
    let size = 0
    let failed = false
    const fail = (e: Error) => {
      if (failed) return
      failed = true
      out.destroy()
      fs.rm(tmp, { force: true }, () => reject(e))
    }
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) { req.unpipe(out); req.removeAllListeners('data'); fail(tooLarge()) }
    })
    req.on('error', fail)
    out.on('error', fail)
    out.on('finish', () => {
      if (failed) return
      fs.rename(tmp, dest, (e) => (e ? fail(e) : resolve()))
    })
    req.pipe(out)
  })
}

// 업로드 파일 이름: 폴더 구분자와 쓸 수 없는 글자를 막고 .csv만 받는다.
export function safeCsvName(name: string | null): string | null {
  if (!name) return null
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  if (!/\.csv$/i.test(base) || base.startsWith('.') || base.length > 200) return null
  return base
}
