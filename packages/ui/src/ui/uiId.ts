// 화면 요소에 ID 속성을 붙이는 도우미.
// ID 목록과 이름 규칙은 프로젝트 루트의 ui-ids.md에 있다.
// 개발 모드에서만 속성을 만든다. 배포 빌드에서는 빈 객체를 돌려준다.

export const UI_ID_ATTR = 'data-ui-id'
export const UI_INSTANCE_ATTR = 'data-ui-instance'

type UiIdProps = Record<string, string>

// 사용법: <div {...uiId('SB.tree')}>
// 반복 항목에는 두 번째 인자로 항목 이름을 넘긴다: <div {...uiId('SB.file', fileName)}>
export function uiId(id: string, instance?: string): UiIdProps {
  if (!import.meta.env.DEV) return {}
  return instance
    ? { [UI_ID_ATTR]: id, [UI_INSTANCE_ATTR]: instance }
    : { [UI_ID_ATTR]: id }
}
