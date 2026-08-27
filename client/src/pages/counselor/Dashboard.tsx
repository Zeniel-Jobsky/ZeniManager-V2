/**
 * Counselor Dashboard
 * Design: 모던 웰니스 미니멀리즘
 * Features: 현황, 프로세스, 캘린더, 메모장
 * Data: Dashboard surfaces use live Supabase APIs. Mock fallbacks are out of scope here.
 */
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { usePageGuard } from '@/hooks/usePageGuard';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchDashboardStats,
  fetchDashboardMonthlyStats,
  fetchMyMemo,
  searchDashboardClients,
  updateMyMemo,
  type DashboardStats,
  type DashboardMonthlyStat,
} from '@/lib/api.dashboard';
import {
  fetchAppointments,
  fetchAppointmentMonthCounts,
  createAppointment,
  updateAppointment,
  updateAppointmentStatus,
  completeAppointmentWithSession,
  deleteAppointment,
} from '@/lib/api.appointments';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { ClientRow, AppointmentRow } from '@/lib/supabase';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Area, AreaChart,
} from 'recharts';
import {
  Users, TrendingUp, CheckCircle2, Search, X, ChevronLeft, ChevronRight,
  AlertCircle, Calendar as CalendarIcon, StickyNote, Loader2, RefreshCw, BarChart3,
  Plus, Trash2, CalendarClock,
} from 'lucide-react';
import { toast } from 'sonner';

const PRIMARY_HEX = '#009C64';
const SCORE_RANGE_FALLBACK = [
  { range: '0-59', count: 0 },
  { range: '60-69', count: 0 },
  { range: '70-79', count: 0 },
  { range: '80-89', count: 0 },
  { range: '90-100', count: 0 },
];
const PROCESS_STAGE_ORDER = [
  '초기상담',
  '심층상담',
  '취업지원',
  '직업훈련',
  '취업알선',
  '취업완료',
  '사후관리',
] as const;

type ProcessStage = {
  stage: string;
  count: number;
};

type CalendarRangeMode = 'today' | 'week' | 'selected-period';
type DashboardTab = 'overview' | 'calendar' | 'memo';

type CalendarDayCell = {
  key: string;
  date: Date;
  isCurrentMonth: boolean;
};

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildCalendarCells(month: Date): CalendarDayCell[] {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const gridStart = addDays(monthStart, -monthStart.getDay());
  const gridEnd = addDays(monthEnd, 6 - monthEnd.getDay());
  const cells: CalendarDayCell[] = [];

  for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor = addDays(cursor, 1)) {
    cells.push({
      key: toDateKey(cursor),
      date: new Date(cursor),
      isCurrentMonth: cursor.getMonth() === month.getMonth() && cursor.getFullYear() === month.getFullYear(),
    });
  }

  return cells;
}

function formatPanelDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${year}.${month}.${day}`;
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function normalizeDateRange(start: string, end: string) {
  return start <= end ? { start, end } : { start: end, end: start };
}

function getDayStatus(dateKey: string, todayKey: string): 'past' | 'today' | 'upcoming' {
  if (dateKey < todayKey) return 'past';
  if (dateKey > todayKey) return 'upcoming';
  return 'today';
}

function buildRange(
  mode: CalendarRangeMode,
  selectedDate: string,
  todayKey: string,
  selectedPeriod: { start: string; end: string },
) {
  if (mode === 'today') {
    return { start: todayKey, end: todayKey, anchor: todayKey };
  }

  if (mode === 'selected-period') {
    const fallback = selectedDate || todayKey;
    const normalized = normalizeDateRange(
      selectedPeriod.start || fallback,
      selectedPeriod.end || fallback,
    );
    return { start: normalized.start, end: normalized.end, anchor: normalized.end };
  }

  // 'week': 항상 "오늘" 기준 앞으로 7일(오늘 포함) — 이 패널이 이제 예약(상담 일정, 미래 항목)만
  // 보여주므로 과거 방향이 아니라 앞으로의 7일이 되어야 의미가 있다. 캘린더에서 다른 날짜를
  // 선택해둔 상태여도 이 버튼은 그 선택과 무관하게 항상 오늘부터 계산한다.
  const todayDate = parseDateKey(todayKey);
  const end = toDateKey(addDays(todayDate, 6));
  return { start: todayKey, end, anchor: todayKey };
}

function formatTimeRange(startTime: string | null, endTime: string | null) {
  if (startTime && endTime) return `${startTime.slice(0, 5)} ~ ${endTime.slice(0, 5)}`;
  if (startTime) return startTime.slice(0, 5);
  return '시간 미정';
}

function getDashboardTabFromPath(path: string): DashboardTab {
  if (path.startsWith('/dashboard/calendar')) return 'calendar';
  if (path.startsWith('/dashboard/memo')) return 'memo';
  return 'overview';
}

function getDashboardSectionFromPath(path: string): 'search' | 'process' | null {
  if (path.startsWith('/dashboard/search')) return 'search';
  if (path.startsWith('/dashboard/process')) return 'process';
  return null;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function CountWithUnit({ count, unit = '명' }: { count: number; unit?: string }) {
  return <>{count}<span className="text-base font-medium text-muted-foreground ml-0.5">{unit}</span></>;
}

function StatCard({ icon, label, value, sub, color, onClick, actionLabel }: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: string;
  color?: string;
  onClick?: () => void;
  actionLabel?: string;
}) {
  const isInteractive = typeof onClick === 'function';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isInteractive}
      className={`stat-card flex w-full items-start gap-4 text-left ${
        isInteractive
          ? 'transition-transform duration-200 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring'
          : ''
      }`}
    >
      <div className="w-10 h-10 rounded-sm flex items-center justify-center flex-shrink-0" style={{ background: color || 'oklch(0.92 0.05 162.5)' }}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold text-foreground mt-0.5">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
        {isInteractive && (
          <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: PRIMARY_HEX }}>
            {actionLabel || '화면 열기'}
            <ChevronRight size={12} />
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Live Calendar ────────────────────────────────────────────────────────────

function LiveCalendar({
  month,
  selectedDate,
  counts,
  onMonthChange,
  onSelectDate,
}: {
  month: Date;
  selectedDate: string;
  counts: Record<string, number>;
  onMonthChange: (nextMonth: Date) => void;
  onSelectDate: (dateKey: string, date: Date) => void;
}) {
  const todayKey = toDateKey(new Date());
  const cells = buildCalendarCells(month);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          className="rounded-sm p-1 hover:bg-muted"
          aria-label="이전 달"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold">
          {month.getFullYear()}년 {month.getMonth() + 1}월
        </span>
        <button
          type="button"
          onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          className="rounded-sm p-1 hover:bg-muted"
          aria-label="다음 달"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center xl:gap-1.5 2xl:gap-2">
        {['일', '월', '화', '수', '목', '금', '토'].map(label => (
          <div key={label} className="py-1 text-xs font-medium text-muted-foreground xl:py-1.5 xl:text-sm 2xl:py-2 2xl:text-base">
            {label}
          </div>
        ))}

        {cells.map(cell => {
          const count = counts[cell.key] ?? 0;
          const status = getDayStatus(cell.key, todayKey);
          const isSelected = cell.key === selectedDate;
          const isToday = status === 'today';

          return (
            <button
              key={cell.key}
              type="button"
              onClick={() => onSelectDate(cell.key, cell.date)}
              className={`relative min-h-[52px] overflow-hidden rounded-sm border p-1.5 text-left transition-colors xl:min-h-[78px] xl:p-2.5 2xl:min-h-[117px] 2xl:rounded-md 2xl:p-3.5 ${
                cell.isCurrentMonth ? 'bg-background hover:bg-muted/40' : 'bg-muted/20 hover:bg-muted/40'
              }`}
              style={{
                borderColor: isSelected ? PRIMARY_HEX : undefined,
                boxShadow: isSelected ? `0 0 0 1px ${PRIMARY_HEX}` : undefined,
              }}
              aria-pressed={isSelected}
            >
              <div className="flex items-start justify-between gap-1">
                <span
                  className={`text-xs font-medium xl:text-sm 2xl:text-lg ${
                    !cell.isCurrentMonth
                      ? 'text-muted-foreground/60'
                      : isToday
                        ? 'font-semibold'
                        : status === 'past'
                          ? 'text-muted-foreground'
                          : 'text-foreground'
                  }`}
                  style={isToday ? { color: PRIMARY_HEX } : undefined}
                >
                  {cell.date.getDate()}
                </span>

                {count > 0 && cell.isCurrentMonth && (
                  <span
                    className="inline-flex min-h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 py-0.5 text-[10px] font-semibold xl:min-h-[20px] xl:min-w-[20px] xl:px-1.5 xl:py-0.5 xl:text-[11px] 2xl:min-h-[24px] 2xl:min-w-[24px] 2xl:px-2 2xl:py-1 2xl:text-sm"
                    style={{
                      color: PRIMARY_HEX,
                      background: 'rgba(0, 156, 100, 0.10)',
                    }}
                  >
                    {count > 9 ? '9+' : count}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Personal Memo ────────────────────────────────────────────────────────────

function PersonalMemoPanel({
  counselorName,
  memo,
  loading,
  saving,
  dirty,
  error,
  onChange,
  onRefresh,
  onReset,
  onSave,
}: {
  counselorName?: string;
  memo: string;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onRefresh: () => void;
  onReset: () => void;
  onSave: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">상담사 개인 메모</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {`${counselorName || '접속한 사용자'}님의 현재 DB 메모입니다.`}
          </p>
        </div>

        <button onClick={onRefresh} className="p-2 rounded-sm border hover:bg-muted" title="메모 새로고침" disabled={loading || saving}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="rounded-sm border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-3 w-40 rounded bg-muted" />
          <div className="h-48 rounded-md bg-muted" />
          <div className="h-9 w-52 rounded bg-muted" />
        </div>
      ) : (
        <>
          <textarea
            value={memo}
            onChange={e => onChange(e.target.value)}
            placeholder="상담 메모, 전달사항, 다음 확인 포인트를 여기에 적어두세요."
            rows={10}
            className="w-full rounded-md border border-input bg-background px-3 py-3 text-sm leading-6 outline-none transition focus:ring-2 focus:ring-ring resize-y"
            disabled={saving}
          />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">
              {dirty ? '저장되지 않은 변경사항이 있습니다.' : '현재 화면과 저장된 메모가 동기화되어 있습니다.'}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onReset}
                disabled={!dirty || saving}
                className="btn-cancel px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                되돌리기
              </button>
              <button
                onClick={onSave}
                disabled={saving || !dirty}
                className="btn-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function CounselorDashboard() {
  const { canRender, user } = usePageGuard('counselor');
  const [location, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<DashboardTab>(() => getDashboardTabFromPath(location));
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<DashboardMonthlyStat[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<ClientRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [calendarMode, setCalendarMode] = useState<CalendarRangeMode>('today');
  const [selectedPeriod, setSelectedPeriod] = useState(() => {
    const today = toDateKey(new Date());
    return { start: today, end: today };
  });
  const [selectedPeriodPreset, setSelectedPeriodPreset] = useState('custom');
  const [showPeriodSelector, setShowPeriodSelector] = useState(false);
  const [monthCounts, setMonthCounts] = useState<Record<string, number>>({});
  const [monthLoading, setMonthLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [appointmentError, setAppointmentError] = useState<string | null>(null);
  const [showAppointmentForm, setShowAppointmentForm] = useState(false);
  const [appointmentSaving, setAppointmentSaving] = useState(false);
  const [editingAppointmentId, setEditingAppointmentId] = useState<string | null>(null);
  const [appointmentForm, setAppointmentForm] = useState({
    date: toDateKey(new Date()),
    startTime: '09:00',
    endTime: '10:00',
    memo: '',
  });
  const [appointmentClientQuery, setAppointmentClientQuery] = useState('');
  const [appointmentClientResults, setAppointmentClientResults] = useState<ClientRow[]>([]);
  const [appointmentClient, setAppointmentClient] = useState<{ id: string; name: string } | null>(null);
  const [completingAppointment, setCompletingAppointment] = useState<AppointmentRow | null>(null);
  const [completeSessionForm, setCompleteSessionForm] = useState({ type: '초기상담', content: '', next_action: '' });
  const [completingSaving, setCompletingSaving] = useState(false);
  const [memoValue, setMemoValue] = useState('');
  const [savedMemoValue, setSavedMemoValue] = useState('');
  const [memoLoading, setMemoLoading] = useState(false);
  const [memoSaving, setMemoSaving] = useState(false);
  const [memoError, setMemoError] = useState<string | null>(null);
  const [memoLoaded, setMemoLoaded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const processSectionRef = useRef<HTMLDivElement | null>(null);

  const dashboardCounselorId = user?.counselorId;
  const calendarCounselorId = user?.counselorId;
  const memoAuthUserId = user?.id;
  const todayKey = toDateKey(new Date());
  const currentRange = buildRange(calendarMode, selectedDate, todayKey, selectedPeriod);
  const isMemoDirty = memoValue !== savedMemoValue;

  const loadStats = useCallback(async () => {
    if (!dashboardCounselorId) {
      setStats(null);
      setMonthlyStats([]);
      setStatsError('대시보드 데이터를 불러오려면 연결된 상담사 정보가 필요합니다.');
      setStatsLoading(false);
      return;
    }

    setStatsLoading(true);
    try {
      const [nextStats, nextMonthlyStats] = await Promise.all([
        fetchDashboardStats(dashboardCounselorId),
        fetchDashboardMonthlyStats(dashboardCounselorId),
      ]);
      setStats(nextStats);
      setMonthlyStats(nextMonthlyStats);
      setStatsError(null);
    } catch (e: any) {
      const message = e.message || '대시보드 데이터를 불러오지 못했습니다.';
      setStatsError(message);
      setStats(null);
      setMonthlyStats([]);
      toast.error('통계 로드 실패: ' + message);
    } finally {
      setStatsLoading(false);
    }
  }, [dashboardCounselorId]);

  useEffect(() => { loadStats(); }, [loadStats]);

  useEffect(() => {
    const nextTab = getDashboardTabFromPath(location);
    setActiveTab(prev => (prev === nextTab ? prev : nextTab));
  }, [location]);

  useEffect(() => {
    if (activeTab !== 'overview') return;

    const section = getDashboardSectionFromPath(location);
    if (!section) return;

    const frameId = window.requestAnimationFrame(() => {
      if (section === 'search') {
        searchInputRef.current?.focus();
        searchInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      processSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeTab, location]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }
    const timer = setTimeout(async () => {
      if (!dashboardCounselorId) {
        setSearchResults([]);
        setSearchError('검색을 수행하려면 연결된 상담사 정보가 필요합니다.');
        setSearching(false);
        return;
      }

      setSearching(true);
      try {
        const results = await searchDashboardClients(dashboardCounselorId, searchQuery);
        setSearchResults(results);
        setSearchError(null);
      } catch (e: any) {
        setSearchResults([]);
        setSearchError(e.message || '검색 결과를 불러오지 못했습니다.');
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [dashboardCounselorId, searchQuery]);

  const loadCalendarMonth = useCallback(async () => {
    if (!calendarCounselorId) {
      setMonthCounts({});
      setCalendarError('캘린더 기능을 호출하려면 연결된 상담사 정보가 필요합니다.');
      return;
    }

    setMonthLoading(true);
    try {
      const monthStart = toDateKey(startOfMonth(calendarMonth));
      const monthEnd = toDateKey(endOfMonth(calendarMonth));
      const counts = await fetchAppointmentMonthCounts(calendarCounselorId, monthStart, monthEnd);
      setMonthCounts(counts);
      setCalendarError(null);
    } catch (e: any) {
      setCalendarError(e.message || '캘린더 데이터를 불러오지 못했습니다.');
    } finally {
      setMonthLoading(false);
    }
  }, [calendarCounselorId, calendarMonth]);

  const loadAppointments = useCallback(async () => {
    if (!calendarCounselorId) {
      setAppointments([]);
      setAppointmentError('예약 기능을 호출하려면 연결된 상담사 정보가 필요합니다.');
      return;
    }

    setAppointmentsLoading(true);
    try {
      const rows = await fetchAppointments(calendarCounselorId, currentRange.start, currentRange.end);
      setAppointments(rows);
      setAppointmentError(null);
    } catch (e: any) {
      setAppointmentError(e.message || '예약 목록을 불러오지 못했습니다.');
    } finally {
      setAppointmentsLoading(false);
    }
  }, [calendarCounselorId, currentRange.end, currentRange.start]);

  useEffect(() => {
    if (activeTab !== 'calendar') return;
    loadCalendarMonth();
  }, [activeTab, loadCalendarMonth]);

  useEffect(() => {
    if (activeTab !== 'calendar') return;
    loadAppointments();
  }, [activeTab, loadAppointments]);

  useEffect(() => {
    if (activeTab !== 'calendar') return;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadCalendarMonth();
      loadAppointments();
    }, 30 * 60 * 1000);

    return () => window.clearInterval(intervalId);
  }, [activeTab, loadAppointments, loadCalendarMonth]);

  const refreshCalendar = useCallback(() => {
    loadCalendarMonth();
    loadAppointments();
  }, [loadAppointments, loadCalendarMonth]);

  const loadMyMemo = useCallback(async () => {
    if (!memoAuthUserId) {
      setMemoValue('');
      setSavedMemoValue('');
      setMemoError('개인 메모 기능을 호출하려면 로그인한 상담사 user_id가 필요합니다.');
      setMemoLoaded(false);
      return;
    }

    setMemoLoading(true);
    try {
      const nextMemo = await fetchMyMemo(memoAuthUserId);
      const safeMemo = nextMemo ?? '';
      setMemoValue(safeMemo);
      setSavedMemoValue(safeMemo);
      setMemoError(null);
      setMemoLoaded(true);
    } catch (e: any) {
      setMemoError(e.message || '메모를 불러오지 못했습니다.');
    } finally {
      setMemoLoading(false);
    }
  }, [memoAuthUserId]);

  const handleSaveMemo = useCallback(async () => {
    if (!memoAuthUserId) {
      toast.error('로그인한 상담사 정보를 찾을 수 없습니다.');
      return;
    }

    setMemoSaving(true);
    try {
      const nextMemo = await updateMyMemo(memoAuthUserId, memoValue);
      const safeMemo = nextMemo ?? '';
      setMemoValue(safeMemo);
      setSavedMemoValue(safeMemo);
      setMemoError(null);
      setMemoLoaded(true);
      toast.success('개인 메모가 저장되었습니다.');
    } catch (e: any) {
      const message = e.message || '메모 저장에 실패했습니다.';
      setMemoError(message);
      toast.error(message);
    } finally {
      setMemoSaving(false);
    }
  }, [memoAuthUserId, memoValue]);

  useEffect(() => {
    setMemoValue('');
    setSavedMemoValue('');
    setMemoError(null);
    setMemoLoaded(false);
  }, [memoAuthUserId]);

  const handleDateSelect = useCallback((dateKey: string, date: Date) => {
    setSelectedDate(dateKey);
    setSelectedPeriod({ start: dateKey, end: dateKey });
    setSelectedPeriodPreset('custom');
    setShowPeriodSelector(true);
    setCalendarMode('selected-period');
    if (date.getMonth() !== calendarMonth.getMonth() || date.getFullYear() !== calendarMonth.getFullYear()) {
      setCalendarMonth(startOfMonth(date));
    }
  }, [calendarMonth]);

  const handleSelectedPeriodPresetChange = useCallback((value: string) => {
    setSelectedPeriodPreset(value);

    if (value === 'custom') {
      setShowPeriodSelector(true);
      return;
    }

    const days = Number(value);
    if (Number.isNaN(days) || days < 1) return;

    const anchor = selectedDate || todayKey;
    const range = normalizeDateRange(
      toDateKey(addDays(parseDateKey(anchor), -(days - 1))),
      anchor,
    );

    setSelectedPeriod(range);
    setSelectedDate(range.end);
    setCalendarMode('selected-period');
    setShowPeriodSelector(true);
  }, [selectedDate, todayKey]);

  const handleSelectedPeriodChange = useCallback((field: 'start' | 'end', value: string) => {
    const fallback = selectedDate || todayKey;
    const nextRange = normalizeDateRange(
      field === 'start' ? (value || fallback) : (selectedPeriod.start || fallback),
      field === 'end' ? (value || fallback) : (selectedPeriod.end || fallback),
    );

    setSelectedPeriodPreset('custom');
    setSelectedPeriod(nextRange);
    setSelectedDate(nextRange.end);
    setCalendarMode('selected-period');
  }, [selectedDate, selectedPeriod.end, selectedPeriod.start, todayKey]);

  useEffect(() => {
    if (!appointmentClientQuery.trim() || !calendarCounselorId) {
      setAppointmentClientResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const results = await searchDashboardClients(calendarCounselorId, appointmentClientQuery);
        setAppointmentClientResults(results);
      } catch {
        setAppointmentClientResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [appointmentClientQuery, calendarCounselorId]);

  const openAppointmentForm = useCallback(() => {
    setEditingAppointmentId(null);
    setAppointmentForm({
      date: selectedDate || todayKey,
      startTime: '09:00',
      endTime: '10:00',
      memo: '',
    });
    setAppointmentClient(null);
    setAppointmentClientQuery('');
    setAppointmentClientResults([]);
    setShowAppointmentForm(true);
  }, [selectedDate, todayKey]);

  const openRescheduleForm = useCallback((appointment: AppointmentRow) => {
    setEditingAppointmentId(appointment.id);
    setAppointmentForm({
      date: appointment.date,
      startTime: appointment.start_time.slice(0, 5),
      endTime: appointment.end_time.slice(0, 5),
      memo: appointment.memo ?? '',
    });
    setAppointmentClient(
      appointment.client_id ? { id: appointment.client_id, name: appointment.client_name || '' } : null,
    );
    setAppointmentClientQuery('');
    setAppointmentClientResults([]);
    setShowAppointmentForm(true);
  }, []);

  const handleSubmitAppointment = useCallback(async () => {
    if (!calendarCounselorId) {
      toast.error('로그인한 상담사 정보를 찾을 수 없습니다.');
      return;
    }

    setAppointmentSaving(true);
    try {
      if (editingAppointmentId) {
        await updateAppointment(editingAppointmentId, calendarCounselorId, {
          client_id: appointmentClient?.id ?? null,
          date: appointmentForm.date,
          start_time: appointmentForm.startTime,
          end_time: appointmentForm.endTime,
          memo: appointmentForm.memo,
        });
        toast.success('예약 일정이 변경되었습니다.');
      } else {
        await createAppointment({
          counselor_id: calendarCounselorId,
          client_id: appointmentClient?.id ?? null,
          date: appointmentForm.date,
          start_time: appointmentForm.startTime,
          end_time: appointmentForm.endTime,
          memo: appointmentForm.memo,
        });
        toast.success('예약이 등록되었습니다.');
      }
      setShowAppointmentForm(false);
      setEditingAppointmentId(null);
      await Promise.all([loadAppointments(), loadCalendarMonth()]);
    } catch (e: any) {
      toast.error(e.message || (editingAppointmentId ? '일정 변경에 실패했습니다.' : '예약 등록에 실패했습니다.'));
    } finally {
      setAppointmentSaving(false);
    }
  }, [appointmentClient, appointmentForm, calendarCounselorId, editingAppointmentId, loadAppointments, loadCalendarMonth]);

  const handleCancelAppointment = useCallback(async (id: string) => {
    try {
      await updateAppointmentStatus(id, '취소');
      toast.success('상담 예약을 취소했습니다.');
      await Promise.all([loadAppointments(), loadCalendarMonth()]);
    } catch (e: any) {
      toast.error(e.message || '예약 취소에 실패했습니다.');
    }
  }, [loadAppointments, loadCalendarMonth]);

  const openCompleteForm = useCallback((appointment: AppointmentRow) => {
    if (!appointment.client_id) {
      toast.error('이 예약에는 연결된 고객이 없어 완료 처리할 수 없습니다. 먼저 "일정변경"으로 대상 고객을 지정하세요.');
      return;
    }
    setShowAppointmentForm(false);
    setCompletingAppointment(appointment);
    setCompleteSessionForm({ type: '초기상담', content: '', next_action: '' });
  }, []);

  const handleCompleteAppointment = useCallback(async () => {
    if (!completingAppointment || !calendarCounselorId) return;

    setCompletingSaving(true);
    try {
      await completeAppointmentWithSession(completingAppointment, calendarCounselorId, {
        type: completeSessionForm.type,
        content: completeSessionForm.content,
        next_action: completeSessionForm.next_action || null,
      });
      toast.success('상담기록이 저장되고 예약이 완료 처리되었습니다.');
      setCompletingAppointment(null);
      await Promise.all([loadAppointments(), loadCalendarMonth(), loadStats()]);
    } catch (e: any) {
      toast.error(e.message || '완료 처리에 실패했습니다.');
    } finally {
      setCompletingSaving(false);
    }
  }, [calendarCounselorId, completeSessionForm, completingAppointment, loadAppointments, loadCalendarMonth, loadStats]);

  const handleDeleteAppointment = useCallback(async (id: string) => {
    if (!window.confirm('이 예약을 삭제할까요? 삭제하면 되돌릴 수 없습니다.')) return;
    try {
      await deleteAppointment(id);
      toast.success('예약이 삭제되었습니다.');
      await Promise.all([loadAppointments(), loadCalendarMonth()]);
    } catch (e: any) {
      toast.error(e.message || '예약 삭제에 실패했습니다.');
    }
  }, [loadAppointments, loadCalendarMonth]);

  const handleAppointmentHistoryClick = useCallback((appointment: AppointmentRow) => {
    if (!appointment.client_id) {
      toast.error('이 예약에는 연결된 고객이 없어 상담이력으로 이동할 수 없습니다.');
      return;
    }
    // /clients/list를 경유하지 않고 상세 페이지로 바로 이동 (목록 로딩을 기다릴 필요 없음)
    navigate(`/clients/detail/${encodeURIComponent(appointment.client_id)}?tab=history&date=${appointment.date}`);
  }, [navigate]);

  const openClientList = useCallback((params?: Record<string, string>) => {
    const searchParams = new URLSearchParams(params);
    navigate(`/clients/list${searchParams.toString() ? `?${searchParams.toString()}` : ''}`);
  }, [navigate]);

  const openDashboardTab = useCallback((tab: DashboardTab) => {
    const nextPath = tab === 'calendar'
      ? '/dashboard/calendar'
      : tab === 'memo'
        ? '/dashboard/memo'
        : '/dashboard';

    setActiveTab(tab);
    if (location !== nextPath) {
      navigate(nextPath);
    }
  }, [location, navigate]);

  useEffect(() => {
    if (activeTab !== 'memo' || memoLoaded || memoLoading) return;
    void loadMyMemo();
  }, [activeTab, loadMyMemo, memoLoaded, memoLoading]);

  const totalClients = stats?.totalClients ?? 0;
  const completedClients = stats?.employed ?? 0;
  const pendingClients = stats?.followUpNeeded ?? 0;
  const activeProcesses = stats?.inProgress ?? 0;
  const averageScore = stats?.averageScore ?? null;
  const scoredClients = stats?.scoredClients ?? 0;
  const unscoredClients = stats?.unscoredClients ?? 0;
  const scoreDistribution = stats?.scoreDistribution ?? SCORE_RANGE_FALLBACK;
  const hasScoreDistribution = scoreDistribution.some(item => item.count > 0);

  const processBreakdownByStage = new Map(stats?.stageBreakdown?.map(item => [item.stage, item.count]) ?? []);
  const processStages: ProcessStage[] = PROCESS_STAGE_ORDER.map(stage => ({
    stage,
    count: processBreakdownByStage.get(stage) ?? 0,
  }));
  const stageColors: Record<string, string> = {
    '초기상담': '#4299E1',
    '심층상담': '#9F7AEA',
    '취업지원': '#F6AD55',
    '직업훈련': '#ED8936',
    '취업알선': '#38BDF8',
    '취업완료': PRIMARY_HEX,
    '사후관리': '#68D391',
  };
  const maxStageCount = Math.max(...processStages.map(s => s.count), 1);

  if (!canRender) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">업무 대시보드</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            안녕하세요, {user?.name}님. 오늘도 좋은 하루 되세요.
            {!isSupabaseConfigured() && <span className="ml-2 text-amber-600 text-xs">(대시보드 실데이터 확인에는 Supabase 설정 필요)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadStats} className="p-1.5 rounded-sm hover:bg-muted" title="새로고침">
            <RefreshCw size={14} className={statsLoading ? 'animate-spin' : ''} />
          </button>
          <div className="text-sm text-muted-foreground">
            {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          </div>
        </div>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="피상담자 검색 (이름, 연락처, 희망직종)"
          className="w-full pl-9 pr-4 py-2.5 rounded-sm border border-input bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring shadow-sm"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X size={14} />
          </button>
        )}
      </div>

      {searchQuery && (
        <div className="bg-card rounded-md border border-border shadow-sm overflow-hidden">
          {searching ? (
            <div className="flex items-center justify-center p-4">
              <Loader2 size={16} className="animate-spin text-muted-foreground mr-2" />
              <span className="text-sm text-muted-foreground">검색 결과를 불러오는 중...</span>
            </div>
          ) : searchError ? (
            <div className="p-4 text-sm text-destructive text-center">{searchError}</div>
          ) : searchResults.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">일치하는 피상담자가 없습니다.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">이름</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">연락처</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">희망직종</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">현재 단계</th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map(c => (
                  <tr
                    key={c.id}
                    className="border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer"
                    onClick={() => {
                      setSearchQuery('');
                      openClientList({ clientId: String(c.id) });
                    }}
                  >
                    <td className="px-4 py-2.5 font-medium">{c.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{c.phone || '-'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{c.desired_job || '-'}</td>
                    <td className="px-4 py-2.5">
                      <span className="badge-active">{c.participation_stage || '-'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="stat-card animate-pulse">
              <div className="w-10 h-10 rounded-sm bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-muted rounded w-2/3" />
                <div className="h-6 bg-muted rounded w-1/2" />
              </div>
            </div>
          ))
        ) : (
          <>
            <StatCard
              icon={<Users size={18} color={PRIMARY_HEX} />}
              label="전체 상담자 수"
              value={<CountWithUnit count={totalClients} />}
              sub="담당 상담자"
              color="oklch(0.92 0.05 162.5)"
              onClick={() => openClientList()}
              actionLabel="상담자 목록 열기"
            />
            <StatCard
              icon={<TrendingUp size={18} color="#4299E1" />}
              label="진행 중"
              value={<CountWithUnit count={activeProcesses} />}
              sub="프로세스 진행"
              color="oklch(0.92 0.04 240)"
              onClick={() => openClientList({ filter: 'in-progress' })}
              actionLabel="진행 현황 보기"
            />
            <StatCard
              icon={<CheckCircle2 size={18} color={PRIMARY_HEX} />}
              label="취업 완료"
              value={<CountWithUnit count={completedClients} />}
              sub={totalClients > 0 ? `성사율 ${Math.round(completedClients / totalClients * 100)}%` : '-'}
              color="oklch(0.92 0.05 162.5)"
              onClick={() => openClientList({ filter: 'employed' })}
              actionLabel="완료 대상 보기"
            />
            <StatCard
              icon={<AlertCircle size={18} color="#F6AD55" />}
              label="후속 상담 필요"
              value={<CountWithUnit count={pendingClients} />}
              sub="팔로업 대상"
              color="oklch(0.95 0.06 85)"
              onClick={() => openClientList({ filter: 'follow-up' })}
              actionLabel="후속 대상 보기"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {statsLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="stat-card animate-pulse">
              <div className="w-10 h-10 rounded-sm bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-muted rounded w-2/3" />
                <div className="h-6 bg-muted rounded w-1/2" />
              </div>
            </div>
          ))
        ) : (
          <>
            <StatCard
              icon={<BarChart3 size={18} color={PRIMARY_HEX} />}
              label="평균 점수"
              value={averageScore != null ? `${averageScore}점` : '-'}
              sub={scoredClients > 0 ? `입력된 ${scoredClients}명 기준` : '입력된 점수 없음'}
              color="oklch(0.93 0.03 162.5)"
            />
            <StatCard
              icon={<CheckCircle2 size={18} color="#4299E1" />}
              label="점수 입력 완료"
              value={scoredClients}
              sub={totalClients > 0 ? `입력률 ${Math.round((scoredClients / totalClients) * 100)}%` : '-'}
              color="oklch(0.92 0.04 240)"
            />
            <StatCard
              icon={<AlertCircle size={18} color="#F6AD55" />}
              label="점수 미확정"
              value={unscoredClients}
              sub={totalClients > 0 ? `전체 대비 ${Math.round((unscoredClients / totalClients) * 100)}%` : '-'}
              color="oklch(0.95 0.06 85)"
            />
          </>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto border-b border-border pb-px">
        {[
          { id: 'overview', label: '현황', icon: <TrendingUp size={14} /> },
          { id: 'calendar', label: '캘린더', icon: <CalendarIcon size={14} /> },
          { id: 'memo', label: '메모장', icon: <StickyNote size={14} /> },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => openDashboardTab(tab.id as DashboardTab)}
            className="flex shrink-0 items-center gap-1.5 rounded-t-sm border border-border px-4 py-2.5 text-sm font-medium transition-all"
            style={activeTab === tab.id
              ? { borderColor: PRIMARY_HEX, color: PRIMARY_HEX, background: 'rgba(0, 156, 100, 0.08)' }
              : { color: '#6b7280', background: 'transparent' }
            }
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {statsError && (
            <div className="lg:col-span-3 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {statsError}
            </div>
          )}
          <div className="lg:col-span-2 bg-card rounded-md p-5 shadow-sm border border-border">
            <h3 className="text-sm font-semibold text-foreground mb-4">월별 세션/진행 인원</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyStats} barSize={14}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.88 0.008 75)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'oklch(0.55 0.015 65)' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'oklch(0.55 0.015 65)' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: '6px', border: '1px solid oklch(0.88 0.008 75)', fontSize: '12px' }} />
                <Bar dataKey="sessions" name="세션 수" fill={PRIMARY_HEX} radius={[3, 3, 0, 0]} />
                <Bar dataKey="clients" name="상담 진행 인원" fill="#4299E1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div ref={processSectionRef} className="bg-card rounded-md p-5 shadow-sm border border-border">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">프로세스 과정 수</h3>
              <button
                type="button"
                onClick={() => openClientList()}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
              >
                목록 보기
                <ChevronRight size={12} />
              </button>
            </div>
            <div className="space-y-3">
              {processStages.map(stage => (
                <button
                  key={stage.stage}
                  type="button"
                  onClick={() => openClientList({ stage: stage.stage })}
                  className="block w-full rounded-xl px-2 py-1.5 text-left transition hover:bg-muted/35 focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-foreground">{stage.stage}</span>
                    <span className="text-xs font-semibold text-foreground">{stage.count}명</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${(stage.count / maxStageCount) * 100}%`,
                        background: stageColors[stage.stage] || PRIMARY_HEX,
                      }}
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-3 bg-card rounded-md p-5 shadow-sm border border-border">
            <h3 className="text-sm font-semibold text-foreground mb-4">월별 상담 진행 인원 추이</h3>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={monthlyStats}>
                <defs>
                  <linearGradient id="clientGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4299E1" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#4299E1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.88 0.008 75)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'oklch(0.55 0.015 65)' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'oklch(0.55 0.015 65)' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: '6px', border: '1px solid oklch(0.88 0.008 75)', fontSize: '12px' }} />
                <Area type="monotone" dataKey="clients" name="상담 진행 인원" stroke="#4299E1" strokeWidth={2} fill="url(#clientGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="lg:col-span-3 bg-card rounded-md p-5 shadow-sm border border-border">
            <h3 className="text-sm font-semibold text-foreground mb-4">점수 구간별 분포</h3>
            {hasScoreDistribution ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={scoreDistribution} barSize={32}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.88 0.008 75)" vertical={false} />
                  <XAxis dataKey="range" tick={{ fontSize: 11, fill: 'oklch(0.55 0.015 65)' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'oklch(0.55 0.015 65)' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: '6px', border: '1px solid oklch(0.88 0.008 75)', fontSize: '12px' }} />
                  <Bar dataKey="count" name="상담자 수" fill={PRIMARY_HEX} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[180px] items-center justify-center rounded-sm border border-dashed border-border bg-muted/10 text-sm text-muted-foreground">
                입력된 점수 데이터가 없습니다.
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'calendar' && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[540px_minmax(0,1fr)] 2xl:grid-cols-[810px_minmax(0,1fr)]">
          <div className="rounded-md border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">캘린더</h3>
              {monthLoading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
            </div>
            <div className="mx-auto w-full max-w-[360px] xl:max-w-none">
              <LiveCalendar
                month={calendarMonth}
                selectedDate={selectedDate}
                counts={monthCounts}
                onMonthChange={setCalendarMonth}
                onSelectDate={handleDateSelect}
              />
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">상담 일정</h3>
                <div className="mt-1 text-xs text-muted-foreground">
                  {calendarMode === 'today' && `기준일 ${formatPanelDate(currentRange.anchor)}`}
                  {calendarMode === 'week' && `오늘부터 7일 ${formatPanelDate(currentRange.start)} ~ ${formatPanelDate(currentRange.end)}`}
                  {calendarMode === 'selected-period' && `선택 기간 ${formatPanelDate(currentRange.start)} ~ ${formatPanelDate(currentRange.end)}`}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    setCalendarMode('today');
                    setShowPeriodSelector(false);
                  }}
                  className="rounded-sm border px-3 py-1.5 text-xs font-medium"
                  style={calendarMode === 'today' ? { background: PRIMARY_HEX, borderColor: PRIMARY_HEX, color: 'white' } : undefined}
                >
                  오늘
                </button>
                <button
                  onClick={() => {
                    setCalendarMode('week');
                    setShowPeriodSelector(false);
                  }}
                  className="rounded-sm border px-3 py-1.5 text-xs font-medium"
                  style={calendarMode === 'week' ? { background: PRIMARY_HEX, borderColor: PRIMARY_HEX, color: 'white' } : undefined}
                >
                  7일
                </button>
                <button
                  onClick={() => {
                    setCalendarMode('selected-period');
                    setSelectedPeriod(prev => {
                      if (prev.start && prev.end) return prev;
                      return { start: selectedDate || todayKey, end: selectedDate || todayKey };
                    });
                    setShowPeriodSelector(prev => !prev);
                  }}
                  className="rounded-sm border px-3 py-1.5 text-xs font-medium"
                  style={calendarMode === 'selected-period' ? { background: PRIMARY_HEX, borderColor: PRIMARY_HEX, color: 'white' } : undefined}
                >
                  기간 선택
                </button>
                <button
                  type="button"
                  onClick={() => (showAppointmentForm ? setShowAppointmentForm(false) : openAppointmentForm())}
                  className="inline-flex items-center gap-1 rounded-sm px-3 py-1.5 text-xs font-semibold text-white"
                  style={{ background: PRIMARY_HEX }}
                >
                  {showAppointmentForm ? <X size={14} /> : <Plus size={14} />}
                  {showAppointmentForm ? '닫기' : '새 예약'}
                </button>
                <button
                  onClick={refreshCalendar}
                  className="rounded-sm border p-2 hover:bg-muted"
                  title="일정 새로고침"
                >
                  <RefreshCw size={14} className={monthLoading || appointmentsLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {calendarMode === 'selected-period' && showPeriodSelector && (
              <div className="mb-4 rounded-sm border border-border bg-muted/15 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-foreground">기간 범위 선택</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      빠른 기간을 고르거나 시작일과 종료일을 직접 지정할 수 있습니다.
                    </div>
                  </div>
                  <div className="rounded-sm bg-background px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm">
                    {formatPanelDate(currentRange.start)} ~ {formatPanelDate(currentRange.end)}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <label className="space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground">빠른 기간</span>
                    <select
                      value={selectedPeriodPreset}
                      onChange={e => handleSelectedPeriodPresetChange(e.target.value)}
                      className="w-full rounded-sm border border-input bg-background px-3 py-2.5 text-sm shadow-sm outline-none transition focus:ring-2 focus:ring-ring"
                    >
                      <option value="custom">직접 선택</option>
                      <option value="1">당일</option>
                      <option value="3">3일</option>
                      <option value="7">7일</option>
                      <option value="30">30일</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground">시작일</span>
                    <input
                      type="date"
                      value={selectedPeriod.start}
                      onChange={e => handleSelectedPeriodChange('start', e.target.value)}
                      className="w-full rounded-sm border border-input bg-background px-3 py-2.5 text-sm shadow-sm outline-none transition focus:ring-2 focus:ring-ring"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground">종료일</span>
                    <input
                      type="date"
                      value={selectedPeriod.end}
                      onChange={e => handleSelectedPeriodChange('end', e.target.value)}
                      className="w-full rounded-sm border border-input bg-background px-3 py-2.5 text-sm shadow-sm outline-none transition focus:ring-2 focus:ring-ring"
                    />
                  </label>
                </div>
              </div>
            )}

            {(calendarError || appointmentError) && (
              <div className="mb-3 rounded-sm border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {calendarError}
                {calendarError && appointmentError && <br />}
                {appointmentError}
              </div>
            )}

            {showAppointmentForm && (
            <div className="mb-4 rounded-sm border border-border bg-muted/15 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground">날짜</span>
                  <input
                    type="date"
                    value={appointmentForm.date}
                    onChange={e => setAppointmentForm(prev => ({ ...prev, date: e.target.value }))}
                    className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground">시작 시간</span>
                  <input
                    type="time"
                    value={appointmentForm.startTime}
                    onChange={e => setAppointmentForm(prev => ({ ...prev, startTime: e.target.value }))}
                    className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground">종료 시간</span>
                  <input
                    type="time"
                    value={appointmentForm.endTime}
                    onChange={e => setAppointmentForm(prev => ({ ...prev, endTime: e.target.value }))}
                    className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
                <div className="relative space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground">대상 고객 (선택)</span>
                  <input
                    type="text"
                    value={appointmentClient ? appointmentClient.name : appointmentClientQuery}
                    onChange={e => {
                      setAppointmentClient(null);
                      setAppointmentClientQuery(e.target.value);
                    }}
                    placeholder="이름/전화번호로 검색"
                    className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  {!appointmentClient && appointmentClientResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-sm border border-border bg-background shadow-md">
                      {appointmentClientResults.map(client => (
                        <button
                          key={client.id}
                          type="button"
                          onClick={() => {
                            setAppointmentClient({ id: client.id, name: client.name });
                            setAppointmentClientResults([]);
                          }}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                          {client.name} <span className="text-xs text-muted-foreground">{client.phone}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <label className="mt-3 block space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">메모 (선택)</span>
                <input
                  type="text"
                  value={appointmentForm.memo}
                  onChange={e => setAppointmentForm(prev => ({ ...prev, memo: e.target.value }))}
                  placeholder="예약 관련 메모"
                  className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </label>

              <div className="mt-3 flex justify-end gap-2">
                {editingAppointmentId && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAppointmentForm(false);
                      setEditingAppointmentId(null);
                    }}
                    className="rounded-sm border px-4 py-2 text-xs font-semibold hover:bg-muted"
                  >
                    취소
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSubmitAppointment}
                  disabled={appointmentSaving}
                  className="inline-flex items-center gap-1.5 rounded-sm px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  style={{ background: PRIMARY_HEX }}
                >
                  {appointmentSaving && <Loader2 size={12} className="animate-spin" />}
                  {editingAppointmentId ? '일정 변경 저장' : '예약 등록'}
                </button>
              </div>
            </div>
          )}

          {completingAppointment && (
            <div className="mb-4 rounded-sm border border-border bg-muted/15 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-foreground">상담 완료 처리</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {completingAppointment.client_name || '담당 고객 미지정'} · {formatPanelDate(completingAppointment.date)} {formatTimeRange(completingAppointment.start_time, completingAppointment.end_time)}
                    <br />
                    완료 처리 시 아래 내용으로 상담기록(상담이력)이 함께 생성되어 이 예약과 연결됩니다.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCompletingAppointment(null)}
                  className="rounded-sm p-1.5 hover:bg-muted"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground">상담 유형</span>
                  <select
                    value={completeSessionForm.type}
                    onChange={e => setCompleteSessionForm(prev => ({ ...prev, type: e.target.value }))}
                    className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
                  >
                    {['초기상담', '심층상담', '취업지원', '취업완료', '사후관리', '기타'].map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="mt-3 block space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">상담 내용 *</span>
                <textarea
                  value={completeSessionForm.content}
                  onChange={e => setCompleteSessionForm(prev => ({ ...prev, content: e.target.value }))}
                  rows={4}
                  placeholder="상담 내용을 입력하세요..."
                  className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </label>

              <label className="mt-3 block space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">다음 조치사항 (선택)</span>
                <textarea
                  value={completeSessionForm.next_action}
                  onChange={e => setCompleteSessionForm(prev => ({ ...prev, next_action: e.target.value }))}
                  rows={2}
                  placeholder="다음 상담 시 확인할 조치사항을 입력하세요..."
                  className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </label>

              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCompletingAppointment(null)}
                  className="rounded-sm border px-4 py-2 text-xs font-semibold hover:bg-muted"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleCompleteAppointment}
                  disabled={completingSaving || !completeSessionForm.content.trim()}
                  className="inline-flex items-center gap-1.5 rounded-sm px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  style={{ background: PRIMARY_HEX }}
                >
                  {completingSaving && <Loader2 size={12} className="animate-spin" />}
                  상담기록 저장 + 완료 처리
                </button>
              </div>
            </div>
          )}

            {appointmentsLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 size={16} className="animate-spin" />
                예약 목록을 불러오는 중입니다.
              </div>
            ) : appointments.length === 0 ? (
              <div className="rounded-sm border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
                선택한 범위에 예정된 상담 일정이 없습니다.
              </div>
            ) : (
              <div className="space-y-3">
                {appointments.map(appointment => {
                  const isCompleted = appointment.status === '완료';
                  return (
                  <div
                    key={appointment.id}
                    onClick={isCompleted ? () => handleAppointmentHistoryClick(appointment) : undefined}
                    role={isCompleted ? 'button' : undefined}
                    tabIndex={isCompleted ? 0 : undefined}
                    onKeyDown={isCompleted ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleAppointmentHistoryClick(appointment);
                      }
                    } : undefined}
                    title={isCompleted ? '클릭하면 이 고객의 상담이력으로 이동합니다.' : undefined}
                    className={`flex flex-wrap items-center gap-4 rounded-md border border-border/80 bg-background px-4 py-3.5 shadow-sm ${
                      isCompleted ? 'cursor-pointer transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-muted/20 hover:shadow-md' : ''
                    }`}
                  >
                    <div className="w-[88px] flex-shrink-0 rounded-sm bg-muted/20 px-3 py-2 text-center">
                      <div className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground">
                        {appointment.date.slice(5).replace('-', '.')}
                      </div>
                      <div className="mt-1 text-sm font-semibold leading-5 text-foreground">
                        {formatTimeRange(appointment.start_time, appointment.end_time)}
                      </div>
                    </div>
                    <div className="h-12 w-px flex-shrink-0 bg-border" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {appointment.client_name || '담당 고객 미지정'}
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {appointment.memo || '메모 없음'}
                      </div>
                    </div>
                    <span
                      className="rounded-sm px-2 py-1 text-[11px] font-medium"
                      style={
                        appointment.status === '예정'
                          ? { color: PRIMARY_HEX, background: 'rgba(0, 156, 100, 0.10)' }
                          : appointment.status === '완료'
                            ? { color: '#4299E1', background: 'rgba(66, 153, 225, 0.10)' }
                            : { color: '#9CA3AF', background: 'rgba(156, 163, 175, 0.15)' }
                      }
                    >
                      {appointment.status}
                    </span>
                    {appointment.status === '예정' && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openRescheduleForm(appointment)}
                          className="inline-flex items-center gap-1 rounded-sm border px-2.5 py-1.5 text-[11px] font-medium hover:bg-muted"
                        >
                          <CalendarClock size={12} />
                          일정변경
                        </button>
                        <button
                          type="button"
                          onClick={() => openCompleteForm(appointment)}
                          className="rounded-sm border px-2.5 py-1.5 text-[11px] font-medium hover:bg-muted"
                        >
                          완료 처리
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancelAppointment(appointment.id)}
                          className="rounded-sm border px-2.5 py-1.5 text-[11px] font-medium text-destructive hover:bg-destructive/5"
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteAppointment(appointment.id)}
                          className="rounded-sm border p-1.5 text-destructive hover:bg-destructive/5"
                          title="삭제"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'memo' && (
        <div className="bg-card rounded-md p-5 shadow-sm border border-border">
          <PersonalMemoPanel
            counselorName={user?.name}
            memo={memoValue}
            loading={memoLoading}
            saving={memoSaving}
            dirty={isMemoDirty}
            error={memoError}
            onChange={setMemoValue}
            onRefresh={() => { void loadMyMemo(); }}
            onReset={() => setMemoValue(savedMemoValue)}
            onSave={() => { void handleSaveMemo(); }}
          />
        </div>
      )}
    </div>
  );
}
