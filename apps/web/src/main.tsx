// Point d'entrée du front : routes de l'application et client de requêtes (TanStack Query).
import 'katex/dist/katex.min.css';
import './index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { CoursePage } from './pages/course/CoursePage';
import { Dashboard } from './pages/Dashboard';
import { DocumentPage } from './pages/document/DocumentPage';
import { QuizPlayer } from './pages/quiz/QuizPlayer';
import { ReportView } from './pages/ReportView';
import { SessionPlayer } from './pages/session/SessionPlayer';
import { StatsPage } from './pages/stats/StatsPage';
import { UnitEditor } from './pages/editor/UnitEditor';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 } },
});

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/courses/:courseId', element: <CoursePage /> },
      { path: '/courses/:courseId/documents/:documentId', element: <DocumentPage /> },
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
