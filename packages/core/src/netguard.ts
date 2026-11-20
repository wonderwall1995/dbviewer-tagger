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

export function isPublicAddress(ip: string): boolean {
  const family = net.isIP(ip)
  if (family === 4) return !BLOCKED_V4.some((c) => inV4(ip, c))
  if (family === 6) {
    const lower = ip.toLowerCase()
    // IPv4를 담은 IPv6 (::ffff:a.b.c.d)는 안의 IPv4로 판단한다.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPublicAddress(mapped[1])
    if (lower === '::' || lower === '::1') return false
    const first = parseInt(lower.split(':')[0] || '0', 16)
    if ((first & 0xfe00) === 0xfc00) return false // fc00::/7 고유 로컬
    if ((first & 0xffc0) === 0xfe80) return false // fe80::/10 링크 로컬
    if ((first & 0xff00) === 0xff00) return false // ff00::/8 멀티캐스트
    if (lower.startsWith('64:ff9b:') || lower.startsWith('2001:db8:')) return false // 변환용, 문서용
    return true
  }
  return false
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
