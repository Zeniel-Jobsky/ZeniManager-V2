-- ─────────────────────────────────────────────────────────────────────────────
-- 예약/일정(appointments) 테이블
--
-- sessions(상담 이력, 이미 진행한 상담 기록)와는 별개로, "아직 진행하지 않은 미래 일정"을
-- 담기 위한 테이블. 캘린더에서 "예정"으로 표시된다.
--
-- 완료 처리는 반드시 그 자리에서 실제 상담기록(sessions)을 함께 입력받아 생성하고,
-- session_id로 연결한다 (완료된 예약을 클릭하면 정확히 그 상담기록으로 이동하기 위함).
--
-- RLS는 기존 memo_cards와 동일한 패턴(counselor_id 직접 소유) 사용.
-- 실행 전: is_admin(), get_my_counselor_id() 함수가 이미 존재해야 함 (supabase_setup.sql 참고).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.appointments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  counselor_id  UUID NOT NULL REFERENCES public.counselors(id) ON DELETE CASCADE,
  client_id     UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  session_id    UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  date          DATE NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  status        TEXT NOT NULL DEFAULT '예정' CHECK (status IN ('예정', '완료', '취소')),
  memo          TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_time > start_time)
);

-- appointments.sql을 이미 실행한 적이 있어 테이블이 이미 존재하는 경우를 위한 보강
-- (CREATE TABLE IF NOT EXISTS는 기존 테이블에 새 컬럼을 추가해주지 않으므로 별도 필요)
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_counselor_date ON public.appointments(counselor_id, date);
CREATE INDEX IF NOT EXISTS idx_appointments_client_id ON public.appointments(client_id);
CREATE INDEX IF NOT EXISTS idx_appointments_session_id ON public.appointments(session_id);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "appointments_select" ON public.appointments;
CREATE POLICY "appointments_select" ON public.appointments FOR SELECT
  USING (is_admin() OR counselor_id = get_my_counselor_id());

DROP POLICY IF EXISTS "appointments_insert" ON public.appointments;
CREATE POLICY "appointments_insert" ON public.appointments FOR INSERT
  WITH CHECK (is_admin() OR counselor_id = get_my_counselor_id());

DROP POLICY IF EXISTS "appointments_update" ON public.appointments;
CREATE POLICY "appointments_update" ON public.appointments FOR UPDATE
  USING (is_admin() OR counselor_id = get_my_counselor_id())
  WITH CHECK (is_admin() OR counselor_id = get_my_counselor_id());

DROP POLICY IF EXISTS "appointments_delete" ON public.appointments;
CREATE POLICY "appointments_delete" ON public.appointments FOR DELETE
  USING (is_admin() OR counselor_id = get_my_counselor_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO authenticated;

-- updated_at 자동 갱신 (다른 테이블에 이미 동일 함수가 있다면 재사용됨)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_appointments_updated_at ON public.appointments;
CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

NOTIFY pgrst, 'reload schema';
