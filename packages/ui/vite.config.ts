import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 6200,
    // Fail if the port is in use. The Electron main process needs this exact port.
    strictPort: true,
    // Web 모드(pnpm dev:web): 화면의 /api 요청을 Web API 서버로 넘긴다. 데스크톱은 /api를 쓰지 않는다.
    proxy: {
      // '/api/'처럼 끝에 /를 둔다. '/api'로 두면 화면 코드 파일 /api.ts까지 서버로 넘어가 화면이 뜨지 않는다.
      '/api/': { target: 'http://127.0.0.1:6201', changeOrigin: false },
    },
  },
})
