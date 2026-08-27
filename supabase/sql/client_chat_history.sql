-- ─────────────────────────────────────────────────────────────────────────────
-- 고객 챗봇 대화 이력(client_chat_history) — clients(uuid) 스키마로 재작성
--
-- 이 파일은 원래 옛 스키마(public.client, 정수 client_id) 기준으로 작성돼 있었다.
-- 실제 라이브 DB에는 public.client(단수)가 존재한 적이 없어 이 CREATE TABLE의 FK가
-- 애초에 성립할 수 없었고, 프론트(clientChatHistory.ts)도 client.id(uuid 문자열)를
-- Number()로 강제 변환하려다 항상 "유효한 client_id가 필요합니다" 에러를 던지고 있었다
-- (DB까지 요청이 가지도 못하는 클라이언트 단 검증 실패). 즉 이 기능은 한 번도 정상
-- 동작한 적이 없다고 봐도 되므로, 기존 테이블이 있다면 지우고 새 스키마로 재생성한다.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.client_chat_history CASCADE;

CREATE TABLE public.client_chat_history (
  client_id       UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  messages        JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_chat_history_messages_array_check
    CHECK (jsonb_typeof(messages) = 'array')
);

CREATE INDEX idx_client_chat_history_updated_at
  ON public.client_chat_history(updated_at DESC);

CREATE OR REPLACE FUNCTION public.set_client_chat_history_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_chat_history_updated_at ON public.client_chat_history;
CREATE TRIGGER trg_client_chat_history_updated_at
  BEFORE UPDATE ON public.client_chat_history
  FOR EACH ROW EXECUTE FUNCTION public.set_client_chat_history_updated_at();

ALTER TABLE public.client_chat_history ENABLE ROW LEVEL SECURITY;

-- 다른 테이블(sessions 등)과 동일한 패턴: is_admin() 또는 담당 상담사 본인만 접근.
DROP POLICY IF EXISTS "client_chat_history_select" ON public.client_chat_history;
CREATE POLICY "client_chat_history_select" ON public.client_chat_history FOR SELECT
  USING (
    is_admin() OR
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_chat_history.client_id AND c.counselor_id = get_my_counselor_id())
  );

DROP POLICY IF EXISTS "client_chat_history_insert" ON public.client_chat_history;
CREATE POLICY "client_chat_history_insert" ON public.client_chat_history FOR INSERT
  WITH CHECK (
    is_admin() OR
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_chat_history.client_id AND c.counselor_id = get_my_counselor_id())
  );

DROP POLICY IF EXISTS "client_chat_history_update" ON public.client_chat_history;
CREATE POLICY "client_chat_history_update" ON public.client_chat_history FOR UPDATE
  USING (
    is_admin() OR
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_chat_history.client_id AND c.counselor_id = get_my_counselor_id())
  )
  WITH CHECK (
    is_admin() OR
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_chat_history.client_id AND c.counselor_id = get_my_counselor_id())
  );

-- 원본 파일에 이 GRANT가 누락돼 있었다 (있었어도 어차피 client_id 정수 변환 단계에서
-- 항상 막혀서 드러나지 않았을 것). 다른 테이블과 동일하게 authenticated에 부여.
GRANT SELECT, INSERT, UPDATE ON public.client_chat_history TO authenticated;

NOTIFY pgrst, 'reload schema';
