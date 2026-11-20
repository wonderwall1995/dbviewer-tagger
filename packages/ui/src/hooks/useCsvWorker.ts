import { useRef, useCallback } from 'react'
import type { ParsedCsv } from '@tagger/shared'

type PendingEntry = {
  resolve: (v: ParsedCsv) => void
  reject: (r: string) => void
}

export function useCsvWorker() {
  const workerRef = useRef<Worker | null>(null)
  const pending = useRef<Map<number, PendingEntry>>(new Map())
  const counter = useRef(0)

  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('../workers/csvParser.worker.ts', import.meta.url),
        { type: 'module' }
      )
      workerRef.current.addEventListener('message', (e: MessageEvent<{ id: number; result?: ParsedCsv; error?: string }>) => {
        const { id, result, error } = e.data
        const entry = pending.current.get(id)
        if (!entry) return
        pending.current.delete(id)
        if (error) entry.reject(error)
        else entry.resolve(result!)
      })
    }
    return workerRef.current
  }, [])

  const parseCsv = useCallback(
    // allowMeta: DB에서 내보낸 CSV(DB-downloads 아래)일 때만 true. 제약 행·타입 행을 찾는다.
    (name: string, content: string, allowMeta = false): Promise<ParsedCsv> =>
      new Promise((resolve, reject) => {
        const id = ++counter.current
        pending.current.set(id, { resolve, reject })
        getWorker().postMessage({ id, name, content, allowMeta })
      }),
    [getWorker]
  )

  return { parseCsv }
}
