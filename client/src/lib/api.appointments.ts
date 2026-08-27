/**
 * 예약/일정(appointments) API
 *
 * sessions(상담 이력 — 이미 진행한 상담 기록)와 완전히 분리된, 아직 진행하지 않은
 * 미래 일정 전용 테이블. DB 마이그레이션: supabase/sql/appointments.sql 실행 필요.
 */
import {
  executeSupabaseRequest,
  getSupabaseClient,
  isSupabaseConfigured,
} from './supabase';
import type { AppointmentRow, AppointmentStatus } from './supabase';
import { createSession } from './api';

function sb() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase가 설정되지 않았습니다. 설정 메뉴에서 Supabase URL과 API 키를 입력하세요.');
  return client;
}

function runQuery<T>(
  operationLabel: string,
  request: PromiseLike<{
    data: T | null;
    error: unknown;
    status?: number | null;
    count?: number | null;
  }>,
) {
  return executeSupabaseRequest(operationLabel, request, {
    requireStoredSession: true,
  });
}

const ISO_DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}(:\d{2})?$/;

function assertAppointmentSupabaseConfigured(scopeLabel: string): void {
  if (!isSupabaseConfigured()) {
    throw new Error(`${scopeLabel} 기능을 사용하려면 Supabase 설정이 필요합니다.`);
  }
}

function assertAppointmentCounselorId(scopeLabel: string, counselorId: string | null | undefined): string {
  assertAppointmentSupabaseConfigured(scopeLabel);

  const normalized = counselorId?.trim();
  if (!normalized) {
    throw new Error(`${scopeLabel} 기능을 호출하려면 public.counselors.id가 필요합니다.`);
  }
  return normalized;
}

function assertAppointmentDateRange(scopeLabel: string, rangeStart: string, rangeEnd: string): void {
  if (!ISO_DATE_KEY_PATTERN.test(rangeStart) || !ISO_DATE_KEY_PATTERN.test(rangeEnd)) {
    throw new Error(`${scopeLabel} 기능을 호출하려면 YYYY-MM-DD 형식의 조회 기간이 필요합니다.`);
  }
  if (rangeStart > rangeEnd) {
    throw new Error(`${scopeLabel} 기능을 호출하려면 시작일이 종료일보다 늦지 않은 조회 기간이 필요합니다.`);
  }
}

function assertAppointmentDate(scopeLabel: string, date: string): string {
  const trimmed = date?.trim();
  if (!trimmed || !ISO_DATE_KEY_PATTERN.test(trimmed)) {
    throw new Error(`${scopeLabel} 기능을 호출하려면 YYYY-MM-DD 형식의 날짜가 필요합니다.`);
  }
  return trimmed;
}

function assertAppointmentTime(scopeLabel: string, label: string, time: string): string {
  const trimmed = time?.trim();
  if (!trimmed || !TIME_PATTERN.test(trimmed)) {
    throw new Error(`${scopeLabel} 기능을 호출하려면 ${label}이(가) HH:MM 형식이어야 합니다.`);
  }
  return trimmed;
}

type LiveAppointmentRecord = {
  id: string;
  counselor_id: string;
  client_id: string | null;
  session_id: string | null;
  date: string;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  memo: string | null;
  created_at: string;
  updated_at: string;
  clients: { name: string } | { name: string }[] | null;
};

