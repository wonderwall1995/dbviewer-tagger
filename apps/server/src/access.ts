import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// Web 입장 코드 (공용 비밀번호 하나). 모든 면접관이 같은 코드를 쓴다.
// 서버에는 코드 원문을 두지 않고 scrypt 해시와 만료 시각만 <dataDir>/access.json 에 둔다 (권한 600).
// 코드는 관리 명령(admin.ts)으로 만들고, 만들 때 한 번만 화면에 보여 준다.

export interface AccessRecord {
  version: 1
  salt: string
  hash: string
  createdAt: string
  expiresAt: string
}

export const DEFAULT_CODE_DAYS = 60
// 헷갈리는 글자(0/O, 1/I/L)를 뺀 글자로 4글자씩 3묶음. 약 60비트.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function accessFile(dataDir: string): string {
  return path.join(dataDir, 'access.json')
}

export function generateCode(): string {
  const groups: string[] = []
  for (let g = 0; g < 3; g++) {
    let s = ''
    for (let i = 0; i < 4; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)]
    groups.push(s)
  }
  return groups.join('-')
}

// 입력한 코드를 비교하기 좋게 다듬는다: 대문자, 공백·하이픈 제거.
function normalize(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '')
}

function hashCode(code: string, salt: Buffer): Buffer {
  return crypto.scryptSync(normalize(code), salt, 32)
}

export function writeAccess(dataDir: string, code: string, days = DEFAULT_CODE_DAYS, now = new Date()): AccessRecord {
  const salt = crypto.randomBytes(16)
  const record: AccessRecord = {
    version: 1,
    salt: salt.toString('hex'),
    hash: hashCode(code, salt).toString('hex'),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
  }
  fs.mkdirSync(dataDir, { recursive: true })
  const file = accessFile(dataDir)
  fs.writeFileSync(file, JSON.stringify(record, null, 2), { encoding: 'utf-8', mode: 0o600 })
  try { fs.chmodSync(file, 0o600) } catch { /* Windows는 권한 비트를 쓰지 않는다 */ }
  return record
}

export function readAccess(dataDir: string): AccessRecord | null {
  try {
    const r = JSON.parse(fs.readFileSync(accessFile(dataDir), 'utf-8')) as AccessRecord
    if (r?.version !== 1 || typeof r.salt !== 'string' || typeof r.hash !== 'string' || typeof r.expiresAt !== 'string') return null
    return r
  } catch {
    return null
  }
}

export function revokeAccess(dataDir: string): boolean {
  const file = accessFile(dataDir)
  if (!fs.existsSync(file)) return false
  fs.rmSync(file, { force: true })
  return true
}

export type CheckResult = 'ok' | 'wrong' | 'expired' | 'no-code'

// 코드가 맞는지 확인한다. 비교는 시간이 일정한 방법(timingSafeEqual)으로 한다.
export function checkCode(record: AccessRecord | null, input: unknown, now = Date.now()): CheckResult {
  if (!record) return 'no-code'
  if (typeof input !== 'string' || input.length === 0 || input.length > 64) return 'wrong'
  const expected = Buffer.from(record.hash, 'hex')
  const actual = hashCode(input, Buffer.from(record.salt, 'hex'))
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return 'wrong'
  if (now > Date.parse(record.expiresAt)) return 'expired'
  return 'ok'
}

// 같은 곳(IP)에서 입장 실패가 이어지면 잠시 막는다. 기본: 10분 동안 10번 실패하면 그 10분이 지날 때까지 막음.
export class LoginLimiter {
  private fails = new Map<string, number[]>()
  constructor(private max = 10, private windowMs = 10 * 60 * 1000) {}

  blocked(key: string, now = Date.now()): boolean {
    const list = (this.fails.get(key) ?? []).filter((t) => now - t < this.windowMs)
    this.fails.set(key, list)
    return list.length >= this.max
  }

  fail(key: string, now = Date.now()): void {
    const list = (this.fails.get(key) ?? []).filter((t) => now - t < this.windowMs)
    list.push(now)
    this.fails.set(key, list)
  }

  clear(key: string): void {
    this.fails.delete(key)
  }
}
