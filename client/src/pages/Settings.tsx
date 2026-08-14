/**
 * Settings Page
 * 
 * SECURITY: All API keys are stored ONLY in localStorage.
 * No keys are hardcoded, committed to git, or sent to any server.
 * This file is safe to publish on GitHub publicly.
 */
import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { isAdminRole, ROLE_ADMIN, ROLE_COUNSELOR } from '@shared/const';
import { useAuth } from '@/contexts/AuthContext';
import { usePageGuard } from '@/hooks/usePageGuard';
import {
  Key, Globe, LogOut, Save, Eye, EyeOff, User,
  ChevronLeft, Database, CheckCircle2, XCircle,
  AlertTriangle, RefreshCw, Cpu, Info, Copy, Check
} from 'lucide-react';
import { toast } from 'sonner';
import {
  STORAGE_KEYS,
  executeSupabaseRequest,
  getSupabaseClient,
  getSupabaseUrl, getSupabaseAnonKey,
  isSupabaseConfigured, removeStoredAppSetting, resetSupabaseClient, setStoredAppSetting,
} from '@/lib/supabase';

interface SecretField {
  storageKey: string;
  label: string;
  placeholder: string;
  hint: string;
  icon: React.ReactNode;
  isUrl?: boolean;
}

const FIELDS: SecretField[] = [
  {
    storageKey: STORAGE_KEYS.SUPABASE_URL,
    label: 'Supabase URL',
    placeholder: 'https://xxxxxxxxxxxx.supabase.co',
    hint: 'Supabase 대시보드 → Settings → API → Project URL',
    icon: <Globe size={14} />,
    isUrl: true,
  },
  {
    storageKey: STORAGE_KEYS.SUPABASE_ANON_KEY,
    label: 'Supabase Anon Key (공개 키)',
    placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    hint: 'Supabase 대시보드 → Settings → API → anon public',
    icon: <Key size={14} />,
  },
  {
    storageKey: STORAGE_KEYS.SUPABASE_SERVICE_ROLE_KEY,
    label: 'Supabase Service Role Key (관리자)',
    placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    hint: 'Electron 관리자 기능에만 사용됩니다. 로컬 기기에만 저장하세요.',
    icon: <Key size={14} />,
  },
  {
    storageKey: STORAGE_KEYS.OPENAI_API_KEY,
    label: 'OpenAI API Key (선택)',
    placeholder: 'sk-...',
    hint: 'platform.openai.com → API keys (AI 기능 사용 시 필요)',
    icon: <Cpu size={14} />,
  },
];

