# ProjectManage 개인정보 안내

ProjectManage는 사용자 PC에서 실행됩니다. 개발자 서버, 사용량 분석, 자동 오류 보고 기능을 사용하지 않습니다.

- **로컬 프로젝트** — 선택한 폴더에서 프로젝트 설정과 Git 정보를 확인합니다. 폴더 경로, 이름, 언어, 유형, 버전, Git 브랜치, 인증 정보가 제거된 원격 저장소 주소, 마지막 확인 시각은 이 PC의 앱 데이터 폴더에 저장합니다.
- **GitHub** — 사용자가 연결할 때 GitHub에 인증을 요청하고, 계정과 저장소 목록 조회 요청을 보냅니다. 계정명과 저장소 메타데이터는 로컬에 보관합니다. 토큰은 macOS Keychain 및 Windows DPAPI를 사용하는 OS 기반 암호화로 보호합니다. 프로젝트 소스와 로컬 폴더 경로는 GitHub에 전송하지 않습니다.
- **삭제** — 앱에서 프로젝트를 제거하면 저장 목록에서 해당 항목을 지웁니다. GitHub 연결을 해제하면 이 PC에서 토큰과 저장소 목록을 지웁니다. GitHub에서 권한도 취소하려면 계정의 [애플리케이션 설정](https://github.com/settings/applications)이나 [토큰 설정](https://github.com/settings/personal-access-tokens)에서 해제하세요.
- **앱 데이터** — 프로젝트 목록은 제거할 때까지, GitHub 계정 정보는 연결 해제할 때까지 로컬에 보관됩니다. macOS의 `~/Library/Application Support/ProjectManage`, Windows의 `%APPDATA%\ProjectManage`에서 앱 데이터를 지울 수 있습니다.

**CSV 내보내기** 시 사용자가 고른 경로에 프로젝트 목록을 저장합니다. 내보낸 파일은 사용자가 직접 관리하고 삭제할 수 있습니다.

GitHub의 데이터 처리는 [GitHub 개인정보 처리방침](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)을 따릅니다. 앱의 개인정보 관련 문의는 [저장소 이슈](https://github.com/kkt9102/my_project_manage/issues)에서 받습니다.
