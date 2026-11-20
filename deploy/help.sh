#!/usr/bin/env bash
# 서버 명령 목록을 보여 준다.   (pnpm server:help)
cat <<'EOF'
DBViewer-tagger Web 서버 명령 (EC2에서, 저장소 폴더 안에서 실행)

  자주 쓰는 것
    pnpm server:up                 main을 받아 배포 (PR을 병합한 뒤 이것만 치면 됨)
    pnpm server:status             상태 한눈에 보기 (주소, 버전, 응답, 세션 수, 입장 코드 만료)
    pnpm server:rollback           문제가 생기면 바로 전 버전으로 되돌리기 (빌드 없음)

  입장 코드 (면접관 모두가 쓰는 공통 코드 하나)
    pnpm server:code status        코드가 있는지, 언제 만료되는지
    pnpm server:code set-code      새 코드 만들기 (기본 60일, 화면에 한 번만 보임)
    pnpm server:code set-code --days 30
    pnpm server:code revoke        새 입장 막기

  가끔 쓰는 것
    pnpm server:logs               서비스 로그 보기
    pnpm server:setup              서버 설정 다시 깔기 (서비스 설정이 바뀌었을 때. 도메인은 기억해 둔 것을 씀)
    pnpm server:up <커밋>           main에 들어 있는 특정 커밋으로 배포

  주의
    - 배포하면 그 순간 들어와 있던 면접관의 작업이 지워집니다. 면접관이 쓰는 시간은 피하세요.
    - 입장 코드는 채팅이나 저장소에 적지 마세요.
EOF
