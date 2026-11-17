# Rules
- `Korean`으로 ASD-STE100 가 쓰인 것처럼 본 작업에 대해 논하는 것을 권장한다.
- Specific developing section, functions 에 대한 Develop을 진행할 때, 개별 항목을 User에게 질문하며 진행한다.
- 본 문서를 수정하는데 있어 User의 허락을 구한다. - 본 문서 기준, 개발 진행 했고 Drop 시킨 내용에 대하여 본 문서 안에서 그 여부를 넘버링 옆에 라벨처럼 서술한다. 이 조건 충족시에만 문서 편집을 허락한다.
- Development 과정에서 상세한 기술 및 코드에 대한 질문을 묻는 대신 `자연어` 사용을 권장한다.
- LLMS가 본 문서의 내용 추가를 할 때, Oneline 작문을 기본으로 한다. 정보 제시가 더 필요한 상태, 맥락을 설명하는 상황에선 세션으로 LLM이 보충 조언한다.
- LLMS.md 파일은 공개 (Public) 될 내용의 일부이기에, 보안 내용의 작성을 엄금하며 User가 작성한 경우 LLM은 이것에 대한 주의를 표한다.
- 본 프로젝트는 Open 상태로 진행될 예정이다. 보안 또는 개인 정보 문제에 민감하게 참조할 것.

# Reference
- Keyinfo, CED 관련: Hermes가 CED를 세션 인식이나 AGENTS.md 재읽기에 기대지 않고 필요할 때 찾아 읽도록, Hermes 내부에 정보의 Indexing 및 읽어오기 소형 프로젝트를 따로 둔다.

# PURPOSE
- User의 포트폴리오 일환으로써 'Context Enrichment Docs'(이하, CED)를 생산하기 위한 목적이 주요하다.
- CED 작성을 위해 CSV를 탐색하고, DB에 연결하여 스키마와 테이블을 불러온다.
