import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.jsx';
import FloatingChat from './FloatingChat.jsx';

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
          'inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-semibold transition',
          isActive
            ? 'bg-[#e3efff] text-[#3970c9]'
            : 'text-zinc-500 hover:bg-[#eff6ff] hover:text-[#5b8def]'
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
    menu.push({ to: '/', label: role === 'lead' ? '오늘 멘토링' : '피드' });
    menu.push({ to: '/students', label: '학생' });
    if (['director', 'lead', 'admin'].includes(role)) {
      menu.push({ to: '/wrong-answer-assignment', label: '오답 배정' });
    }
    menu.push({ to: '/assignment-status', label: '질답 배정현황' });
    if (['director', 'admin'].includes(role)) {
      menu.push({ to: '/lead-mentoring-status', label: '총괄멘토링 현황' });
      menu.push({ to: '/question-completion-status', label: '질답 완료 현황' });
    }
    if (['director', 'lead', 'admin'].includes(role)) {
      menu.push({ to: '/lead-assignment-board', label: '총괄멘토 배정표' });
    }
    if (role === 'director') menu.push({ to: '/settings', label: '설정' });
  } else {
    menu.push({ to: '/parent', label: '마이페이지' });
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 bg-white/90 shadow-[0_1px_12px_rgba(51,79,118,0.05)] backdrop-blur-xl">
        <div className="app-shell-container flex items-center justify-between py-3.5">
          <Link
            to={role === 'parent' ? '/parent' : '/'}
            className="flex items-center gap-2 text-lg font-black tracking-tight text-[#1d2b43]"
          >
            <span>Mentoring <span className="text-[#5b8def]">Portal</span></span>
          </Link>

          <div className="flex items-center gap-3 text-sm">
            <div className="text-slate-700">
              {user?.display_name} ({ROLE_LABEL[role] || role})
            </div>
            <button className="btn-ghost !border-0" onClick={logout}>
              로그아웃
            </button>
          </div>
        </div>

        <div className="bg-[#f8fbff]/90">
          <div className="app-shell-container">
            <nav className="flex flex-wrap gap-5 overflow-x-auto">
              {menu.map((item) => (
                <Item key={item.to} to={item.to}>
                  {item.label}
                </Item>
              ))}
            </nav>
          </div>
        </div>
      </header>

      <main className="app-shell-container py-6">
        {children}
      </main>
      {role !== 'parent' ? <FloatingChat /> : null}
    </div>
  );
}
