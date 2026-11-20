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

const { server } = createTaggerServer(config.server)
server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `포트 ${config.port}를 이미 쓰고 있습니다.` : '서버를 시작하지 못했습니다.')
  process.exit(1)
})
server.listen(config.port, '127.0.0.1', () => {
  console.log(`tagger web api: http://127.0.0.1:${config.port} (${config.production ? 'production' : 'development'})`)
})
