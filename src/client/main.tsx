import { createRoot } from 'react-dom/client';
import { Link, Navigate, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { AppLayout, PublicLayout } from './components/Layout.js';
import { ToastProvider } from './components/Toasts.js';
import { PageHeader, usePageTitle } from './components/ui.js';
import { InvitePage } from './pages/InvitePage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { LoginPage, ResetPage, SignupPage } from './pages/AuthPages.js';
import { DashboardPage } from './pages/Dashboard.js';
import { GroupBillPage, SettleUpPage, GroupBillViewPage } from './pages/GroupBillPages.js';
import { GroupPage } from './pages/GroupPage.js';
import { ChooseGroupPage, EditGroupPage, GroupsPage, JoinPage, NewGroupPage } from './pages/GroupsPages.js';
import { SoloBillPage, SoloListPage, SoloBillViewPage } from './pages/SoloPages.js';
import { SessionProvider } from './session.js';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/public-sans';
import './styles.css';

function NotFoundPage() {
  usePageTitle('Page not found');
  return (
    <>
      <PageHeader title="Page not found" />
      <p>
        That page doesn't exist. <Link to="/">Go to the Dashboard</Link>
      </p>
    </>
  );
}

const router = createBrowserRouter([
  // Works logged in or out, so it sits outside both frames.
  { path: '/invite/:code', element: <InvitePage /> },
  {
    element: <PublicLayout />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignupPage /> },
      { path: '/reset', element: <ResetPage /> },
    ],
  },
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/solo', element: <SoloListPage /> },
      { path: '/solo/new', element: <SoloBillPage /> },
      { path: '/solo/:id', element: <SoloBillViewPage /> },
      { path: '/solo/:id/edit', element: <SoloBillPage /> },
      { path: '/groups', element: <GroupsPage /> },
      { path: '/groups/new', element: <NewGroupPage /> },
      { path: '/groups/:groupId', element: <GroupPage /> },
      { path: '/groups/:groupId/edit', element: <EditGroupPage /> },
      { path: '/groups/:groupId/bills/new', element: <GroupBillPage /> },
      { path: '/groups/:groupId/bills/:billId', element: <GroupBillViewPage /> },
      { path: '/groups/:groupId/bills/:billId/edit', element: <GroupBillPage /> },
      { path: '/groups/:groupId/settle-ups/new', element: <SettleUpPage /> },
      { path: '/groups/:groupId/settle-ups/:settleId', element: <SettleUpPage /> },
      { path: '/group-bill/new', element: <ChooseGroupPage /> },
      { path: '/join', element: <JoinPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/account', element: <Navigate to="/settings" replace /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

createRoot(document.getElementById('root') as HTMLElement).render(
  <SessionProvider>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </SessionProvider>,
);
