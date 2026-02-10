import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.jsx';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user = await login(username.trim(), password);
      nav(user.role === 'parent' ? '/parent' : '/');
    } catch (err) {
      setError(err.message || '로그인 실패');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md card p-6">
        <div className="text-brand-800 font-semibold tracking-wide">Mentoring Portal</div>
        <div className="mt-1 text-sm text-slate-600">아이디/비밀번호로 로그인</div>

        <form className="mt-6 space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="text-xs text-slate-600">아이디</label>
            <input className="input mt-1" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-slate-600">비밀번호</label>
            <input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          <button disabled={busy} className="btn-primary w-full">{busy ? '로그인 중...' : '로그인'}</button>
        </form>

        <div className="mt-6 text-xs text-slate-500">
        </div>
      </div>
    </div>
  );
}
