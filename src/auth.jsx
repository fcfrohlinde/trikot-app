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
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [setupRequired, setSetupRequired] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    init();
  }, []);

  async function init() {
    // Status prüfen
    try {
      const r = await fetch('/api/auth/status');
      const d = await readJsonResponse(r, 'Auth-Status konnte nicht geladen werden');
      setSetupRequired(d.setupRequired);
      setAuthError('');
    } catch (e) {
      setAuthError(e.message);
    }
    // Wenn Token da, User laden — zuerst aus localStorage für sofortige Anzeige,
    // dann frischen Stand aus dem Backend nachziehen.
    const t = localStorage.getItem('token');
    if (t) {
      const stored = localStorage.getItem('user');
      if (stored) {
        try { setUser(JSON.parse(stored)); } catch {}
      }
      try {
        const r = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${t}` },
        });
        if (r.ok) {
          const d = await readJsonResponse(r, 'Benutzer konnte nicht geladen werden');
          setUser(d.user);
          localStorage.setItem('user', JSON.stringify(d.user));
        } else if (r.status === 401) {
          // Token ungültig oder Account gelöscht
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setToken(null);
          setUser(null);
        }
      } catch (e) {
        setAuthError(e.message);
      }
    }
    setLoading(false);
  }

  async function refreshUser() {
    const t = localStorage.getItem('token');
    if (!t) return;
    try {
      const r = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (r.ok) {
        const d = await readJsonResponse(r, 'Benutzer konnte nicht aktualisiert werden');
        setUser(d.user);
        localStorage.setItem('user', JSON.stringify(d.user));
      }
    } catch (e) {
      setAuthError(e.message);
    }
  }

  async function login(username, password) {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const d = await readJsonResponse(r, 'Login fehlgeschlagen');
    localStorage.setItem('token', d.token);
    localStorage.setItem('user', JSON.stringify(d.user));
    setToken(d.token);
    setUser(d.user);
  }

  async function setup(username, password, name) {
    const r = await fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, name }),
    });
    const d = await readJsonResponse(r, 'Setup fehlgeschlagen');
    localStorage.setItem('token', d.token);
    localStorage.setItem('user', JSON.stringify(d.user));
    setToken(d.token);
    setUser(d.user);
    setSetupRequired(false);
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  }

  function authFetch(url, options = {}) {
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }).then(async r => {
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
