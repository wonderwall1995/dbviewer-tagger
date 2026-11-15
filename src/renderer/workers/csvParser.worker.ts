import { parseCsvContent } from '../hooks/useCsvParser'

self.addEventListener('message', (e: MessageEvent<{ id: number; name: string; content: string }>) => {
  const { id, name, content } = e.data
  try {
    const result = parseCsvContent(name, content)
    self.postMessage({ id, result })
  } catch (err) {
    self.postMessage({ id, error: String(err) })
  }
})
