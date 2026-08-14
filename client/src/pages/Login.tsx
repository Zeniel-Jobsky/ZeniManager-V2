/**
 * Login Page
 * Design: 모던 웰니스 미니멀리즘
 * Features: Supabase 설정, 설정 초기화, 로그인
 *
 * SECURITY: No API keys are hardcoded. All credentials stored in localStorage via Settings.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { isAdminRole } from '@shared/const';
import { useAuth } from '@/contexts/AuthContext';
import { consumeAuthNotice } from '@/lib/authAccess';
import {
  Eye, EyeOff, Key, Globe, ChevronDown,
  CheckCircle2, AlertTriangle, Save, RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  STORAGE_KEYS,
  isSupabaseConfigured,
  resetStoredAppSettings,
  resetSupabaseClient,
  removeStoredAppSetting,
  setStoredAppSetting,
} from '@/lib/supabase';

const ZENIEL_LOGO_SRC = `${import.meta.env.BASE_URL}zeniel-logo.png`;

function ApiSettingsPanel({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState(() => localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) || '');
  const [anonKey, setAnonKey] = useState(() => localStorage.getItem(STORAGE_KEYS.SUPABASE_ANON_KEY) || '');
  const [showKey, setShowKey] = useState(false);

  const handleSave = async () => {
    if (url.trim()) await setStoredAppSetting(STORAGE_KEYS.SUPABASE_URL, url);
    else await removeStoredAppSetting(STORAGE_KEYS.SUPABASE_URL);

    if (anonKey.trim()) await setStoredAppSetting(STORAGE_KEYS.SUPABASE_ANON_KEY, anonKey);
    else await removeStoredAppSetting(STORAGE_KEYS.SUPABASE_ANON_KEY);

    resetSupabaseClient();
    toast.success('Supabase 설정이 저장되었습니다.');
    onClose();
  };

  const configured = isSupabaseConfigured();

  return (
    <div className="mt-3 space-y-3 rounded-sm border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-1.5 text-xs">
        {configured
          ? <><CheckCircle2 size={12} className="text-green-600" /><span className="text-green-700">Supabase 연결됨</span></>
          : <><AlertTriangle size={12} className="text-amber-500" /><span className="text-amber-700">Supabase 미설정</span></>
        }
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Supabase URL</label>
        <div className="relative">
          <Globe size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://xxxxxxxxxxxx.supabase.co"
            className="w-full rounded-sm border border-input bg-background py-2 pl-7 pr-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            autoComplete="off"
          />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">Project URL을 입력하세요.</p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">Supabase Anon Key</label>
        <div className="relative">
          <Key size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type={showKey ? 'text' : 'password'}
            value={anonKey}
            onChange={e => setAnonKey(e.target.value)}
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
            className="w-full rounded-sm border border-input bg-background py-2 pl-7 pr-8 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">Anon Key를 입력하세요.</p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          className="flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium text-white"
          style={{ background: '#009C64' }}
        >
          <Save size={11} />
          저장
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm border border-input px-3 py-1.5 text-xs transition-colors hover:bg-muted"
        >
          닫기
        </button>
      </div>
    </div>
  );
}

export default function Login() {
  const [, navigate] = useLocation();
  const { login, isLoading } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const notice = consumeAuthNotice();
    if (notice) {
      setError(notice);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('이메일과 비밀번호를 입력해주세요.');
      return;
    }
    setError('');

    const result = await login(email, password);
    if (result.success) {
      toast.success('로그인되었습니다.');
      navigate(isAdminRole(result.user?.role) ? '/admin/dashboard' : '/dashboard');
    } else {
      setError(result.error || '이메일 또는 비밀번호가 올바르지 않습니다.');
      setPassword(''); // Clear password on failure
    }
  };

  const handleResetSettings = async () => {
    await resetStoredAppSettings();
    setError('');
    setShowApiSettings(false);
    toast.success('로컬 설정이 초기화되었습니다.');
  };

  const configured = isSupabaseConfigured();

  return (
    <div className="flex min-h-screen items-center justify-center p-4" style={{ background: 'oklch(0.958 0.008 75)' }}>
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <img
            src={ZENIEL_LOGO_SRC}
            alt="ZENIEL"
            className="mx-auto mb-4 h-16 object-contain"
          />
          <h1 className="text-2xl font-bold text-foreground">상담 관리 시스템</h1>
          <p className="mt-1 text-sm text-muted-foreground">로그인하여 시스템에 접속하세요</p>
        </div>

        {/* Login Card */}
        <div className="rounded-md border border-border bg-card p-6 shadow-sm">
          <form onSubmit={handleLogin} className="space-y-4">
            {/* Email */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">이메일</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="이메일을 입력하세요"
                className="w-full rounded-sm border border-input bg-background px-3 py-2.5 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-ring"
                autoComplete="email"
              />
            </div>

            {/* Password */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">비밀번호</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="비밀번호를 입력하세요"
                  className="w-full rounded-sm border border-input bg-background px-3 py-2.5 pr-10 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-ring"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-sm bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* Login Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full py-2.5 disabled:opacity-60"
            >
              {isLoading ? '로그인 중...' : '로그인'}
            </button>
          </form>

          {/* Supabase Settings Toggle */}
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowApiSettings(!showApiSettings)}
                className="flex flex-1 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <Key size={14} />
                <span>Supabase 연결 설정</span>
                {configured && <CheckCircle2 size={12} className="text-green-600" />}
                <ChevronDown
                  size={14}
                  className="ml-auto transition-transform duration-200"
                  style={{ transform: showApiSettings ? 'rotate(180deg)' : 'rotate(0deg)' }}
                />
              </button>
              <button
                type="button"
                onClick={handleResetSettings}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-input px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <RotateCcw size={12} />
                설정 초기화
              </button>
            </div>

            {showApiSettings && (
              <ApiSettingsPanel onClose={() => setShowApiSettings(false)} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
