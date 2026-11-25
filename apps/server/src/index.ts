import fs from 'fs'
import { createTaggerServer } from './server'
import { loadConfig } from './config'

// Web API 서버 시작점. 127.0.0.1에만 묶는다. 바깥 요청은 Nginx가 넘겨준다.
// 설정이 잘못되었거나 포트가 쓰이고 있으면 다른 값으로 바꾸지 않고 멈춘다.
let config
try {
  config = loadConfig(process.env)
} catch (e: unknown) {
  console.error(`설정 오류: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}

// 운영은 입장 화면의 "들어가기"로 세션을 만든다. 개발(내 PC)은 입장 화면 없이 바로 연다.
const openAccess = !config.production
if (openAccess) console.warn('개발 모드: 입장 화면 없이 열어 둡니다.')

const { server } = createTaggerServer({ ...config.server, openAccess })
const where = config.socket ?? `127.0.0.1:${config.port}`
server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `${where}를 이미 쓰고 있습니다.` : '서버를 시작하지 못했습니다.')
  process.exit(1)
})
const mode = config.production ? 'production' : 'development'

if (config.socket) {
  const sock = config.socket
  // 지난 실행이 남긴 소켓 파일을 지운다. (systemd RuntimeDirectory를 쓰면 보통 없다)
  if (!sock.startsWith('\\\\.\\pipe\\') && fs.existsSync(sock)) fs.rmSync(sock, { force: true })
  server.listen(sock, () => {
    // 같은 그룹(Nginx의 www-data)만 쓸 수 있게 한다.
    if (!sock.startsWith('\\\\.\\pipe\\')) fs.chmodSync(sock, 0o660)
    console.log(`tagger web api: ${sock} (${mode})`)
  })
} else {
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`tagger web api: http://127.0.0.1:${config.port} (${mode})`)
  })
}

// systemd가 멈추라고 하면 연결을 정리하고 끝낸다.
process.on('SIGTERM', () => server.close(() => process.exit(0)))
