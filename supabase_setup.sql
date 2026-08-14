-- ============================================================
-- 상담 관리 시스템 - Supabase 스키마 설정
-- 
-- 사용 방법:
-- 1. Supabase 대시보드 → SQL Editor 열기
-- 2. 이 파일 전체 내용을 붙여넣기
-- 3. Run 버튼 클릭
--
-- 주의: 기존 테이블이 있으면 DROP 후 재생성됩니다.
-- ============================================================

-- ─── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── 1. 상담사 테이블 (counselors) ────────────────────────────────────────────
DROP TABLE IF EXISTS public.memo_cards CASCADE;
DROP TABLE IF EXISTS public.survey_responses CASCADE;
DROP TABLE IF EXISTS public.sessions CASCADE;
DROP TABLE IF EXISTS public.clients CASCADE;
DROP TABLE IF EXISTS public.counselors CASCADE;

CREATE TABLE public.counselors (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE,
  phone         TEXT,
  branch        TEXT,                          -- 소속 지점
  role          INTEGER DEFAULT 5 CHECK (role IN (4, 5)),
  status        TEXT DEFAULT '재직' CHECK (status IN ('재직', '휴직', '퇴직')),
  client_count  INTEGER DEFAULT 0,
  completed_count INTEGER DEFAULT 0,
  joined_at     DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 2. 상담자(내담자) 테이블 (clients) ──────────────────────────────────────
CREATE TABLE public.clients (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seq_no                INTEGER,              -- 순번
  year                  INTEGER,              -- 연도
  assignment_type       TEXT,                 -- 배정구분 (이관/모집/배정)
  name                  TEXT NOT NULL,        -- 성명
  resident_id_masked    TEXT,                 -- 주민번호 앞 6자리
  phone                 TEXT,                 -- 연락처
  last_counsel_date     DATE,                 -- 최근 상담일
  age                   INTEGER,              -- 나이
  gender                TEXT CHECK (gender IN ('남', '여')),
  business_type         TEXT,                 -- 사업유형 (Ⅰ/Ⅱ)
  participation_type    TEXT,                 -- 참여유형
  participation_stage   TEXT,                 -- 참여단계
  competency_grade      TEXT,                 -- 역량등급 (A/B/C/D)
  recognition_date      DATE,                 -- 인정통지일
  desired_job           TEXT,                 -- 희망직종
  counsel_notes         TEXT,                 -- 상담내역
  address               TEXT,                 -- 주소
  school                TEXT,                 -- 학교
  major                 TEXT,                 -- 전공
  education_level       TEXT,                 -- 최종학력
  initial_counsel_date  DATE,                 -- 초기상담(1차)
  iap_date              DATE,                 -- IAP수립일
  iap_duration          TEXT,                 -- IAP운영기간
  allowance_apply_date  DATE,                 -- 참여수당신청일
  rediagnosis_date      DATE,                 -- 재진단날짜
  rediagnosis_yn        TEXT,                 -- 재진단여부
  work_exp_type         TEXT,                 -- 일경험유형
  work_exp_intent       TEXT,                 -- 참여의사
  work_exp_company      TEXT,                 -- 참여기업
  work_exp_period       TEXT,                 -- 참여기간
  work_exp_completed    TEXT,                 -- 수료여부
  training_name         TEXT,                 -- 훈련과정명
  training_start        DATE,                 -- 훈련개강일
  training_end          DATE,                 -- 훈련종료일
  training_allowance    TEXT,                 -- 훈련수당
  intensive_start       DATE,                 -- 집중취업알선시작일
  intensive_end         DATE,                 -- 집중취업알선종료일
  support_end_date      DATE,                 -- 취업지원종료일
  employment_type       TEXT,                 -- 취업구분
  employment_date       DATE,                 -- 취업일자
  employer              TEXT,                 -- 취업처
  job_title             TEXT,                 -- 취업직무
  salary                TEXT,                 -- 급여
  employment_duration   TEXT,                 -- 취업소요기간
  resignation_date      DATE,                 -- 퇴사일
  retention_1m_date     DATE,
  retention_1m_yn       TEXT,
  retention_6m_date     DATE,
  retention_6m_yn       TEXT,
  retention_12m_date    DATE,
  retention_12m_yn      TEXT,
  retention_18m_date    DATE,
  retention_18m_yn      TEXT,
  counselor_name        TEXT,                 -- 담당자 이름
  counselor_id          UUID REFERENCES public.counselors(id) ON DELETE SET NULL,
  branch                TEXT,                 -- 지점
  follow_up             BOOLEAN DEFAULT FALSE,
  score                 INTEGER,              -- 구직준비도 점수
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 3. 상담 세션 테이블 (sessions) ──────────────────────────────────────────
CREATE TABLE public.sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  type            TEXT NOT NULL,              -- 초기상담/심층상담/취업지원/사후관리
  content         TEXT,                       -- 상담 내용
  counselor_name  TEXT,
  counselor_id    UUID REFERENCES public.counselors(id) ON DELETE SET NULL,
  next_action     TEXT,                       -- 다음 조치사항
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 4. 구직준비도 설문 응답 테이블 (survey_responses) ────────────────────────
CREATE TABLE public.survey_responses (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id         UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  survey_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  -- 구직목표수립 (1~5점)
  q1_job_goal       INTEGER CHECK (q1_job_goal BETWEEN 1 AND 5),
  -- 구직의지 (1~5점)
  q2_employment_will INTEGER CHECK (q2_employment_will BETWEEN 1 AND 5),
  -- 희망직종 계획 (1~5점)
  q3_employment_plan INTEGER CHECK (q3_employment_plan BETWEEN 1 AND 5),
  -- 구직기술 필요도 (1~5점)
  q4_job_skill_need  INTEGER CHECK (q4_job_skill_need BETWEEN 1 AND 5),
  -- 구직정보 필요도 (1~5점)
  q5_job_info_need   INTEGER CHECK (q5_job_info_need BETWEEN 1 AND 5),
  -- 취업역량 향상도 (1~5점)
  q6_competency_up   INTEGER CHECK (q6_competency_up BETWEEN 1 AND 5),
  -- 취업장애요인 (1~5점)
  q7_barrier         INTEGER CHECK (q7_barrier BETWEEN 1 AND 5),
  q7_barrier_detail  TEXT,                   -- 장애요인 상세
  -- 건강상태 (1~5점)
  q8_health          INTEGER CHECK (q8_health BETWEEN 1 AND 5),
  total_score        INTEGER,                -- 합계 점수 (자동 계산)
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 5. 메모 카드 테이블 (memo_cards) ────────────────────────────────────────
CREATE TABLE public.memo_cards (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  counselor_id  UUID NOT NULL REFERENCES public.counselors(id) ON DELETE CASCADE,
  column_id     TEXT NOT NULL DEFAULT 'todo' CHECK (column_id IN ('todo', 'inprogress', 'done')),
  title         TEXT NOT NULL,
  content       TEXT,
  priority      TEXT DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  due_date      DATE,
  client_name   TEXT,
  sort_order    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX idx_clients_counselor_id ON public.clients(counselor_id);
CREATE INDEX idx_clients_branch ON public.clients(branch);
CREATE INDEX idx_clients_name ON public.clients(name);
CREATE INDEX idx_sessions_client_id ON public.sessions(client_id);
CREATE INDEX idx_survey_client_id ON public.survey_responses(client_id);
CREATE INDEX idx_memo_counselor_id ON public.memo_cards(counselor_id);

-- ─── Updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_counselors_updated_at BEFORE UPDATE ON public.counselors FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_memo_updated_at BEFORE UPDATE ON public.memo_cards FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Auto-calculate survey total_score ───────────────────────────────────────
CREATE OR REPLACE FUNCTION calc_survey_total()
RETURNS TRIGGER AS $$
BEGIN
  NEW.total_score = COALESCE(NEW.q1_job_goal,0) + COALESCE(NEW.q2_employment_will,0)
    + COALESCE(NEW.q3_employment_plan,0) + COALESCE(NEW.q4_job_skill_need,0)
    + COALESCE(NEW.q5_job_info_need,0) + COALESCE(NEW.q6_competency_up,0)
    + COALESCE(NEW.q7_barrier,0) + COALESCE(NEW.q8_health,0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_survey_total BEFORE INSERT OR UPDATE ON public.survey_responses FOR EACH ROW EXECUTE FUNCTION calc_survey_total();

-- ─── RLS (Row Level Security) ─────────────────────────────────────────────────
ALTER TABLE public.counselors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memo_cards ENABLE ROW LEVEL SECURITY;

-- Helper: get counselor row for current auth user
CREATE OR REPLACE FUNCTION get_my_counselor_id()
RETURNS UUID AS $$
  SELECT id FROM public.counselors WHERE auth_user_id = auth.uid() LIMIT 1;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Helper: check if current user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.counselors
    WHERE auth_user_id = auth.uid() AND role = 4
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- ── counselors: admins see all; counselors see own row ──
CREATE POLICY "counselors_select" ON public.counselors FOR SELECT
  USING (is_admin() OR auth_user_id = auth.uid());

CREATE POLICY "counselors_insert" ON public.counselors FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "counselors_update" ON public.counselors FOR UPDATE
  USING (is_admin() OR auth_user_id = auth.uid());

CREATE POLICY "counselors_delete" ON public.counselors FOR DELETE
  USING (is_admin());

-- ── clients: admins see all; counselors see only their clients ──
CREATE POLICY "clients_select" ON public.clients FOR SELECT
  USING (is_admin() OR counselor_id = get_my_counselor_id());

CREATE POLICY "clients_insert" ON public.clients FOR INSERT
  WITH CHECK (is_admin() OR counselor_id = get_my_counselor_id());

CREATE POLICY "clients_update" ON public.clients FOR UPDATE
  USING (is_admin() OR counselor_id = get_my_counselor_id());

CREATE POLICY "clients_delete" ON public.clients FOR DELETE
  USING (is_admin() OR counselor_id = get_my_counselor_id());

-- ── sessions: same as clients ──
CREATE POLICY "sessions_select" ON public.sessions FOR SELECT
  USING (
    is_admin() OR
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.counselor_id = get_my_counselor_id())
  );

CREATE POLICY "sessions_insert" ON public.sessions FOR INSERT
  WITH CHECK (
    is_admin() OR
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.counselor_id = get_my_counselor_id())
  );

CREATE POLICY "sessions_update" ON public.sessions FOR UPDATE
  USING (
    is_admin() OR
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.counselor_id = get_my_counselor_id())
  );

CREATE POLICY "sessions_delete" ON public.sessions FOR DELETE
  USING (
    is_admin() OR
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.counselor_id = get_my_counselor_id())
  );

-- ── survey_responses: same as clients ──
CREATE POLICY "surveys_select" ON public.survey_responses FOR SELECT
  USING (
    is_admin() OR
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.counselor_id = get_my_counselor_id())
  );

