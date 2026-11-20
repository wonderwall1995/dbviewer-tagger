// ~/.ssh/config의 Host 별칭으로 접속하는 방법. 시스템의 ssh 프로그램(OpenSSH 클라이언트)을 실행한다.
// 키 암호, ssh-agent, ProxyJump, Port 같은 사용자의 ssh 설정을 그대로 따른다.
// 암호를 물을 수 없으므로 BatchMode로 실행한다. (키에 암호가 없거나 ssh-agent에 키가 올라 있어야 한다)
// 이 파일은 electron에 기대지 않는다. 그래서 가짜 실행기로 시험할 수 있다.

import { spawn } from 'child_process'
import net from 'net'

// 별칭이 ssh의 옵션으로 읽히지 않게 글자를 제한한다. (예: -oProxyCommand=...)
export const isSafeAlias = (alias: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._@-]*$/.test(alias)

// 원격 셸에 넘기는 경로는 작은따옴표로 감싼다. (공백, 한글, 작은따옴표가 들어 있어도 한 덩어리로 읽힌다)
export const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

export interface RemoteOps {
  stat(p: string): Promise<{ isDirectory: boolean; size: number }>
  readdir(p: string): Promise<Array<{ filename: string; isDirectory: boolean }>>
  mkdir(p: string): Promise<void>
  readFile(p: string): Promise<Buffer>
  writeFile(p: string, data: Buffer): Promise<void>
  unlink(p: string): Promise<void>
  rename(from: string, to: string): Promise<void>
}

export type RunResult = { code: number; out: Buffer; err: string }
export type Runner = (command: string, input?: Buffer) => Promise<RunResult>

// 원격 명령은 기존 터널의 LocalForward를 다시 열지 않는다. -W 연결에도 같은 규칙을 쓴다.
// 암호를 묻지 않고, 10초 안에 연결되지 않으면 포기하고, 30초마다 살아 있는지 확인한다.
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3']

// ssh가 남긴 오류 문구를 사용자가 이해할 수 있는 말로 바꾼다.
export function friendlySshError(stderr: string): string {
  const e = stderr.trim()
  if (/Permission denied/i.test(e)) return 'SSH 인증에 실패했어요. 키에 암호가 있으면 ssh-agent에 키를 올리거나, 암호 없는 키를 써 주세요'
  if (/Could not resolve hostname/i.test(e)) return 'SSH 별칭이나 호스트를 찾을 수 없어요. ~/.ssh/config의 Host 이름을 확인해 주세요'
  if (/Connection refused/i.test(e)) return 'SSH 서버에 연결하지 못했어요 (연결 거부). 서버가 켜져 있는지 확인해 주세요'
  if (/timed out|No route to host|Network is unreachable/i.test(e)) return 'SSH 서버에 닿지 못했어요 (시간 초과). 같은 네트워크인지 확인해 주세요'
  if (/Host key verification failed/i.test(e)) return '처음 접속하는 서버예요. 터미널에서 ssh로 한 번 접속해 호스트 키를 등록해 주세요'
  return e.split('\n').filter(Boolean).slice(-1)[0] ?? 'SSH 실행에 실패했어요'
}

// 시스템 ssh로 원격 명령을 실행한다.
export function sshRunner(alias: string): Runner {
  return (command, input) =>
    new Promise((resolve, reject) => {
      if (!isSafeAlias(alias)) return reject(new Error('SSH 별칭에 쓸 수 없는 글자가 있어요'))
      const proc = spawn('ssh', [...SSH_OPTS, '--', alias, command], { windowsHide: true })
      const out: Buffer[] = []
      const err: Buffer[] = []
      proc.stdout.on('data', (d: Buffer) => out.push(d))
      proc.stderr.on('data', (d: Buffer) => err.push(d))
      proc.on('error', (e: NodeJS.ErrnoException) => {
        reject(new Error(e.code === 'ENOENT' ? '시스템에서 ssh 프로그램을 찾을 수 없어요. OpenSSH 클라이언트를 설치해 주세요' : e.message))
      })
      proc.on('close', (code) => resolve({ code: code ?? 1, out: Buffer.concat(out), err: Buffer.concat(err).toString('utf-8') }))
      proc.stdin.on('error', () => { /* 명령이 입력을 받기 전에 끝나면 생기는 오류. 종료 코드로 판단한다. */ })
      proc.stdin.end(input)
    })
}

