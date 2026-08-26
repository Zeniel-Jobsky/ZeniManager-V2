# Manual RAG MVP

국민취업지원제도 업무매뉴얼 PDF를 Supabase에 적재하고, Edge Function `manual-chat`으로 근거 기반 답변을 생성하는 MVP입니다.

## 구성

- `sql/manual_rag.sql`: 매뉴얼 문서, 청크, 대화 로그 테이블과 기본 검색 RPC
- `poc/match_manual_chunks_hybrid.sql`: 벡터 유사도와 키워드 점수를 함께 쓰는 하이브리드 검색 RPC
- `ingest_manual_pdf.mjs`: PDF 텍스트 추출, 청크화, 임베딩 생성, Supabase 적재 스크립트
- `../supabase/functions/manual-chat/index.ts`: 매뉴얼 질문 답변 Edge Function

## 적용 순서

1. Supabase SQL Editor에서 `sql/manual_rag.sql`을 실행합니다.
2. Supabase SQL Editor에서 `poc/match_manual_chunks_hybrid.sql`을 실행합니다.
3. `.env` 또는 터미널 환경변수에 `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`를 설정합니다.
4. PDF를 적재합니다.

```bash
node manual-rag/ingest_manual_pdf.mjs \
  --file "/path/to/국민취업지원제도업무매뉴얼.pdf" \
  --title "국민취업지원제도 업무매뉴얼" \
  --version "2026.1" \
  --published-at 2026-01-01 \
  --replace
```

5. Edge Function을 배포합니다.

```bash
supabase functions deploy manual-chat
supabase secrets set OPENAI_API_KEY=...
```

6. 앱에서는 상담사 메뉴의 `국취제 매뉴얼 도우미` 화면에서 호출합니다.
