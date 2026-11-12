import { createBrowserRouter, Navigate, RouterProvider, useLocation, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { HomePage } from './pages/Home';
import { SignInPage, SignUpPage } from './pages/Auth';
import { TeamPage } from './pages/Team';
import { InvitePage } from './pages/Invite';
import { TacticsPage } from './pages/Tactics';
import { TacticViewPage } from './pages/TacticView';
import { TacticEditorPage } from './pages/TacticEditor';
import { GameModePage } from './pages/GameMode';
import { NotFoundPage } from './pages/NotFound';
import { ProfilePage } from './pages/Profile';
import { PlayerProfilePage } from './pages/PlayerProfile';
import { InvitesPage } from './pages/Invites';
import { RecruitingPage, RecruitingTeamPage } from './pages/Recruiting';
import { TrainingPage } from './pages/Training';
import { SettingsPage } from './pages/Settings';

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/signin?next=${next}`} replace />;
  }
  return <Outlet />;
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/signin', element: <SignInPage /> },
      { path: '/signup', element: <SignUpPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/team', element: <TeamPage /> },
          { path: '/invite/:token', element: <InvitePage /> },
          { path: '/tactics', element: <TacticsPage /> },
          { path: '/tactics/new', element: <TacticEditorPage /> },
          { path: '/tactics/:tacticId', element: <TacticViewPage /> },
          { path: '/tactics/:tacticId/edit', element: <TacticEditorPage /> },
          { path: '/game', element: <GameModePage /> },
          { path: '/profile', element: <ProfilePage /> },
          { path: '/players/:userId', element: <PlayerProfilePage /> },
          { path: '/invites', element: <InvitesPage /> },
          { path: '/recruiting', element: <RecruitingPage /> },
          { path: '/recruiting/:teamId', element: <RecruitingTeamPage /> },
          { path: '/training', element: <TrainingPage /> },
          { path: '/settings', element: <SettingsPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
