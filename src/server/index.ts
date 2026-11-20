import path from 'path'
import { createTaggerServer } from './server'

// Web API 서버 시작점. 127.0.0.1에만 묶는다. 바깥 요청은 Nginx가 넘겨준다.
// 포트가 쓰이고 있으면 다른 포트로 옮겨 가지 않고 멈춘다.
const port = Number(process.env.TAGGER_PORT ?? 6201)
const dataDir = path.resolve(process.env.TAGGER_DATA_DIR ?? path.join(process.cwd(), 'local', 'web-data'))

const { server } = createTaggerServer({ dataDir })
server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `포트 ${port}를 이미 쓰고 있습니다.` : '서버를 시작하지 못했습니다.')
  process.exit(1)
})
server.listen(port, '127.0.0.1', () => {
  console.log(`tagger web api: http://127.0.0.1:${port}`)
})