CREATE POLICY "surveys_insert" ON public.survey_responses FOR INSERT
  WITH CHECK (
    is_admin() OR
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.counselor_id = get_my_counselor_id())
  );

CREATE POLICY "surveys_update" ON public.survey_responses FOR UPDATE
  USING (
    is_admin() OR
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.counselor_id = get_my_counselor_id())
  );

CREATE POLICY "surveys_delete" ON public.survey_responses FOR DELETE
  USING (
    is_admin() OR
    EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.counselor_id = get_my_counselor_id())
  );

-- ── memo_cards: each counselor sees only their own cards ──
CREATE POLICY "memos_select" ON public.memo_cards FOR SELECT
  USING (is_admin() OR counselor_id = get_my_counselor_id());

CREATE POLICY "memos_insert" ON public.memo_cards FOR INSERT
  WITH CHECK (is_admin() OR counselor_id = get_my_counselor_id());

CREATE POLICY "memos_update" ON public.memo_cards FOR UPDATE
  USING (is_admin() OR counselor_id = get_my_counselor_id());

CREATE POLICY "memos_delete" ON public.memo_cards FOR DELETE
  USING (is_admin() OR counselor_id = get_my_counselor_id());

-- ─── 테스트 계정 생성 ─────────────────────────────────────────────────────────
-- 주의: auth.users는 직접 INSERT 불가. Supabase Dashboard → Authentication → Users 에서 생성하거나
-- 아래 SQL을 실행 후 대시보드에서 이메일/비밀번호로 사용자를 생성하고 아래 counselors INSERT를 실행하세요.

