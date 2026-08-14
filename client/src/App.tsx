/**
 * App.tsx - 라우팅 및 레이아웃 설정
 * Design: 모던 웰니스 미니멀리즘
 * Primary: #009C64 | Background: #F0EEE9 | Font: Noto Sans KR
 */
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Redirect, Route, Router as WouterRouter, Switch } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { isAdminRole } from "@shared/const";
import { matchesAccessRequirement, type PageAccessRequirement } from "@/lib/authAccess";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import DashboardLayout from "./components/DashboardLayout";
import ErrorBoundary from "./components/ErrorBoundary";

// Pages
import Login from "./pages/Login";
import Settings from "./pages/Settings";
import CounselorDashboard from "./pages/counselor/Dashboard";
import ClientList from "./pages/counselor/ClientList";
import ClientRegister from "./pages/counselor/ClientRegister";
import AdminDashboard from "./pages/admin/AdminDashboard";
import CounselorList from "./pages/admin/CounselorList";
import AdminClientList from "./pages/admin/AdminClientList";
import ClientDetail from "./pages/counselor/ClientDetail";

function GuardedRoute({ component: Component, requirement = "authenticated" }: {
  component: React.ComponentType;
  requirement?: PageAccessRequirement;
}) {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Redirect to="/login" />;
  }

  if (!matchesAccessRequirement(user.role, requirement)) {
    return <Redirect to={isAdminRole(user.role) ? '/admin/dashboard' : '/dashboard'} />;
  }

  return (
    <ErrorBoundary>
      <DashboardLayout>
        <Component />
      </DashboardLayout>
    </ErrorBoundary>
  );
}

function AppRoutes() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <Switch>
      {/* Public */}
      <Route path="/login">
        {isAuthenticated
          ? <Redirect to={isAdminRole(user?.role) ? '/admin/dashboard' : '/dashboard'} />
          : <Login />
        }
      </Route>

      {/* Root redirect */}
      <Route path="/">
        {isAuthenticated
          ? <Redirect to={isAdminRole(user?.role) ? '/admin/dashboard' : '/dashboard'} />
          : <Redirect to="/login" />
        }
      </Route>

      {/* Counselor routes */}
      <Route path="/dashboard/search">
        <GuardedRoute component={CounselorDashboard} requirement="counselor" />
      </Route>
      <Route path="/dashboard/process">
        <GuardedRoute component={CounselorDashboard} requirement="counselor" />
      </Route>
      <Route path="/dashboard/calendar">
        <GuardedRoute component={CounselorDashboard} requirement="counselor" />
      </Route>
      <Route path="/dashboard/memo">
        <GuardedRoute component={CounselorDashboard} requirement="counselor" />
      </Route>
      <Route path="/dashboard">
        <GuardedRoute component={CounselorDashboard} requirement="counselor" />
      </Route>
      <Route path="/clients/detail/:id">
        <GuardedRoute component={ClientDetail} requirement="counselor" />
      </Route>
      <Route path="/clients/list">
        <GuardedRoute component={ClientList} requirement="counselor" />
      </Route>
      <Route path="/clients/detail/:id">
        <GuardedRoute component={ClientDetail} requirement="counselor" />
      </Route>
      <Route path="/clients/register">
        <GuardedRoute component={ClientRegister} requirement="counselor" />
      </Route>
      <Route path="/clients">
        <GuardedRoute component={ClientList} requirement="counselor" />
      </Route>

      {/* Admin routes */}
      <Route path="/admin/dashboard">
        <GuardedRoute component={AdminDashboard} requirement="admin" />
      </Route>
      <Route path="/admin/dashboard/:sub">
        <GuardedRoute component={AdminDashboard} requirement="admin" />
      </Route>
      <Route path="/admin/counselors">
        <GuardedRoute component={CounselorList} requirement="admin" />
      </Route>
      <Route path="/admin/clients">
        <GuardedRoute component={AdminClientList} requirement="admin" />
      </Route>

      {/* Settings */}
      <Route path="/settings">
        <GuardedRoute component={Settings} />
      </Route>

      {/* Fallback */}
      <Route>
        {isAuthenticated
          ? <Redirect to={isAdminRole(user?.role) ? '/admin/dashboard' : '/dashboard'} />
          : <Redirect to="/login" />
        }
      </Route>
    </Switch>
  );
}

function App() {
  const isPackagedElectron = typeof window !== "undefined" && window.location.protocol === "file:";

  return (
    <ThemeProvider defaultTheme="light">
      <AuthProvider>
        <WouterRouter hook={isPackagedElectron ? useHashLocation : undefined}>
          <TooltipProvider>
            <Toaster position="top-center" />
            <AppRoutes />
          </TooltipProvider>
        </WouterRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
