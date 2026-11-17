import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { RemoteOps } from './sshAlias'

interface LocalCed { dir: string; files: string[]; skippedDrafts: number }
interface Session { ops: RemoteOps; root: string; close: () => void; transport: 'ssh-exec' | 'sftp' }
interface Dependencies {
  dataRoot: () => string
  generate: (product: string | null) => LocalCed
  connect: () => Promise<Session>
  describeError: (error: unknown) => string
}

const remoteJoin = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/')
const hash = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex')
const notFound = (error: unknown) => (error as { code?: number })?.code === 2

// 전송 기록은 작업 폴더에만 둔다. 접속 정보, 절대 경로, 본문, 오류 원문은 기록하지 않는다.
function startLog(root: string) {
  const requestId = crypto.randomUUID()
  let sequence = 0
  return (event: string, detail: Record<string, unknown> = {}) => {
    try {
      const dir = path.join(root, 'local', 'logs')
      fs.mkdirSync(dir, { recursive: true })
      fs.appendFileSync(path.join(dir, 'ced-transfer.jsonl'), JSON.stringify({
        version: 1, time: new Date().toISOString(), requestId, sequence: ++sequence, event, ...detail,
      }) + '\n', 'utf8')
    } catch { console.warn('[ced-transfer] 로그를 저장하지 못했습니다') }
  }
}

export function createCedSender(deps: Dependencies) {
  return async (_event: unknown, product: string | null) => {
    const log = startLog(deps.dataRoot())
    const started = Date.now()
    log('transfer.requested')
    let session: Session | null = null
    let local: LocalCed | null = null
    let stage = 'local.generate'
    try {
      local = deps.generate(product)
      const docs = local.files.filter(f => f.toLowerCase().endsWith('.md'))
      const base = { dir: local.dir, skippedDrafts: local.skippedDrafts, written: [] as string[], updated: [] as string[], unchanged: [] as string[], conflicts: [] as string[], leftover: [] as string[] }
      log('local.generated', { documents: docs.length, skippedDrafts: local.skippedDrafts })
      if (docs.length <= 1) {
        log('transfer.completed', { noNotes: true, durationMs: Date.now() - started })
        return { ok: true as const, ...base, noNotes: true }
      }

      stage = 'ssh.connect'
      log('ssh.connecting')
      session = await deps.connect()
      const ops = session.ops
      // 별칭 방식은 세션을 지연 생성하므로 stat의 성공 뒤에 연결 완료를 기록한다.
      await ops.stat(session.root)
      log('ssh.connected', { transport: session.transport })
      stage = 'remote.directory'
      let remoteDir = session.root
      for (const segment of ['CED', path.basename(local.dir)]) {
        remoteDir = remoteJoin(remoteDir, segment)
        try { await ops.stat(remoteDir) } catch (error) {
          if (!notFound(error)) throw error
          await ops.mkdir(remoteDir)
        }
      }
      log('remote.directory_ready')
      let state: Record<string, string> = {}
      try {
        const parsed = JSON.parse((await ops.readFile(remoteJoin(remoteDir, '.ced-state.json'))).toString('utf8'))
        if (parsed && typeof parsed.files === 'object') state = parsed.files
      } catch { /* 상태를 읽지 못하면 기존 파일을 덮어쓰는 근거로 쓰지 않는다. */ }
      const nextState: Record<string, string> = {}
      const put = async (name: string, buf: Buffer) => {
        const target = remoteJoin(remoteDir, name)
        const tmp = `${target}.tmp-${crypto.randomUUID()}`
        await ops.writeFile(tmp, buf)
        if ((await ops.stat(tmp)).size !== buf.length) {
          await ops.unlink(tmp).catch(() => {})
          throw new Error(`${name}: 전송한 크기가 달라요`)
        }
        await ops.rename(tmp, target)
      }
      stage = 'remote.files'
      for (const name of docs) {
        if (/[\\/]/.test(name)) continue
        const buf = fs.readFileSync(path.join(local.dir, name))
        const digest = hash(buf)
        let existing: Buffer | null = null
        try { existing = await ops.readFile(remoteJoin(remoteDir, name)) } catch (error) { if (!notFound(error)) throw error }
        let outcome: 'written' | 'updated' | 'unchanged' | 'conflicts'
        if (existing === null) {
          await put(name, buf); outcome = 'written'; nextState[name] = digest
        } else if (hash(existing) === digest) {
          outcome = 'unchanged'; nextState[name] = digest
        } else if (state[name] && state[name] === hash(existing)) {
          await put(name, buf); outcome = 'updated'; nextState[name] = digest
        } else {
          outcome = 'conflicts'
          if (state[name]) nextState[name] = state[name]
        }
        base[outcome].push(name)
        log(`file.${outcome}`, { file: name, bytes: buf.length, sha256: digest })
      }
      for (const name of Object.keys(state)) if (!docs.includes(name)) base.leftover.push(name)
      stage = 'remote.state'
      await ops.writeFile(remoteJoin(remoteDir, '.ced-state.json'), Buffer.from(JSON.stringify({ version: 1, files: nextState }, null, 2), 'utf8'))
      log('remote.state_saved')
      log('transfer.completed', {
        noNotes: false, written: base.written.length, updated: base.updated.length,
        unchanged: base.unchanged.length, conflicts: base.conflicts.length,
        leftover: base.leftover.length, durationMs: Date.now() - started,
      })
      return { ok: true as const, ...base, noNotes: false }
    } catch (error) {
      log('transfer.failed', { stage, durationMs: Date.now() - started })
      // 로컬 생성 실패는 기존 IPC와 같이 reject하여 UI의 오류 처리로 보낸다.
      if (!local) throw error
      return { ok: false as const, message: deps.describeError(error), dir: local.dir }
    } finally {
      session?.close()
    }
  }
}
