import { parseCsvContent } from '../hooks/useCsvParser'

self.addEventListener('message', (e: MessageEvent<{ id: number; name: string; content: string; allowMeta: boolean }>) => {
  const { id, name, content, allowMeta } = e.data
  try {
    const result = parseCsvContent(name, content, allowMeta)
    self.postMessage({ id, result })
  } catch (err) {
    self.postMessage({ id, error: String(err) })
  }
})
