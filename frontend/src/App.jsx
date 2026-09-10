import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import { FinanceProvider, useFinance } from "./context/FinanceContext.jsx";
import AppShell from "./components/layout/AppShell.jsx";
import { Skeleton } from "./components/ui";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Overview from "./pages/Overview.jsx";
import Accounts from "./pages/Accounts.jsx";
import Cashflow from "./pages/Cashflow.jsx";
import Goals from "./pages/Goals.jsx";
import Forecast from "./pages/Forecast.jsx";
import CalendarPage from "./pages/CalendarPage.jsx";
import Assistant from "./pages/Assistant.jsx";

// Skeletons rather than a "Loading…" line: the shell is already on screen, so
// the wait should look like the page arriving, not like a different screen.
function PageSkeleton() {
  return (
    <main className="page">
      <Skeleton width="220px" height={26} />
      <div className="grid grid--stats">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={104} radius="var(--r-lg)" />
        ))}
      </div>
      <Skeleton height={320} radius="var(--r-lg)" />
    </main>
  );
}

// Holds the shell steady while the first payload lands, so navigation never
// jumps between a bare loader and the full layout.
function FinanceGate({ children }) {
  const { loading } = useFinance();
  return loading ? <PageSkeleton /> : children;
}

// Gate that redirects unauthenticated users to /login.
function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="centered">Loading…</div>;
  return user ? children : <Navigate to="/login" replace />;
}

// Everything behind the login wall shares one data provider and one shell.
function AuthedApp() {
  return (
    <FinanceProvider>
      <AppShell>
        <FinanceGate>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/cashflow" element={<Cashflow />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/forecast" element={<Forecast />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/assistant" element={<Assistant />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </FinanceGate>
      </AppShell>
    </FinanceProvider>
  );
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/register"
        element={user ? <Navigate to="/" replace /> : <Register />}
      />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <AuthedApp />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
