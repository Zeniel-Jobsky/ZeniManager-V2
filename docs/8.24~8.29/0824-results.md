# 작업 결과 — 2026-08-24

> 작성자: BE-wookhyun
> 관련 문서: [requirements-analysis.md](./requirements-analysis.md)

오늘 진행한 작업 중 결과물로 남길 두 가지를 기록한다.

1. Electron 빌드 타겟 변경 (`portable` → `nsis`)
2. 실제 상담 데이터 기반 `client` 테이블 구축

---

## 1. Electron 빌드 타겟 변경: `portable` → `nsis`

### 배경 / 문제

빌드한 Windows `.exe`를 실행하면 창이 뜨기 전 로딩이 비정상적으로 오래 걸리는 문제가 있었다.

원인은 렌더러 코드나 네트워크 호출이 아니라 **[electron-builder.yml](../../electron-builder.yml)의 Windows 빌드 타겟 설정**이었다.

```yaml
win:
  target:
    - target: portable
```

`portable` 타겟은 설치 과정 없이 exe 파일 하나로 배포하는 방식인데, 그 대신 **실행할 때마다 Electron 런타임 + 의존성 전체를 `%TEMP%`에 압축 해제한 뒤 구동**하는 구조다. 인스톨러(NSIS)처럼 한 번만 설치하고 이후에는 설치된 실행 파일을 바로 띄우는 게 아니라, 더블클릭할 때마다 압축 해제 과정을 반복한다.

여기에 같은 파일의 `compression: maximum` 설정이 겹쳐, 압축률은 높지만 그만큼 해제 시 CPU 연산이 늘어나 로딩이 더 길어졌다. 이 프로젝트는 Electron 런타임(약 150~200MB) 외에도 `xlsx`, `pdfjs-dist`, `recharts`, `framer-motion`, `@supabase/supabase-js` 등 무거운 의존성을 함께 패키징하고 있어, 매번 압축 해제해야 하는 portable 방식과 특히 궁합이 좋지 않았다.

### 조치

`win.target`을 `portable`에서 `nsis`(설치형)로 변경하고, 설치 마법사 옵션을 추가했다.

```diff
 win:
   executableName: ZeniManager
   icon: electron/icons/zeniel-logo.ico
   target:
-    - target: portable
+    - target: nsis
       arch:
         - x64
+
+nsis:
+  oneClick: false
+  allowToChangeInstallationDirectory: true
+  createDesktopShortcut: true
+  createStartMenuShortcut: true
```

- `oneClick: false`: 원클릭 설치가 아닌, 설치 경로를 고를 수 있는 마법사 형태
- `allowToChangeInstallationDirectory: true`: 설치 폴더 변경 허용
- 바탕화면 / 시작메뉴 바로가기 자동 생성

nsis 타겟은 한 번 설치하면 이후 실행은 설치된 위치의 exe를 바로 구동하므로, 매 실행마다 반복되던 압축 해제 과정이 사라진다.

### 빌드 및 검증

`pnpm electron:build:win`으로 재빌드했다.

- 1차 시도: Windows 코드사이닝(`signtool.exe`) 단계에서 `ELIFECYCLE Command failed`로 실패. macOS에서 Windows용 exe를 만들 때 electron-builder가 인증서 없이도 Wine을 통해 자동 서명을 시도하다가 실패하는 문제였다.
- 2차 시도: 빌드 시 `CSC_IDENTITY_AUTO_DISCOVERY=false` 환경 변수를 추가해 자동 서명 시도를 비활성화. 정상적으로 빌드 완료.

**산출물**: `release/1.0.0/상담 관리 시스템 Setup 1.0.0.exe` (약 148MB)

같은 방식으로 macOS용 빌드(`pnpm electron:build:mac`)도 진행해 이 Mac(Apple Silicon)에서 직접 실행 확인했다.

- x64 / arm64 각각의 `.zip`과 `.app`은 정상 생성됨 (ad-hoc 서명으로 폴백).
- `.dmg`는 [electron-builder.yml](../../electron-builder.yml)의 `dmg.background`가 가리키는 `electron/icons/dmg-background.png` 파일이 저장소에 없어 실패함 — 기존에 누락되어 있던 리소스로, 이번 작업 범위 밖의 별도 이슈로 남겨둠 (DMG 배포가 필요해지면 배경 이미지 추가 필요).

