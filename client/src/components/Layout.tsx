import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Icon, Logo } from './Icons';
import { NotificationBell } from './NotificationBell';

// Primary navigation lists features with a usable workflow. Settings sits at
// the bottom of the sidebar; Game Mode has a red accent.
const NAV = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/team', label: 'Team', icon: 'team' },
  { to: '/recruiting', label: 'Recruiting', icon: 'search' },
  { to: '/tactics', label: 'Tactics', icon: 'tactics' },
  { to: '/training', label: 'Training', icon: 'calendar' },
  { to: '/game', label: 'Game Mode', icon: 'game', className: 'nav-game' },
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
            <NotificationBell />
            <NavLink to="/profile" className="topbar-user"><Icon name="user" /> {user.user_name}</NavLink>
            <button type="button" className="btn ghost small" onClick={async () => { await signOut(); navigate('/'); }}>
              <Icon name="logout" /> Sign out
            </button>
          </div>
        ) : null}
      </header>
      {user ? (
        <nav className="sidebar" aria-label="Main">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={({ isActive }) => `nav-item ${item.className ?? ''}${isActive ? ' active' : ''}`}>
              <Icon name={item.icon} /> <span>{item.label}</span>
            </NavLink>
          ))}
          <div className="nav-spacer" />
          <NavLink to="/settings" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <Icon name="settings" /> <span>Settings</span>
          </NavLink>
        </nav>
      ) : null}
      <main className={user ? 'content' : 'content full'}>
        <Outlet />
      </main>
    </div>
  );
}