function liveAppointmentToRow(row: LiveAppointmentRecord): AppointmentRow {
  let clientName: string | null = null;
  if (Array.isArray(row.clients)) {
    clientName = row.clients[0]?.name ?? null;
  } else if (row.clients) {
    clientName = row.clients.name ?? null;
  }

  return {
    id: row.id,
    counselor_id: row.counselor_id,
    client_id: row.client_id ?? null,
    client_name: clientName,
    session_id: row.session_id ?? null,
    date: row.date,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    memo: row.memo ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const APPOINTMENT_SELECT_FIELDS = `
  id,
  counselor_id,
  client_id,
  session_id,
  date,
  start_time,
  end_time,
  status,
  memo,
  created_at,
  updated_at,
  clients ( name )
`;

/** 같은 상담사·같은 날짜의 시간대가 겹치는지 확인 ("취소"는 겹침으로 취급하지 않음). */
function timeRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface CreateAppointmentInput {
  counselor_id: string;
  client_id?: string | null;
  date: string;
  start_time: string;
  end_time: string;
  memo?: string | null;
}

export interface UpdateAppointmentInput {
  date?: string;
  start_time?: string;
  end_time?: string;
  client_id?: string | null;
  memo?: string | null;
}

export async function fetchAppointments(
  counselorId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<AppointmentRow[]> {
  const scopedCounselorId = assertAppointmentCounselorId('예약 목록 조회', counselorId);
  assertAppointmentDateRange('예약 목록 조회', rangeStart, rangeEnd);

  const { data, error } = await runQuery<LiveAppointmentRecord[]>(
    '예약 목록 조회',
    sb()
      .from('appointments')
      .select(APPOINTMENT_SELECT_FIELDS)
      .eq('counselor_id', scopedCounselorId)
      .gte('date', rangeStart)
      .lte('date', rangeEnd)
      .neq('status', '취소')
      .order('date', { ascending: true })
      .order('start_time', { ascending: true }),
  );

  if (error) throw error;
  return ((data ?? []) as LiveAppointmentRecord[]).map(liveAppointmentToRow);
}

export async function fetchAppointmentMonthCounts(
  counselorId: string,
  monthStart: string,
  monthEnd: string,
): Promise<Record<string, number>> {
  const scopedCounselorId = assertAppointmentCounselorId('예약 캘린더', counselorId);
  assertAppointmentDateRange('예약 캘린더', monthStart, monthEnd);

  const { data, error } = await runQuery<Array<{ date: string }>>(
    '예약 월간 건수 조회',
    sb()
      .from('appointments')
      .select('date')
      .eq('counselor_id', scopedCounselorId)
      .gte('date', monthStart)
      .lte('date', monthEnd)
      .neq('status', '취소'),
  );

  if (error) throw error;

  return (data ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.date] = (acc[row.date] ?? 0) + 1;
    return acc;
  }, {});
}

/**
 * 같은 상담사가 같은 날짜에 겹치는 시간대로 예약을 잡으려는지 확인한다.
 * excludeAppointmentId를 주면(수정 시) 자기 자신은 충돌 대상에서 제외한다.
 */
async function assertNoAppointmentConflict(
  counselorId: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeAppointmentId?: string,
): Promise<void> {
  const { data, error } = await runQuery<Array<{ id: string; start_time: string; end_time: string }>>(
    '예약 충돌 확인',
    sb()
      .from('appointments')
      .select('id, start_time, end_time')
      .eq('counselor_id', counselorId)
      .eq('date', date)
      .neq('status', '취소'),
  );

  if (error) throw error;

  const conflict = (data ?? []).find(row => {
    if (excludeAppointmentId && row.id === excludeAppointmentId) return false;
    return timeRangesOverlap(startTime, endTime, row.start_time, row.end_time);
  });

  if (conflict) {
    throw new Error(
      `이미 ${date} ${conflict.start_time.slice(0, 5)}~${conflict.end_time.slice(0, 5)}에 잡힌 예약과 시간이 겹칩니다.`,
    );
  }
}

export async function createAppointment(input: CreateAppointmentInput): Promise<AppointmentRow> {
  const scopedCounselorId = assertAppointmentCounselorId('예약 등록', input.counselor_id);
  const date = assertAppointmentDate('예약 등록', input.date);
  const startTime = assertAppointmentTime('예약 등록', '시작 시간', input.start_time);
  const endTime = assertAppointmentTime('예약 등록', '종료 시간', input.end_time);

  if (startTime >= endTime) {
    throw new Error('종료 시간은 시작 시간보다 늦어야 합니다.');
  }

  await assertNoAppointmentConflict(scopedCounselorId, date, startTime, endTime);

  const { data, error } = await runQuery<LiveAppointmentRecord>(
    '예약 등록',
    sb()
      .from('appointments')
      .insert({
        counselor_id: scopedCounselorId,
        client_id: input.client_id ?? null,
        date,
        start_time: startTime,
        end_time: endTime,
        memo: input.memo?.trim() || null,
      })
      .select(APPOINTMENT_SELECT_FIELDS)
      .single(),
  );

  if (error) throw error;
  if (!data) throw new Error('예약 등록 후 결과를 확인하지 못했습니다.');
  return liveAppointmentToRow(data);
}

export async function updateAppointment(
  id: string,
  counselorId: string,
  patch: UpdateAppointmentInput,
): Promise<AppointmentRow> {
  const scopedCounselorId = assertAppointmentCounselorId('예약 수정', counselorId);
  if (!id?.trim()) throw new Error('예약 수정 기능을 호출하려면 예약 id가 필요합니다.');

  const nextDate = patch.date != null ? assertAppointmentDate('예약 수정', patch.date) : undefined;
  const nextStart = patch.start_time != null ? assertAppointmentTime('예약 수정', '시작 시간', patch.start_time) : undefined;
  const nextEnd = patch.end_time != null ? assertAppointmentTime('예약 수정', '종료 시간', patch.end_time) : undefined;

  if (nextDate || nextStart || nextEnd) {
    const { data: current, error: currentError } = await runQuery<{ date: string; start_time: string; end_time: string }>(
      '예약 수정 전 조회',
      sb().from('appointments').select('date, start_time, end_time').eq('id', id).single(),
    );
    if (currentError) throw currentError;
    if (!current) throw new Error('수정할 예약을 찾지 못했습니다.');

    const effectiveDate = nextDate ?? current.date;
    const effectiveStart = nextStart ?? current.start_time;
    const effectiveEnd = nextEnd ?? current.end_time;

    if (effectiveStart >= effectiveEnd) {
      throw new Error('종료 시간은 시작 시간보다 늦어야 합니다.');
    }

    await assertNoAppointmentConflict(scopedCounselorId, effectiveDate, effectiveStart, effectiveEnd, id);
  }

  const payload: Record<string, unknown> = {};
  if (nextDate !== undefined) payload.date = nextDate;
  if (nextStart !== undefined) payload.start_time = nextStart;
  if (nextEnd !== undefined) payload.end_time = nextEnd;
  if (patch.client_id !== undefined) payload.client_id = patch.client_id;
  if (patch.memo !== undefined) payload.memo = patch.memo?.trim() || null;

  const { data, error } = await runQuery<LiveAppointmentRecord>(
    '예약 수정',
    sb()
      .from('appointments')
      .update(payload)
      .eq('id', id)
      .select(APPOINTMENT_SELECT_FIELDS)
      .single(),
  );

  if (error) throw error;
  if (!data) throw new Error('예약 수정 후 결과를 확인하지 못했습니다.');
  return liveAppointmentToRow(data);
}

export async function updateAppointmentStatus(id: string, status: AppointmentStatus): Promise<AppointmentRow> {
  if (!id?.trim()) throw new Error('예약 상태 변경 기능을 호출하려면 예약 id가 필요합니다.');

  const { data, error } = await runQuery<LiveAppointmentRecord>(
    '예약 상태 변경',
    sb()
      .from('appointments')
      .update({ status })
      .eq('id', id)
      .select(APPOINTMENT_SELECT_FIELDS)
      .single(),
  );

  if (error) throw error;
  if (!data) throw new Error('예약 상태 변경 후 결과를 확인하지 못했습니다.');
  return liveAppointmentToRow(data);
}

export interface CompleteAppointmentSessionInput {
  type: string;
  content: string;
  next_action?: string | null;
  counselor_name?: string | null;
}

/**
 * 예약을 "완료" 처리하면서, 그 자리에서 실제 상담기록(sessions)을 함께 생성해 session_id로 연결한다.
 * (완료 처리 = 상태만 바꾸는 게 아니라 반드시 상담기록을 남기는 행위로 취급 — 완료된 예약을 클릭했을 때
 * 정확히 이 상담기록으로 이동할 수 있게 하기 위함. createSession의 참여단계 자동 갱신 로직도 그대로 적용됨.)
 */
export async function completeAppointmentWithSession(
  appointment: AppointmentRow,
  counselorId: string,
  sessionInput: CompleteAppointmentSessionInput,
): Promise<AppointmentRow> {
  const scopedCounselorId = assertAppointmentCounselorId('예약 완료 처리', counselorId);
  if (!appointment.id?.trim()) throw new Error('예약 완료 처리 기능을 호출하려면 예약 id가 필요합니다.');
  if (!appointment.client_id) {
    throw new Error('이 예약에는 연결된 고객이 없어 상담기록을 남길 수 없습니다. 먼저 "일정변경"으로 대상 고객을 지정하세요.');
  }
  if (!sessionInput.content?.trim()) {
    throw new Error('상담 내용을 입력해야 완료 처리할 수 있습니다.');
  }

  const session = await createSession({
    client_id: appointment.client_id,
    counselor_id: scopedCounselorId,
    date: appointment.date,
    type: sessionInput.type || '상담기록',
    content: sessionInput.content,
    next_action: sessionInput.next_action ?? null,
    counselor_name: sessionInput.counselor_name ?? null,
  });

  const { data, error } = await runQuery<LiveAppointmentRecord>(
    '예약 완료 처리',
    sb()
      .from('appointments')
      .update({ status: '완료', session_id: session.id })
      .eq('id', appointment.id)
      .select(APPOINTMENT_SELECT_FIELDS)
      .single(),
  );

  if (error) throw error;
  if (!data) throw new Error('예약 완료 처리 후 결과를 확인하지 못했습니다.');
  return liveAppointmentToRow(data);
}

export async function deleteAppointment(id: string): Promise<void> {
  if (!id?.trim()) throw new Error('예약 삭제 기능을 호출하려면 예약 id가 필요합니다.');

  const { error } = await runQuery<null>(
    '예약 삭제',
    sb().from('appointments').delete().eq('id', id),
  );

  if (error) throw error;
}
