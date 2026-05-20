import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

async function readJsonResponse(response, fallbackMessage) {
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 300) };
    }
  }
  if (!response.ok) {
    const requestSuffix = data.requestId ? ` (Fehler-ID: ${data.requestId})` : '';
    throw new Error(`${data.error || fallbackMessage}${requestSuffix}`);
  }
  return data;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [setupRequired, setSetupRequired] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  useEffect(() => { init(); }, []);

  async function init() {
    try {
      const r = await fetch('/api/auth/status', { credentials: 'same-origin' });
      const d = await readJsonResponse(r, 'Auth-Status konnte nicht geladen werden');
      setSetupRequired(d.setupRequired);
      setAuthError('');
    } catch (e) {
      setAuthError(e.message);
    }

    const legacyToken = localStorage.getItem('token');
    const stored = localStorage.getItem('user');
    if (stored) {
      try { setUser(JSON.parse(stored)); } catch {}
    }

    try {
      const r = await fetch('/api/auth/me', {
        credentials: 'same-origin',
        headers: legacyToken ? { Authorization: `Bearer ${legacyToken}` } : {},
      });
      if (r.ok) {
        const d = await readJsonResponse(r, 'Benutzer konnte nicht geladen werden');
        setUser(d.user);
        if (legacyToken) setToken(legacyToken);
        localStorage.setItem('user', JSON.stringify(d.user));
      } else if (r.status === 401) {
        localStorage.removeItem('user');
        setUser(null);
      }
      localStorage.removeItem('token');
    } catch (e) {
      setAuthError(e.message);
    }

    setLoading(false);
  }

  async function refreshUser() {
    try {
      const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (r.ok) {
        const d = await readJsonResponse(r, 'Benutzer konnte nicht aktualisiert werden');
        setUser(d.user);
        localStorage.setItem('user', JSON.stringify(d.user));
      } else if (r.status === 401) {
        logout();
      }
    } catch (e) {
      setAuthError(e.message);
    }
  }

  async function login(username, password) {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const d = await readJsonResponse(r, 'Login fehlgeschlagen');
    localStorage.removeItem('token');
    localStorage.setItem('user', JSON.stringify(d.user));
    setToken(null);
    setUser(d.user);
  }

  async function setup(username, password, name) {
    const r = await fetch('/api/auth/setup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, name }),
    });
    const d = await readJsonResponse(r, 'Setup fehlgeschlagen');
    localStorage.removeItem('token');
    localStorage.setItem('user', JSON.stringify(d.user));
    setToken(null);
    setUser(d.user);
    setSetupRequired(false);
  }

  function logout() {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  }

  function authFetch(url, options = {}) {
    const headers = { ...(options.headers || {}), 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(url, { ...options, credentials: 'same-origin', headers }).then(async r => {
      if (r.status === 401) {
        logout();
        throw new Error('Sitzung abgelaufen');
      }
      return r;
    });
  }

  return (
    <AuthContext.Provider value={{ user, token, setupRequired, loading, authError, login, logout, setup, authFetch, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
