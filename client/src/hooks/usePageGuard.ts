import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import {
  matchesAccessRequirement,
  persistAuthNotice,
  type PageAccessRequirement,
} from '@/lib/authAccess';

export function usePageGuard(
  requirement: PageAccessRequirement = 'authenticated',
) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [location, navigate] = useLocation();

  const canRender = !!user
    && isAuthenticated
    && matchesAccessRequirement(user.role, requirement);

  useEffect(() => {
    if (isLoading) return;

    if (!user || !isAuthenticated) {
      persistAuthNotice('로그인이 필요합니다.');
      if (location !== '/login') {
        navigate('/login');
      }
      return;
    }

    if (!matchesAccessRequirement(user.role, requirement)) {
      persistAuthNotice('접근 권한이 없어 로그인 페이지로 이동했습니다.');
      if (location !== '/login') {
        navigate('/login');
      }
    }
  }, [isAuthenticated, isLoading, location, navigate, requirement, user]);

  return {
    canRender,
    isLoading,
    user,
  };
}
