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

// Web API 서버. 화면(httpApi)이 부르는 경로는 넷뿐이다.
//   GET  /api/health          살아 있는지
//   POST /api/call/<채널>      core 처리 함수 호출. 본문은 { args: [...] }
//   GET  /api/events          진행률 알림 (SSE)
//   POST /api/upload?name=    CSV 올리기 (본문 = 파일 내용)
// 사용자(세션)마다 작업 폴더와 메모리 상태를 따로 둔다. 데스크톱 전용 기능(SSH, Hermes, 폴더 대화상자)은 없다.

export interface ServerOptions {
  // 세션 작업 폴더들을 둘 폴더. 세션마다 <dataDir>/sessions/<id>/ 를 쓴다.
  dataDir: string
  // JSON 본문 최대 크기 (바이트)
  maxJsonBytes?: number
  // 업로드 파일 최대 크기 (바이트)
  maxUploadBytes?: number
}

const SESSION_COOKIE = 'tagger_sid'

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
  ctx: Ctx
  streams: Set<http.ServerResponse>
  lastSeen: number
}

export function createTaggerServer(opts: ServerOptions) {
  const maxJson = opts.maxJsonBytes ?? 20 * 1024 * 1024
  const maxUpload = opts.maxUploadBytes ?? 20 * 1024 * 1024
  const sessions = new Map<string, Session>()

  function newSession(): Session {
    const id = crypto.randomBytes(24).toString('base64url')
    const root = path.join(opts.dataDir, 'sessions', id)
    fs.mkdirSync(root, { recursive: true })
    let slots: DbSlots = normalizeSlots({})
    const session: Session = {
      id,
      streams: new Set(),
      lastSeen: Date.now(),
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
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${created.id}; HttpOnly; SameSite=Lax; Path=/`)
    return created
  }

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
        const parsed = JSON.parse(body.toString('utf8'))
        if (!Array.isArray(parsed?.args)) return sendJson(res, 400, { ok: false, error: '요청 형식이 올바르지 않습니다.' })
        args = parsed.args
      }
      try {
        const value = await fn(session.ctx, ...args)
        return sendJson(res, 200, { ok: true, value: value === undefined ? null : value })
      } catch (e: unknown) {
        return sendJson(res, 200, { ok: false, error: e instanceof Error ? e.message : String(e) })
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
      const destDir = path.join(session.ctx.ws.root, 'S3-downloads', 'local-downloads')
      fs.mkdirSync(destDir, { recursive: true })
      const dest = path.join(destDir, name)
      await writeBodyToFile(req, dest, maxUpload)
      return sendJson(res, 200, { ok: true, value: { name, path: dest } })
    }

    return sendJson(res, 404, { ok: false, error: '없는 경로입니다.' })
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      const status = (e as { status?: number })?.status ?? 500
      // 응답을 다 보낸 뒤 연결을 닫는다. 남은 본문(큰 업로드 등)을 끝까지 받지 않기 위해서다.
      if (!res.headersSent) res.setHeader('Connection', 'close')
      res.on('finish', () => req.destroy())
      if (!res.headersSent) sendJson(res, status, { ok: false, error: status === 413 ? '요청이 너무 큽니다.' : '서버 오류입니다.' })
      else res.end()
    })
  })

  return { server, sessions }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) })
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
