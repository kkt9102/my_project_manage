# ProjectManage

PC에 등록한 개발 프로젝트와 GitHub 저장소를 한곳에서 찾는 Windows·macOS 데스크톱 앱입니다.

## 설치

[GitHub Releases](https://github.com/kkt9102/my_project_manage/releases)에서 운영체제에 맞는 파일을 받으세요.

| 운영체제 | 설치 파일 |
| --- | --- |
| Windows x64 | `ProjectManage-*-win-x64.exe` |
| macOS Apple Silicon | `ProjectManage-*-mac-arm64.dmg` |
| macOS Intel | `ProjectManage-*-mac-x64.dmg` |

현재 설치 파일에는 배포자 코드 서명이 적용되어 있지 않습니다. OS에서 배포자를 확인할 수 없다는 메시지가 표시될 수 있습니다. 릴리스의 `SHA256SUMS.txt`로 다운로드한 파일을 확인할 수 있습니다.

## 로컬 프로젝트

1. **로컬 프로젝트 → 프로젝트 등록**에서 소스 폴더를 선택합니다.
2. 감지한 프로젝트의 이름, 종류, 버전을 확인하고 등록합니다.
3. 목록에서 VS Code 또는 파일 탐색기로 프로젝트를 엽니다.

JS/TS(Next.js, NestJS 등), Ruby, Ruby on Rails, Rust, Java/Kotlin, Android, Swift, .NET, Python, Go와 정적 웹을 감지합니다. 프로젝트 설정과 소스 구조를 확인하며 버전을 파일에서 확인할 수 없으면 `—`로 표시합니다. 상위 폴더를 고르면 바로 아래의 하위 프로젝트를 찾습니다.

Git 상태와 브랜치를 보려면 Git이 설치되어 있어야 합니다. VS Code로 열려면 VS Code가 설치되어 있어야 합니다. 목록은 마지막 확인 결과를 표시하며 **새로고침**으로 갱신합니다. 앱을 닫으면 종료됩니다.

## GitHub 프로젝트

**GitHub로 연결**에서 다음 중 한 가지 방법을 선택합니다.

- **GitHub App** — [GitHub App 등록](https://github.com/settings/apps/new)에서 기기 흐름(Device Flow)을 켜고 조회에 필요한 저장소 권한만 선택합니다. 조회할 계정이나 저장소에 앱을 설치한 뒤 앱의 클라이언트 ID를 입력하고 브라우저에서 코드를 승인합니다. 설치 및 사용자 권한으로 접근 가능한 저장소가 표시됩니다. 토큰이 만료되면 다시 연결합니다.
- **개인 액세스 토큰** — [세분화된 토큰](https://github.com/settings/personal-access-tokens/new)을 만들고 표시할 저장소와 읽기 권한을 지정한 후 입력합니다.

GitHub 목록은 사용자가 저장소 동기화를 누를 때 갱신합니다. 등록한 로컬 폴더와 GitHub 저장소는 Git 원격 주소를 기준으로 연결됩니다.

앱이 저장하고 전송하는 데이터는 [개인정보 안내](PRIVACY.md)에서 확인할 수 있습니다.

## 개발

Node.js 22 이상을 사용합니다.

```sh
npm ci
npm start
npm run lint
npm test
```

`npm run build`는 현재 OS용 설치 파일을 `dist/`에 생성합니다. 버전 태그를 푸시하면 GitHub Actions가 macOS 및 Windows 설치 파일을 빌드해 릴리스에 첨부합니다.

## 라이선스

[MIT](LICENSE)
