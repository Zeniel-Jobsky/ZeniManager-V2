/**
 * Client List Page (상담자 목록)
 * - 필터: 전체 / 진행 중 / 취업 완료 / 후속 상담 / 점수 미확정
 * - 행 클릭 시 /clients/detail/:id로 이동 (상담이력/상담입력 등은 그 화면에서 처리)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { ROLE_COUNSELOR, isEmploymentCompletedStage } from '@shared/const';
import { usePageGuard } from '@/hooks/usePageGuard';
import {
  Search, Plus, ChevronRight, ChevronLeft,
  Edit3, Loader2, Trash2,
  RefreshCw, ArrowUp, ArrowDown, GripVertical
} from 'lucide-react';
import { toast } from 'sonner';
import { fetchClients, updateClient, deleteClient } from '@/lib/api';
import { syncEmploymentSuccessCase } from '@/lib/employmentSuccessCase';
import type { ClientRow } from '@/lib/supabase';

const PRIMARY = '#009C64';

type FilterType = 'all' | 'in-progress' | 'employed' | 'follow-up' | 'no-score';

function hasScore(client: ClientRow): boolean {
  return client.score != null;
}

function needsFollowUp(client: ClientRow): boolean {
  return client.retention_1m_yn === 'N';
}

function formatFollowUpStat(client: ClientRow): string {
  return client.retention_1m_yn ?? '-';
}

function isEmploymentCompleted(client: ClientRow): boolean {
  return isEmploymentCompletedStage(client.participation_stage);
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
  const VALID_FILTERS: FilterType[] = ['all', 'in-progress', 'employed', 'follow-up', 'no-score'];
  const [filter, setFilter] = useState<FilterType>(() => {
    const requested = new URLSearchParams(window.location.search).get('filter');
    return (VALID_FILTERS as string[]).includes(requested || '') ? (requested as FilterType) : 'all';
  });
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const itemsPerPage = 20;
  const SWIPE_DELETE_WIDTH = 88;
  const [openSwipeClientId, setOpenSwipeClientId] = useState<string | null>(null);
  const [deletingClientId, setDeletingClientId] = useState<string | null>(null);

  const handleDeleteClient = async (client: ClientRow) => {
    if (!confirm(`'${client.name}' 고객을 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return;
    setDeletingClientId(client.id);
    try {
      await deleteClient(client.id);
      setClients(prev => prev.filter(c => c.id !== client.id));
      setOpenSwipeClientId(null);
      toast.success('삭제되었습니다.');
    } catch (e: any) {
      toast.error('삭제 실패: ' + e.message);
    } finally {
      setDeletingClientId(null);
    }
  };

  // --- Column Resize & Reorder States ---
  const DEFAULT_COLS = [
    { key: 'name', label: '이름', width: 120 },
    { key: 'phone', label: '연락처', width: 140 },
    { key: 'iap_date', label: 'IAP 수립일', width: 130 },
    { key: 'participation_stage', label: '취업단계', width: 120 },
    { key: 'business_type', label: '사업유형', width: 120 },
    { key: 'retest_stat', label: '점수', width: 80 },
    { key: 'continue_serv_1_stat', label: '사후관리', width: 100 },
    { key: 'memo', label: '메모', width: 250 },
  ];

  // NOTE(2026-08-26): 컬럼 키(iap_to→iap_date 등)가 스키마 마이그레이션으로 바뀌면서,
  // 예전에 저장된 localStorage 컬럼 설정에 지금은 존재하지 않는 키가 남아있을 수 있다.
  // 그런 키는 걸러내고, DEFAULT_COLS에 새로 생긴 키는 뒤에 채워 넣어 자동으로 복구한다.
  const DEFAULT_COL_KEYS = DEFAULT_COLS.map(c => c.key);

  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('zeni_client_col_order');
    if (saved) {
      try {
        const parsed: string[] = JSON.parse(saved);
        const validKeys = new Set(DEFAULT_COL_KEYS);
        const kept = parsed.filter(key => validKeys.has(key));
        const missing = DEFAULT_COL_KEYS.filter(key => !kept.includes(key));
        return [...kept, ...missing];
      } catch {
        // 저장된 값이 손상됐으면 기본값으로 폴백
      }
    }
    return DEFAULT_COL_KEYS;
  });

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const defaults = DEFAULT_COLS.reduce((acc, c) => ({ ...acc, [c.key]: c.width }), {} as Record<string, number>);
    const saved = localStorage.getItem('zeni_client_col_widths');
    if (saved) {
      try {
        const parsed: Record<string, number> = JSON.parse(saved);
        return { ...defaults, ...parsed };
      } catch {
        // 저장된 값이 손상됐으면 기본값으로 폴백
      }
    }
    return defaults;
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

    const forwardParams = new URLSearchParams();
    const tab = params.get('tab');
    const date = params.get('date');
    if (tab) forwardParams.set('tab', tab);
    if (date) forwardParams.set('date', date);
    const suffix = forwardParams.toString() ? `?${forwardParams.toString()}` : '';

    navigate(`/clients/detail/${clientId}${suffix}`);
    deepLinkHandledRef.current = true;
    window.history.replaceState({}, '', window.location.pathname);
  }, [clients, loading, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('filter')) return;
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const filtered = clients.filter(c => {
    const matchSearch = !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.phone || '').includes(search) ||
      (c.desired_job || '').includes(search);
    // List tabs now follow the same live DB rules as the dashboard instead of legacy mock fields.
    const matchFilter =
      filter === 'all' ? true :
        filter === 'in-progress' ? !isEmploymentCompleted(c) :
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
    'in-progress': clients.filter(c => !isEmploymentCompleted(c)).length,
    employed: clients.filter(c => isEmploymentCompleted(c)).length,
    'follow-up': clients.filter(c => needsFollowUp(c)).length,
    'no-score': clients.filter(c => !hasScore(c)).length,
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
          <FilterTab label="진행 중" active={filter === 'in-progress'} count={counts['in-progress']} onClick={() => setFilter('in-progress')} />
          <FilterTab label="취업 완료" active={filter === 'employed'} count={counts.employed} onClick={() => setFilter('employed')} />
          <FilterTab label="후속 상담" active={filter === 'follow-up'} count={counts['follow-up']} onClick={() => setFilter('follow-up')} />
          <FilterTab label="점수 미확정" active={filter === 'no-score'} count={counts['no-score']} onClick={() => setFilter('no-score')} />
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
                      className="relative flex border-b border-border last:border-0 overflow-hidden"
                    >
                      {/* 왼쪽으로 드래그하면 뒤에 깔린 삭제 버튼이 드러남 */}
                      <div className="absolute inset-y-0 right-0 z-0 flex items-stretch" style={{ width: SWIPE_DELETE_WIDTH }}>
                        <button
                          onClick={() => handleDeleteClient(client)}
                          disabled={deletingClientId === client.id}
                          className="flex-1 bg-destructive text-destructive-foreground text-xs font-bold flex flex-col items-center justify-center gap-1 hover:brightness-110 transition-[filter] disabled:opacity-60"
                        >
                          {deletingClientId === client.id
                            ? <Loader2 size={16} className="animate-spin" />
                            : <Trash2 size={16} />
                          }
                          삭제
                        </button>
                      </div>

                      <motion.div
                        className="relative z-10 flex bg-card w-full touch-pan-y"
                        drag="x"
                        dragConstraints={{ left: -SWIPE_DELETE_WIDTH, right: 0 }}
                        dragElastic={0}
                        dragMomentum={false}
                        animate={{ x: openSwipeClientId === client.id ? -SWIPE_DELETE_WIDTH : 0 }}
                        transition={{ type: 'spring', damping: 32, stiffness: 420 }}
                        onDragEnd={(_, info) => {
                          setOpenSwipeClientId(info.offset.x < -SWIPE_DELETE_WIDTH / 2 ? client.id : null);
                        }}
                      >
                      <td className="flex-shrink-0 px-4 py-3 text-muted-foreground flex items-center bg-card" style={{ width: 60 }}>
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
                                {/* NOTE(2026-08-26): 실데이터의 참여단계가 고정 값 몇 개보다 훨씬
                                    다양해서(구직활동/중단/만종 등 30여 종) 드롭다운 대신 자유
                                    텍스트로 입력받는다. blur/Enter 시점에 저장. */}
                                <input
                                  type="text"
                                  key={client.id + ':' + (client.participation_stage ?? '')}
                                  defaultValue={client.participation_stage || ''}
                                  onBlur={e => {
                                    const next = e.target.value.trim();
                                    if (next !== (client.participation_stage || '')) {
                                      handleStageUpdate(client.id, next);
                                    }
                                  }}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                  }}
                                  className={`text-xs px-2 py-1 rounded-sm border border-transparent hover:border-border focus:border-input focus:bg-background outline-none ${stageColors[client.participation_stage || ''] || 'badge-active'}`}
                                  style={{ width: '100%' }}
                                />
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
                                  {client.score != null
                                    ? <span className="font-semibold" style={{ color: PRIMARY }}>{client.score}</span>
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
                                <div className="truncate w-full">{client.counsel_notes || '-'}</div>
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
                      <td className="flex-shrink-0 px-4 py-3 text-right flex items-center justify-end bg-card" style={{ width: 80 }}>
                        <button
                          onClick={() => navigate(`/clients/detail/${client.id}`)}
                          className="p-1.5 rounded-sm hover:bg-muted transition-colors"
                        >
                          <Edit3 size={14} />
                        </button>
                      </td>
                      </motion.div>
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
