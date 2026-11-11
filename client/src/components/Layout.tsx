import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Icon, Logo } from './Icons';

// Primary navigation only lists features with a usable workflow. Training and
// Schedule are follow-on milestones and stay out of the nav until then.
const NAV = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/team', label: 'Team', icon: 'team' },
  { to: '/tactics', label: 'Tactics', icon: 'tactics' },
  { to: '/game', label: 'Game Mode', icon: 'game' },
];

export function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <Logo />
          <span>CS Trainer</span>
        </NavLink>
        {user ? (
          <div className="topbar-actions">
            <span className="topbar-user"><Icon name="user" /> {user.user_name}</span>
            <button type="button" className="btn ghost small" onClick={async () => { await signOut(); navigate('/'); }}>
              <Icon name="logout" /> Sign out
            </button>
          </div>
        ) : null}
      </header>
      {user ? (
        <nav className="sidebar" aria-label="Main">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <Icon name={item.icon} /> <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      ) : null}
      <main className={user ? 'content' : 'content full'}>
        <Outlet />
      </main>
    </div>
  );
}
