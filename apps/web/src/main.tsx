import 'katex/dist/katex.min.css';
import './index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { CoursePage } from './pages/CoursePage';
import { Dashboard } from './pages/Dashboard';
import { QuizPlayer } from './pages/QuizPlayer';
import { ReportView } from './pages/ReportView';
import { SessionPlayer } from './pages/SessionPlayer';
import { StatsPage } from './pages/StatsPage';
import { UnitEditor } from './pages/UnitEditor';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 } },
});

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/courses/:courseId', element: <CoursePage /> },
      { path: '/units/:unitId/edit', element: <UnitEditor /> },
      { path: '/sessions/:sessionId', element: <SessionPlayer /> },
      { path: '/reports/:reportId', element: <ReportView /> },
      { path: '/quizzes/:quizId', element: <QuizPlayer /> },
      { path: '/stats', element: <StatsPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
