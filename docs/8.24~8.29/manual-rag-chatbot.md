# 국취제 매뉴얼 도우미 기능 문서

## 개요

국취제 매뉴얼 도우미는 국민취업지원제도 업무매뉴얼 PDF를 기반으로 상담사가 질문을 입력하면 관련 근거를 검색하고 답변을 생성하는 RAG 기반 챗봇 기능입니다.

일반 GPT처럼 자유롭게 답변하는 구조가 아니라, Supabase에 저장된 매뉴얼 청크를 먼저 검색한 뒤 검색된 근거 안에서만 답변하도록 구성했습니다. 답변에는 근거 수준, 참조 페이지, 관련 키워드를 함께 표시해 상담사가 원문 근거를 빠르게 확인할 수 있도록 했습니다.

## 프로젝트 계획서와의 연결

과제수행 계획서의 개선 필요성은 크게 다음 세 가지였습니다.

1. AI·데이터 기반 상담 전환
2. 구직자 맞춤형 상담 강화
3. 상담 데이터 자산화

국취제 매뉴얼 도우미는 이 중 특히 `AI·데이터 기반 상담 전환`과 직접 연결됩니다. 상담사 개인 경험에 의존하던 매뉴얼 확인 과정을 줄이고, 같은 질문에 대해 일관된 근거 기반 답변을 제공해 상담 품질 표준화에 기여합니다.

향후 상담자 상세 데이터, 상담 메모, 질문 로그와 연결하면 `구직자 맞춤형 상담 강화`와 `상담 데이터 자산화`까지 확장할 수 있습니다.

## 사용자 화면

- 메뉴 위치: 상담사 사이드바 > `국취제 매뉴얼 도우미`
- 라우트: `/dashboard/manual`
- 주요 기능:
  - 매뉴얼 질문 입력
  - 예시 질문 버튼 제공
  - 답변 신뢰도 표시
  - 최근 답변 출처 표시
  - 근거 페이지, 섹션명, 매칭 키워드 표시
  - 같은 사이드바 메뉴를 다시 클릭하면 페이지 새로고침

## 주요 파일

### 프론트엔드

- `client/src/App.tsx`
  - `/dashboard/manual` 라우트를 추가합니다.

- `client/src/components/DashboardLayout.tsx`
  - 상담사 사이드바에 `국취제 매뉴얼 도우미` 메뉴를 추가합니다.
  - 현재 페이지에서 같은 메뉴를 다시 누르면 페이지를 새로고침합니다.

- `client/src/lib/manualRag.ts`
  - Supabase Edge Function `manual-chat` 호출 로직과 응답 타입을 정의합니다.

- `client/src/pages/counselor/ManualRagChat.tsx`
  - 챗봇 UI 본문입니다.
  - 질문 입력, 답변 표시, 출처 표시, 근거 신뢰도 표시를 담당합니다.

### Supabase Edge Function

- `supabase/functions/manual-chat/index.ts`
  - 질문 임베딩 생성
  - 매뉴얼 청크 검색
  - 검색 근거 기반 답변 생성
  - 답변 로그 저장
  - 근거 부족 시 답변 차단

- `supabase/functions/tsconfig.check.json`
  - `manual-chat/**/*.ts`를 Edge Function 타입체크 대상에 포함합니다.

### 매뉴얼 RAG 리소스

- `manual-rag/sql/manual_rag.sql`
  - 매뉴얼 문서, 청크, 대화 로그 테이블 및 기본 RPC 정의

- `manual-rag/poc/match_manual_chunks_hybrid.sql`
  - 벡터 유사도와 키워드 매칭을 함께 사용하는 하이브리드 검색 RPC

- `manual-rag/ingest_manual_pdf.mjs`
  - PDF 텍스트 추출, 청크화, 임베딩 생성, Supabase 적재 스크립트

- `manual-rag/README.md`
  - SQL 적용, PDF 적재, Edge Function 배포 순서 정리

## 동작 흐름

1. 상담사가 `/dashboard/manual` 화면에서 질문을 입력합니다.
2. 프론트엔드가 Supabase Edge Function `manual-chat`을 호출합니다.
3. Edge Function이 질문을 임베딩합니다.
4. Supabase RPC가 매뉴얼 청크 중 관련도가 높은 내용을 검색합니다.
5. 관련도가 낮거나 핵심 키워드가 부족하면 답변을 생성하지 않습니다.
6. 관련 근거가 충분하면 GPT 모델이 검색된 청크 안에서만 답변을 생성합니다.
7. 프론트엔드가 답변, 신뢰도, 출처, 페이지, 매칭 키워드를 표시합니다.

