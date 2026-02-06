import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from '../api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [token, setTok] = useState(getToken());
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const t = getToken();
    if (!t) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api('/api/auth/me', { token: t });
      setUser(me.user);
    } catch {
      setToken('');
      setTok('');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(username, password) {
    const r = await api('/api/auth/login', { method: 'POST', body: { username, password }, token: '' });
    setToken(r.token);
    setTok(r.token);
    setUser(r.user);
    return r.user;
  }

  function logout() {
    setToken('');
    setTok('');
    setUser(null);
  }

  const value = useMemo(() => ({ token, user, loading, login, logout, refresh }), [token, user, loading]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}
