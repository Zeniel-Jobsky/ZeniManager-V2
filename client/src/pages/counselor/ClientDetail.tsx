/**
 * Client Detail Page (상담자 상세 정보)
 */
import { useState, useEffect, useCallback } from 'react';
import { useLocation, useParams } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { PARTICIPATION_TYPE_OPTIONS } from '@/const';
import {
  ChevronLeft, User, Phone, Edit3, ClipboardList,
  Loader2, Trash2, Save, ChevronRight, Plus,
  Check, X, Mail, Calendar, MapPin, Target, BookOpen, 
  Building2, Briefcase, Car, Clock, Award
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchClientById, 
  updateClient, 
  fetchBusinessCodes,
  fetchSessions, 
  createSession,
  deleteSession,
  fetchSurveys, 
  createSurvey,
  updateSurvey,
  updateSession,
  createAllowanceLog,
  fetchAllowanceLogs,
  updateAllowanceLog,
  addCertificate,
  deleteCertificate
} from '@/lib/api';
import { syncEmploymentSuccessCase } from '@/lib/employmentSuccessCase';
import type { ClientRow, SessionRow, SurveyRow } from '@/lib/supabase';
import { isSupabaseConfigured } from '@/lib/supabase';
import DaumPostcode from 'react-daum-postcode';
import { CounselChatTab } from './CounselChatTab';
import { ClientSummaryAnalysisTab } from './ClientSummaryAnalysisTab';
import { EmploymentSuccessCaseCard } from './EmploymentSuccessCaseCard';
import './ClientDetail.css';

const PRIMARY = '#009C64';

type ClientTab = 'manage' | 'history' | 'input' | 'survey' | 'summary' | 'chat';

const SUCCESS_CASE_SYNC_FIELDS = new Set([
  'employment_date',
  'employer',
  'job_title',
  'salary',
  'employment_type',
  'participation_stage'
]);

// ─── Survey Definitions ──────────────────────────────────────────────────────

const SURVEY_QUESTIONS = [
  { key: 'survey_1', label: '구직목표 수립', desc: '취업하고자 하는 직종이나 분야에 대한 목표가 있습니까?' },
  { key: 'survey_2', label: '3개월 내 구직의지', desc: '3개월 이내에 취업하고자 하는 의지가 있습니까?' },
  { key: 'survey_3', label: '희망직종 구직계획', desc: '희망 직종에 취업하기 위한 구체적인 계획이 있습니까?' },
  { key: 'survey_4', label: '구직기술 필요도', desc: '이력서 작성, 면접 준비 등 구직기술 지원이 필요합니까?' },
  { key: 'survey_5', label: '구직정보 필요도', desc: '취업처 발굴, 채용정보 등 구직정보 지원이 필요합니까?' },
  { key: 'survey_6', label: '취업역량 향상도', desc: '직업훈련, 자격증 취득 등 취업역량 향상 지원이 필요합니까?' },
  { key: 'survey_7', label: '취업장애요인', desc: '건강, 가족돌봄, 교통 등 취업에 장애가 되는 요인이 있습니까?' },
  { key: 'survey_8', label: '건강상태', desc: '현재 건강상태는 취업활동에 지장이 없습니까?' },
] as const;

const SURVEY_OPTIONS = [
  { value: 3, label: '예', color: '#009C64' },
  { value: 2, label: '보통', color: '#f59e0b' },
  { value: 1, label: '아니오', color: '#ef4444' },
];

