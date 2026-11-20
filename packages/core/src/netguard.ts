import dns from 'dns'
import net from 'net'

// Web에서 면접관이 적은 DB 주소로 서버가 대신 접속한다. 이 주소로 서버 안쪽(같은 서버의 다른 DB, 클라우드 메타데이터 등)을
// 두드리지 못하게, 공인 주소만 허용한다. 검사한 IP로 그대로 접속해서, 검사 뒤 DNS가 바뀌는 경우도 막는다.

// IPv4 문자열 → 32비트 수
function v4ToInt(ip: string): number {
  return ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0
}

function inV4(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split('/')
  const mask = Number(bits) === 0 ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask)
}

// 공인 주소가 아닌 IPv4 범위
const BLOCKED_V4 = [
  '0.0.0.0/8',       // 이 네트워크
  '10.0.0.0/8',      // 사설망
  '100.64.0.0/10',   // 통신사 공유 주소
  '127.0.0.0/8',     // 루프백 (같은 서버)
  '169.254.0.0/16',  // 링크 로컬 (클라우드 메타데이터 169.254.169.254 포함)
  '172.16.0.0/12',   // 사설망
  '192.0.0.0/24',    // 프로토콜용
  '192.0.2.0/24',    // 문서용
  '192.168.0.0/16',  // 사설망
  '198.18.0.0/15',   // 성능 시험용
  '198.51.100.0/24', // 문서용
  '203.0.113.0/24',  // 문서용
  '224.0.0.0/4',     // 멀티캐스트
  '240.0.0.0/4',     // 예약 (255.255.255.255 포함)
]

// IPv6 주소를 16바이트로 푼다. 표기가 달라도(축약 안 함, ::, 끝의 IPv4 표기) 같은 주소면 같은 바이트가 된다.
// 문자열 모양으로 판정하면 0:0:0:0:0:0:0:1 이나 ::ffff:7f00:1 같은 같은 주소의 다른 표기를 놓친다.
export function ipv6ToBytes(ip: string): number[] | null {
  let s = ip.toLowerCase()
  const zone = s.indexOf('%')
  if (zone >= 0) s = s.slice(0, zone)
  if (net.isIPv6(s) === false) return null
  // 끝이 IPv4 표기면 16비트 두 묶음으로 바꾼다.
  const v4tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (v4tail) {
    const n = v4ToInt(v4tail[1])
    s = s.slice(0, -v4tail[1].length) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16)
  }
  const [head, tail] = s.includes('::') ? s.split('::') : [s, null]
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const groups = tail === null ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t]
  if (groups.length !== 8) return null
  const bytes: number[] = []
  for (const g of groups) {
    const v = parseInt(g || '0', 16)
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) return null
    bytes.push((v >> 8) & 0xff, v & 0xff)
  }
  return bytes
}

function startsWith(bytes: number[], prefix: number[], bits: number): boolean {
  for (let i = 0; i < bits; i++) {
    const byte = i >> 3
    const mask = 0x80 >> (i & 7)
    if ((bytes[byte] & mask) !== (prefix[byte] & mask)) return false
  }
  return true
}

const V6 = (s: string) => ipv6ToBytes(s) as number[]
// 공인 주소가 아니거나 다른 주소를 감싸 내부로 갈 수 있는 IPv6 범위
const BLOCKED_V6: Array<[number[], number]> = [
  [V6('::'), 128],            // 지정 안 됨
  [V6('::1'), 128],           // 루프백
  [V6('64:ff9b::'), 96],      // NAT64 (IPv4를 감쌈)
  [V6('64:ff9b:1::'), 48],    // 로컬 NAT64
  [V6('100::'), 64],          // 버림용
  [V6('2001::'), 32],         // Teredo 터널
  [V6('2001:db8::'), 32],     // 문서용
  [V6('fc00::'), 7],          // 고유 로컬 (사설망)
  [V6('fe80::'), 10],         // 링크 로컬
  [V6('fec0::'), 10],         // 사이트 로컬 (폐지됨)
  [V6('ff00::'), 8],          // 멀티캐스트
]

function v4FromBytes(b: number[], at: number): string {
  return `${b[at]}.${b[at + 1]}.${b[at + 2]}.${b[at + 3]}`
}

export function isPublicAddress(ip: string): boolean {
  if (typeof ip !== 'string') return false
  if (net.isIPv4(ip)) return !BLOCKED_V4.some((c) => inV4(ip, c))
  const b = ipv6ToBytes(ip)
  if (!b) return false
  // IPv4를 담은 IPv6는 안의 IPv4로 판단한다: ::ffff:a.b.c.d (mapped), ::a.b.c.d (호환, 폐지됨), 2002:aabb:ccdd:: (6to4)
  const first10Zero = b.slice(0, 10).every((x) => x === 0)
  if (first10Zero && b[10] === 0xff && b[11] === 0xff) return isPublicAddress(v4FromBytes(b, 12))
  if (first10Zero && b[10] === 0 && b[11] === 0 && !(b.slice(12).every((x) => x === 0) || (b.slice(12, 15).every((x) => x === 0) && b[15] === 1))) {
    return isPublicAddress(v4FromBytes(b, 12))
  }
  if (b[0] === 0x20 && b[1] === 0x02) return isPublicAddress(v4FromBytes(b, 2))
  return !BLOCKED_V6.some(([prefix, bits]) => startsWith(b, prefix, bits))
}

// DB 포트: PostgreSQL 기본 포트와 1024 이상만. 서버를 다른 서비스(22, 80 등) 두드리는 데 쓰지 못하게 한다.
export function isAllowedDbPort(port: number): boolean {
  return Number.isInteger(port) && (port === 5432 || (port >= 1024 && port <= 65535))
}

// 호스트 이름을 풀어 공인 주소 하나를 돌려준다. 풀린 주소 중 하나라도 공인이 아니면 거절한다.
export async function resolvePublicHost(host: string): Promise<string> {
  const name = host.trim()
  if (name === '') throw new Error('DB 호스트가 비어 있습니다.')
  const addrs = net.isIP(name)
    ? [{ address: name }]
    : await dns.promises.lookup(name, { all: true, verbatim: true }).catch(() => {
      throw new Error('DB 호스트 이름을 찾지 못했습니다.')
    })
  if (addrs.length === 0) throw new Error('DB 호스트 이름을 찾지 못했습니다.')
  if (!addrs.every((a) => isPublicAddress(a.address))) {
    throw new Error('이 환경에서는 공인 인터넷 주소의 DB에만 연결할 수 있습니다.')
  }
  return addrs[0].address
}
