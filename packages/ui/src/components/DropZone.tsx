import { useState } from 'react'
import { Upload, FolderOpen } from 'lucide-react'
import { uiId } from '../ui/uiId'

interface DropZoneProps {
  onDrop: (files: FileList) => void
  onOpenDialog: () => void
}

export function DropZone({ onDrop, onOpenDialog }: DropZoneProps) {
  const [dragging, setDragging] = useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }

  const handleDragLeave = () => setDragging(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length > 0) {
      onDrop(e.dataTransfer.files)
    }
  }

  return (
    <div
      className={`dropzone ${dragging ? 'dragging' : ''}`}
      {...uiId('MN.dropzone')}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Upload size={40} className="dropzone-icon" />
      <p className="dropzone-title">
        좌측 상단 DB 연결 후, 스키마 - 테이블을 다운로드 받아요.
        <br />
        Local 아이콘으로 사이드바에 불러와요
      </p>
      <p className="dropzone-sub">또는</p>
      <button className="btn-primary" onClick={onOpenDialog}>
        <FolderOpen size={16} />
        파일 선택
      </button>
    </div>
  )
}
