const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';

export function getToken() {
  return localStorage.getItem('token') || '';
}

export function setToken(t) {
  if (t) localStorage.setItem('token', t);
  else localStorage.removeItem('token');
}

async function parseJSON(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function api(path, { method = 'GET', body, token } = {}) {
  const isFormData = (typeof FormData !== 'undefined') && (body instanceof FormData);
  const headers = {};
  if (!isFormData) headers['Content-Type'] = 'application/json';
  const t = token ?? getToken();
  if (t) headers.Authorization = `Bearer ${t}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? (isFormData ? body : JSON.stringify(body)) : undefined
  });
  const data = await parseJSON(res);
  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// 파일 다운로드 (JSON/CSV 등)
export async function downloadFile(path, filename) {
  const t = getToken();
  const headers = {};
  if (t) headers.Authorization = `Bearer ${t}`;

  const res = await fetch(`${API_BASE}${path}`, { method: 'GET', headers });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      msg = data?.error || data?.message || msg;
    } catch {}
    throw new Error(msg);
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();

  window.URL.revokeObjectURL(url);
}

export { API_BASE };