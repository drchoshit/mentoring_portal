import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.jsx';

const ROLE_LABEL = {
  director: '원장',
  lead: '총괄멘토',
  mentor: '클리닉 멘토',
  admin: '관리자',
  parent: '학부모'
};

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
  const role = String(user?.role || '').trim();

  const menu = [];
  if (role !== 'parent') {
    menu.push({ to: '/', label: '피드' });
    menu.push({ to: '/students', label: '학생' });
    menu.push({ to: '/assignment-status', label: '질답 배정현황' });
    if (['director', 'lead', 'admin'].includes(role)) {
      menu.push({ to: '/lead-assignment-board', label: '총괄멘토 배정표' });
    }
    if (role === 'director') menu.push({ to: '/settings', label: '설정' });
  } else {
    menu.push({ to: '/parent', label: '마이페이지' });
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-gold-400/30 bg-white/70 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <Link
            to={role === 'parent' ? '/parent' : '/'}
            className="font-semibold tracking-wide text-brand-800"
          >
            Mentoring Portal
          </Link>

          <div className="flex items-center gap-3 text-sm">
            <div className="text-slate-700">
              {user?.display_name} ({ROLE_LABEL[role] || role})
            </div>
            <button className="btn-ghost" onClick={logout}>
              로그아웃
            </button>
          </div>
        </div>

        <div className="border-t border-slate-200/60">
          <div className="mx-auto max-w-7xl px-4 py-2">
            <nav className="flex flex-wrap gap-2 overflow-x-auto">
              {menu.map((item) => (
                <Item key={item.to} to={item.to}>
                  {item.label}
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
