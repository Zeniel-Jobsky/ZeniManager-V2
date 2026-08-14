# Electron 빌드 가이드

상담 관리 시스템을 Windows 및 macOS 데스크탑 앱으로 패키징하는 방법을 설명합니다.

---

## 사전 요구사항

| 항목 | 버전 |
|------|------|
| Node.js | 18 이상 |
| pnpm | 10 이상 |
| Git | 최신 버전 |
| **Windows 빌드** | Windows 10/11 또는 Wine (Linux/macOS에서 크로스 빌드 시) |
| **macOS 빌드** | macOS 10.15 이상 (Xcode Command Line Tools 필요) |

---

## 프로젝트 구조 (Electron 관련)

```
counsel-admin-v2/
├── electron/
│   ├── main.js              # Electron 메인 프로세스
│   ├── preload.js           # 렌더러 ↔ 메인 IPC 브릿지
│   ├── entitlements.mac.plist  # macOS 권한 설정
│   └── icons/
│       ├── icon.icns        # macOS 아이콘 (빌드 전 추가 필요)
│       ├── icon.ico         # Windows 아이콘 (빌드 전 추가 필요)
│       ├── icon.png         # Linux / 범용 아이콘
│       └── README.md        # 아이콘 생성 방법
├── electron-builder.yml     # electron-builder 설정
├── vite.electron.config.ts  # Electron 전용 Vite 빌드 설정
└── client/src/hooks/
    └── useElectron.ts       # React IPC 훅
```

---

## 1단계: 아이콘 준비

빌드 전 `electron/icons/` 디렉토리에 아이콘 파일을 추가해야 합니다.

```bash
# electron-icon-builder로 자동 생성 (권장)
# 1024×1024 이상의 PNG 파일 필요
npx electron-icon-builder --input=zeniel-logo.png --output=electron/icons
```

자세한 방법은 `electron/icons/README.md` 참고.

---

## 2단계: 의존성 설치

```bash
pnpm install
```

`pnpm`이 의존성 빌드 스크립트를 제한한 환경에서도 루트 `postinstall`이 Electron 바이너리를 자동 복구합니다. 이미 설치된 상태에서 `Electron failed to install correctly` 오류가 나면 아래 명령으로 수동 복구 후 다시 실행하세요.

```bash
pnpm electron:ensure
```

---

## 3단계: 개발 모드 실행 (Electron)

```bash
pnpm electron:dev
```

Vite 개발 서버(포트 5181)가 시작된 후 Electron 창이 자동으로 열립니다.

> **참고**: 개발 모드에서는 Supabase 연결 없이 목업 데이터로 동작합니다.
> 로그인 화면 하단 **Supabase 연결 설정**에서 키를 입력하면 실제 데이터와 연결됩니다.

---

## 4단계: 프로덕션 빌드

### Windows (.exe NSIS 설치 파일 + Portable)

```bash
# Windows에서 실행
pnpm electron:build:win

# 출력 위치
# release/{version}/
#   ├── 상담 관리 시스템 Setup {version}.exe   ← NSIS 설치 파일
#   └── 상담 관리 시스템 {version}.exe         ← Portable 실행 파일
```

### macOS (.dmg + .zip)

```bash
# macOS에서 실행
pnpm electron:build:mac

# 출력 위치
# release/{version}/
#   ├── 상담 관리 시스템-{version}.dmg          ← DMG 설치 파일 (Intel)
#   ├── 상담 관리 시스템-{version}-arm64.dmg    ← DMG 설치 파일 (Apple Silicon)
#   └── 상담 관리 시스템-{version}-mac.zip      ← ZIP 압축 파일
```

### 전체 플랫폼 빌드 (현재 OS 기준)

```bash
pnpm electron:build
```

---

## 크로스 플랫폼 빌드

| 빌드 대상 | 빌드 환경 | 방법 |
|-----------|-----------|------|
| Windows x64 | Windows | `pnpm electron:build:win` |
| Windows x64 | macOS/Linux | Wine + `pnpm electron:build:win` |
| macOS | macOS | `pnpm electron:build:mac` |
| macOS | Windows/Linux | ❌ 불가 (Apple 정책) |
| Linux | 모든 OS | `pnpm electron:build:linux` |

> **macOS 앱은 반드시 macOS 환경에서 빌드해야 합니다.**

---

## 코드 서명 (선택, 배포 시 권장)

### Windows

```bash
# 환경 변수 설정
export CSC_LINK=path/to/certificate.pfx
export CSC_KEY_PASSWORD=your-password

pnpm electron:build:win
```

### macOS

```bash
# Apple Developer 인증서 필요
export CSC_LINK=path/to/certificate.p12
export CSC_KEY_PASSWORD=your-password
export APPLE_ID=your@apple.id
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx

pnpm electron:build:mac
```

> 서명 없이 배포하면 Windows SmartScreen 경고 및 macOS Gatekeeper 경고가 표시됩니다.

---

## 앱 내 Supabase 연결 설정

Electron 앱은 코드에 API 키를 포함하지 않습니다. 사용자가 직접 입력해야 합니다.

1. 앱 실행 후 로그인 화면 하단 **Supabase 연결 설정** 클릭
2. 또는 로그인 후 좌측 메뉴 **설정** 클릭
3. Supabase Project URL과 Anon Key 입력
4. **연결 테스트** 버튼으로 확인 후 저장

입력된 키는 기기의 `localStorage`에만 저장되며 외부로 전송되지 않습니다.

---

## Supabase 데이터베이스 설정

앱 사용 전 Supabase 프로젝트에 스키마를 적용해야 합니다.

1. [Supabase 대시보드](https://supabase.com/dashboard) → 프로젝트 선택
2. 좌측 메뉴 **SQL Editor** 클릭
3. `supabase_setup.sql` 파일 내용을 붙여넣고 **Run** 클릭
4. Authentication → Users에서 테스트 계정 생성
5. 생성된 UUID를 `supabase_setup.sql` 하단 주석의 INSERT 문에 입력하여 실행

---

## 빌드 스크립트 요약

| 스크립트 | 설명 |
|----------|------|
| `pnpm dev` | 웹 서버 개발 모드 (브라우저) |
| `pnpm electron:ensure` | Electron 바이너리 수동 복구 |
| `pnpm electron:dev` | Electron 개발 모드 (데스크탑) |
| `pnpm electron:build:win` | Windows 설치 파일 빌드 |
| `pnpm electron:build:mac` | macOS DMG 빌드 |
| `pnpm electron:build:linux` | Linux AppImage/deb 빌드 |
| `pnpm electron:build` | 현재 OS 기준 빌드 |
| `pnpm test` | 단위 테스트 실행 |
| `pnpm db:push` | Drizzle 스키마 마이그레이션 |
