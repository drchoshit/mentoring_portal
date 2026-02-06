import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.jsx';

function Item({ to, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          'inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition',
          'border',
          isActive
            ? 'bg-brand-800 text-white border-brand-800 shadow-sm'
            : 'bg-white/70 text-slate-700 border-slate-200 hover:bg-white hover:border-slate-300'
        ].join(' ')
      }
    >
      {children}
    </NavLink>
  );
}

export default function AppShell({ children }) {
  const { user, logout } = useAuth();

  const menu = [];
  if (user?.role !== 'parent') {
    menu.push({ to: '/', label: '피드' });
    menu.push({ to: '/students', label: '학생' });
    if (user?.role === 'director') menu.push({ to: '/settings', label: '설정' });
  } else {
    menu.push({ to: '/parent', label: '내 아이' });
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-gold-400/30 bg-white/70 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <Link
            to={user?.role === 'parent' ? '/parent' : '/'}
            className="font-semibold tracking-wide text-brand-800"
          >
            Mentoring Portal
          </Link>

          <div className="flex items-center gap-3 text-sm">
            <div className="text-slate-700">
              {user?.display_name} ({user?.role})
            </div>
            <button className="btn-ghost" onClick={logout}>
              로그아웃
            </button>
          </div>
        </div>

        <div className="border-t border-slate-200/60">
          <div className="mx-auto max-w-7xl px-4 py-2">
            <nav className="flex flex-wrap gap-2 overflow-x-auto">
              {menu.map((m) => (
                <Item key={m.to} to={m.to}>
                  {m.label}
                </Item>
              ))}
            </nav>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}