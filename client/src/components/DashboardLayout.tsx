/**
 * DashboardLayout - 고정 사이드바 + 상단 헤더 레이아웃
 * Design: 모던 웰니스 미니멀리즘
 * Primary: #009C64 | Background: #F0EEE9
 */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { isAdminRole } from '@shared/const';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard,
  Users,
  Settings,
  LogOut,
  ChevronDown,
  ChevronRight,
  Menu,
  X,
  Building2,
  UserCog,
  Bell,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { toast } from 'sonner';

const ZENIEL_LOGO_SRC = `${import.meta.env.BASE_URL}zeniel-logo.png`;

interface NavItem {
  label: string;
  path?: string;
  icon: React.ReactNode;
  children?: NavItem[];
}

function hasMatchingPath(item: NavItem, location: string): boolean {
  if (item.path === location) return true;
  if (!item.children) return false;
  return item.children.some(child => hasMatchingPath(child, location));
}

const counselorNav: NavItem[] = [
  {
    label: '업무 대시보드',
    icon: <LayoutDashboard size={17} />,
    children: [
      { label: '상담자 목록 열기', path: '/clients/list', icon: <ChevronRight size={14} /> },
      { label: '상담자 검색', path: '/dashboard/search', icon: <ChevronRight size={14} /> },
      { label: '프로세스 현황', path: '/dashboard/process', icon: <ChevronRight size={14} /> },
      { label: '캘린더', path: '/dashboard/calendar', icon: <ChevronRight size={14} /> },
      { label: '메모장', path: '/dashboard/memo', icon: <ChevronRight size={14} /> },
    ],
  },
];

const adminNav: NavItem[] = [
  {
    label: '사업 대시보드',
    icon: <Building2 size={17} />,
    path: '/admin/dashboard',
  },
  {
    label: '상담사 목록',
    path: '/admin/counselors',
    icon: <UserCog size={17} />,
  },
  {
    label: '상담자 목록',
    path: '/admin/clients',
    icon: <Users size={17} />,
  },
];

function NavGroup({ item, depth = 0 }: { item: NavItem; depth?: number }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(() => {
    if (!item.children) return false;
    return item.children.some(child => hasMatchingPath(child, location));
  });

  const isActive = item.path === location;
  const hasChildren = item.children && item.children.length > 0;
  const hasActiveChild = Boolean(hasChildren && item.children?.some(child => hasMatchingPath(child, location)));

  useEffect(() => {
    if (!hasChildren) return;
    setOpen(hasActiveChild);
  }, [hasChildren, hasActiveChild]);

  if (!hasChildren && item.path) {
    return (
      <Link href={item.path}>
        <div className={`sidebar-item ${isActive ? 'sidebar-item-active' : ''}`} style={{ paddingLeft: `${16 + depth * 16}px` }}>
          <span className="flex-shrink-0 opacity-70">{item.icon}</span>
          <span>{item.label}</span>
        </div>
      </Link>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={`sidebar-item w-full ${hasActiveChild ? 'sidebar-item-active' : ''}`}
        style={{ paddingLeft: `${16 + depth * 16}px` }}
      >
        <span className="flex-shrink-0 opacity-70">{item.icon}</span>
        <span className="flex-1 text-left">{item.label}</span>
        <span className="transition-transform duration-200" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          <ChevronRight size={14} />
        </span>
      </button>
      {open && item.children && (
        <div className="mt-0.5">
          {item.children.map((child, i) => (
            <NavGroup key={i} item={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const isAdmin = isAdminRole(user?.role);
  const navItems = isAdmin ? adminNav : counselorNav;
  const roleLabel = isAdmin ? '관리자' : '상담사';
  const organizationLabel = user?.department || user?.branch;

  const handleLogout = () => {
    logout();
    toast.success('로그아웃되었습니다.');
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'oklch(0.958 0.008 75)' }}>
      {/* Sidebar */}
      <aside
        className="flex flex-col flex-shrink-0 bg-card border-r border-border transition-all duration-200 overflow-hidden"
        style={{ width: sidebarOpen ? '240px' : '0px', minWidth: sidebarOpen ? '240px' : '0px' }}
      >
        {/* Logo */}
        <div className="flex items-center justify-center px-4 py-3 border-b border-border">
          <img
            src={ZENIEL_LOGO_SRC}
            alt="ZENIEL"
            className="h-12 object-contain"
          />
        </div>

        {/* Role & Affiliation badge */}
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <div className="flex flex-col gap-1.5">
            <span className={`w-fit px-2 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wider ${isAdmin ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
              {roleLabel}
            </span>
            {organizationLabel && (
              <div className="flex items-center gap-1 text-xs font-medium text-foreground">
                <Building2 size={12} className="text-muted-foreground" />
                <span>{organizationLabel}</span>
              </div>
            )}
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2">
          {navItems.map((item, i) => (
            <NavGroup key={i} item={item} />
          ))}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between px-5 py-3 bg-card border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-sm hover:bg-muted transition-colors"
            >
              {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            {!sidebarOpen && (
              <img
                src={ZENIEL_LOGO_SRC}
                alt="ZENIEL"
                className="h-9 object-contain"
              />
            )}
            <div className="text-sm text-muted-foreground hidden sm:block">
              {roleLabel} 포털
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="p-1.5 rounded-sm hover:bg-muted transition-colors relative">
              <Bell size={18} />
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full" style={{ background: 'oklch(0.577 0.245 27.325)' }}></span>
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-muted transition-colors">
                  <Avatar className="w-7 h-7">
                    <AvatarFallback className="text-xs font-medium text-white" style={{ background: 'oklch(0.588 0.152 162.5)' }}>
                      {user?.name?.charAt(0) || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium hidden sm:block">{user?.name}</span>
                  <ChevronDown size={14} className="text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-3 py-2">
                  <div className="text-sm font-medium">{user?.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {organizationLabel ? `${roleLabel} · ${organizationLabel}` : roleLabel}
                  </div>
                  <div className="text-xs text-muted-foreground">{user?.email}</div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <Settings size={14} className="mr-2" />
                    설정
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive">
                  <LogOut size={14} className="mr-2" />
                  로그아웃
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-5 page-enter">
          {children}
        </main>
      </div>
    </div>
  );
}
