/**
 * Admin Client List Page (상담자 목록 - 관리자)
 * Design: 모던 웰니스 미니멀리즘
 * Data: Supabase API with DB schema matching
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Search, Download, Upload, RefreshCw, Loader2, ChevronLeft, ChevronRight, Filter, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';
import { usePageGuard } from '@/hooks/usePageGuard';
import { fetchClients, fetchCounselors, createClient } from '@/lib/api';
import type { ClientRow, CounselorRow } from '@/lib/supabase';

const PRIMARY_HEX = '#009C64';
const ITEMS_PER_PAGE = 20;

const stageColors: Record<string, string> = {
  '초기상담': 'badge-active',
  '심층상담': 'badge-pending',
  '취업지원': 'badge-pending',
  '취업완료': 'badge-completed',
  '사후관리': 'badge-active',
};

// 엑셀 양식 헤더
const CSV_HEADERS = [
  '순번', '연도', '배정구분', '이름', '주민번호', '연락처', '최종상담일', '연령', '성별', '사업유형',
  '참여유형', '참여단계', '역량등급', '인정통지일', '희망직무', '상담내역', '주소', '출신학교', '전공', '최종학력',
  '초기상담(1차)', 'IAP수립일', 'IAP운영기간', '참여수당신청일', '재진단날짜', '재진단여부', '일경험유형', '참여의사',
  '참여기업', '참여기간', '수료여부', '훈련과정명', '훈련개강일', '훈련종료일', '훈련수당', '집중취업알선시작일',
  '집중취업알선종료일', '취업지원종료일', '취업구분', '취업일자', '취업처', '취업직무', '급여', '취업소요기간', '퇴사일',
  '1차(1개월)', '1차상태', '2차(6개월)', '2차상태', '3차(12개월)', '3차상태', '4차(18개월)', '4차상태', '담당자', '지점'
];

export default function AdminClientList() {
  const { canRender } = usePageGuard('admin');
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [counselors, setCounselors] = useState<CounselorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  const topRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [currentPage]);

  const loadClients = () => {
    setLoading(true);
    Promise.all([fetchClients(), fetchCounselors()])
      .then(([clientsData, counselorsData]) => {
        setCounselors(counselorsData);

        const counselorMap = new Map(counselorsData.map(c => [c.user_id, c]));

        const enrichedClients = clientsData.map(client => {
          const counselor = client.counselor_id ? counselorMap.get(client.counselor_id) : undefined;
          return {
            ...client,
            counselor_name: counselor ? counselor.user_name : null,
            branch: counselor && counselor.department ? counselor.department : null
          };
        });

        setClients(enrichedClients);
        setLoading(false);
      })
      .catch(err => {
        toast.error('데이터 로드 실패: ' + err.message);
        setLoading(false);
      });
  };

  useEffect(() => { loadClients(); }, []);

  const branches = ['all', ...Array.from(new Set(clients.map(c => c.branch).filter(Boolean) as string[]))];
  const stages = ['all', '초기상담', '심층상담', '취업지원', '취업완료', '사후관리'];

  const filtered = clients.filter(c => {
    const nameToSearch = c.client_name || c.name || '';
    const phoneToSearch = c.phone_encrypted || c.phone || '';
    
    const matchSearch = !search ||
      nameToSearch.includes(search) ||
      phoneToSearch.includes(search) ||
      (c.counselor_name || '').includes(search);
    const matchBranch = branchFilter === 'all' || c.branch === branchFilter;
    const matchStage = stageFilter === 'all' || c.participation_stage === stageFilter;
    return matchSearch && matchBranch && matchStage;
  });

  const sortedData = useMemo(() => {
    let sortableItems = [...filtered];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        let aValue = a[sortConfig.key as keyof ClientRow] ?? '';
        let bValue = b[sortConfig.key as keyof ClientRow] ?? '';
        
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [filtered, sortConfig]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, branchFilter, stageFilter, sortConfig]);

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

  // ─── CSV 내보내기 (Export) ───
  const handleExportCSV = () => {
    if (filtered.length === 0) return toast.error('내보낼 데이터가 없습니다.');

    const rows = filtered.map(c => {
      // 1. 주민번호 합치기
      let residentStr = '';
      if (c.birth_date) {
        const bStr = c.birth_date.replace(/-/g, '');
        if (bStr.length >= 8) residentStr += bStr.substring(2);
        else residentStr += c.birth_date;
      }
      if (c.resident_id) {
        residentStr += residentStr ? '-' + c.resident_id : c.resident_id;
      }

      // 2. 일경험 참여기간 계산
      let workExpPeriod = '';
      if (c.work_ex_start && c.work_ex_end) {
        const d1 = new Date(c.work_ex_start);
        const d2 = new Date(c.work_ex_end);
        if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
          let months = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
          if (d2.getDate() >= d1.getDate()) months += 1;
          workExpPeriod = `${Math.max(1, months)}개월`;
        }
      }

      // 3. 필드 매핑
      return [
        c.seq_no ?? '', 
        c.year ?? '', 
        c.assignment_type ?? '', 
        c.client_name || c.name || '', 
        residentStr, 
        c.phone_encrypted || c.phone || '', 
        c.last_counsel_date ?? '', 
        c.age ?? '', 
        c.gender_code || c.gender || '', 
        c.business_type_code ?? c.business_type ?? '',
        c.participation_type ?? '', 
        c.participation_stage ?? '', 
        c.capa ?? '', 
        c.notificate_date ?? c.recognition_date ?? '', 
        c.desired_job_1 ?? c.desired_job ?? '', 
        c.memo ?? c.counsel_notes ?? '', 
        [c.address_1, c.address_2].filter(Boolean).join(' ') || c.address || '', 
        c.school_name ?? '', 
        c.major ?? '', 
        c.education_level ?? '',
        c.created_at ? c.created_at.split('T')[0] : (c.initial_counsel_date || ''), 
        c.iap_to ?? c.iap_date ?? '', 
        c.iap_todate ?? c.iap_duration ?? '', 
        c.allowance_apply_date ?? '', 
        c.retest_date ?? c.rediagnosis_date ?? '', 
        c.retest_stat !== undefined && c.retest_stat !== null ? String(c.retest_stat) : (c.rediagnosis_yn || ''), 
        c.work_ex_type !== undefined && c.work_ex_type !== null ? String(c.work_ex_type) : (c.work_exp_type || ''), 
        c.work_ex_desire !== undefined && c.work_ex_desire !== null ? String(c.work_ex_desire) : (c.work_exp_intent || ''), 
        c.work_ex_company ?? c.work_exp_company ?? '', 
        workExpPeriod, 
        c.work_ex_graduate !== undefined && c.work_ex_graduate !== null ? String(c.work_ex_graduate) : (c.work_exp_completed || ''), 
        c.training_name ?? '', 
        c.training_start ?? '', 
        c.training_end ?? '', 
        c.training_allowance ?? '', 
        c.job_place_start ?? c.intensive_start ?? '', 
        c.job_place_end ?? c.intensive_end ?? '', 
        c.job_place_support_end ?? c.support_end_date ?? '', 
        c.hire_type ?? '', 
        c.hire_date ?? '', 
        c.hire_place ?? '', 
        c.hire_job_type ?? '', 
        c.hire_payment ?? '', 
        c.employment_duration ?? '', 
        c.retirement_date ?? '', 
        c.continue_serv_1_date ?? '', 
        c.continue_serv_1_stat !== undefined && c.continue_serv_1_stat !== null ? String(c.continue_serv_1_stat) : '', 
        c.continue_serv_6_date ?? '', 
        c.continue_serv_6_stat !== undefined && c.continue_serv_6_stat !== null ? String(c.continue_serv_6_stat) : '', 
        c.continue_serv_12_date ?? '', 
        c.continue_serv_12_stat !== undefined && c.continue_serv_12_stat !== null ? String(c.continue_serv_12_stat) : '', 
        c.continue_serv_18_date ?? '', 
        c.continue_serv_18_stat !== undefined && c.continue_serv_18_stat !== null ? String(c.continue_serv_18_stat) : '', 
        c.counselor_name ?? '', 
        c.branch ?? '' 
      ];
    });

    const csvContent = "\uFEFF" + [CSV_HEADERS, ...rows]
      .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `상담자목록_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    toast.success('엑셀 형식으로 내보내기가 완료되었습니다.');
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  // ─── CSV 추가하기 (Import) ───
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const buffer = event.target?.result as ArrayBuffer;
        if (!buffer) throw new Error("파일을 읽을 수 없습니다.");

        let text = '';
        try {
          const decoder = new TextDecoder('utf-8', { fatal: true });
          text = decoder.decode(buffer);
        } catch (err) {
          const decoder = new TextDecoder('euc-kr');
          text = decoder.decode(buffer);
        }

        if (text.charCodeAt(0) === 0xFEFF) {
          text = text.substring(1);
        }

        const rows = text.split('\n').filter(r => r.trim());
        if (rows.length < 2) throw new Error("데이터가 없거나 부족합니다.");

        const parseRow = (rowStr: string) => 
          rowStr.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(s => s.replace(/^"|"$/g, '').trim());

        const headers = parseRow(rows[0]);
        
        // 🚨 안전한 배열 인덱싱 함수
        const getVal = (cols: string[], colName: string) => {
          const idx = headers.indexOf(colName);
          if (idx === -1 || idx >= cols.length) return '';
          return cols[idx] || '';
        };

        let successCount = 0;
        let failCount = 0;

        toast.info(`총 ${rows.length - 1}개의 데이터 처리를 시작합니다...`);

        const parseSmallInt = (val: string) => {
          if (!val) return undefined;
          const parsed = parseInt(val, 10);
          return isNaN(parsed) ? undefined : parsed;
        };

        for (let i = 1; i < rows.length; i++) {
          const cols = parseRow(rows[i]);
          
          // 🚨 빈 값이 들어와도 안전하게 하이픈('-')으로 대체하여 NOT NULL 에러 방지
          const rawName = getVal(cols, '이름');
          const rawPhone = getVal(cols, '연락처');
          
          const client_name = rawName ? rawName : '-';
          const phone_encrypted = rawPhone ? rawPhone : '-';
          
          const counselorName = getVal(cols, '담당자');
          const matchedCounselor = counselors.find(
            c => c.user_name && counselorName && c.user_name.trim() === counselorName.trim()
          );

          const payload: any = {
            client_name,
            name: client_name, 
            phone_encrypted,
            phone: phone_encrypted, 
            counselor_id: matchedCounselor ? matchedCounselor.user_id : undefined,
          };

          // 주민번호 분리
          const residentStr = getVal(cols, '주민번호');
          if (residentStr && residentStr.includes('-')) {
            const [bPart, rPart] = residentStr.split('-');
            payload.resident_id = rPart;
            if (bPart.length === 6 && rPart.length > 0) {
              const centuryCode = rPart.charAt(0);
              const century = ['3','4','7','8'].includes(centuryCode) ? '20' : '19';
              payload.birth_date = `${century}${bPart.substring(0, 2)}-${bPart.substring(2, 4)}-${bPart.substring(4, 6)}`;
            } else {
              payload.birth_date = bPart;
            }
          } else if (residentStr) {
            payload.birth_date = residentStr; 
          }

          // 나머지 항목 맵핑
          if (headers.includes('연령')) payload.age = parseSmallInt(getVal(cols, '연령'));
          if (headers.includes('성별')) payload.gender_code = getVal(cols, '성별') === '남' ? 'M' : (getVal(cols, '성별') === '여' ? 'F' : getVal(cols, '성별') || undefined);
          if (headers.includes('사업유형')) payload.business_type_code = parseSmallInt(getVal(cols, '사업유형'));
          if (headers.includes('참여유형')) payload.participation_type = getVal(cols, '참여유형') || undefined;
          if (headers.includes('참여단계')) payload.participation_stage = getVal(cols, '참여단계') || undefined;
          if (headers.includes('역량등급')) payload.capa = getVal(cols, '역량등급') || undefined;
          if (headers.includes('인정통지일')) payload.notificate_date = getVal(cols, '인정통지일') || undefined;
          if (headers.includes('희망직무')) payload.desired_job_1 = getVal(cols, '희망직무') || undefined;
          if (headers.includes('상담내역')) payload.memo = getVal(cols, '상담내역') || undefined;
          if (headers.includes('주소')) payload.address_1 = getVal(cols, '주소') || undefined;
          if (headers.includes('출신학교')) payload.school_name = getVal(cols, '출신학교') || undefined;
          if (headers.includes('전공')) payload.major = getVal(cols, '전공') || undefined;
          if (headers.includes('최종학력')) payload.education_level = getVal(cols, '최종학력') || undefined;
          
          if (headers.includes('IAP수립일')) payload.iap_to = getVal(cols, 'IAP수립일') || undefined;
          if (headers.includes('IAP운영기간')) payload.iap_todate = parseSmallInt(getVal(cols, 'IAP운영기간'));
          
          if (headers.includes('재진단날짜')) payload.retest_date = getVal(cols, '재진단날짜') || undefined;
          if (headers.includes('재진단여부')) payload.retest_stat = parseSmallInt(getVal(cols, '재진단여부'));
          
          if (headers.includes('일경험유형')) payload.work_ex_type = parseSmallInt(getVal(cols, '일경험유형'));
          if (headers.includes('참여의사')) payload.work_ex_desire = parseSmallInt(getVal(cols, '참여의사'));
          if (headers.includes('참여기업')) payload.work_ex_company = getVal(cols, '참여기업') || undefined;
          if (headers.includes('수료여부')) payload.work_ex_graduate = parseSmallInt(getVal(cols, '수료여부'));
          
          if (headers.includes('집중취업알선시작일')) payload.job_place_start = getVal(cols, '집중취업알선시작일') || undefined;
          if (headers.includes('집중취업알선종료일')) payload.job_place_end = getVal(cols, '집중취업알선종료일') || undefined;
          if (headers.includes('취업지원종료일')) payload.job_place_support_end = getVal(cols, '취업지원종료일') || undefined;
          
          if (headers.includes('취업구분')) payload.hire_type = getVal(cols, '취업구분') || undefined;
          if (headers.includes('취업일자')) payload.hire_date = getVal(cols, '취업일자') || undefined;
          if (headers.includes('취업처')) payload.hire_place = getVal(cols, '취업처') || undefined;
          if (headers.includes('취업직무')) payload.hire_job_type = getVal(cols, '취업직무') || undefined;
          if (headers.includes('급여')) payload.hire_payment = getVal(cols, '급여') || undefined;
          
          if (headers.includes('퇴사일')) payload.retirement_date = getVal(cols, '퇴사일') || undefined;
          
          if (headers.includes('1차(1개월)')) payload.continue_serv_1_date = getVal(cols, '1차(1개월)') || undefined;
          if (headers.includes('1차상태')) payload.continue_serv_1_stat = parseSmallInt(getVal(cols, '1차상태'));
          
          if (headers.includes('2차(6개월)')) payload.continue_serv_6_date = getVal(cols, '2차(6개월)') || undefined;
          if (headers.includes('2차상태')) payload.continue_serv_6_stat = parseSmallInt(getVal(cols, '2차상태'));
          
          if (headers.includes('3차(12개월)')) payload.continue_serv_12_date = getVal(cols, '3차(12개월)') || undefined;
          if (headers.includes('3차상태')) payload.continue_serv_12_stat = parseSmallInt(getVal(cols, '3차상태'));
          
          if (headers.includes('4차(18개월)')) payload.continue_serv_18_date = getVal(cols, '4차(18개월)') || undefined;
          if (headers.includes('4차상태')) payload.continue_serv_18_stat = parseSmallInt(getVal(cols, '4차상태'));

          try {
            await createClient(payload);
            successCount++;
          } catch (err) {
            console.error(`Failed to import client [${client_name}]:`, err);
            failCount++;
          }
        }

        if (failCount === 0) {
          toast.success(`${successCount}명의 상담자 데이터가 성공적으로 추가되었습니다.`);
        } else {
          toast.warning(`${successCount}명 성공, ${failCount}명 실패했습니다.`);
        }
        
        loadClients(); 
      } catch (err: any) {
        toast.error('CSV 처리 중 오류: ' + err.message);
      } finally {
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = ''; 
      }
    };

    reader.readAsArrayBuffer(file);
  };

  if (!canRender) return null;

  return (
    <div ref={topRef} className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">상담자 목록</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            전체 {clients.length}명 · 검색 결과 {filtered.length}명
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={loadClients} className="btn-cancel flex items-center gap-1.5" disabled={loading || importing}>
            <RefreshCw size={14} className={loading && !importing ? 'animate-spin' : ''} />
            새로고침
          </button>
          
          <input 
            type="file" 
            accept=".csv" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            style={{ display: 'none' }} 
          />
          
          <button onClick={handleImportClick} className="btn-primary flex items-center gap-1.5" disabled={importing || loading}>
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            CSV 추가하기
          </button>

          <button onClick={handleExportCSV} className="btn-primary flex items-center gap-1.5" disabled={loading || importing}>
            <Download size={14} />
            CSV 내보내기
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
            placeholder="이름, 연락처, 담당 상담사로 검색..."
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
              {branches.filter(b => b !== 'all').map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <select
            value={stageFilter}
            onChange={e => setStageFilter(e.target.value)}
            className="px-3 py-1.5 rounded-sm border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">전체 단계</option>
            {stages.filter(s => s !== 'all').map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-card rounded-md shadow-sm border border-border flex flex-col overflow-hidden">
        {loading && !importing ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
            <RefreshCw size={16} className="animate-spin" />
            데이터 로딩 중...
          </div>
        ) : (
          <>
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th 
                      className="text-left px-4 py-3 font-medium text-muted-foreground cursor-pointer hover:bg-muted/80 transition-colors"
                      onClick={() => handleSort('client_name')}
                    >
                      <div className="flex items-center gap-1.5">이름 / 인적사항 {renderSortIcon('client_name')}</div>
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">연락처</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">담당 상담사</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden xl:table-cell">지점</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">참여단계</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">사업 유형</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">취업구분</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedData.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                        {search || branchFilter !== 'all' || stageFilter !== 'all'
                          ? '검색 결과가 없습니다.'
                          : '등록된 상담자가 없습니다.'}
                      </td>
                    </tr>
                  ) : (
                    paginatedData.map((c, idx) => {
                      const displayName = c.client_name || c.name || '';
                      return (
                        <tr key={c.id || c.client_id || idx} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-7 h-7 rounded-sm flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                                style={{ background: PRIMARY_HEX }}
                              >
                                {displayName ? displayName.charAt(0) : ''}
                              </div>
                              <div>
                                <div className="font-medium text-foreground">{displayName}</div>
                                <div className="text-xs text-muted-foreground">
                                  {(c.gender_code || c.gender) && `${c.gender_code || c.gender}`}{c.age && `, ${c.age}세`}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{c.phone_encrypted || c.phone || '-'}</td>
                          <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">{c.counselor_name || '-'}</td>
                          <td className="px-4 py-3 text-muted-foreground hidden xl:table-cell">{c.branch || '-'}</td>
                          <td className="px-4 py-3">
                            {c.participation_stage
                              ? <span className={stageColors[c.participation_stage] || 'badge-active'}>{c.participation_stage}</span>
                              : <span className="text-muted-foreground">-</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{c.business_type_code || c.business_type || '-'}</td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            {c.hire_type
                              ? <span className="badge-completed">{c.hire_type}</span>
                              : <span className="text-muted-foreground text-xs">미취업</span>
                            }
                          </td>
                        </tr>
                      );
                    })
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
    </div>
  );
}