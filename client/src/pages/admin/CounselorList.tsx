/**
 * Admin Counselor List Page (상담사 목록)
 * Data: Supabase API (mock fallback when not configured) & Electron IPC for Registration/Deletion
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ROLE_ADMIN, ROLE_COUNSELOR, isAdminRole, type AppRole } from '@shared/const';
import { Search, Plus, Edit3, Trash2, X, Loader2, RefreshCw, AlertTriangle, Eye, Target, Users, TrendingUp, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { usePageGuard } from '@/hooks/usePageGuard';
import { fetchCounselors, updateCounselor, fetchClients } from '@/lib/api';
import type { CounselorRow, ClientRow } from '@/lib/supabase';
import { isSupabaseConfigured, getSupabaseUrl, getSupabaseServiceRoleKey } from '@/lib/supabase';
import { useElectron } from '@/hooks/useElectron';

const PRIMARY_HEX = '#009C64';
const ITEMS_PER_PAGE = 20;

const STAGE_COLORS: Record<string, string> = {
  '초기상담': '#4299E1',
  '심층상담': '#9F7AEA',
  '취업지원': '#F6AD55',
  '취업완료': '#009C64',
  '사후관리': '#38B2AC',
};

interface CounselorForm {
  user_name: string;
  email: string;
  password: string;
  department: string;
  memo: string;
  memo_bymanager: string;
  role: AppRole;
}

const EMPTY_FORM: CounselorForm = {
  user_name: '', email: '', password: '', department: '', memo: '', memo_bymanager: '', role: ROLE_COUNSELOR,
};

// ─── 1. 상담사 상세 정보(통계) 모달 ───
function CounselorDetailModal({
  counselor,
  onClose,
  onMemoUpdate
}: {
  counselor: CounselorRow;
  onClose: () => void;
  onMemoUpdate: (newMemo: string) => void;
}) {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  
  // 메모 수정용 상태
  const [memo, setMemo] = useState(counselor.memo_bymanager || '');
  const [savingMemo, setSavingMemo] = useState(false);

  useEffect(() => {
    fetchClients(counselor.user_id)
      .then(data => {
        setClients(data);
        setLoading(false);
      })
      .catch(() => {
        toast.error('내담자 데이터를 불러오는데 실패했습니다.');
        setLoading(false);
      });
  }, [counselor.user_id]);

  const totalClients = clients.length; 
  // 🚨 에러 수정: employment_type 대신 hire_date(취업일자)가 있거나 단계가 취업완료인 경우로 변경
  const completedClients = clients.filter(c => !!c.hire_date || c.participation_stage === '취업완료').length;
  const successRate = totalClients > 0 ? Math.round((completedClients / totalClients) * 100) : 0;

  const stageData = useMemo(() => {
    const order = ['초기상담', '심층상담', '취업지원', '취업완료', '사후관리'];
    const map: Record<string, number> = { '초기상담': 0, '심층상담': 0, '취업지원': 0, '취업완료': 0, '사후관리': 0 };
    clients.forEach(c => {
      if (c.participation_stage && map[c.participation_stage] !== undefined) {
        map[c.participation_stage]++;
      }
    });
    return order.map(name => ({ name, value: map[name] }));
  }, [clients]);

  const maxStageValue = Math.max(...stageData.map(s => s.value), 1);

  const handleSaveMemo = async () => {
    setSavingMemo(true);
    try {
      if (!isSupabaseConfigured()) {
        toast.success('메모가 저장되었습니다. (데모 모드)');
        onMemoUpdate(memo);
      } else {
        await updateCounselor(counselor.user_id, { memo_bymanager: memo });
        toast.success('관리자 메모가 저장되었습니다.');
        onMemoUpdate(memo);
      }
    } catch (e: any) {
      toast.error('메모 저장 실패: ' + e.message);
    } finally {
      setSavingMemo(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-card rounded-md shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold" style={{ background: PRIMARY_HEX }}>
              {counselor.user_name.charAt(0)}
            </div>
            <div>
              <h2 className="font-bold text-lg text-foreground">{counselor.user_name} 상담사</h2>
              <p className="text-sm text-muted-foreground">{counselor.department || '소속 지점 없음'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-sm hover:bg-muted text-muted-foreground"><X size={20} /></button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 bg-muted/10">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 size={28} className="animate-spin text-primary mb-2" />
              <p className="text-sm text-muted-foreground">성과 데이터를 분석 중입니다...</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-card border border-border rounded-md p-4 text-center shadow-sm">
                  <Users size={20} className="mx-auto text-blue-500 mb-2" />
                  <div className="text-xs text-muted-foreground font-medium mb-1">담당 인원</div>
                  <div className="text-2xl font-bold text-foreground">{totalClients}명</div>
                </div>
                <div className="bg-card border border-border rounded-md p-4 text-center shadow-sm">
                  <Target size={20} className="mx-auto mb-2" style={{ color: PRIMARY_HEX }} />
                  <div className="text-xs text-muted-foreground font-medium mb-1">취업 완료</div>
                  <div className="text-2xl font-bold text-foreground">{completedClients}명</div>
                </div>
                <div className="bg-card border border-border rounded-md p-4 text-center shadow-sm">
                  <TrendingUp size={20} className="mx-auto text-amber-500 mb-2" />
                  <div className="text-xs text-muted-foreground font-medium mb-1">취업 성취율</div>
                  <div className="text-2xl font-bold text-foreground">{successRate}%</div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-md p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-foreground mb-5">상담자 프로세스 과정 분포</h3>
                <div className="space-y-4">
                  {stageData.map((stage) => {
                    const widthPct = maxStageValue > 0 ? (stage.value / maxStageValue) * 100 : 0;
                    const barColor = STAGE_COLORS[stage.name] || '#CBD5E0';
                    return (
                      <div key={stage.name}>
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="font-medium text-muted-foreground">{stage.name}</span>
                          <span className="font-semibold text-foreground">{stage.value}명</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${widthPct}%`, backgroundColor: barColor }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-md p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-amber-900">관리자 메모</h3>
                  <button
                    onClick={handleSaveMemo}
                    disabled={savingMemo || memo === (counselor.memo_bymanager || '')}
                    className="px-3 py-1.5 bg-amber-600 text-white text-xs font-medium rounded-sm hover:bg-amber-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                  >
                    {savingMemo && <Loader2 size={12} className="animate-spin" />}
                    저장
                  </button>
                </div>
                <textarea
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="상담사에 대한 관리자 전용 메모를 입력하세요 (상담사 본인에게는 보이지 않습니다)..."
                  className="w-full h-24 p-3 text-sm bg-white border border-amber-200 rounded-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 resize-none text-amber-950 placeholder:text-amber-300/80"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 2. 상담사 등록/수정 모달 ───
function CounselorModal({
  counselor,
  existingBranches,
  onSave,
  onClose,
}: {
  counselor: CounselorRow | null;
  existingBranches: string[];
  onSave: (form: CounselorForm) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<CounselorForm>(() =>
    counselor
      ? {
          user_name: counselor.user_name,
          email: '',
          password: '',
          department: counselor.department || '',
          memo: counselor.memo || '',
          memo_bymanager: counselor.memo_bymanager || '',
          role: counselor.role || ROLE_COUNSELOR,
        }
      : { ...EMPTY_FORM, department: existingBranches.length > 0 ? '' : '' } 
  );

  const [isCustomBranch, setIsCustomBranch] = useState(() => {
    if (existingBranches.length === 0) return true;
    if (counselor?.department && !existingBranches.includes(counselor.department)) return true;
    return false;
  });

  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.user_name.trim()) { toast.error('이름을 입력해주세요.'); return; }
    if (!form.department.trim()) { toast.error('지점을 선택하거나 입력해주세요.'); return; }
    
    if (!counselor) {
      if (!form.email.trim()) { toast.error('이메일을 입력해주세요.'); return; }
      if (!form.password.trim()) { toast.error('비밀번호를 입력해주세요.'); return; }
      if (form.password.length < 6) { toast.error('비밀번호는 6자리 이상이어야 합니다.'); return; }
    }

    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-card rounded-md shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">{counselor ? '상담사 수정' : '상담사 등록'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-sm hover:bg-muted"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {!isSupabaseConfigured() && (
            <div className="flex items-center gap-2 p-3 rounded-sm border border-amber-200 bg-amber-50 text-amber-800 text-xs">
              <AlertTriangle size={13} />
              Supabase 미설정 — 저장이 실제 DB에 반영되지 않습니다.
            </div>
          )}
          
          <div>
            <label className="block text-sm font-medium mb-1.5">이름 <span className="text-destructive">*</span></label>
            <input
              type="text"
              value={form.user_name}
              onChange={e => setForm(f => ({ ...f, user_name: e.target.value }))}
              className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="홍길동"
            />
          </div>

          {!counselor && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1.5">이메일 (아이디) <span className="text-destructive">*</span></label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="counselor@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">비밀번호 <span className="text-destructive">*</span></label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="6자리 이상"
                />
              </div>
            </>
          )}

          {isCustomBranch ? (
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-sm font-medium">지점 <span className="text-destructive">*</span></label>
                {existingBranches.length > 0 && (
                  <button 
                    type="button" 
                    onClick={() => {
                      setIsCustomBranch(false);
                      setForm(f => ({ ...f, department: '' }));
                    }} 
                    className="text-xs hover:underline"
                    style={{ color: PRIMARY_HEX }}
                  >
                    목록에서 선택하기
                  </button>
                )}
              </div>
              <input
                type="text"
                value={form.department}
                onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="새 지점명 직접 입력 (예: 서울 강남지점)"
                autoFocus
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-1.5">지점 <span className="text-destructive">*</span></label>
              <select
                value={form.department}
                onChange={e => {
                  if (e.target.value === '__NEW__') {
                    setIsCustomBranch(true);
                    setForm(f => ({ ...f, department: '' }));
                  } else {
                    setForm(f => ({ ...f, department: e.target.value }));
                  }
                }}
                className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="" disabled>지점을 선택하세요</option>
                {existingBranches.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
                <option value="__NEW__">+ 새 지점 직접 입력</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1.5">관리자 메모</label>
            <textarea
              value={form.memo_bymanager}
              onChange={e => setForm(f => ({ ...f, memo_bymanager: e.target.value }))}
              className="w-full px-3 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[80px]"
              placeholder="상담사에 대한 관리자 전용 참고 사항..."
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving} className="btn-primary flex items-center gap-1.5 disabled:opacity-60">
              {saving ? <Loader2 size={13} className="animate-spin" /> : null}
              저장
            </button>
            <button type="button" onClick={onClose} className="btn-cancel">취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── 3. 메인 페이지 컴포넌트 ───
export default function CounselorList() {
  const { canRender } = usePageGuard('admin');
  const { isElectron, adminRegisterCounselor, adminDeleteCounselor } = useElectron(); 
  
  const [counselors, setCounselors] = useState<CounselorRow[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [currentPage]);

  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<CounselorRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CounselorRow | null>(null);
  const [detailTarget, setDetailTarget] = useState<CounselorRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [counselorsData, allClientsData] = await Promise.all([
        fetchCounselors(),
        fetchClients()
      ]);

      const enhancedCounselors = counselorsData.map(c => {
        const myClients = allClientsData.filter(client => client.counselor_id === c.user_id);
        // 🚨 에러 수정: employment_type 대신 hire_date(취업일자) 유무 및 participation_stage 사용
        const completedCount = myClients.filter(client => !!client.hire_date || client.participation_stage === '취업완료').length;
        
        return {
          ...c,
          client_count: myClients.length,
          completed_count: completedCount
        };
      });

      setCounselors(enhancedCounselors);
    } catch (e: any) {
      toast.error('데이터 로드 실패: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const existingBranches = useMemo(() => {
    const branches = counselors
      .map(c => c.department)
      .filter((b): b is string => Boolean(b)); 
    return Array.from(new Set(branches)).sort();
  }, [counselors]);

  const counselorOnlyList = counselors.filter(c => Number(c.role) === 5);

  const filtered = counselorOnlyList.filter(c => {
    const matchSearch = !search ||
      c.user_name.toLowerCase().includes(search.toLowerCase()) ||
      (c.department || '').includes(search);
    const matchBranch = branchFilter === 'all' || c.department === branchFilter;
    
    return matchSearch && matchBranch;
  });

  const sortedData = useMemo(() => {
    const sortableItems = [...filtered];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        const aValue = a[sortConfig.key as keyof CounselorRow] ?? '';
        const bValue = b[sortConfig.key as keyof CounselorRow] ?? '';
        
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [filtered, sortConfig]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, branchFilter, sortConfig]);

  const totalPages = Math.ceil(sortedData.length / ITEMS_PER_PAGE);
  const paginatedData = sortedData.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const renderSortIcon = (key: string) => {
    if (sortConfig?.key !== key) return <ArrowUpDown size={14} className="opacity-40" />;
    return sortConfig.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
  };

  const handleSave = async (form: CounselorForm) => {
    if (!isSupabaseConfigured()) {
      if (editTarget) {
        setCounselors(prev => prev.map(c => c.user_id === editTarget.user_id ? { ...c, ...form } : c));
        toast.success('수정되었습니다. (데모 모드)');
      } else {
        const newC: CounselorRow = {
          user_id: `demo_${Date.now()}`,
          ...form,
          role: 5,
          client_count: 0,
          completed_count: 0,
        };
        setCounselors(prev => [newC, ...prev]);
        toast.success('등록되었습니다. (데모 모드)');
      }
      setShowModal(false);
      setEditTarget(null);
      return;
    }
    
    try {
      if (editTarget) {
        const updated = await updateCounselor(editTarget.user_id, {
          user_name: form.user_name,
          department: form.department,
          memo: form.memo,
          role: editTarget.role
        } as any);
        
        setCounselors(prev => prev.map(c => c.user_id === updated.user_id ? { ...updated, client_count: c.client_count, completed_count: c.completed_count } : c));
        toast.success('상담사 정보가 수정되었습니다.');
        setShowModal(false);
        setEditTarget(null);
      } else {
        if (!isElectron) {
          toast.error("데스크톱 앱(관리자 모드)에서만 상담사 등록이 가능합니다.");
          return;
        }

        const supabaseUrl = getSupabaseUrl();
        const serviceRoleKey = getSupabaseServiceRoleKey();

        if (!supabaseUrl || !serviceRoleKey) {
          toast.error("설정 메뉴에서 Supabase URL과 Service Role Key를 등록해주세요.");
          return;
        }

        const result = await adminRegisterCounselor({
          supabaseUrl,
          serviceRoleKey,
          email: form.email,
          password: form.password,
          user_name: form.user_name,
          department: form.department
        });

        if (result.success) {
          toast.success('상담사가 안전하게 등록되었습니다.');
          load(); 
          setShowModal(false);
          setEditTarget(null);
        } else {
          toast.error(`등록 실패: ${result.error}`);
        }
      }
    } catch (e: any) {
      toast.error('작업 실패: ' + e.message);
    }
  };

  const handleDelete = async (c: CounselorRow) => {
    if (!isSupabaseConfigured()) {
      setCounselors(prev => prev.filter(x => x.user_id !== c.user_id));
      toast.success('삭제되었습니다. (데모 모드)');
      setDeleteTarget(null);
      return;
    }
    
    try {
      if (!isElectron) {
        toast.error("데스크톱 앱(관리자 모드)에서만 상담사 삭제가 가능합니다.");
        return;
      }

      const supabaseUrl = getSupabaseUrl();
      const serviceRoleKey = getSupabaseServiceRoleKey();

      if (!supabaseUrl || !serviceRoleKey) {
        toast.error("설정 메뉴에서 Supabase URL과 Service Role Key를 등록해주세요.");
        return;
      }

      const result = await adminDeleteCounselor({
        supabaseUrl,
        serviceRoleKey,
        userId: String(c.user_id)
      });

      if (result.success) {
        setCounselors(prev => prev.filter(x => x.user_id !== c.user_id));
        toast.success(`${c.user_name} 상담사가 완전히 삭제되었습니다.`);
        setDeleteTarget(null);
      } else {
        toast.error(`삭제 실패: ${result.error}`);
      }
    } catch (e: any) {
      toast.error('오류 발생: ' + e.message);
    }
  };

  if (!canRender) return null;

  return (
    <div ref={topRef} className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">상담사 목록</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            전체 {counselorOnlyList.length}명
            {!isSupabaseConfigured() && <span className="ml-2 text-amber-600">(데모 데이터)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-sm hover:bg-muted" title="새로고침">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => { setEditTarget(null); setShowModal(true); }}
            className="btn-primary"
          >
            <Plus size={15} className="mr-1" />
            상담사 등록
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
            placeholder="이름, 지점으로 검색..."
            className="w-full pl-9 pr-4 py-2 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-muted-foreground" />
            <select
              value={branchFilter}
              onChange={e => setBranchFilter(e.target.value)}
              className="px-3 py-1.5 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="all">전체 지점</option>
              {existingBranches.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-md shadow-sm border border-border flex flex-col overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-muted-foreground mr-2" />
            <span className="text-sm text-muted-foreground">데이터 로드 중...</span>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th 
                      className="text-left px-4 py-3 font-medium text-muted-foreground cursor-pointer hover:bg-muted/80 transition-colors"
                      onClick={() => handleSort('user_name')}
                    >
                      <div className="flex items-center gap-1.5">이름 {renderSortIcon('user_name')}</div>
                    </th>
                    <th 
                      className="text-left px-4 py-3 font-medium text-muted-foreground cursor-pointer hover:bg-muted/80 transition-colors"
                      onClick={() => handleSort('department')}
                    >
                      <div className="flex items-center gap-1.5">지점 {renderSortIcon('department')}</div>
                    </th>
                    <th 
                      className="text-right px-4 py-3 font-medium text-muted-foreground cursor-pointer hover:bg-muted/80 transition-colors"
                      onClick={() => handleSort('client_count')}
                    >
                      <div className="flex items-center justify-end gap-1.5">{renderSortIcon('client_count')} 담당 인원</div>
                    </th>
                    <th 
                      className="text-right px-4 py-3 font-medium text-muted-foreground cursor-pointer hover:bg-muted/80 transition-colors"
                      onClick={() => handleSort('completed_count')}
                    >
                      <div className="flex items-center justify-end gap-1.5">{renderSortIcon('completed_count')} 상담 완료</div>
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">역할</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">상세/수정/삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedData.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        {search || branchFilter !== 'all' ? '검색 결과가 없습니다.' : '등록된 상담사가 없습니다.'}
                      </td>
                    </tr>
                  ) : (
                    paginatedData.map(c => (
                      <tr key={c.user_id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setDetailTarget(c)}>
                            <div className="w-8 h-8 rounded-sm flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style={{ background: PRIMARY_HEX }}>
                              {c.user_name.charAt(0)}
                            </div>
                            <div className="font-medium text-foreground hover:underline">{c.user_name}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{c.department || '-'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-foreground">{c.client_count ?? 0}</td>
                        <td className="px-4 py-3 text-right">
                          <span style={{ color: PRIMARY_HEX }} className="font-semibold">{c.completed_count ?? 0}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={isAdminRole(c.role) ? 'badge-pending' : 'badge-active'}>
                            {isAdminRole(c.role) ? '관리자' : '상담사'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setDetailTarget(c)}
                              className="p-1.5 rounded-sm hover:bg-muted transition-colors inline-flex items-center text-muted-foreground"
                              title="상세보기"
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              onClick={() => { setEditTarget(c); setShowModal(true); }}
                              className="p-1.5 rounded-sm hover:bg-muted transition-colors inline-flex items-center text-muted-foreground"
                              title="수정"
                            >
                              <Edit3 size={14} />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(c)}
                              className="p-1.5 rounded-sm hover:bg-destructive/10 transition-colors text-destructive inline-flex items-center"
                              title="삭제"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/10">
                <div className="text-sm text-muted-foreground">
                  총 <span className="font-medium text-foreground">{sortedData.length}</span>건 중 {(currentPage - 1) * ITEMS_PER_PAGE + 1}-
                  {Math.min(currentPage * ITEMS_PER_PAGE, sortedData.length)} 표시
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-sm border border-border bg-background hover:bg-muted disabled:opacity-50 transition-colors"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-sm font-medium px-2 text-foreground">
                    {currentPage} <span className="text-muted-foreground font-normal">/ {totalPages}</span>
                  </span>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded-sm border border-border bg-background hover:bg-muted disabled:opacity-50 transition-colors"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showModal && (
        <CounselorModal
          counselor={editTarget}
          existingBranches={existingBranches}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditTarget(null); }}
        />
      )}

      {detailTarget && (
        <CounselorDetailModal 
          counselor={detailTarget} 
          onClose={() => setDetailTarget(null)}
          onMemoUpdate={(newMemo) => {
            setCounselors(prev => prev.map(c => c.user_id === detailTarget.user_id ? { ...c, memo_bymanager: newMemo } : c));
            setDetailTarget(prev => prev ? { ...prev, memo_bymanager: newMemo } : null);
          }}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-card rounded-md shadow-xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-foreground mb-2">상담사 삭제</h3>
            <p className="text-sm text-muted-foreground mb-5">
              <strong>{deleteTarget.user_name}</strong> 상담사를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteTarget(null)} className="btn-cancel">취소</button>
              <button onClick={() => handleDelete(deleteTarget)} className="btn-destructive">삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
