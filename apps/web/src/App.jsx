import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider.jsx';
import Guard from './components/Guard.jsx';
import AppShell from './components/AppShell.jsx';

import Login from './pages/Login.jsx';
import Feeds from './pages/Feeds.jsx';
import Students from './pages/Students.jsx';
import Mentoring from './pages/Mentoring.jsx';
import Settings from './pages/Settings.jsx';
import Parent from './pages/Parent.jsx';
import ParentHome from './pages/ParentHome.jsx';
import ParentLegacy from './pages/ParentLegacy.jsx';

function Shell({ children }) {
  return <AppShell>{children}</AppShell>;
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
            <Shell><ParentHome /></Shell>
          </Guard>
        }
      />
      <Route
        path="/parent/renewal"
        element={
          <Guard roles={['parent']}>
            <Shell><Parent /></Shell>
          </Guard>
        }
      />
      <Route
        path="/parent/legacy"
        element={
          <Guard roles={['parent']}>
            <Shell><ParentLegacy /></Shell>
          </Guard>
        }
      />

      <Route
        path="/"
        element={
          <Guard>
            <Shell>{user?.role === 'parent' ? <Navigate to="/parent" replace /> : <Feeds />}</Shell>
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