function SecretInput({ field }: { field: SecretField }) {
  const [value, setValue] = useState(() => localStorage.getItem(field.storageKey) || '');
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const trimmed = value.trim();
    if (trimmed) {
      await setStoredAppSetting(field.storageKey, trimmed);
    } else {
      await removeStoredAppSetting(field.storageKey);
    }
    resetSupabaseClient();
    setSaved(true);
    toast.success(`${field.label} 저장됨`);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClear = async () => {
    setValue('');
    await removeStoredAppSetting(field.storageKey);
    resetSupabaseClient();
    toast.info(`${field.label} 삭제됨`);
  };

  const isSet = !!localStorage.getItem(field.storageKey);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium flex items-center gap-1.5">
          {field.icon}
          {field.label}
        </label>
        {isSet ? (
          <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
            <CheckCircle2 size={12} /> 설정됨
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <XCircle size={12} /> 미설정
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder={field.placeholder}
            className="w-full pr-9 pl-3 py-2 rounded-sm border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <button
          onClick={handleSave}
          className="px-3 py-2 rounded-sm text-sm font-medium text-white flex items-center gap-1.5 transition-colors"
          style={{ background: saved ? '#16a34a' : '#009C64' }}
        >
          {saved ? <Check size={13} /> : <Save size={13} />}
          {saved ? '저장됨' : '저장'}
        </button>
        {isSet && (
          <button
            onClick={handleClear}
            className="px-3 py-2 rounded-sm text-sm border border-input hover:bg-muted transition-colors text-muted-foreground"
          >
            삭제
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <Info size={11} />
        {field.hint}
      </p>
    </div>
  );
}

function ConnectionStatus() {
  const [status, setStatus] = useState<'checking' | 'ok' | 'error' | 'unconfigured'>('checking');
  const [errorMsg, setErrorMsg] = useState('');

  const toFriendlyErrorMessage = (error: { code?: string; message?: string; details?: string }) => {
    if (error.message?.includes('세션이 만료되었거나 연결이 끊어졌습니다')) {
      return error.message;
    }
    if (error.message?.includes('초 안에 끝나지 않았습니다')) {
      return error.message;
    }
    if (error.code === '42P01') {
      return 'public.user 테이블을 찾을 수 없습니다. (실 DB 스키마가 public.user 기반인지 확인하세요)';
    }
    if (error.code === '42501') {
      return `권한 오류: ${error.message || 'public.user 조회 권한이 없습니다.'}`;
    }
    if (error.message?.includes('schema cache')) {
      return `연결은 되었지만 스키마 캐시가 갱신되지 않았습니다. Supabase 프로젝트 및 스키마 설정을 확인하세요.`;
    }
    return error.message || '연결 실패';
  };

  const check = async () => {
    setStatus('checking');
    setErrorMsg('');
    if (!isSupabaseConfigured()) {
      setStatus('unconfigured');
      return;
    }
    try {
      const sb = getSupabaseClient();
      if (!sb) { setStatus('unconfigured'); return; }
      const { error } = await executeSupabaseRequest(
        'Supabase 연결 상태 확인',
        sb.from('user').select('user_id').limit(1),
        { timeoutMs: 5000 },
      );
      if (error) {
        setStatus('error');
        setErrorMsg(toFriendlyErrorMessage(error));
      } else {
        setStatus('ok');
      }
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(toFriendlyErrorMessage(e) || '연결 실패');
    }
  };

  useEffect(() => { check(); }, []);

  return (
    <div className="flex items-center justify-between p-3 rounded-sm border border-border bg-muted/30">
      <div className="flex items-center gap-2">
        {status === 'checking' && <RefreshCw size={14} className="animate-spin text-muted-foreground" />}
        {status === 'ok' && <CheckCircle2 size={14} className="text-green-600" />}
        {status === 'error' && <XCircle size={14} className="text-destructive" />}
        {status === 'unconfigured' && <AlertTriangle size={14} className="text-yellow-500" />}
        <span className="text-sm">
          {status === 'checking' && '연결 확인 중...'}
          {status === 'ok' && 'Supabase 연결 정상'}
          {status === 'error' && `연결 실패: ${errorMsg}`}
          {status === 'unconfigured' && 'Supabase 미설정 (목업 데이터 사용 중)'}
        </span>
      </div>
      <button onClick={check} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
        <RefreshCw size={12} />
        재확인
      </button>
    </div>
  );
}

function SqlSchemaSection() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const sql = `-- public.user 조회 + 개인 memo 수정 권한
-- role: 관리자 = 4, 상담사 = 5

grant select on table public."user" to authenticated;
grant update (memo) on table public."user" to authenticated;
revoke all on table public."user" from anon;

create or replace function public.is_current_user_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public."user" u
    where u.user_id = auth.uid()
      and u.role = 4
  );
$$;

revoke all on function public.is_current_user_admin() from public;
grant execute on function public.is_current_user_admin() to authenticated;

alter table public."user" enable row level security;

drop policy if exists user_select_self_or_admin on public."user";
create policy user_select_self_or_admin
on public."user"
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_current_user_admin()
);

drop policy if exists user_update_own_memo_or_admin on public."user";
create policy user_update_own_memo_or_admin
on public."user"
for update
to authenticated
using (
  user_id = auth.uid()
  or public.is_current_user_admin()
)
with check (
  user_id = auth.uid()
  or public.is_current_user_admin()
);`;

    navigator.clipboard.writeText(sql).then(() => {
      setCopied(true);
      toast.success('SQL이 클립보드에 복사되었습니다.');
      setTimeout(() => setCopied(false), 3000);
    });
  };

  return (
    <div className="bg-card rounded-md p-5 shadow-sm border border-border space-y-3">
      <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Database size={15} />
        Supabase 권한 설정 안내
      </h2>
      <div className="text-sm text-muted-foreground space-y-1">
        <p>현재 앱은 좌측 nav/헤더 사용자 정보 조회와 상담사 개인 메모 저장을 위해 <code>public.user</code>의 select/update 권한이 필요합니다.</p>
        <ol className="list-decimal list-inside space-y-1 text-xs mt-2">
          <li><a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" className="text-primary underline">Supabase 대시보드</a> → 프로젝트 선택</li>
          <li>좌측 메뉴 <strong>SQL Editor</strong> 클릭</li>
          <li>아래 SQL을 실행해 <code>authenticated</code> 사용자의 <code>public.user</code> 조회/메모수정 정책을 적용</li>
          <li>상담사는 본인 행만 조회/수정하고, 관리자는 모든 행을 조회/수정할 수 있게 됩니다</li>
        </ol>
      </div>
      <button
        onClick={handleCopy}
        className="flex items-center gap-2 px-4 py-2 rounded-sm text-sm font-medium text-white transition-colors"
        style={{ background: copied ? '#16a34a' : '#009C64' }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? 'SQL 복사됨!' : 'user 조회/메모 RLS SQL 복사'}
      </button>
    </div>
  );
}

export default function Settings() {
  const [, navigate] = useLocation();
  const { canRender } = usePageGuard('authenticated');
  const { user, logout } = useAuth();
  const isAdmin = isAdminRole(user?.role);
  const organizationLabel = user?.department || user?.branch;

  const handleLogout = () => {
    logout();
    toast.success('로그아웃되었습니다.');
    navigate('/login');
  };

  if (!canRender) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1 as any)}
          className="p-1.5 rounded-sm hover:bg-muted transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-foreground">설정</h1>
          <p className="text-sm text-muted-foreground mt-0.5">API 연결 및 계정 관리</p>
        </div>
      </div>

      {/* Security Notice */}
      <div className="flex items-start gap-2.5 p-3.5 rounded-sm border border-amber-200 bg-amber-50 text-amber-800 text-xs">
        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
        <div>
          <strong>보안 안내:</strong> 모든 API 키는 이 기기의 브라우저 localStorage에만 저장됩니다.
          서버로 전송되지 않으며, 코드에 포함되지 않아 GitHub 공개 저장소에 안전하게 배포할 수 있습니다.
        </div>
      </div>

      {/* Profile */}
      <div className="bg-card rounded-md p-5 shadow-sm border border-border space-y-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <User size={15} />
          계정 정보
        </h2>
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-sm flex items-center justify-center text-white text-lg font-bold"
            style={{ background: '#009C64' }}
          >
            {user?.name?.charAt(0) || 'U'}
          </div>
          <div>
            <div className="font-semibold text-foreground">{user?.name}</div>
            <div className="text-sm text-muted-foreground">{user?.email}</div>
            <div className="flex items-center gap-2 mt-1">
              <span className={isAdminRole(user?.role) ? 'badge-pending' : 'badge-active'}>
                {isAdminRole(user?.role) ? '관리자' : '상담사'}
              </span>
              {organizationLabel && (
                <span className="text-xs text-muted-foreground">{organizationLabel}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Connection Status */}
      <div className="bg-card rounded-md p-5 shadow-sm border border-border space-y-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Database size={15} />
          연결 상태
        </h2>
        <ConnectionStatus />
      </div>

      {/* API Keys */}
      <div className="bg-card rounded-md p-5 shadow-sm border border-border space-y-5">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Key size={15} />
          API 키 설정
          <span className="ml-auto text-xs font-normal text-muted-foreground">localStorage에만 저장됨</span>
        </h2>
        {FIELDS.filter(field => isAdmin || field.storageKey !== STORAGE_KEYS.SUPABASE_SERVICE_ROLE_KEY).map(field => (
          <SecretInput key={field.storageKey} field={field} />
        ))}
      </div>

      {/* Schema Setup Guide */}
      <SqlSchemaSection />

      {/* Logout */}
      <div className="bg-card rounded-md p-5 shadow-sm border border-border">
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <LogOut size={15} />
          계정 관리
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          로그아웃하면 현재 세션이 종료됩니다. API 키 설정은 유지됩니다.
        </p>
        <button onClick={handleLogout} className="btn-destructive">
          <LogOut size={14} className="mr-1.5" />
          로그아웃
        </button>
      </div>
    </div>
  );
}