-- ─── 테스트용 상담사 계정 (auth.users에 계정 생성 후 UUID를 아래에 입력) ──────
-- 1. Supabase Dashboard → Authentication → Users → Add User 클릭
--    테스트용 이메일/비밀번호로 계정을 생성하세요.
--
-- 2. 생성된 UUID를 아래 INSERT의 auth_user_id에 입력

-- 예시 (실제 UUID로 교체 필요):
-- INSERT INTO public.counselors (auth_user_id, name, email, phone, branch, role, status, joined_at)
-- VALUES
--   ('여기에-상담사-UUID', '상담사', 'counselor@example.com', '010-0000-0001', '서울지점', 5, '재직', '2024-01-01'),
--   ('여기에-관리자-UUID', '관리자', 'admin@example.com', '010-0000-0000', '본사', 4, '재직', '2024-01-01');

-- ─── 완료 메시지 ──────────────────────────────────────────────────────────────
SELECT '✅ 상담 관리 시스템 스키마 설정 완료!' AS message,
       '테이블: counselors, clients, sessions, survey_responses, memo_cards' AS tables,
       'RLS 정책: 상담사별 데이터 격리 적용됨' AS rls;
-- 역할 코드: 관리자 = 4, 상담사 = 5
-- 기존 문자열 role('admin'/'counselor')를 사용 중이면 정수값으로 마이그레이션 후 적용하세요.
