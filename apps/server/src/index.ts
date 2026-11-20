import { createTaggerServer } from './server'
import { loadConfig } from './config'
import { readAccess } from './access'

// Web API 서버 시작점. 127.0.0.1에만 묶는다. 바깥 요청은 Nginx가 넘겨준다.
// 설정이 잘못되었거나 포트가 쓰이고 있으면 다른 값으로 바꾸지 않고 멈춘다.
let config
try {
  config = loadConfig(process.env)
} catch (e: unknown) {
  console.error(`설정 오류: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}

// 입장 코드: 운영은 늘 코드로만 들어온다. 개발(내 PC)은 코드 파일이 없으면 코드 없이 열어 둔다.
const hasCode = readAccess(config.server.dataDir) !== null
const openAccess = !config.production && !hasCode
if (config.production && !hasCode) {
  console.warn('입장 코드가 없습니다. 관리 명령 set-code 로 만들기 전에는 아무도 들어올 수 없습니다.')
}
if (openAccess) console.warn('개발 모드: 입장 코드 없이 열어 둡니다.')

const { server } = createTaggerServer({ ...config.server, openAccess })
server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `포트 ${config.port}를 이미 쓰고 있습니다.` : '서버를 시작하지 못했습니다.')
  process.exit(1)
})
server.listen(config.port, '127.0.0.1', () => {
  console.log(`tagger web api: http://127.0.0.1:${config.port} (${config.production ? 'production' : 'development'})`)
})
