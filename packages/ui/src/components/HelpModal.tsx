import { HelpCircle } from 'lucide-react'
import { Modal } from './Modal'
import { uiId } from '../ui/uiId'

// 도움말. 머리글 Help! 버튼의 창과 Web 입장 화면(WebGate)이 같은 내용을 보여 준다. 줄 안의 \n은 줄을 바꾼다. 창 폭은 가장 긴 줄에 맞춘다.
// 마지막 줄의 숫자는 코드의 값이다: DB 내보내기 CHUNK_SIZE(3,000행), CHUNK_DELAY_MS(150ms) — packages/core/src/db.ts,
// Web의 쿼리 시간 제한 30초(statement_timeout)·세션 디스크 200MB — apps/server/src/server.ts, 표의 쪽 크기 — DataGrid.tsx.
const LINES = [
  '시트는 CSV 파일들을 담고 있는 개별 Preset (예: local.json)을 포함합니다.',
  'CSV 파일은 DB의 테이블 스냅샷으로 구성됩니다. 다중 테이블 스냅샷을 지원합니다.',
  'Datagrid에서 Column 대상으로 선택해볼 경우,\nL과 K 버튼이 있습니다. K가 핵심 기능인 키 기록 기능입니다.',
  'Products 기능은 개별 DB가 다른 제품을 상정하는 케이스를 위해 있습니다. Hermes 전송에 분리를 위해 쓰입니다.',
  'Backup & Clear 기능이 있는 이유는 본 프로젝트가 Electron 대상으로 최초 설계되었기 때문입니다.',
  'DB 스냅샷은 테이블마다 3,000행씩 나눠 불러오고, 묶음 사이에 0.15초 쉬어 DB 부하를 나눕니다. (쉬는 시간만 따지면 초당 최대 약 2만 행)\n'
    + '테이블 하나는 읽기 전용 스냅샷 트랜잭션 안에서 커서로 읽어, 읽는 동안 원본이 바뀌어도 행이 빠지거나 겹치지 않습니다.\n'
    + 'Web에서는 쿼리 하나당 30초, 면접관 한 명당 디스크 200MB까지이며, 표는 100 / 500 / 1,000 / 2,500행 단위로 나눠 보여 줍니다.',
]

export function HelpTitle() {
  return <span className="help-title"><HelpCircle size={15} /> Help!</span>
}

export function HelpList() {
  return (
    <ul className="help-list" {...uiId('HP.list')}>
      {LINES.map((line, i) => (
        <li key={i} className="help-item">{line}</li>
      ))}
    </ul>
  )
}

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title={<HelpTitle />}
      uiCode="HP"
      onClose={onClose}
      cardClassName="help-modal-card"
    >
      <HelpList />
    </Modal>
  )
}