// 원격 파일 동작을 셸 명령으로 한다. 원격은 Linux나 macOS 같은 POSIX 셸이어야 한다.
// 오류는 SFTP와 같은 번호(2 = 없음, 3 = 권한 없음)를 붙여 돌려준다.
export function makeExecOps(run: Runner): RemoteOps {
  const fail = (code: number, message: string) => Object.assign(new Error(message), { code })
  const check = (r: RunResult, what: string): RunResult => {
    if (r.code === 0) return r
    const e = r.err.trim()
    throw fail(/No such file|not found/i.test(e) ? 2 : /Permission denied/i.test(e) ? 3 : 1, friendlySshError(e) || `${what} 실패`)
  }
  return {
    // 쌍따옴표를 쓰지 않는다. (Windows의 ssh가 명령을 넘기는 과정에서 따옴표가 깨질 수 있다)
    async stat(p) {
      const r = check(await run(`if [ -d ${shq(p)} ]; then echo d; elif [ -f ${shq(p)} ]; then echo f; wc -c < ${shq(p)}; else echo n; fi`), 'stat')
      const lines = r.out.toString('utf-8').trim().split('\n').map((l) => l.trim())
      if (lines[0] === 'n') throw fail(2, '없음')
      if (lines[0] === 'd') return { isDirectory: true, size: 0 }
      return { isDirectory: false, size: Number(lines[1]) || 0 }
    },
    async readdir(p) {
      const r = check(await run(`ls -1Ap ${shq(p)}`), 'readdir')
      return r.out.toString('utf-8').split('\n').filter(Boolean).map((l) =>
        l.endsWith('/') ? { filename: l.slice(0, -1), isDirectory: true } : { filename: l, isDirectory: false },
      )
    },
    async mkdir(p) { check(await run(`mkdir ${shq(p)}`), 'mkdir') },
    async readFile(p) { return check(await run(`cat ${shq(p)}`), 'read').out },
    async writeFile(p, data) { check(await run(`cat > ${shq(p)}`, data), 'write') },
    async unlink(p) { check(await run(`rm ${shq(p)}`), 'rm') },
    async rename(from, to) { check(await run(`mv -f ${shq(from)} ${shq(to)}`), 'mv') },
  }
}

// 별칭으로 터널을 연다. 이 PC의 임시 포트로 들어온 연결마다 `ssh -W 호스트:포트 별칭`을 하나씩 실행해 이어 준다.
// -W는 ssh 설정에 적힌 LocalForward를 쓰지 않는다. 그래서 선생님이 따로 열어 둔 터널과 포트가 부딪히지 않는다.
export async function startAliasTunnel(alias: string, host: string, port: number): Promise<{ localPort: number; close: () => void }> {
  if (!isSafeAlias(alias)) throw new Error('SSH 별칭에 쓸 수 없는 글자가 있어요')
  if (!/^[A-Za-z0-9._:-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('서버 주소의 호스트나 포트가 올바르지 않아요')

  // 먼저 한 번 접속해 본다. 실패하면 ssh가 남긴 이유를 그대로 알려 준다.
  const probe = await sshRunner(alias)('true')
  if (probe.code !== 0) throw new Error(friendlySshError(probe.err))

  const sockets = new Set<net.Socket>()
  const server = net.createServer((sock) => {
    sockets.add(sock)
    const proc = spawn('ssh', [...SSH_OPTS, '-W', `${host}:${port}`, '--', alias], { windowsHide: true })
    sock.pipe(proc.stdin)
    proc.stdout.pipe(sock)
    proc.stderr.on('data', () => { /* 연결 실패는 소켓이 닫히는 것으로 전해진다. */ })
    proc.stdin.on('error', () => {})
    proc.on('error', () => sock.destroy())
    proc.on('exit', () => sock.destroy())
    sock.on('error', () => proc.kill())
    sock.on('close', () => { sockets.delete(sock); proc.kill() })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const localPort = (server.address() as net.AddressInfo).port
  return {
    localPort,
    close: () => {
      server.close()
      for (const s of sockets) s.destroy()
    },
  }
}