function SurveyTab({ clientId }: { clientId: string; }) {
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
    SURVEY_QUESTIONS.forEach(q => {
      const value = (survey as any)[q.key];
      if (typeof value === 'number') {
        nextAnswers[q.key] = value;
      }
    });

    setAnswers(nextAnswers);
    setBarrierDetail(survey.survey_7_memo || '');
    setSurveyDate(survey.survey_date || today);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    syncFormFromSurvey(latestSurvey);
  }, [latestSurvey, syncFormFromSurvey]);

  const resetForm = () => {
    syncFormFromSurvey(latestSurvey);
  };

  const handleSave = async () => {
    if (Object.keys(answers).length < SURVEY_QUESTIONS.length) {
      toast.error('모든 항목에 응답해주세요.');
      return;
    }
    if (!isSupabaseConfigured()) {
      toast.error('Supabase 설정이 필요합니다.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        client_id: clientId,
        survey_date: surveyDate,
        survey_1: answers['survey_1'] || null,
        survey_2: answers['survey_2'] || null,
        survey_3: answers['survey_3'] || null,
        survey_4: answers['survey_4'] || null,
        survey_5: answers['survey_5'] || null,
        survey_6: answers['survey_6'] || null,
        survey_7: answers['survey_7'] || null,
        survey_8: answers['survey_8'] || null,
        survey_7_memo: answers['survey_7'] && answers['survey_7'] >= 2 ? barrierDetail || null : null,
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
              className="text-xs px-2 py-1 rounded-sm border border-input bg-background"
            />
          </div>
        </div>

        <div className="space-y-3">
          {SURVEY_QUESTIONS.map((q, idx) => (
            <div key={q.key} className="space-y-1.5">
              <div className="text-xs font-medium text-foreground">{idx + 1}. {q.label}</div>
              <div className="text-xs text-muted-foreground">{q.desc}</div>
              <div className="flex gap-2">
                {SURVEY_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setAnswers(a => ({ ...a, [q.key]: opt.value }))}
                    className="flex-1 py-1.5 rounded-sm text-xs font-medium border transition-all"
                    style={answers[q.key] === opt.value
                      ? { background: opt.color, borderColor: opt.color, color: 'white' }
                      : { borderColor: '#e5e7eb', color: '#6b7280' }
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {(answers['survey_7'] === 2 || answers['survey_7'] === 3) && (
          <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="text-xs font-medium text-foreground">취업장애요인 상세내용</div>
            <textarea
              value={barrierDetail}
              onChange={e => setBarrierDetail(e.target.value)}
              placeholder="장애요인에 대해 상세히 입력해주세요..."
              className="w-full text-xs p-2 rounded-sm border border-input bg-background min-h-[60px] outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
        )}

        <div className="flex items-center justify-end pt-2 border-t border-border">
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving} className="btn-primary py-1.5 px-3 text-xs">저장</button>
            <button onClick={resetForm} className="btn-cancel py-1.5 px-3 text-xs">취소</button>
          </div>
        </div>
      </div>

      <div className="grid gap-3">
        {surveys.map(s => (
          <div key={s.survey_id} className="counsel_survey_item">
            <div>
              <div className="text-sm font-medium">{s.survey_date} 설문</div>
              <div className="text-xs text-muted-foreground">
                {s.survey_7_memo ? `취업장애요인 메모: ${s.survey_7_memo}` : '설문 완료'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();

  const [client, setClient] = useState<ClientRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ClientTab>('manage');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [businessCodes, setBusinessCodes] = useState<{ value: string; label: string }[]>([]);
  const [allowanceLogs, setAllowanceLogs] = useState<any[]>([]);
  const [isAddingAllowance, setIsAddingAllowance] = useState(false);
  const [newAllowanceData, setNewAllowanceData] = useState({
    round: 1,
    start_date: new Date().toISOString().split('T')[0],
    end_date: new Date().toISOString().split('T')[0],
    apply_date: new Date().toISOString().split('T')[0],
    expected_payment_date: new Date().toISOString().split('T')[0],
    has_income: false,
    family_allowance_count: 0,
    is_paid: false,
    activity_content: ''
  });

  const [editingAllowanceId, setEditingAllowanceId] = useState<number | null>(null);
  const [editAllowanceMemoValue, setEditAllowanceMemoValue] = useState('');

  // NOTE(2026-08-26): public.sessions 스키마에는 회차/시간/프로파일링 필드가 없어
  // type/date/content/next_action만 저장된다.
  const [newSession, setNewSession] = useState({
    type: '초기상담',
    content: '',
    next_action: '',
    date: new Date().toISOString().split('T')[0],
  });

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editSessionContent, setEditSessionContent] = useState<string>('');
  
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isEditingHistory, setIsEditingHistory] = useState(false);
  const [historyEditDraft, setHistoryEditDraft] = useState<Partial<SessionRow>>({});
  
  // Allowance log specific editing states
  const [editingLogId, setEditingLogId] = useState<number | null>(null);
  const [editingLogField, setEditingLogField] = useState<string | null>(null);
  const [logEditValue, setLogEditValue] = useState<string>('');

  const loadClient = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const data = await fetchClientById(id);
      setClient(data);
    } catch (err) {
      toast.error('내담자 정보를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadBusinessCodes = useCallback(async () => {
    try {
      const codes = await fetchBusinessCodes();
      if (codes && codes.length > 0) {
        setBusinessCodes(codes);
      } else {
        // Fallback demo data if API returns empty (e.g., during local dev)
        setBusinessCodes([
          { value: '1', label: '테스트 취업지원제도 1유형' },
          { value: '2', label: '테스트취업 2유형' },
        ]);
      }
    } catch (e) {
      console.error('Failed to fetch business codes:', e);
      // Also provide fallback in case of error
      setBusinessCodes([
        { value: '1', label: '테스트 취업지원제도 1유형' },
        { value: '2', label: '테스트취업 2유형' },
      ]);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    if (!id) return;
    try {
      const data = await fetchSessions(id);
      setSessions(data);
    } catch (err) {
      toast.error('상담 이력을 불러오는데 실패했습니다.');
    }
  }, [id]);

  const loadAllowanceLogs = useCallback(async () => {
    if (!id) return;
    try {
      const data = await fetchAllowanceLogs(id);
      setAllowanceLogs(data);
    } catch (err) {
      console.error('Failed to load allowance logs', err);
    }
  }, [id]);

  useEffect(() => { 
    loadClient(); 
    loadBusinessCodes();
    loadAllowanceLogs();
  }, [loadClient, loadBusinessCodes, loadAllowanceLogs]);

  useEffect(() => {
    if (activeTab === 'history' || activeTab === 'input') loadSessions();
  }, [activeTab, loadSessions]);

  // NOTE(2026-08-26): 자격증 기능은 현재 DB 스키마(public.clients)에서 지원되지 않는다.
  // addCertificate/deleteCertificate는 항상 에러를 던지도록 스텁 처리되어 있음.
  const handleAddCert = async (name: string, date: string | null) => {
    if (!id || !client) return;
    try {
      await addCertificate(id, name, date);
    } catch (e: any) {
      toast.error('자격증 추가 실패: ' + e.message);
    }
  };

  const handleDeleteCert = async (name: string) => {
    if (!id || !client) return;
    try {
      await deleteCertificate(id, name);
    } catch (e: any) {
      toast.error('자격증 삭제 실패: ' + e.message);
    }
  };

  const startEdit = (field: string, initialValue: any) => {
    setEditingField(field);
    setEditValue(String(initialValue ?? ''));
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue('');
  };

  const handleUpdateField = async (field: string, forcedValue?: any, secondField?: string, secondValue?: any) => {
    if (!id || !client) return;
    setSaving(true);
    try {
      const updates: any = {};
      
      // NOTE(2026-08-26): public.clients 스키마 기준. DB 컬럼명이 ClientRow 필드명과
      // 대부분 동일해서(_code/_encrypted 접미사 없음) dbKey는 기본적으로 필드명 그대로 쓰고,
      // 예외(표시용으로 이름이 다른 필드, 값 포맷 변환이 필요한 필드)만 처리한다.
      const processField = (f: string, v: any) => {
        let dbKey = f;
        let val: any = v;

        if (f === 'counsel_notes') return { dbKey: 'counsel_notes', val: v };
        // "보유점수" 필드는 rediagnosis_yn 값을 보여주는 표시용 필드명이라 실제 저장은 rediagnosis_yn으로.
        if (f === 'retest_score') dbKey = 'rediagnosis_yn';

        if (v === '' || v === null || v === undefined) {
          val = null;
        } else {
          if (f === 'age') {
            const num = Number(v.toString().replace(/[^0-9.-]/g, ''));
            val = isNaN(num) ? null : num;
          }

          // Phone formatting (01012345678 -> 010-1234-5678)
          if (f === 'phone') {
            const digits = v.toString().replace(/[^0-9]/g, '');
            if (digits.length === 11) {
              val = digits.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
            } else if (digits.length === 10) {
              val = digits.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
            } else {
              val = digits;
            }
          }

          // Date formatting (19940624 -> 1994-06-24)
          const dateFields = ['iap_date', 'initial_counsel_date', 'rediagnosis_date', 'employment_date'];
          if (dateFields.includes(f)) {
            const digits = v.toString().replace(/[^0-9]/g, '');
            if (digits.length === 8) {
              val = digits.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
            } else {
              val = v;
            }
          }
        }

        return { dbKey, val };
      };

      const main = processField(field, forcedValue !== undefined ? forcedValue : editValue);
      updates[main.dbKey] = main.val;

      if (secondField !== undefined) {
        const second = processField(secondField, secondValue);
        updates[second.dbKey] = second.val;
      }

      await updateClient(id, updates);

      // Update state
      const newState = { ...client, [field]: main.val };
      if (secondField) (newState as any)[secondField] = secondValue;

      setClient(newState as ClientRow);

      const second = secondField !== undefined ? processField(secondField, secondValue) : null;
      const shouldSyncSuccessCase =
        SUCCESS_CASE_SYNC_FIELDS.has(main.dbKey) ||
        (second ? SUCCESS_CASE_SYNC_FIELDS.has(second.dbKey) : false);

      if (shouldSyncSuccessCase) {
        try {
          await syncEmploymentSuccessCase(id);
        } catch (syncError) {
          console.error('Failed to sync employment success case after client detail update:', {
            clientId: id,
            field: main.dbKey,
            secondField: second?.dbKey ?? null,
            error: syncError instanceof Error ? syncError.message : syncError,
          });
          toast.warning('취업성사자 기록(유사도) 저장에 실패했습니다.');
        }
      }

      toast.success('적용되었습니다.');
      setEditingField(null);
    } catch (e: any) {
      toast.error('수정 실패: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateSession = async (session: SessionRow) => {
    try {
      await updateSession(session.id, {
        ...session,
        content: editSessionContent
      });
      setSessions(prev => prev.map(s => s.id === session.id ? { ...s, content: editSessionContent } : s));
      toast.success('상담 이력이 수정되었습니다.');
      setEditingSessionId(null);
    } catch (e: any) {
      toast.error('수정 실패: ' + e.message);
    }
  };

  const startEditLogField = (logId: number, fieldName: string, initialVal: string | null) => {
    setEditingLogId(logId);
    setEditingLogField(fieldName);
    setLogEditValue(initialVal || '');
  };

  const cancelEditLog = () => {
    setEditingLogId(null);
    setEditingLogField(null);
    setLogEditValue('');
  };

  const saveLogField = async () => {
    if (!editingLogId || !editingLogField) return;
    try {
      setSaving(true);
      let val = logEditValue;
      const dateFields = ['start_date', 'end_date', 'apply_date', 'expected_payment_date'];
      if (dateFields.includes(editingLogField)) {
        const digits = val.replace(/[^0-9]/g, '');
        if (digits.length === 8) {
          val = digits.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
        }
      }
      await updateAllowanceLog(editingLogId, { [editingLogField]: val });
      setAllowanceLogs(prev => prev.map(log => log.allowance_id === editingLogId ? { ...log, [editingLogField]: val } : log));
      toast.success('수정되었습니다.');
      cancelEditLog();
    } catch (e: any) {
      toast.error('수정 실패: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateAllowanceLogField = async (allowanceId: number, field: string, value: any) => {
    try {
      // Direct updates for boolean/dropdowns
      await updateAllowanceLog(allowanceId, { [field]: value });
      setAllowanceLogs(prev => prev.map(log => log.allowance_id === allowanceId ? { ...log, [field]: value } : log));
      toast.success('적용되었습니다.');
    } catch (e: any) {
      toast.error('오류 발생: ' + e.message);
    }
  };

  const handleSaveAllowanceMemo = async (allowanceId: number) => {
    try {
      setSaving(true);
      await updateAllowanceLog(allowanceId, { activity_content: editAllowanceMemoValue });
      setAllowanceLogs(prev => prev.map(log => log.allowance_id === allowanceId ? { ...log, activity_content: editAllowanceMemoValue } : log));
      toast.success('메모가 저장되었습니다.');
      setEditingAllowanceId(null);
    } catch (e: any) {
      toast.error('저장 실패: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAllowanceLog = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await createAllowanceLog({
        client_id: id,
        ...newAllowanceData
      });
      toast.success('수당 신청 기록이 추가되었습니다.');
      setIsAddingAllowance(false);
      loadAllowanceLogs();
    } catch (e: any) {
      toast.error('추가 실패: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const clearSelectedSession = () => {
    setSelectedSessionId(null);
    setIsEditingHistory(false);
  };

  const handleCreateSession = async () => {
    if (!id || !user) return;
    setSaving(true);
    try {
      await createSession({
        client_id: id,
        ...newSession,
        counselor_name: user?.name || null,
        counselor_id: user?.id || null,
      });

      toast.success('저장되었습니다.');
      setNewSession({
        type: '초기상담',
        content: '',
        next_action: '',
        date: new Date().toISOString().split('T')[0],
      });
      loadSessions();
      loadClient(); // 내담자 정보(참여 단계) 새로고침
      setActiveTab('history');
    } catch (e: any) {
      toast.error('저장 실패: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSession = async (sid: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      await deleteSession(sid);
      setSessions(prev => prev.filter(s => s.id !== sid));
      toast.success('삭제되었습니다.');
    } catch (e: any) {
      toast.error('삭제 실패');
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[400px] animate-pulse">
      <Loader2 size={32} className="animate-spin text-primary mb-4" />
      <span className="text-sm font-medium text-muted-foreground">상담자 정보를 불러오는 중...</span>
    </div>
  );

  if (!client) return (
    <div className="p-8 text-center text-muted-foreground">상담자를 찾을 수 없습니다.</div>
  );

  const stageColors: Record<string, string> = {
    '초기상담': 'badge-active', 
    '심층상담': 'badge-pending',
    '취업지원': 'badge-pending', 
    '취업완료': 'badge-completed', 
    '사후처리': 'badge-active'
  };

  return (
    <div className="counsel_detail_container animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Header */}
      <div className="counsel_header flex items-center justify-between mb-6 px-1">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/counselor/clients')} className="p-2 hover:bg-muted rounded-full transition-all group">
            <ChevronLeft size={20} className="group-hover:-translate-x-0.5 transition-transform" />
          </button>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <h1 className="text-xl font-bold tracking-tight">{client.name}</h1>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${stageColors[client.participation_stage || ''] || 'badge-active'}`}>
                {client.participation_stage || '상태 미정'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <Phone size={11} /> {client.phone || '-'}
              <span className="opacity-30">|</span>
              <User size={11} /> {client.gender || '-'} ({client.age ? `${client.age}세` : '-'})
            </p>
          </div>
        </div>
      </div>

      {/*
        NOTE(2026-08-26): 실데이터의 참여단계 값이 5단계 고정 파이프라인을 훨씬 벗어나
        (구직활동/중단/만종/사후관리취업 등 30여 종) 있어, 5단계 진행바는 대부분의 레코드에서
        전부 비활성으로 보이는 오해의 소지가 있었다. 상단 배지(위 헤더)가 실제 값을 그대로
        보여주므로 진행바는 제거함.
      */}

      <EmploymentSuccessCaseCard clientId={client.id} />

      {/* Tabs */}
      <div className="counsel_tab_wrapper flex gap-1 border-b border-border pb-px overflow-x-auto mb-6">
        {[ 
          { id: 'manage', label: '대시보드' },
          { id: 'history', label: '상담이력' },
          { id: 'input', label: '상담입력' },
          { id: 'survey', label: '구직준비도' },
          { id: 'summary', label: '요약 및 분석' },
          { id: 'chat', label: '챗봇' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as ClientTab)}
            className={`counsel_tab_btn px-6 py-3 text-sm font-medium transition-all relative
              ${activeTab === tab.id ? 'text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="counsel_content_card bg-card border border-border rounded-xl p-6 min-h-[500px] shadow-sm">
        {activeTab === 'manage' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Column 1: Personal Profile (Reorganized & Expanded) */}
              <div className="counsel_dashboard_card bg-muted/20 p-5 rounded-xl border border-border/50">
                <h3 className="text-sm font-bold flex items-center justify-between mb-5 text-foreground/80">
                  <span className="flex items-center gap-2"><User size={15} className="text-primary" /> 인적 사항</span>
                  <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">상세 프로필</span>
                </h3>

                <div className="space-y-1">
                  <DashboardField label="연락처" icon={<Phone size={13} />} field="phone" value={client.phone} onEdit={startEdit} editingField={editingField} editValue={editValue} setEditValue={setEditValue} onConfirm={handleUpdateField} onCancel={cancelEdit} />
                  
                  <DashboardField
                    label="나이"
                    icon={<Calendar size={13} />}
                    field="age"
                    value={client.age != null ? String(client.age) : null}
                    onEdit={startEdit}
                    editingField={editingField}
                    editValue={editValue}
                    setEditValue={setEditValue}
                    onConfirm={handleUpdateField}
                    onCancel={cancelEdit}
                  />

                  <DashboardField label="주소" icon={<MapPin size={13} />} field="address" value={client.address} onEdit={startEdit} editingField={editingField} editValue={editValue} setEditValue={setEditValue} onConfirm={handleUpdateField} onCancel={cancelEdit} />

                  <DashboardField
                    label="최종학력"
                    icon={<BookOpen size={13} />}
                    field="education_level"
                    value={client.education_level}
                    onEdit={startEdit}
                    editingField={editingField}
                    editValue={editValue}
                    setEditValue={setEditValue}
                    onConfirm={handleUpdateField}
                    onCancel={cancelEdit}
                    type="select"
                    options={['초졸', '중졸', '고졸', '전문대졸', '대졸', '석사', '박사'].map(v => ({ value: v, label: v }))}
                  />
                  <DashboardField
                    label="대학교명"
                    icon={<Building2 size={13} />}
                    field="school"
                    value={client.school}
                    onEdit={startEdit}
                    editingField={editingField}
                    editValue={editValue}
                    setEditValue={setEditValue}
                    onConfirm={handleUpdateField}
                    onCancel={cancelEdit}
                  />
                  <DashboardField
                    label="전공"
                    icon={<Award size={13} />}
                    field="major"
                    value={client.major}
                    onEdit={startEdit}
                    editingField={editingField}
                    editValue={editValue}
                    setEditValue={setEditValue}
                    onConfirm={handleUpdateField}
                    onCancel={cancelEdit}
                  />
                </div>
              </div>

              {/* Column 2: Management Status */}
              <div className="counsel_dashboard_card bg-muted/20 p-5 rounded-xl border border-border/50">
                <h3 className="text-sm font-bold flex items-center gap-2 mb-5 text-foreground/80">
                  <Building2 size={15} className="text-primary" /> 관리 현황
                </h3>
                <DashboardField 
                    label="배정구분" 
                    field="assignment_type" 
                    value={client.assignment_type} 
                    onEdit={startEdit} 
                    editingField={editingField} 
                    editValue={editValue} 
                    setEditValue={setEditValue} 
                    onConfirm={handleUpdateField} 
                    onCancel={cancelEdit} 
                    type="select"
                    options={[
                        { value: '이관', label: '이관' }, 
                        { value: '모집', label: '모집' }, 
                        { value: '배정', label: '배정' }
                    ]}
                />
                <DashboardField 
                    label="사업유형" 
                    field="business_type" 
                    value={client.business_type} 
                    onEdit={startEdit} 
                    editingField={editingField} 
                    editValue={editValue} 
                    setEditValue={setEditValue} 
                    onConfirm={handleUpdateField} 
                    onCancel={cancelEdit} 
                    type="select"
                    options={businessCodes.filter(c => c.value && c.value !== '')}
                />
                <DashboardField 
                    label="참여유형" 
                    field="participation_type" 
                    value={client.participation_type} 
                    onEdit={startEdit} 
                    editingField={editingField} 
                    editValue={editValue} 
                    setEditValue={setEditValue} 
                    onConfirm={handleUpdateField} 
                    onCancel={cancelEdit} 
                    type="select"
                    options={[...PARTICIPATION_TYPE_OPTIONS]}
                />
                <DashboardField
                    label="역량등급"
                    field="competency_grade"
                    value={client.competency_grade}
                    onEdit={startEdit} 
                    editingField={editingField} 
                    editValue={editValue} 
                    setEditValue={setEditValue} 
                    onConfirm={handleUpdateField} 
                    onCancel={cancelEdit} 
                    type="select"
                    options={[
                        { value: 'A', label: 'A등급 (구직준비도 높음)' },
                        { value: 'B', label: 'B등급 (구직역량 필요)' },
                        { value: 'C', label: 'C등급 (취업의지 부족)' },
                        { value: 'D', label: 'D등급 (심층상담 필요)' }
                    ]}
                />
                <DashboardField 
                    label="참여단계" 
                    field="participation_stage" 
                    value={client.participation_stage}
                    onEdit={startEdit}
                    editingField={editingField}
                    editValue={editValue}
                    setEditValue={setEditValue}
                    onConfirm={handleUpdateField}
                    onCancel={cancelEdit}
                    isBadge
                    stageColors={stageColors}
                />
                {/* NOTE(2026-08-26): 실데이터의 참여단계가 고정 5개보다 훨씬 다양해서(30여 종)
                    드롭다운 대신 자유 텍스트로 입력받는다. */}
              </div>

              {/* Column 3: Key Dates */}
              <div className="counsel_dashboard_card bg-muted/20 p-5 rounded-xl border border-border/50">
                <h3 className="text-sm font-bold flex items-center gap-2 mb-5 text-foreground/80">
                  <Clock size={15} className="text-primary" /> 주요 일정
                </h3>
                <DashboardField label="초기상담일" icon={<Calendar size={13} />} field="initial_counsel_date" value={client.initial_counsel_date} onEdit={startEdit} editingField={editingField} editValue={editValue} setEditValue={setEditValue} onConfirm={handleUpdateField} onCancel={cancelEdit} type="date" readonly />
                <DashboardField label="IAP수립일" icon={<Calendar size={13} />} field="iap_date" value={client.iap_date} onEdit={startEdit} editingField={editingField} editValue={editValue} setEditValue={setEditValue} onConfirm={handleUpdateField} onCancel={cancelEdit} type="date" />
                <div className="grid grid-cols-2 gap-4">
                  <DashboardField label="재진단일" icon={<Calendar size={13} />} field="rediagnosis_date" value={client.rediagnosis_date} onEdit={startEdit} editingField={editingField} editValue={editValue} setEditValue={setEditValue} onConfirm={handleUpdateField} onCancel={cancelEdit} type="date" />
                  <DashboardField 
                      label="재진단여부" 
                      field="rediagnosis_yn" 
                      value={client.rediagnosis_yn} 
                      onEdit={startEdit} 
                      editingField={editingField} 
                      editValue={editValue} 
                      setEditValue={setEditValue} 
                      onConfirm={handleUpdateField} 
                      onCancel={cancelEdit} 
                      type="select"
                      options={[
                          { value: '1', label: '완료' },
                          { value: '0', label: '미완료' },
                          { value: '90', label: '진행중' }
                      ]}
                  />
                </div>
                <DashboardField label="보유점수" field="retest_score" value={client.rediagnosis_yn ? `${client.rediagnosis_yn}점` : '-'} onEdit={startEdit} editingField={editingField} editValue={editValue} setEditValue={setEditValue} onConfirm={handleUpdateField} onCancel={cancelEdit} highlight />
              </div>

              {/* Column 3.5: Allowance Log */}
              <div className="counsel_dashboard_card bg-muted/20 p-5 rounded-xl border border-border/50">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-sm font-bold flex items-center gap-2 text-foreground/80">
                    <Award size={15} className="text-primary" /> 수당 신청 여부
                  </h3>
                  <button 
                    onClick={() => setIsAddingAllowance(!isAddingAllowance)}
                    className="p-1 hover:bg-primary/10 rounded-full text-primary transition-colors"
                  >
                    {isAddingAllowance ? <X size={16} /> : <Plus size={16} />}
                  </button>
                </div>

                {isAddingAllowance && (
                  <div className="mb-6 p-4 border-2 border-primary/20 rounded-xl bg-primary/5 animate-in slide-in-from-top-2 duration-300">
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold text-primary">회차</span>
                        <input type="number" className="border rounded px-2 py-1.5 text-xs outline-none focus:border-primary" value={newAllowanceData.round} onChange={e => setNewAllowanceData({...newAllowanceData, round: Number(e.target.value)})} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold text-primary">지급여부</span>
                        <select className="border rounded px-2 py-1.5 text-xs outline-none focus:border-primary" value={newAllowanceData.is_paid ? '1' : '0'} onChange={e => setNewAllowanceData({...newAllowanceData, is_paid: e.target.value === '1'})}>
                          <option value="0">미지급</option>
                          <option value="1">지급완료</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold text-primary">신청일</span>
                        <div className="relative">
                          <input 
                            type="text" 
                            className="w-full border rounded px-2 py-1.5 text-xs outline-none focus:border-primary pr-7" 
                            placeholder="YYYY-MM-DD"
                            value={newAllowanceData.apply_date} 
                            onChange={e => {
                              let val = e.target.value;
                              const digits = val.replace(/[^0-9]/g, '');
                              if (digits.length <= 4) val = digits;
                              else if (digits.length <= 6) val = digits.replace(/(\d{4})(\d{1,2})/, '$1-$2');
                              else val = digits.replace(/(\d{4})(\d{2})(\d{2,2})/, '$1-$2-$3');
                              setNewAllowanceData({...newAllowanceData, apply_date: val});
                            }} 
                          />
                          <input 
                            type="date" 
                            id="new-allowance-apply-date"
                            className="absolute inset-0 opacity-0 pointer-events-none"
                            value={newAllowanceData.apply_date && /^\d{4}-\d{2}-\d{2}$/.test(newAllowanceData.apply_date) ? newAllowanceData.apply_date : ''}
                            onChange={(e) => setNewAllowanceData({...newAllowanceData, apply_date: e.target.value})}
                          />
                          <button 
                            type="button"
                            onClick={() => (document.getElementById('new-allowance-apply-date') as any)?.showPicker()}
                            className="absolute right-1 top-1/2 -translate-y-1/2 text-primary hover:bg-primary/10 p-1 rounded"
                          >
                            <Calendar size={13} />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold text-primary">예상지급일</span>
                        <div className="relative">
                          <input 
                            type="text" 
                            className="w-full border rounded px-2 py-1.5 text-xs outline-none focus:border-primary pr-7" 
                            placeholder="YYYY-MM-DD"
                            value={newAllowanceData.expected_payment_date} 
                            onChange={e => {
                              let val = e.target.value;
                              const digits = val.replace(/[^0-9]/g, '');
                              if (digits.length <= 4) val = digits;
                              else if (digits.length <= 6) val = digits.replace(/(\d{4})(\d{1,2})/, '$1-$2');
                              else val = digits.replace(/(\d{4})(\d{2})(\d{2,2})/, '$1-$2-$3');
                              setNewAllowanceData({...newAllowanceData, expected_payment_date: val});
                            }} 
                          />
                          <input 
                            type="date" 
                            id="new-allowance-pay-date"
                            className="absolute inset-0 opacity-0 pointer-events-none"
                            value={newAllowanceData.expected_payment_date && /^\d{4}-\d{2}-\d{2}$/.test(newAllowanceData.expected_payment_date) ? newAllowanceData.expected_payment_date : ''}
                            onChange={(e) => setNewAllowanceData({...newAllowanceData, expected_payment_date: e.target.value})}
                          />
                          <button 
                            type="button"
                            onClick={() => (document.getElementById('new-allowance-pay-date') as any)?.showPicker()}
                            className="absolute right-1 top-1/2 -translate-y-1/2 text-primary hover:bg-primary/10 p-1 rounded"
                          >
                            <Calendar size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 mb-4">
                      <span className="text-[11px] font-bold text-primary">메모</span>
                      <textarea 
                        className="w-full border rounded px-2 py-2 text-xs min-h-[60px] outline-none focus:border-primary resize-none" 
                        placeholder="상세 내용을 입력하세요..."
                        value={newAllowanceData.activity_content}
                        onChange={e => setNewAllowanceData({...newAllowanceData, activity_content: e.target.value})}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleCreateAllowanceLog} disabled={saving} className="flex-1 bg-primary text-white py-2 rounded-lg text-xs font-bold hover:bg-primary-dark transition-colors flex items-center justify-center gap-2">
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} 저장하기
                      </button>
                      <button onClick={() => setIsAddingAllowance(false)} className="px-4 py-2 border border-border rounded-lg text-xs hover:bg-muted transition-colors">취소</button>
                    </div>
                  </div>
                )}

                {allowanceLogs.length > 0 ? (
                  allowanceLogs.map((log) => (
                    <div key={log.allowance_id || log.round} className="mb-4 border border-border/50 rounded-lg p-3 bg-white/50">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold text-primary">{log.round}회차 참여수당</span>
                        <select
                          className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-bold outline-none border border-primary/20"
                          value={log.is_paid ? '1' : '0'}
                          onChange={e => handleUpdateAllowanceLogField(log.allowance_id, 'is_paid', e.target.value === '1')}
                        >
                          <option value="1">지급완료</option>
                          <option value="0">미지급</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        {['start_date', 'end_date', 'apply_date', 'expected_payment_date'].map((field) => (
                           <div key={field} className="text-[11px] flex flex-col gap-1">
                             <span className="text-muted-foreground mr-1">
                               {field === 'start_date' ? '지원시작일' : 
                                field === 'end_date' ? '지원종료일' :
                                field === 'apply_date' ? '신청일' : '예상지급일'}:
                             </span>
                             {editingLogId === log.allowance_id && editingLogField === field ? (
                               <div className="flex items-center gap-1">
                                  <div className="relative flex-1">
                                    <input 
                                      className="w-full border-2 border-primary rounded px-1.5 py-1 text-[11px] outline-none animate-in fade-in zoom-in-95 pr-6" 
                                      value={logEditValue} 
                                      autoFocus
                                      onChange={e => {
                                        let val = e.target.value;
                                        const digits = val.replace(/[^0-9]/g, '');
                                        if (digits.length <= 4) val = digits;
                                        else if (digits.length <= 6) val = digits.replace(/(\d{4})(\d{1,2})/, '$1-$2');
                                        else val = digits.replace(/(\d{4})(\d{2})(\d{2,2})/, '$1-$2-$3');
                                        setLogEditValue(val);
                                      }}
                                      onKeyDown={e => e.key === 'Enter' && saveLogField()}
                                    />
                                    <input 
                                      type="date" 
                                      id={`date-picker-log-${log.allowance_id}-${field}`}
                                      className="absolute inset-0 opacity-0 pointer-events-none"
                                      value={logEditValue && /^\d{4}-\d{2}-\d{2}$/.test(logEditValue) ? logEditValue : ''}
                                      onChange={(e) => setLogEditValue(e.target.value)}
                                    />
                                    <button 
                                      type="button"
                                      onClick={() => (document.getElementById(`date-picker-log-${log.allowance_id}-${field}`) as any)?.showPicker()}
                                      className="absolute right-1 top-1/2 -translate-y-1/2 text-primary hover:bg-primary/5 p-1 rounded"
                                    >
                                      <Calendar size={11} />
                                    </button>
                                  </div>
                                  <button onClick={saveLogField} className="text-primary hover:bg-primary/10 p-1 rounded-full shrink-0"><Check size={12} /></button>
                                  <button onClick={cancelEditLog} className="text-muted-foreground hover:bg-muted p-1 rounded-full shrink-0"><X size={12} /></button>
                               </div>
                             ) : (
                               <div className="flex items-center justify-between hover:bg-primary/5 p-1 rounded cursor-pointer group/field" onClick={() => startEditLogField(log.allowance_id, field, (log as any)[field])}>
                                 <div className="flex items-center gap-1.5 text-foreground/80">
                                   <Calendar size={11} className="text-primary/50 group-hover/field:text-primary transition-colors" />
                                   {(log as any)[field] || '-'}
                                 </div>
                                 <Edit3 size={10} className="opacity-0 group-hover/field:opacity-100 text-primary transition-all" />
                               </div>
                             )}
                           </div>
                        ))}
                      </div>
                      <div className="text-[11px] mb-2 flex items-center gap-2">
                        <span className="text-muted-foreground">수입여부:</span>
                        <select className="border rounded px-1 py-0.5 text-[11px] outline-none" value={log.has_income ? '1' : '0'} onChange={e => handleUpdateAllowanceLogField(log.allowance_id, 'has_income', e.target.value === '1')}>
                          <option value="1">있음</option>
                          <option value="0">없음</option>
                        </select>
                      </div>
                      <div className="flex justify-between items-center text-[11px] text-muted-foreground mb-1">
                        <span>메모:</span>
                        {editingAllowanceId === log.allowance_id ? (
                          <div className="flex gap-2">
                             <button onClick={() => handleSaveAllowanceMemo(log.allowance_id)} className="text-primary font-bold hover:underline">저장</button>
                             <button onClick={() => setEditingAllowanceId(null)} className="text-muted-foreground hover:underline">취소</button>
                          </div>
                        ) : (
                          <button onClick={() => { setEditingAllowanceId(log.allowance_id); setEditAllowanceMemoValue(log.activity_content || ''); }} className="text-primary hover:underline flex items-center gap-1"><Edit3 size={10} /> 수정</button>
                        )}
                      </div>
                      {editingAllowanceId === log.allowance_id ? (
                        <textarea 
                          className="w-full bg-white p-2 rounded border-2 border-primary/30 text-[11px] text-foreground/80 min-h-[60px] outline-none resize-none focus:border-primary transition-all"
                          value={editAllowanceMemoValue}
                          onChange={e => setEditAllowanceMemoValue(e.target.value)}
                          placeholder="메모를 입력하세요..."
                          autoFocus
                        />
                      ) : (
                        <div className="bg-white/30 p-2 rounded border border-border/30 text-[11px] text-foreground/80 min-h-[40px] whitespace-pre-wrap">
                          {log.activity_content || '메모가 없습니다.'}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-center py-6 text-xs text-muted-foreground border border-dashed border-border/50 rounded-lg">
                    등록된 수당 신청 기록이 없습니다.
                  </div>
                )}
              </div>

              {/* Row 2 */}
              
              {/* Column 4: Detailed Desired Conditions */}
              <div className="counsel_dashboard_card bg-muted/20 p-5 rounded-xl border border-border/50">
                <h3 className="text-sm font-bold flex items-center gap-2 mb-5 text-foreground/80">
                  <Target size={15} className="text-primary" /> 희망 조건 상세
                </h3>
                <DashboardField label="희망직종" field="desired_job" value={client.desired_job} onEdit={() => startEdit('desired_job', client.desired_job)} editingField={editingField} editValue={editValue} setEditValue={setEditValue} onConfirm={handleUpdateField} onCancel={cancelEdit} />
              </div>

              {/* Column 5: Employment Results */}
              <div className="counsel_dashboard_card bg-muted/20 p-5 rounded-xl border border-border/50">
                <h3 className="text-sm font-bold flex items-center gap-2 mb-5 text-foreground/80">
                  <Briefcase size={15} className="text-primary" /> 취업 성과
                </h3>
                <DashboardField label="취업처" field="employer" value={client.employer} onEdit={startEdit} editingField={editingField} editValue={editValue} setEditValue={setEditValue} onConfirm={handleUpdateField} onCancel={cancelEdit} />
                <DashboardField label="취업직무" field="job_title" value={client.job_title} onEdit={startEdit} editingField={editingField} editValue={editValue} setEditValue={setEditValue} onConfirm={handleUpdateField} onCancel={cancelEdit} />
                <DashboardField label="취업일자" icon={<Calendar size={13} />} field="employment_date" value={client.employment_date} onEdit={startEdit} editingField={editingField} editValue={editValue} setEditValue={setEditValue} onConfirm={handleUpdateField} onCancel={cancelEdit} type="date" />
                <DashboardField
                    label="급여"
                    icon={<span className="font-bold text-[11px] text-primary">₩</span>}
                    field="salary"
                    value={client.salary}
                    onEdit={() => startEdit('salary', client.salary)}
                    editingField={editingField}
                    editValue={editValue}
                    setEditValue={setEditValue}
                    onConfirm={handleUpdateField}
                    onCancel={cancelEdit}
                />
              </div>

              {/* Column 6: Retention Status */}
              <div className="counsel_dashboard_card bg-muted/20 p-5 rounded-xl border border-border/50">
                <h3 className="text-sm font-bold flex items-center gap-2 mb-5 text-foreground/80">
                  <Award size={15} className="text-primary" /> 고용 유지 현황
                </h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-2">
                  <DashboardField label="1개월 근속일" field="retention_1m_date" value={client.retention_1m_date} onEdit={startEdit} editingField={editingField} editValue={editValue} setEditValue={setEditValue} onConfirm={handleUpdateField} onCancel={cancelEdit} type="date" />
                  <DashboardField label="1개월 근속여부" field="retention_1m_yn" value={client.retention_1m_yn} onEdit={() => startEdit('retention_1m_yn', client.retention_1m_yn)} editingField={editingField} editValue={editValue} setEditValue={setEditValue} onConfirm={handleUpdateField} onCancel={cancelEdit} type="select" options={[{ value: 'Y', label: '유지' }, { value: 'N', label: '미유지' }]} />

                  <DashboardField label="6개월 근속일" field="retention_6m_date" value={client.retention_6m_date} onEdit={startEdit} editingField={editingField} editValue={editValue} setEditValue={setEditValue} onConfirm={handleUpdateField} onCancel={cancelEdit} type="date" />
                  <DashboardField label="6개월 근속여부" field="retention_6m_yn" value={client.retention_6m_yn} onEdit={() => startEdit('retention_6m_yn', client.retention_6m_yn)} editingField={editingField} editValue={editValue} setEditValue={setEditValue} onConfirm={handleUpdateField} onCancel={cancelEdit} type="select" options={[{ value: 'Y', label: '유지' }, { value: 'N', label: '미유지' }]} />

                  <DashboardField label="12개월 근속일" field="retention_12m_date" value={client.retention_12m_date} onEdit={startEdit} editingField={editingField} editValue={editValue} setEditValue={setEditValue} onConfirm={handleUpdateField} onCancel={cancelEdit} type="date" />
                  <DashboardField label="12개월 근속여부" field="retention_12m_yn" value={client.retention_12m_yn} onEdit={() => startEdit('retention_12m_yn', client.retention_12m_yn)} editingField={editingField} editValue={editValue} setEditValue={setEditValue} onConfirm={handleUpdateField} onCancel={cancelEdit} type="select" options={[{ value: 'Y', label: '유지' }, { value: 'N', label: '미유지' }]} />

                  <DashboardField label="18개월 근속일" field="retention_18m_date" value={client.retention_18m_date} onEdit={startEdit} editingField={editingField} editValue={editValue} setEditValue={setEditValue} onConfirm={handleUpdateField} onCancel={cancelEdit} type="date" />
                  <DashboardField label="18개월 근속여부" field="retention_18m_yn" value={client.retention_18m_yn} onEdit={() => startEdit('retention_18m_yn', client.retention_18m_yn)} editingField={editingField} editValue={editValue} setEditValue={setEditValue} onConfirm={handleUpdateField} onCancel={cancelEdit} type="select" options={[{ value: 'Y', label: '유지' }, { value: 'N', label: '미유지' }]} />
                </div>
                <div className="mt-4 pt-4 border-t border-border/40">
                   {/* Removed score field */}
                </div>
              </div>
            </div>


            <div className="counsel_dashboard_card bg-muted/10 p-6 rounded-xl border border-border/50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold flex items-center gap-2 text-foreground/80">
                  <ClipboardList size={15} className="text-primary" /> 상담 가이드 및 특이사항
                </h3>
                {editingField !== 'counsel_notes' && (
                  <button onClick={() => startEdit('counsel_notes', client.counsel_notes)} className="flex items-center gap-1.5 px-3 py-1 bg-white border border-border rounded-full text-xs hover:bg-muted transition-colors">
                    <Edit3 size={11} /> 편집하기
                  </button>
                )}
              </div>
              {editingField === 'counsel_notes' ? (
                <div className="space-y-3">
                  <textarea
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    rows={8}
                    className="w-full text-sm bg-background border border-primary px-4 py-3 rounded-xl outline-none resize-none shadow-sm"
                    placeholder="상담 시 유의사항이나 상세 메모를 입력하세요..."
                  />
                  <div className="flex justify-end gap-2">
                    <button onClick={cancelEdit} className="px-4 py-1.5 text-xs text-muted-foreground hover:bg-muted rounded-md transition-colors">취소</button>
                    <button onClick={() => handleUpdateField('counsel_notes')} className="px-5 py-1.5 text-xs text-white bg-primary hover:bg-primary/90 rounded-md shadow-sm transition-colors">저장하기</button>
                  </div>
                </div>
              ) : (
                <div className="p-5 bg-white rounded-xl text-sm leading-relaxed border border-border/50 min-h-[120px] whitespace-pre-wrap shadow-[inset_0_1px_3px_rgba(0,0,0,0.02)]">
                  {client.counsel_notes || <span className="text-muted-foreground italic">등록된 특이사항이 없습니다. 상담을 통해 업데이트 해주세요.</span>}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-300">
            {selectedSessionId ? (() => {
              const s = sessions.find(ss => ss.id === selectedSessionId);
              if (!s) return null;
              
              const formatTime = (t?: string | null) => t?.split(':').slice(0, 2).join(':') || '';
              
              return (
                <div className="bg-white p-6 rounded-xl border border-border/50 animate-in fade-in zoom-in-95 duration-200">
                  <div className="flex items-center justify-between mb-8 pb-4 border-b border-border/40">
                    <div className="flex items-center gap-6">
                      <button onClick={clearSelectedSession} className="p-2 hover:bg-muted rounded-full transition-colors group">
                        <ChevronLeft size={18} className="group-hover:-translate-x-0.5 transition-transform" />
                      </button>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-3">
                          <span className="text-xl font-bold bg-primary/5 px-3 py-1 rounded-lg text-primary">{s.type || '일반상담'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground ml-1">
                          <Clock size={13} />
                          <span>{s.date}</span>
                        </div>
                      </div>
                    </div>
                    {!isEditingHistory ? (
                      <button
                        onClick={() => {
                          setHistoryEditDraft({
                            content: s.content,
                            next_action: s.next_action,
                          });
                          setIsEditingHistory(true);
                        }}
                        className="flex items-center gap-1.5 px-4 py-2 bg-primary/10 text-primary rounded-lg text-xs font-bold hover:bg-primary/20 transition-all"
                      >
                        <Edit3 size={14} /> 정보 수정
                      </button>
                    ) : (
                      <div className="flex gap-2">
                         <button onClick={() => setIsEditingHistory(false)} className="px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-muted rounded-lg transition-all">취소</button>
                         <button 
                            onClick={async () => {
                              try {
                                setSaving(true);
                                await updateSession(s.id, historyEditDraft);
                                await loadSessions();
                                setIsEditingHistory(false);
                                toast.success('저장되었습니다.');
                              } catch (e: any) {
                                toast.error('저장 실패: ' + e.message);
                              } finally {
                                setSaving(false);
                              }
                            }}
                            className="px-4 py-2 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary/90 transition-all flex items-center gap-1.5"
                          >
                           {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} 저장하기
                         </button>
                      </div>
                    )}
                  </div>
                  
                  <div className="space-y-8">
                    <div>
                      <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
                        <div className="w-1 h-3 bg-primary rounded-full"></div> 상담 내용
                      </h4>
                      {isEditingHistory ? (
                        <textarea 
                          className="w-full p-4 text-sm bg-background border border-primary/30 rounded-xl outline-none focus:ring-2 focus:ring-primary/10 transition-all min-h-[200px]"
                          value={historyEditDraft.content || ''}
                          onChange={e => setHistoryEditDraft({...historyEditDraft, content: e.target.value})}
                        />
                      ) : (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90 p-5 bg-muted/10 rounded-xl border border-border/30">{s.content || '내용 없음'}</p>
                      )}
                    </div>

                    <div className="pt-6 border-t border-border/40">
                      <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
                        <div className="w-1 h-3 bg-amber-500 rounded-full"></div> 다음 조치사항
                      </h4>
                      {isEditingHistory ? (
                        <textarea
                          className="w-full p-4 text-sm bg-amber-50/10 border border-amber-200/50 rounded-xl outline-none focus:ring-2 focus:ring-amber-200 transition-all min-h-[100px]"
                          placeholder="다음 상담 시 확인할 조치사항을 입력하세요..."
                          value={historyEditDraft.next_action || ''}
                          onChange={e => setHistoryEditDraft({...historyEditDraft, next_action: e.target.value})}
                        />
                      ) : (
                        <p className="text-sm italic leading-relaxed whitespace-pre-wrap text-muted-foreground/80 p-5 bg-amber-50/5 rounded-xl border border-dashed border-amber-200/40">{s.next_action || '등록된 조치사항이 없습니다.'}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })() : (
              <>
                {sessionsLoading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin text-primary" /></div> :
                  sessions.length === 0 ? <p className="text-center py-24 text-muted-foreground text-sm italic">기록된 상담 이력이 없습니다.</p> :
                    sessions.map((s) => (
                      <div key={s.id} onClick={() => setSelectedSessionId(s.id)} className="p-5 bg-muted/10 rounded-xl border border-border/40 group relative hover:border-primary/40 hover:bg-muted/20 transition-all cursor-pointer">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center">
                              <span className="bg-primary/10 text-primary px-2.5 py-1 rounded text-[10px] font-bold">{s.type || '일반상담'}</span>
                            </div>
                            <span className="text-[10px] text-muted-foreground/60 ml-2 font-medium">{s.date}</span>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }} className="p-2 hover:bg-destructive/10 hover:text-destructive rounded-full transition-colors"><Trash2 size={15} /></button>
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90 line-clamp-2">{s.content}</p>
                      </div>
                    ))}
              </>
            )}
          </div>
        )}

        {activeTab === 'input' && (
          <div className="bg-muted/10 p-6 rounded-xl border border-border/50 animate-in fade-in slide-in-from-right-2 duration-300 max-w-4xl mx-auto">
            <h3 className="text-sm font-bold mb-6 flex items-center gap-2"><Plus size={16} className="text-primary" /> 새로운 상담 기록</h3>
            
            <div className="space-y-6">
              {/* Row 1: Type & Date */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground mb-1.5 block uppercase tracking-wider">상담 유형</label>
                  <select value={newSession.type} onChange={(e) => setNewSession({ ...newSession, type: e.target.value })} className="w-full h-10 px-3 bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/20 transition-all text-sm">
                    {['초기상담', '심층상담', '취업지원', '취업완료', '사후관리', '기타'].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground mb-1.5 block uppercase tracking-wider">상담 일자</label>
                  <input type="date" value={newSession.date} onChange={(e) => setNewSession({ ...newSession, date: e.target.value })} className="w-full h-10 px-3 bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/20 transition-all text-sm" />
                </div>
              </div>

              {/* Row 2: Content */}
              <div>
                <label className="text-[11px] font-bold text-muted-foreground mb-1.5 block uppercase tracking-wider">상담 내용</label>
                <textarea value={newSession.content} onChange={(e) => setNewSession({ ...newSession, content: e.target.value })} rows={6} className="w-full p-4 bg-background border border-border rounded-xl outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none text-sm" placeholder="상담 내용을 입력하세요..." />
              </div>

              {/* Row 3: Next Action */}
              <div>
                <label className="text-[11px] font-bold text-muted-foreground mb-1.5 block uppercase tracking-wider">다음 조치사항</label>
                <textarea value={newSession.next_action} onChange={(e) => setNewSession({ ...newSession, next_action: e.target.value })} rows={3} className="w-full p-4 bg-background border border-border rounded-xl outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none text-sm" placeholder="다음 상담 시 확인할 조치사항을 입력하세요..." />
              </div>
            </div>

            <div className="flex justify-end pt-8 mt-6 border-t border-border/40">
              <button onClick={handleCreateSession} disabled={saving} className="bg-primary text-white px-10 py-3 rounded-lg flex items-center gap-2 font-bold hover:bg-primary/90 transition-all shadow-md shadow-primary/20">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                상담 기록 저장
              </button>
            </div>
          </div>
        )}

        {activeTab === 'survey' && <SurveyTab clientId={id!} />}
        {activeTab === 'summary' && <ClientSummaryAnalysisTab client={client!} />}
        {activeTab === 'chat' && <CounselChatTab client={client!} />}
      </div>
    </div>
  );
}

interface DashboardFieldProps {
  label: string;
  icon?: React.ReactNode;
  field: string;
  value: any;
  onEdit: (field: string, val: any) => void;
  editingField: string | null;
  editValue: string;
  setEditValue: (v: string) => void;
  onConfirm: (field: string) => void;
  onCancel: () => void;
  subValue?: string | null;
  subField?: string;
  isBadge?: boolean;
  stageColors?: Record<string, string>;
  highlight?: boolean;
  type?: 'text' | 'select' | 'address' | 'date';
  options?: { value: string, label: string }[];
  readonly?: boolean;
}

function DashboardField({ 
    label, icon, field, value, onEdit, editingField, 
    editValue, setEditValue, onConfirm, onCancel, 
    subValue, subField, isBadge, stageColors, highlight,
    type = 'text', options = [], readonly = false
}: DashboardFieldProps) {
  const isEditing = editingField === field;
  const [showPostcode, setShowPostcode] = useState(false);
  const [innerSubValue, setInnerSubValue] = useState(subValue || '');

  // Reset internal sub value when editing starts
  useEffect(() => {
    if (isEditing) setInnerSubValue(subValue || '');
  }, [isEditing, subValue]);

  const handlePostcode = (data: any) => {
    let fullAddress = data.address;
    let extraAddress = '';
    if (data.addressType === 'R') {
      if (data.bname !== '') extraAddress += data.bname;
      if (data.buildingName !== '') extraAddress += (extraAddress !== '' ? `, ${data.buildingName}` : data.buildingName);
      fullAddress += (extraAddress !== '' ? ` (${extraAddress})` : '');
    }
    setEditValue(fullAddress);
    setShowPostcode(false);
  };

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (type === 'address' && subField) {
      (onConfirm as any)(field, editValue, subField, innerSubValue);
    } else {
      onConfirm(field);
    }
  };

  return (
    <div className="group py-3 border-b border-border/30 last:border-0 hover:bg-white/50 transition-all px-2 rounded-lg relative">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[10px] font-bold text-muted-foreground/60 flex items-center gap-1.5 uppercase tracking-tight">
          {icon} {label}
        </label>
        {!isEditing && !readonly && <button onClick={() => onEdit(field, value)} className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-primary transition-all"><Edit3 size={11} /></button>}
      </div>
      {isEditing ? (
        <div className="flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-200 relative z-[20]">
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            {type === 'select' ? (
              <select
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full text-xs bg-white border border-primary px-2 py-1.5 rounded-md outline-none shadow-sm shadow-primary/5 focus:ring-2 focus:ring-primary/10 h-8"
              >
                <option value="">선택하세요</option>
                {options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : type === 'address' ? (
              <div className="w-full flex flex-col gap-1.5">
                <div className="flex gap-1 items-center">
                  <input 
                    onClick={() => setShowPostcode(true)}
                    readOnly
                    value={editValue} 
                    className="flex-1 min-w-0 text-xs bg-muted/30 border border-primary px-2 py-1.5 rounded-md outline-none cursor-pointer" 
                    placeholder="주소 검색..."
                  />
                  <button 
                    onClick={() => setShowPostcode(true)}
                    className="shrink-0 px-2 py-1.5 bg-primary/10 text-primary text-[10px] font-bold rounded-md hover:bg-primary/20 transition-colors"
                  >
                    검색
                  </button>
                </div>
                <input
                  value={innerSubValue}
                  onChange={(e) => setInnerSubValue(e.target.value)}
                  className="w-full text-xs bg-white border border-primary px-2 py-1.5 rounded-md outline-none"
                  placeholder="상세 주소를 입력하세요"
                  onKeyDown={(e) => e.key === 'Enter' && handleSave(e as any)}
                />

                {showPostcode && (
                  <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                    <div className="bg-white w-full max-w-lg rounded-xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
                      <div className="flex items-center justify-between p-4 border-b bg-muted/20">
                        <h3 className="text-sm font-bold">주소 검색</h3>
                        <button onClick={() => setShowPostcode(false)} className="p-1 hover:bg-muted rounded-full transition-colors">
                          <X size={16} />
                        </button>
                      </div>
                      <DaumPostcode onComplete={handlePostcode} style={{ height: '450px' }} />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 relative">
                <input 
                  type="text"
                  autoFocus 
                  value={editValue} 
                  onChange={(e) => {
                    let val = e.target.value;
                    const isDateField = field === 'birth_date' || field === 'iap_to' || field === 'rediagnosis_date' || field === 'initial_counsel_date' || field.includes('date');
                    if (field === 'phone') {
                      const digits = val.replace(/[^0-9]/g, '');
                      if (digits.length <= 3) val = digits;
                      else if (digits.length <= 7) val = digits.replace(/(\d{3})(\d{1,4})/, '$1-$2');
                      else val = digits.replace(/(\d{3})(\d{3,4})(\d{4})/, '$1-$2-$3');
                    } else if (isDateField) {
                      const digits = val.replace(/[^0-9]/g, '');
                      if (digits.length <= 4) val = digits;
                      else if (digits.length <= 6) val = digits.replace(/(\d{4})(\d{1,2})/, '$1-$2');
                      else val = digits.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
                    }
                    setEditValue(val);
                  }} 
                  className={`w-full text-xs bg-white border border-primary ${type==='date'?'pr-8':''} px-2 py-1.5 rounded-md outline-none shadow-sm shadow-primary/5 focus:ring-2 focus:ring-primary/10`} 
                  onKeyDown={(e) => e.key === 'Enter' && handleSave(e as any)} 
                />
                {type === 'date' && (
                   <>
                     <input 
                       type="date" 
                       className="absolute inset-0 opacity-0 pointer-events-none" 
                       value={editValue && /^\d{4}-\d{2}-\d{2}$/.test(editValue) ? editValue : ''}
                       onChange={(e) => setEditValue(e.target.value)}
                       id={`date-picker-${field}`}
                     />
                     <button 
                       type="button"
                       onClick={() => (document.getElementById(`date-picker-${field}`) as any)?.showPicker()}
                       className="absolute right-2 top-1/2 -translate-y-1/2 text-primary hover:bg-primary/10 p-1 rounded-md transition-colors"
                     >
                       <Calendar size={13} />
                     </button>
                   </>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-0.5 shrink-0 ml-1">
            <button 
              onClick={handleSave} 
              className="text-primary hover:bg-primary/10 p-1.5 rounded-full transition-colors flex items-center justify-center"
            >
              <Check size={16} strokeWidth={3} />
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); onCancel(); }} 
              className="text-muted-foreground hover:bg-muted p-1.5 rounded-full transition-colors flex items-center justify-center"
            >
              <X size={16} strokeWidth={3} />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          <div className={`text-sm font-bold truncate ${highlight ? 'text-primary' : 'text-foreground/90'}`}>
            {isBadge ? (
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${stageColors?.[value || ''] || 'badge-active'}`}>
                {value || '미정'}
              </span>
            ) : type === 'select' ? (
                options.find(opt => opt.value === String(value))?.label || (value === 0 ? '0' : null) || value || 
                <span className="text-muted-foreground/30 font-normal italic">미입력</span>
            ) : (
                value || <span className="text-muted-foreground/30 font-normal italic">미입력</span>
            )}
          </div>
          {subValue && (
            <div className="text-sm font-bold text-foreground/90 mt-0.5 flex items-center gap-2">
              <span className="truncate">{subValue}</span>
              {subField && <button onClick={() => onEdit(subField, subValue)} className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-primary transition-all"><Edit3 size={11} /></button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CertificationList({ 
  value, 
  onAdd, 
  onDelete 
}: { 
  value: { certificate_name: string; acquisition_date: string | null }[] | undefined; 
  onAdd: (name: string, date: string | null) => void;
  onDelete: (name: string) => void;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [newCert, setNewCert] = useState('');
  const [newDate, setNewDate] = useState('');
  const certs = value || [];

  const handleAdd = () => {
    if (newCert.trim()) {
      onAdd(newCert.trim(), newDate || null);
      setNewCert('');
      setNewDate('');
      setIsAdding(false);
    }
  };

  return (
    <div className="py-3 border-b border-border/30 last:border-0 hover:bg-white/50 transition-all px-2 rounded-lg relative">
      <div className="flex items-center justify-between mb-2">
        <label className="text-[10px] font-bold text-muted-foreground/60 flex items-center gap-1.5 uppercase tracking-tight">
          <Award size={13} /> 자격증 목록
        </label>
        <button 
          onClick={() => setIsAdding(!isAdding)} 
          className="p-1 bg-primary/10 text-primary rounded-full hover:bg-primary/20 transition-all"
        >
          {isAdding ? <X size={12} /> : <Plus size={12} />}
        </button>
      </div>

      {isAdding && (
        <div className="flex flex-col gap-2 mb-3 animate-in slide-in-from-top-1 duration-200 bg-muted/20 p-2 rounded-md">
           <div className="flex gap-1.5">
             <input 
               autoFocus
               value={newCert}
               onChange={(e) => setNewCert(e.target.value)}
               placeholder="자격증 명칭..."
               className="flex-1 text-xs bg-white border border-primary px-2 py-1.5 rounded-md outline-none"
             />
             <input 
               type="date"
               value={newDate}
               onChange={(e) => setNewDate(e.target.value)}
               className="w-[120px] text-xs bg-white border border-primary px-2 py-1.5 rounded-md outline-none"
             />
             <button onClick={handleAdd} className="p-1.5 bg-primary text-white rounded-md shadow-sm">
               <Check size={14} />
             </button>
           </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {certs.length === 0 ? (
          <span className="text-xs text-muted-foreground/30 italic">추가된 자격증이 없습니다.</span>
        ) : (
          certs.map((cert, idx) => (
            <div key={idx} className="flex items-center gap-1.5 bg-primary/5 border border-primary/20 px-2 py-1 rounded-md text-xs font-bold text-primary animate-in fade-in zoom-in-95 duration-200">
              <span className="flex flex-col">
                <span>{cert.certificate_name}</span>
                {cert.acquisition_date && <span className="text-[9px] font-normal opacity-70">{cert.acquisition_date}</span>}
              </span>
              <button 
                onClick={() => onDelete(cert.certificate_name)}
                className="text-primary/40 hover:text-destructive transition-colors ml-1"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

