import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [setupRequired, setSetupRequired] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    // Status prüfen
    try {
      const r = await fetch('/api/auth/status');
      const d = await r.json();
      setSetupRequired(d.setupRequired);
    } catch (e) {
      console.error(e);
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
          const d = await r.json();
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
        // Netzwerkfehler — wir behalten den lokalen Cache
        console.warn('User-Refresh fehlgeschlagen:', e);
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
        const d = await r.json();
        setUser(d.user);
        localStorage.setItem('user', JSON.stringify(d.user));
      }
    } catch (e) {
      console.warn('User-Refresh fehlgeschlagen:', e);
    }
  }

  async function login(username, password) {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Login fehlgeschlagen');
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
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Setup fehlgeschlagen');
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
    <AuthContext.Provider value={{ user, token, setupRequired, loading, login, logout, setup, authFetch, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
