// 보류 (LEGACY): 이 파일은 2026-10-14에 src/legacy로 옮겼다.
// 이유: 커스텀 테이블(제품 뷰어) 기능은 현재 범위에서 제외했다.
// 이 폴더는 빌드와 typecheck에 포함되지 않는다.
// 복원 방법은 같은 폴더의 README.md를 참조한다.

import { useState, useEffect } from 'react'
import { ProductViewer } from './ProductViewer'
import type { FileSource } from '@tagger/shared'

interface Props {
  product: string | null
  initialTableId: string | null
}

export function ProductViewerWindow({ product, initialTableId }: Props) {
  const [fileSources, setFileSources] = useState<Record<string, FileSource>>({})
  const [fileComments, setFileComments] = useState<Record<string, string>>({})
  const [products, setProducts] = useState<string[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    Promise.all([
      window.electronAPI.localLoad(),
      window.electronAPI.lorebookGetCategories(),
    ]).then(([preset, cats]) => {
      setFileSources((preset?.fileSources ?? {}) as Record<string, FileSource>)
      setFileComments(preset?.fileComments ?? {})
      setProducts(cats ?? [])
      setReady(true)
    }).catch(() => setReady(true))
  }, [])

  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-3)', fontSize: 14 }}>
        로딩 중...
      </div>
    )
  }

  return (
    <ProductViewer
      fileSources={fileSources}
      activeProduct={product}
      products={products}
      fileComments={fileComments}
      onClose={() => window.close()}
      standalone
      initialTableId={initialTableId ?? undefined}
    />
  )
}
