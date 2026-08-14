/**
 * Client List Page (상담자 목록)
 * - 탭: 상담관리 / 상담이력 / 상담내용 입력 / 구직준비도 설문
 * - 필터: 전체 / 점수미확정 / 후속상담 / 취업처리
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { ROLE_COUNSELOR } from '@shared/const';
import { useAuth } from '@/contexts/AuthContext';
import { usePageGuard } from '@/hooks/usePageGuard';
import {
  Search, Plus, X, ChevronRight, ChevronLeft, Phone, User,
  Edit3, ClipboardList, Loader2, Trash2, Save,
  AlertTriangle, RefreshCw, ArrowUp, ArrowDown, GripVertical
} from 'lucide-react';
import { toast } from 'sonner';
import { fetchClients, fetchSessions, createSession, deleteSession, fetchSurveys, createSurvey, updateSurvey, updateClient } from '@/lib/api';
import { syncEmploymentSuccessCase } from '@/lib/employmentSuccessCase';
import type { ClientRow, SessionRow, SurveyRow } from '@/lib/supabase';
import { isSupabaseConfigured } from '@/lib/supabase';

const PRIMARY = '#009C64';

type FilterType = 'all' | 'no-score' | 'follow-up' | 'employed';
type ClientModalTab = 'manage' | 'history' | 'input' | 'survey';

function parseFollowUpStat(value: ClientRow['continue_serv_1_stat']): number | null {
  if (value == null || value === '') return null;
  const normalized = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function hasScore(client: ClientRow): boolean {
  return client.retest_stat != null;
}

function needsFollowUp(client: ClientRow): boolean {
  return (parseFollowUpStat(client.continue_serv_1_stat) ?? 0) > 0;
}

function formatFollowUpStat(client: ClientRow): string {
  const followUpStat = parseFollowUpStat(client.continue_serv_1_stat);
  return followUpStat != null && followUpStat > 0 ? String(followUpStat) : '-';
}

function isEmploymentCompleted(client: ClientRow): boolean {
  return client.participation_stage === '취업완료';
}

// ─── Survey Questions from 구직준비도점검설문지 ─────────────────────────────────

const SURVEY_QUESTIONS = [
  { key: 'q1_job_goal', label: '구직목표 수립', desc: '취업하고자 하는 직종이나 분야에 대한 목표가 있습니까?' },
  { key: 'q2_will_3months', label: '3개월 내 구직의지', desc: '3개월 이내에 취업하고자 하는 의지가 있습니까?' },
  { key: 'q3_job_plan', label: '희망직종 구직계획', desc: '희망 직종에 취업하기 위한 구체적인 계획이 있습니까?' },
  { key: 'q4_skill_need', label: '구직기술 필요도', desc: '이력서 작성, 면접 준비 등 구직기술 지원이 필요합니까?' },
  { key: 'q5_info_need', label: '구직정보 필요도', desc: '취업처 발굴, 채용정보 등 구직정보 지원이 필요합니까?' },
  { key: 'q6_competency', label: '취업역량 향상도', desc: '직업훈련, 자격증 취득 등 취업역량 향상 지원이 필요합니까?' },
  { key: 'q7_barrier', label: '취업장애요인', desc: '건강, 가족돌봄, 교통 등 취업에 장애가 되는 요인이 있습니까?' },
  { key: 'q8_health', label: '건강상태', desc: '현재 건강상태는 취업활동에 지장이 없습니까?' },
] as const;

const SURVEY_OPTIONS = [
  { value: 3, label: '예', color: '#009C64' },
  { value: 2, label: '보통', color: '#f59e0b' },
  { value: 1, label: '아니오', color: '#ef4444' },
];

const SURVEY_FIELD_MAP = {
  q1_job_goal: 'survey_1',
  q2_will_3months: 'survey_2',
  q3_job_plan: 'survey_3',
  q4_skill_need: 'survey_4',
  q5_info_need: 'survey_5',
  q6_competency: 'survey_6',
  q7_barrier: 'survey_7',
  q8_health: 'survey_8',
} as const;

function getSurveyAnswer(survey: SurveyRow | Record<string, unknown>, key: keyof typeof SURVEY_FIELD_MAP): number | null {
  const value = (survey as any)[key] ?? (survey as any)[SURVEY_FIELD_MAP[key]];
  return typeof value === 'number' ? value : null;
}

// ─── Survey Tab ───────────────────────────────────────────────────────────────

function SurveyTab({ clientId }: { clientId: string }) {
  const [surveys, setSurveys] = useState<SurveyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [barrierDetail, setBarrierDetail] = useState('');
  const [surveyDate, setSurveyDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchSurveys(clientId);
      setSurveys(data);
    } catch (e: any) {
      toast.error('설문 데이터 로드 실패: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  const latestSurvey = surveys[0] ?? null;

  const syncFormFromSurvey = useCallback((survey: SurveyRow | null) => {
    const today = new Date().toISOString().split('T')[0];
    if (!survey) {
      setAnswers({});
      setBarrierDetail('');
      setSurveyDate(today);
      return;
    }

    const nextAnswers: Record<string, number> = {};
    (Object.keys(SURVEY_FIELD_MAP) as Array<keyof typeof SURVEY_FIELD_MAP>).forEach(key => {
      const value = getSurveyAnswer(survey, key);
      if (typeof value === 'number') {
        nextAnswers[key] = value;
      }
    });

    setAnswers(nextAnswers);
    setBarrierDetail((survey as any).survey_7_memo || (survey as any).q7_barrier_detail || '');
    setSurveyDate(survey.survey_date || today);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    syncFormFromSurvey(latestSurvey);
  }, [latestSurvey, syncFormFromSurvey]);

  const resetForm = () => {
    syncFormFromSurvey(latestSurvey);
  };

  const totalScore = SURVEY_QUESTIONS.reduce((sum, q) => sum + (answers[q.key] || 0), 0);
  const maxScore = SURVEY_QUESTIONS.length * 3;

  const handleSave = async () => {
    if (Object.keys(answers).length < SURVEY_QUESTIONS.length) {
      toast.error('모든 항목에 응답해주세요.');
      return;
    }
    if (!isSupabaseConfigured()) {
      toast.error('Supabase 설정이 필요합니다. 설정 메뉴에서 연결 정보를 입력하세요.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        client_id: clientId,
        survey_date: surveyDate,
        survey_1: answers['q1_job_goal'] || null,
        survey_2: answers['q2_will_3months'] || null,
        survey_3: answers['q3_job_plan'] || null,
        survey_4: answers['q4_skill_need'] || null,
        survey_5: answers['q5_info_need'] || null,
        survey_6: answers['q6_competency'] || null,
        survey_7: answers['q7_barrier'] || null,
        survey_8: answers['q8_health'] || null,
        survey_7_memo: answers['q7_barrier'] && answers['q7_barrier'] >= 2 ? barrierDetail || null : null,
      };
      if (latestSurvey) {
        await updateSurvey(latestSurvey.survey_id, payload);
      } else {
        await createSurvey(payload);
      }
      toast.success('설문이 저장되었습니다.');
      syncFormFromSurvey((await fetchSurveys(clientId))[0] ?? null);
      load();
    } catch (e: any) {
      toast.error('저장 실패: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <Loader2 size={20} className="animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-foreground">구직준비도 설문 이력</div>
        <button
          onClick={resetForm}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-medium text-white"
          style={{ background: PRIMARY }}
        >
          <Plus size={12} />
          설문 내용 불러오기
        </button>
      </div>

      <div className="border border-border rounded-sm p-4 space-y-4 bg-muted/10">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">구직준비도 점검 설문지</div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">설문일</label>
            <input
              type="date"
              value={surveyDate}
              onChange={e => setSurveyDate(e.target.value)}
              className="text-xs px-2 py-1 rounded-sm border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="space-y-3">
          {SURVEY_QUESTIONS.map((q, idx) => (
            <div key={q.key} className="space-y-1.5">
              <div className="text-xs font-medium text-foreground">
                {idx + 1}. {q.label}
              </div>
              <div className="text-xs text-muted-foreground">{q.desc}</div>
              <div className="flex gap-2">
                {SURVEY_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setAnswers(a => ({ ...a, [q.key]: opt.value }));
                      if (q.key === 'q7_barrier' && opt.value < 2) {
                        setBarrierDetail('');
                      }
                    }}
                    className="flex-1 py-1.5 rounded-sm text-xs font-medium border transition-all"
                    style={answers[q.key] === opt.value
                      ? { background: opt.color, borderColor: opt.color, color: 'white' }
                      : { borderColor: '#e5e7eb', color: '#6b7280' }
                    }
                  >
                    {opt.label} ({opt.value}점)
                  </button>
                ))}
              </div>
              {q.key === 'q7_barrier' && answers['q7_barrier'] && answers['q7_barrier'] >= 2 && (
                <input
                  type="text"
                  value={barrierDetail}
                  onChange={e => setBarrierDetail(e.target.value)}
                  placeholder="장애요인 내용을 입력하세요..."
                  className="w-full px-3 py-1.5 rounded-sm border border-input bg-background text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <div className="text-sm">
            총점: <span className="font-bold" style={{ color: PRIMARY }}>{totalScore}</span>
            <span className="text-muted-foreground text-xs"> / {maxScore}점</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-medium text-white disabled:opacity-60"
              style={{ background: PRIMARY }}
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              저장
            </button>
            <button
              onClick={resetForm}
              className="px-3 py-1.5 rounded-sm text-xs border border-input hover:bg-muted"
            >
              취소
            </button>
          </div>
        </div>
      </div>

      {surveys.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8">
          <ClipboardList size={32} className="mx-auto mb-2 opacity-30" />
          설문 이력이 없습니다.
        </div>
      ) : (
        surveys.map(s => {
          const score = s.total_score ?? SURVEY_QUESTIONS.reduce((sum, q) => sum + (getSurveyAnswer(s, q.key as keyof typeof SURVEY_FIELD_MAP) || 0), 0);
          const pct = Math.round((score / maxScore) * 100);
          return (
            <div key={s.survey_id} className="border border-border rounded-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium">{s.survey_date} 설문</div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold" style={{ color: PRIMARY }}>{score}점</span>
                  <span className="text-xs text-muted-foreground">({pct}%)</span>
                </div>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5 mb-3">
                <div
                  className="h-1.5 rounded-full transition-all"
                  style={{ width: `${pct}%`, background: PRIMARY }}
                />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {SURVEY_QUESTIONS.map(q => {
                  const val = getSurveyAnswer(s, q.key as keyof typeof SURVEY_FIELD_MAP);
                  const opt = SURVEY_OPTIONS.find(o => o.value === val);
                  return (
                    <div key={q.key} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground truncate">{q.label}</span>
                      <span className="font-medium ml-2 flex-shrink-0" style={{ color: opt?.color || '#6b7280' }}>
                        {opt?.label || '-'} ({val || 0})
                      </span>
                    </div>
                  );
                })}
              </div>
              {(s.survey_7_memo || (s as any).q7_barrier_detail) && (
                <div className="mt-2 text-xs text-muted-foreground">
                  장애요인: {s.survey_7_memo || (s as any).q7_barrier_detail}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── Client Detail Modal ──────────────────────────────────────────────────────

function ClientDetailModal({
  client,
  onClose,
  initialTab,
  initialDate,
}: {
  client: ClientRow;
  onClose: () => void;
  initialTab?: ClientModalTab;
  initialDate?: string;
}) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<ClientModalTab>(initialTab ?? 'manage');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [newSession, setNewSession] = useState({
    type: '초기상담',
    content: '',
    nextAction: '',
    date: initialDate || new Date().toISOString().split('T')[0],
  });
  const [saving, setSaving] = useState(false);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const data = await fetchSessions(client.id);
      setSessions(data);
    } catch (e: any) {
      toast.error('이력 로드 실패: ' + e.message);
    } finally {
      setSessionsLoading(false);
    }
  }, [client.id]);

  useEffect(() => {
    if (activeTab === 'history' || activeTab === 'input') loadSessions();
  }, [activeTab, loadSessions]);

  useEffect(() => {
    setActiveTab(initialTab ?? 'manage');
    setNewSession({
      type: '초기상담',
      content: '',
      nextAction: '',
      date: initialDate || new Date().toISOString().split('T')[0],
    });
  }, [client.id, initialDate, initialTab]);

  const handleSaveSession = async () => {
    if (!newSession.content.trim()) { toast.error('상담 내용을 입력해주세요.'); return; }
    if (!isSupabaseConfigured()) { toast.error('Supabase 설정이 필요합니다.'); return; }
    setSaving(true);
    try {
      await createSession({
        client_id: client.id,
        date: newSession.date,
        type: newSession.type,
        content: newSession.content,
        counselor_name: user?.name || null,
        counselor_id: user?.id || null,
        next_action: newSession.nextAction || null,
      });
      toast.success('상담 내용이 저장되었습니다.');
      setNewSession({ type: '초기상담', content: '', nextAction: '', date: new Date().toISOString().split('T')[0] });
      loadSessions();
      setActiveTab('history');
    } catch (e: any) {
      toast.error('저장 실패: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSession = async (id: string) => {
    if (!confirm('이 상담 이력을 삭제하시겠습니까?')) return;
    try {
      await deleteSession(id);
      setSessions(prev => prev.filter(s => s.id !== id));
      toast.success('삭제되었습니다.');
    } catch (e: any) {
      toast.error('삭제 실패: ' + e.message);
    }
  };

  const stageColors: Record<string, string> = {
    '초기상담': 'badge-active', '심층상담': 'badge-pending',
    '취업지원': 'badge-pending', '취업완료': 'badge-completed', '사후관리': 'badge-active',
  };

  const tabs: { id: ClientModalTab; label: string }[] = [
    { id: 'manage', label: '상담관리' },
    { id: 'history', label: '상담이력' },
    { id: 'input', label: '상담내용 입력' },
    { id: 'survey', label: '구직준비도 설문' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-card rounded-md shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-sm flex items-center justify-center text-white font-bold text-sm" style={{ background: PRIMARY }}>
              {client.name.charAt(0)}
            </div>
            <div>
              <div className="font-semibold text-foreground">{client.name}</div>
              <div className="text-xs text-muted-foreground">{client.phone} · {client.counselor_name}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-sm hover:bg-muted"><X size={18} /></button>
        </div>

        <div className="flex border-b border-border px-5 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="px-4 py-2.5 text-sm font-medium border-b-2 transition-all -mb-px whitespace-nowrap"
              style={activeTab === tab.id
                ? { borderColor: PRIMARY, color: PRIMARY }
                : { borderColor: 'transparent', color: '#6b7280' }
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'manage' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-2">기본 정보</div>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex items-center gap-2">
                        <User size={13} className="text-muted-foreground" />
                        {client.name} ({client.gender}, {client.age}세)
                      </div>
                      {client.phone && (
                        <div className="flex items-center gap-2">
                          <Phone size={13} className="text-muted-foreground" />
                          {client.phone}
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-2">담당 정보</div>
                    <div className="text-sm space-y-1">
                      <div>담당: <span className="font-medium">{client.counselor_name}</span></div>
                      <div>지점: <span className="font-medium">{client.branch}</span></div>
                      <div>등록일: <span className="font-medium">{client.initial_counsel_date || client.created_at?.split('T')[0]}</span></div>
                    </div>
                  </div>
                  {client.education_level && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-2">학력</div>
                      <div className="text-sm">{client.education_level} {client.school && `(${client.school})`}</div>
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-2">진행 현황</div>
                    <div className="space-y-2">
                      {client.participation_stage && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm">참여단계</span>
                          <span className={stageColors[client.participation_stage] || 'badge-active'}>{client.participation_stage}</span>
                        </div>
                      )}
                      {client.business_type && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm">사업유형</span>
                          <span className="text-sm font-medium">{client.business_type}</span>
                        </div>
                      )}
                      {client.competency_grade && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm">역량등급</span>
                          <span className="text-sm font-bold" style={{ color: PRIMARY }}>{client.competency_grade}등급</span>
                        </div>
                      )}
                      {/* Live list/detail score is sourced from retest_stat to match dashboard rules. */}
                      {client.retest_stat != null && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm">점수</span>
                          <span className="text-sm font-bold" style={{ color: PRIMARY }}>{client.retest_stat}점</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-sm">후속 상담</span>
                        <span className={needsFollowUp(client) ? 'badge-cancelled' : 'badge-active'}>
                          {needsFollowUp(client) ? '필요' : '불필요'}
                        </span>
                      </div>
                    </div>
                  </div>
                  {isEmploymentCompleted(client) && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-2">취업 정보</div>
                      <div className="text-sm space-y-1">
                        <div>상태: <span className="font-medium">취업완료</span></div>
                        {client.employment_type && <div>구분: <span className="font-medium">{client.employment_type}</span></div>}
                        {client.employer && <div>취업처: <span className="font-medium">{client.employer}</span></div>}
                        {client.employment_date && <div>취업일: <span className="font-medium">{client.employment_date}</span></div>}
                        {client.salary && <div>급여: <span className="font-medium">{client.salary}</span></div>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {client.counsel_notes && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">상담 내역 메모</div>
                  <div className="text-sm p-3 rounded-sm bg-muted/30 border border-border whitespace-pre-wrap">{client.counsel_notes}</div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-3">
              {sessionsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={18} className="animate-spin text-muted-foreground" />
                </div>
              ) : sessions.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">상담 이력이 없습니다.</div>
              ) : (
                sessions.map(session => (
                  <div key={session.id} className="border border-border rounded-sm p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="badge-active">{session.type}</span>
                        <span className="text-xs text-muted-foreground">{session.date}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{session.counselor_name}</span>
                        <button
                          onClick={() => handleDeleteSession(session.id)}
                          className="p-1 rounded-sm hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-foreground">{session.content}</p>
                    {session.next_action && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <ChevronRight size={12} />
                        다음 액션: {session.next_action}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'input' && (
            <div className="space-y-4">
              {!isSupabaseConfigured() && (
                <div className="flex items-center gap-2 p-3 rounded-sm border border-amber-200 bg-amber-50 text-amber-800 text-xs">
                  <AlertTriangle size={13} />
                  Supabase 미설정 상태입니다. 저장하려면 설정 메뉴에서 연결 정보를 입력하세요.
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5">상담 유형</label>
                  <select
                    value={newSession.type}
                    onChange={e => setNewSession(s => ({ ...s, type: e.target.value }))}
                    className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {['초기상담', '심층상담', '취업지원', '사후관리', '집단상담', '기타'].map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">상담일</label>
                  <input
                    type="date"
                    value={newSession.date}
                    onChange={e => setNewSession(s => ({ ...s, date: e.target.value }))}
                    className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">상담 내용</label>
                <textarea
                  value={newSession.content}
                  onChange={e => setNewSession(s => ({ ...s, content: e.target.value }))}
                  placeholder="상담 내용을 입력하세요..."
                  rows={5}
                  className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">다음 액션</label>
                <input
                  type="text"
                  value={newSession.nextAction}
                  onChange={e => setNewSession(s => ({ ...s, nextAction: e.target.value }))}
                  placeholder="다음 단계 계획..."
                  className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveSession}
                  disabled={saving}
                  className="btn-primary flex items-center gap-1.5 disabled:opacity-60"
                >
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  저장
                </button>
                <button onClick={onClose} className="btn-cancel">취소</button>
              </div>
            </div>
          )}

          {activeTab === 'survey' && (
            <SurveyTab clientId={client.id} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Filter Tab Button ────────────────────────────────────────────────────────

function FilterTab({ label, active, count, onClick }: { label: string; active: boolean; count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-sm transition-all"
      style={active ? { background: PRIMARY, color: 'white' } : {}}
    >
      {label}
      <span className="text-xs px-1.5 py-0.5 rounded-sm" style={active ? { background: 'rgba(255,255,255,0.2)' } : { background: '#f3f4f6', color: '#6b7280' }}>
        {count}
      </span>
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ClientList() {
  const [, navigate] = useLocation();
  const { canRender, user } = usePageGuard('counselor');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const itemsPerPage = 20;

  // --- Column Resize & Reorder States ---
  const DEFAULT_COLS = [
    { key: 'name', label: '이름', width: 120 },
    { key: 'phone', label: '연락처', width: 140 },
    { key: 'iap_to', label: 'IAP 수립일', width: 130 },
    { key: 'participation_stage', label: '취업단계', width: 120 },
    { key: 'participate_type', label: '사업유형', width: 120 },
    { key: 'retest_stat', label: '점수', width: 80 },
    { key: 'continue_serv_1_stat', label: '사후관리', width: 100 },
    { key: 'memo', label: '메모', width: 250 },
  ];

  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('zeni_client_col_order');
    return saved ? JSON.parse(saved) : DEFAULT_COLS.map(c => c.key);
  });

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('zeni_client_col_widths');
    return saved ? JSON.parse(saved) : DEFAULT_COLS.reduce((acc, c) => ({ ...acc, [c.key]: c.width }), {});
  });

  const [resizing, setResizing] = useState<{ key: string; startWidth: number; startX: number } | null>(null);
  const [draggingCol, setDraggingCol] = useState<string | null>(null);
  const [dropTargetCol, setDropTargetCol] = useState<string | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Initialize CSS variables for column widths
  useEffect(() => {
    if (!tableContainerRef.current) return;
    Object.entries(columnWidths).forEach(([key, width]) => {
      tableContainerRef.current?.style.setProperty(`--col-width-${key}`, `${width}px`);
    });
  }, [columnWidths]);

  useEffect(() => {
    localStorage.setItem('zeni_client_col_order', JSON.stringify(columnOrder));
  }, [columnOrder]);

  useEffect(() => {
    localStorage.setItem('zeni_client_col_widths', JSON.stringify(columnWidths));
  }, [columnWidths]);

  // --- High Performance Resize Handler ---
  const handleResizeInit = (e: React.MouseEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.pageX;
    const startWidth = columnWidths[key];

    setResizing({ key, startWidth, startX });

    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.pageX - startX;
      const newWidth = Math.max(50, startWidth + delta);
      // Update CSS Variable directly for instant feedback (No React Lag)
      tableContainerRef.current?.style.setProperty(`--col-width-${key}`, `${newWidth}px`);
    };

    const onUp = (upEvent: MouseEvent) => {
      const delta = upEvent.pageX - startX;
      const finalWidth = Math.max(50, startWidth + delta);
      setColumnWidths(prev => ({ ...prev, [key]: finalWidth }));
      setResizing(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // --- Drag Handle ---
  const onDragStart = (key: string) => setDraggingCol(key);

  const onDragOver = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    if (!draggingCol || draggingCol === targetKey) return;

    // Get the bounding box of the target element
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const mouseX = e.clientX;

    // Check if mouse has crossed the 50% threshold of the target column
    const dragIdx = columnOrder.indexOf(draggingCol);
    const targetIdx = columnOrder.indexOf(targetKey);

    // If dragging to the right and mouse is past the center of target
    // OR dragging to the left and mouse is before the center of target
    const shouldSwap = (dragIdx < targetIdx && mouseX > centerX) || (dragIdx > targetIdx && mouseX < centerX);

    if (shouldSwap) {
      const newOrder = [...columnOrder];
      newOrder.splice(dragIdx, 1);
      newOrder.splice(targetIdx, 0, draggingCol);

      if (newOrder.join(',') !== columnOrder.join(',')) {
        setColumnOrder(newOrder);
      }
    }
  };

  const onDragEnd = () => {
    setDraggingCol(null);
    setDropTargetCol(null);
  };

  const getColLabel = (key: string) => DEFAULT_COLS.find(c => c.key === key)?.label || key;

  const deepLinkHandledRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchClients(user?.role === ROLE_COUNSELOR ? user.counselorId : undefined);
      setClients(data);
    } catch (e: any) {
      toast.error('데이터 로드 실패: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, filter]);

  const handleStageUpdate = async (clientId: string, newStage: string) => {
    try {
      await updateClient(clientId, { participation_stage: newStage });
      setClients(prev => prev.map(c => c.id === clientId ? { ...c, participation_stage: newStage } : c));
      let syncFailed = false;
      try {
        await syncEmploymentSuccessCase(clientId);
      } catch (syncError) {
        console.error('Failed to sync employment success case after stage update:', syncError);
        syncFailed = true;
      }

      toast.success('취업단계가 업데이트되었습니다.');
      if (syncFailed) {
        toast.warning('취업성사자 기록(유사도) 저장에 실패했습니다.');
      }
    } catch (e: any) {
      toast.error('업데이트 실패: ' + e.message);
    }
  };

  useEffect(() => {
    if (loading || deepLinkHandledRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const clientId = params.get('clientId');
    if (!clientId) return;

    const targetClient = clients.find(client => client.id === clientId);
    if (!targetClient) return;

    navigate(`/clients/detail/${clientId}`);
    deepLinkHandledRef.current = true;
    window.history.replaceState({}, '', window.location.pathname);
  }, [clients, loading, navigate]);

  const filtered = clients.filter(c => {
    const matchSearch = !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.phone || '').includes(search) ||
      (c.desired_job || '').includes(search);
    // List tabs now follow the same live DB rules as the dashboard instead of legacy mock fields.
    const matchFilter =
      filter === 'all' ? true :
        filter === 'no-score' ? !hasScore(c) :
          filter === 'follow-up' ? needsFollowUp(c) :
            filter === 'employed' ? isEmploymentCompleted(c) : true;
    return matchSearch && matchFilter;
  });

  // Sorting logic
  const sortedData = [...filtered].sort((a, b) => {
    if (!sortConfig) return 0;
    const { key, direction } = sortConfig;

    let aValue: any = (a as any)[key];
    let bValue: any = (b as any)[key];

    // Special handling for null/empty values
    if (aValue == null) aValue = '';
    if (bValue == null) bValue = '';

    if (aValue < bValue) return direction === 'asc' ? -1 : 1;
    if (aValue > bValue) return direction === 'asc' ? 1 : -1;
    return 0;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
  const paginatedClients = sortedData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const counts = {
    all: clients.length,
    'no-score': clients.filter(c => !hasScore(c)).length,
    'follow-up': clients.filter(c => needsFollowUp(c)).length,
    employed: clients.filter(c => isEmploymentCompleted(c)).length,
  };

  const stageColors: Record<string, string> = {
    '초기상담': 'badge-active', '심층상담': 'badge-pending',
    '취업지원': 'badge-pending', '취업완료': 'badge-completed', '사후관리': 'badge-active',
  };

  if (!canRender) return null;

  return (
    <div className="space-y-4" ref={tableContainerRef}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">상담자 목록</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            전체 {clients.length}명
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-sm hover:bg-muted transition-colors" title="새로고침">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => navigate('/clients/register')} className="btn-primary">
            <Plus size={15} className="mr-1" />
            상담자 등록
          </button>
        </div>
      </div>

      <div className="bg-card rounded-md p-4 shadow-sm border border-border space-y-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="이름, 전화번호, 희망직종으로 검색..."
            className="w-full pl-9 pr-4 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <FilterTab label="전체" active={filter === 'all'} count={counts.all} onClick={() => setFilter('all')} />
          <FilterTab label="점수 미확정" active={filter === 'no-score'} count={counts['no-score']} onClick={() => setFilter('no-score')} />
          <FilterTab label="후속 상담" active={filter === 'follow-up'} count={counts['follow-up']} onClick={() => setFilter('follow-up')} />
          <FilterTab label="취업처리" active={filter === 'employed'} count={counts.employed} onClick={() => setFilter('employed')} />
        </div>
      </div>

      <div className="bg-card rounded-md shadow-sm border border-border overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-muted-foreground mr-2" />
            <span className="text-sm text-muted-foreground">데이터 로드 중...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1000px]">
              <thead className="sticky top-0 z-20 block">
                <tr className="flex border-b border-border bg-muted/30">
                  <th
                    className="flex-shrink-0 text-left px-4 py-3 font-medium text-muted-foreground select-none flex items-center"
                    style={{ width: 60 }}
                  >
                    순번
                  </th>
                  <div className="flex flex-1">
                    {columnOrder.map(key => {
                      const isActive = sortConfig?.key === key;
                      const isAsc = isActive && sortConfig?.direction === 'asc';
                      const isDesc = isActive && sortConfig?.direction === 'desc';
                      const label = getColLabel(key);

                      return (
                        <motion.th
                          key={key}
                          layout
                          transition={{ layout: { type: 'spring', damping: 30, stiffness: 500 } }}
                          draggable
                          onDragStart={(e: any) => {
                            onDragStart(key);
                            if (e.dataTransfer) {
                              e.dataTransfer.effectAllowed = 'move';
                            }
                          }}
                          onDragOver={(e) => onDragOver(e, key)}
                          onDragEnd={onDragEnd}
                          className={`flex-shrink-0 text-left px-4 py-3 font-medium text-muted-foreground select-none relative group
                          ${draggingCol === key ? 'opacity-30 grayscale blur-[0.5px] z-30' : 'hover:bg-muted/40 z-10'}`}
                          style={{
                            width: `var(--col-width-${key})`,
                            minWidth: `var(--col-width-${key})`,
                            maxWidth: `var(--col-width-${key})`,
                            cursor: draggingCol ? 'grabbing' : 'default'
                          }}
                        >
                          <div className="flex items-center justify-between pointer-events-none w-full">
                            <div
                              className="flex items-center gap-1 cursor-grab active:cursor-grabbing pointer-events-auto"
                              onClick={() => {
                                if (draggingCol) return;
                                let direction: 'asc' | 'desc' | null = 'asc';
                                if (isActive) {
                                  if (sortConfig?.direction === 'asc') direction = 'desc';
                                  else direction = null;
                                }
                                setSortConfig(direction ? { key, direction } : null);
                              }}
                            >
                              <GripVertical size={12} className={`mr-1 transition-opacity ${draggingCol ? 'opacity-100' : 'opacity-20 group-hover:opacity-100'}`} />
                              <span className="truncate font-semibold text-foreground/80 group-hover:text-foreground">{label}</span>
                              <div className="flex flex-col -space-y-1 shrink-0 ml-1">
                                <ArrowUp size={8} className={isAsc ? 'text-primary' : 'opacity-10'} fill={isAsc ? 'currentColor' : 'none'} />
                                <ArrowDown size={8} className={isDesc ? 'text-primary' : 'opacity-10'} fill={isDesc ? 'currentColor' : 'none'} />
                              </div>
                            </div>

                            {/* Resize Handle */}
                            <div
                              onMouseDown={(e) => handleResizeInit(e, key)}
                              className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary transition-colors z-20 pointer-events-auto
                              ${resizing?.key === key ? 'bg-primary shadow-[0_0_8px_rgba(0,156,100,0.5)]' : ''}`}
                            />
                          </div>
                        </motion.th>
                      );
                    })}
                  </div>
                  <th className="flex-shrink-0 text-right px-4 py-3 font-medium text-muted-foreground flex items-center justify-end" style={{ width: 80 }}>액션</th>
                </tr>
              </thead>
              <tbody className="block">
                {filtered.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground border-b border-border">
                    검색 결과가 없습니다.
                  </div>
                ) : (
                  paginatedClients.map((client, index) => (
                    <tr
                      key={client.id}
                      className="flex border-b border-border last:border-0 hover:bg-muted/5 transition-colors"
                    >
                      <td className="flex-shrink-0 px-4 py-3 text-muted-foreground flex items-center" style={{ width: 60 }}>
                        {(currentPage - 1) * itemsPerPage + index + 1}
                      </td>
                      <div className="flex flex-1 overflow-hidden">
                        {columnOrder.map(key => {
                          const val = (client as any)[key];

                          // Common cell properties for sliding
                          const cellClass = "flex-shrink-0 px-4 py-3 flex items-center overflow-hidden";

                          if (key === 'name') {
                            return (
                              <motion.td
                                key={key}
                                layout
                                transition={{ layout: { type: 'spring', damping: 30, stiffness: 500 } }}
                                className={cellClass}
                                style={{
                                  width: `var(--col-width-${key})`,
                                  minWidth: `var(--col-width-${key})`,
                                  maxWidth: `var(--col-width-${key})`
                                }}
                              >
                                <div className="flex items-center gap-2 overflow-hidden w-full">
                                  <div className="w-7 h-7 rounded-sm flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ background: PRIMARY }}>
                                    {client.name.charAt(0)}
                                  </div>
                                  <div
                                    className="font-medium text-foreground whitespace-nowrap cursor-pointer hover:underline truncate"
                                    onClick={() => navigate(`/clients/detail/${client.id}`)}
                                  >
                                    {client.name}
                                  </div>
                                </div>
                              </motion.td>
                            );
                          }

                          if (key === 'participation_stage') {
                            return (
                              <motion.td
                                key={key}
                                layout
                                transition={{ layout: { type: 'spring', damping: 30, stiffness: 500 } }}
                                className={cellClass}
                                style={{
                                  width: `var(--col-width-${key})`,
                                  minWidth: `var(--col-width-${key})`,
                                  maxWidth: `var(--col-width-${key})`
                                }}
                              >
                                <select
                                  value={client.participation_stage || ''}
                                  onChange={e => handleStageUpdate(client.id, e.target.value)}
                                  className={`text-xs px-2 py-1 rounded-sm border-none focus:ring-0 cursor-pointer appearance-none ${stageColors[client.participation_stage || ''] || 'badge-active'}`}
                                  style={{ width: 'fit-content' }}
                                >
                                  <option value="" disabled>단계 선택</option>
                                  {Object.keys(stageColors).map(s => (
                                    <option key={s} value={s} className="bg-background text-foreground">{s}</option>
                                  ))}
                                </select>
                              </motion.td>
                            );
                          }

                          if (key === 'retest_stat') {
                            return (
                              <motion.td
                                key={key}
                                layout
                                transition={{ layout: { type: 'spring', damping: 30, stiffness: 500 } }}
                                className={cellClass}
                                style={{
                                  width: `var(--col-width-${key})`,
                                  minWidth: `var(--col-width-${key})`,
                                  maxWidth: `var(--col-width-${key})`
                                }}
                              >
                                <div className="w-full">
                                  {client.retest_stat != null
                                    ? <span className="font-semibold" style={{ color: PRIMARY }}>{client.retest_stat}</span>
                                    : <span className="text-muted-foreground">-</span>
                                  }
                                </div>
                              </motion.td>
                            );
                          }

                          if (key === 'continue_serv_1_stat') {
                            return (
                              <motion.td
                                key={key}
                                layout
                                transition={{ layout: { type: 'spring', damping: 30, stiffness: 500 } }}
                                className={cellClass}
                                style={{
                                  width: `var(--col-width-${key})`,
                                  minWidth: `var(--col-width-${key})`,
                                  maxWidth: `var(--col-width-${key})`
                                }}
                              >
                                <span className="text-xs truncate">{formatFollowUpStat(client)}</span>
                              </motion.td>
                            );
                          }

                          if (key === 'memo') {
                            return (
                              <motion.td
                                key={key}
                                layout
                                transition={{ layout: { type: 'spring', damping: 30, stiffness: 500 } }}
                                className={`${cellClass} text-muted-foreground text-xs`}
                                style={{
                                  width: `var(--col-width-${key})`,
                                  minWidth: `var(--col-width-${key})`,
                                  maxWidth: `var(--col-width-${key})`
                                }}
                              >
                                <div className="truncate w-full">{client.memo || '-'}</div>
                              </motion.td>
                            );
                          }

                          return (
                            <motion.td
                              key={key}
                              layout
                              transition={{ layout: { type: 'spring', damping: 30, stiffness: 500 } }}
                              className={`${cellClass} text-muted-foreground whitespace-nowrap`}
                              style={{
                                width: `var(--col-width-${key})`,
                                minWidth: `var(--col-width-${key})`,
                                maxWidth: `var(--col-width-${key})`
                              }}
                            >
                              <div className="truncate w-full">{val || '-'}</div>
                            </motion.td>
                          );
                        })}
                      </div>
                      <td className="flex-shrink-0 px-4 py-3 text-right flex items-center justify-end" style={{ width: 80 }}>
                        <button
                          onClick={() => navigate(`/clients/detail/${client.id}`)}
                          className="p-1.5 rounded-sm hover:bg-muted transition-colors"
                        >
                          <Edit3 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination Fix Outside Table Container */}
      {!loading && filtered.length > 0 && (
        <div className="flex items-center justify-between px-4 py-3 bg-card border border-border rounded-md shadow-sm">
          <div className="text-sm text-muted-foreground">
            전체 <span className="font-medium text-foreground">{filtered.length}</span>명 중 {(currentPage - 1) * itemsPerPage + 1}-{(Math.min(currentPage * itemsPerPage, filtered.length))}명 표시
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-sm border border-border hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent transition-all"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="flex items-center px-2">
              <span className="text-sm font-medium pr-1">{currentPage}</span>
              <span className="text-sm text-muted-foreground">/ {totalPages}</span>
            </div>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-sm border border-border hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent transition-all"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