### 남은 참고 사항

- Windows/Mac 모두 **정식 서명 인증서가 없는 상태**로 빌드했다. 그대로 배포하면 Windows SmartScreen, macOS Gatekeeper 경고가 뜬다 (사용자가 "추가 정보 → 실행" / "확인 없이 열기"로 우회 가능하나, 정식 배포 전에는 서명 인증서 적용을 검토해야 함).
- Vite 빌드 산출물 중 `index-*.js` 청크가 1.6MB(gzip 487KB)로 500KB 경고 기준을 초과하고 있음 — 코드 스플리팅(`build.rollupOptions.output.manualChunks`)으로 개선 여지가 있으나 이번 작업 범위 밖.

---

## 2. 실제 상담 데이터 기반 `client` 테이블 구축

### 작업 내용

기존에 엑셀로 관리하던 상담 기록을 CSV로 변환한 뒤 Supabase의 `client` 테이블에 저장했다.

### 대상 테이블 구조

현재 앱이 실제로 조회하는 `client` 테이블은 [client/src/lib/api.ts:177-227](../../client/src/lib/api.ts#L177-L227)의 `CLIENT_SELECT_FIELDS`에 정의된 컬럼을 사용한다. 주요 컬럼:

| 구분 | 컬럼 (예시) |
|---|---|
| 식별/기본정보 | `client_id`, `client_name`, `counselor_id`, `age`, `gender_code`, `birth_date`, `email` |
| 연락처 | `phone_encrypted` |
| 학력 | `education_level`, `school_name`, `major` |
| 참여 정보 | `business_type_code`, `participation_type`, `participation_stage` |
| 희망 조건 (정형) | `desired_job_1~3`, `desired_area_1~3`, `desired_payment`, `hire_type` |
| 취업 결과 | `hire_place`, `hire_job_type`, `hire_date`, `hire_payment` |
| 사후관리 | `continue_serv_1/6/12/18_date`, `continue_serv_*_stat` |
| 비정형 메모 | `memo` |
| 기타 | `address_1/2`, `has_car`, `is_working_parttime`, `can_drive`, `MBTI` |
| 연관 테이블 | `business_code(participate_type)`, `allowance_log(round, apply_date)` |

엑셀에 있던 정형 필드(성명, 나이, 성별, 희망직무, 참여유형 등)는 위 컬럼에 그대로 매핑되고, 자유서술 상담 내용은 `memo` 컬럼에 저장하는 구조다.

### 확인 필요 / 주의 사항

- `phone_encrypted` 컬럼명으로 볼 때, 연락처는 앱에서 [client/src/lib/crypto.ts](../../client/src/lib/crypto.ts)의 암호화 유틸(`encrypt`/`decrypt`, `VITE_ENCRYPTION_KEY` 기반)로 암호화된 값을 저장하는 것으로 보인다. CSV를 그대로 DB에 넣었다면 전화번호가 **평문으로 저장되어 있을 가능성**이 있으니, 화면에서 연락처가 정상적으로 표시/복호화되는지 별도 확인이 필요하다.
- 아래 항목은 이번 문서화 시점에 확정되지 않아 TBD로 남겨둔다. 확인되는 대로 보완한다.
  - [ ] 마이그레이션에 사용한 스크립트/도구 (수작업 CSV import vs 별도 변환 스크립트)
  - [ ] 이관된 레코드 건수
  - [ ] 엑셀 → CSV 변환 시 인코딩/컬럼명 매핑 이슈 여부
  - [ ] `phone_encrypted` 등 암호화가 필요한 컬럼의 실제 저장 상태(평문/암호문) 확인

---

## 다음 단계 (TODO)

- [ ] DMG 배포용 `dmg-background.png` 리소스 추가
- [ ] Windows/Mac 코드사이닝 인증서 적용 검토
- [ ] `client` 테이블 마이그레이션 세부 이력(건수, 도구, 이슈) 보완
- [ ] `phone_encrypted` 컬럼 암호화 상태 점검
