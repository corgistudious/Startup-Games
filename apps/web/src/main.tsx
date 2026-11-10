import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { useSession } from './lib/store';
import { Shell } from './components/Shell';
import { Toaster, Loading } from './components/ui';
import { ApiError } from './lib/api';
import Landing from './pages/Landing';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Companies = lazy(() => import('./pages/Companies'));
const CompanyDetail = lazy(() => import('./pages/CompanyDetail'));
const Market = lazy(() => import('./pages/Market'));
const Bank = lazy(() => import('./pages/Bank'));
const Exchange = lazy(() => import('./pages/Exchange'));
const Symbol = lazy(() => import('./pages/Symbol'));
const LibraryPage = lazy(() => import('./pages/Library'));
const LibraryProfile = lazy(() => import('./pages/LibraryProfile'));
const Reviewer = lazy(() => import('./pages/Reviewer'));
const Inbox = lazy(() => import('./pages/Inbox'));
const Support = lazy(() => import('./pages/Support'));
const Leaderboard = lazy(() => import('./pages/Leaderboard'));
const Profile = lazy(() => import('./pages/Profile'));
const Admin = lazy(() => import('./pages/Admin'));

const qc = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2 },
  },
});

function App() {
  const token = useSession((s) => s.token);
  if (!token)
    return (
      <Routes>
        <Route path="/library/:slug" element={<Suspense fallback={<Loading />}><div className="mx-auto max-w-5xl p-4"><LibraryProfile /></div></Suspense>} />
        <Route path="*" element={<Landing />} />
      </Routes>
    );
  return (
    <Routes>
      <Route element={<Shell />}>
        {[
          ['/', <Dashboard />],
          ['/companies', <Companies />],
          ['/companies/:id', <CompanyDetail />],
          ['/market', <Market />],
          ['/bank', <Bank />],
          ['/exchange', <Exchange />],
          ['/exchange/:symbol', <Symbol />],
          ['/library', <LibraryPage />],
          ['/library/:slug', <LibraryProfile />],
          ['/reviewer', <Reviewer />],
          ['/inbox', <Inbox />],
          ['/support', <Support />],
          ['/leaderboard', <Leaderboard />],
          ['/profile', <Profile />],
          ['/admin', <Admin />],
        ].map(([path, el]) => (
          <Route key={path as string} path={path as string} element={<Suspense fallback={<Loading rows={4} />}>{el}</Suspense>} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
