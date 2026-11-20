import { Database } from 'lucide-react'
import { uiId } from '../ui/uiId'

interface DBButtonProps {
  onClick?: () => void
}

export function DBButton({ onClick }: DBButtonProps) {
  return (
    <button className="db-browse-btn" onClick={onClick} title="DB" {...uiId('SB.db')}>
      <Database size={15} />
    </button>
  )
}
