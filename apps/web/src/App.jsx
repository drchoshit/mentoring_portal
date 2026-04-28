import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider.jsx';
import Guard from './components/Guard.jsx';
import AppShell from './components/AppShell.jsx';

import Login from './pages/Login.jsx';
import Feeds from './pages/Feeds.jsx';
import Students from './pages/Students.jsx';
import Mentoring from './pages/Mentoring.jsx';
import AssignmentStatus from './pages/AssignmentStatus.jsx';
import LeadAssignmentBoard from './pages/LeadAssignmentBoard.jsx';
import Settings from './pages/Settings.jsx';
import Parent from './pages/Parent.jsx';

function Shell({ children }) {
  return <AppShell>{children}</AppShell>;
}

function HomeEntry({ user }) {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search || '');
  const openPage = String(searchParams.get('openPage') || '').trim();
  const canOpenAssignmentStatus = ['director', 'lead', 'mentor', 'admin'].includes(String(user?.role || '').trim());

  if (user?.role === 'parent') return <Navigate to="/parent" replace />;
  if (openPage === 'assignment-status' && canOpenAssignmentStatus) return <AssignmentStatus />;
  return <Feeds />;
}

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/parent"
        element={
          <Guard roles={['parent']}>
            <Shell><Parent /></Shell>
          </Guard>
        }
      />
      <Route
        path="/parent/renewal"
        element={
          <Guard roles={['parent']}>
            <Navigate to="/parent" replace />
          </Guard>
        }
      />
      <Route
        path="/"
        element={
          <Guard>
            <Shell><HomeEntry user={user} /></Shell>
          </Guard>
        }
      />

      <Route
        path="/students"
        element={
          <Guard roles={['director','lead','mentor','admin']}>
            <Shell><Students /></Shell>
          </Guard>
        }
      />

      <Route
        path="/students/:studentId/mentoring"
        element={
          <Guard roles={['director','lead','mentor','admin']}>
            <Shell><Mentoring /></Shell>
          </Guard>
        }
      />

      <Route
        path="/assignment-status"
        element={
          <Guard roles={['director','lead','mentor','admin']}>
            <Shell><AssignmentStatus /></Shell>
          </Guard>
        }
      />

      <Route
        path="/lead-assignment-board"
        element={
          <Guard roles={['director','lead','admin']}>
            <Shell><LeadAssignmentBoard /></Shell>
          </Guard>
        }
      />

      <Route
        path="/settings"
        element={
          <Guard roles={['director']}>
            <Shell><Settings /></Shell>
          </Guard>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