## 검색 보강 사항

사용자는 보통 매뉴얼 표기인 `Ⅰ유형`, `Ⅱ유형`보다 `1유형`, `2유형`, `I유형`, `II유형`처럼 질문할 가능성이 높습니다.

이를 보완하기 위해 질문 키워드 추출 단계에서 다음 표현을 서로 연결했습니다.

- `1유형`, `I유형`, `Ⅰ유형`, `일유형`
- `2유형`, `II유형`, `Ⅱ유형`, `이유형`

또한 1유형과 2유형 비교 질문에서는 다음 키워드도 함께 검색하도록 확장했습니다.

- `참여유형`
- `지원내용`
- `취업지원서비스`
- `구직촉진수당`
- `취업활동비용`

## 일반 GPT 사용과의 차이

일반 GPT에 PDF를 업로드해 질문하는 방식과 비교했을 때, 이 기능의 차별점은 다음과 같습니다.

- 상담 업무 시스템 안에서 바로 사용할 수 있습니다.
- 답변과 함께 근거 페이지, 섹션, 매칭 키워드를 표시합니다.
- 근거가 부족하면 답변을 제한하도록 설계했습니다.
- 질문/답변/근거 로그를 저장해 향후 상담 품질관리와 FAQ 개선에 활용할 수 있습니다.
- 향후 상담자 상세 정보와 연결하면 개인별 상황을 반영한 매뉴얼 안내로 확장할 수 있습니다.

## 실행 및 검증

프론트엔드 타입체크:

```bash
pnpm check
```

Edge Function 타입체크:

```bash
pnpm check:edge
```

로컬 실행:

```bash
pnpm dev
```

현재 개발 환경에서 Vite가 Node.js 20.19 이상을 요구할 수 있습니다. 시스템 Node 버전이 낮으면 Node 버전을 올리거나 최신 Node 경로로 Vite를 실행해야 합니다.

## Supabase 반영 순서

1. `manual-rag/sql/manual_rag.sql` 실행
2. `manual-rag/poc/match_manual_chunks_hybrid.sql` 실행
3. PDF 적재

```bash
node manual-rag/ingest_manual_pdf.mjs \
  --file "/path/to/국민취업지원제도업무매뉴얼.pdf" \
  --title "국민취업지원제도 업무매뉴얼" \
  --version "2026.1" \
  --published-at 2026-01-01 \
  --replace
```

4. Edge Function 배포

```bash
supabase functions deploy manual-chat
```

5. 필요한 secrets 설정

```bash
supabase secrets set OPENAI_API_KEY=...
```

## 시연 전 체크리스트

- Supabase URL과 anon key가 앱 Settings에 입력되어 있는지 확인
- `manual_documents`, `manual_chunks`, `manual_chat_logs` 테이블이 생성되어 있는지 확인
- 매뉴얼 PDF 데이터가 `manual_chunks`에 적재되어 있는지 확인
- `match_manual_chunks_hybrid` RPC가 Supabase에 적용되어 있는지 확인
- `manual-chat` Edge Function이 배포되어 있는지 확인
- `OPENAI_API_KEY` secret이 Supabase Edge Function에 설정되어 있는지 확인
- 로그인 후 상담사 메뉴에서 `국취제 매뉴얼 도우미` 화면이 열리는지 확인
- 주요 테스트 질문 3~5개에 대해 답변과 출처가 표시되는지 확인

## 현재 한계

- PDF 청크 검색 품질에 따라 답변 품질이 크게 달라집니다.
- 질문 표현과 매뉴얼 표현이 다르면 관련 청크를 놓칠 수 있습니다.
- 현재는 매뉴얼 PDF 중심 답변이며, 상담자 개인 데이터와 직접 연결되지는 않았습니다.
- 답변 평점, 피드백, 자주 묻는 질문 자동 개선 기능은 아직 구현되지 않았습니다.

## 향후 개선 방향

- 상담자 상세 화면에서 현재 상담자 정보와 함께 매뉴얼 질문하기
- 답변을 상담 메모에 바로 저장
- 질문/답변/근거 로그를 기반으로 자주 묻는 질문 관리
- 상담사 피드백을 받아 검색 키워드와 FAQ 보강
- 내부 상담 사례와 매뉴얼 근거를 함께 보여주는 업무형 답변으로 확장
