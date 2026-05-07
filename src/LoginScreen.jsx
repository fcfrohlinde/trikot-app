import { useState, useEffect } from 'react';
import { useAuth } from './auth.jsx';
import ReportForm from './ReportForm.jsx';

export default function LoginScreen() {
  const { login, setup, setupRequired } = useAuth();
  const [mode, setMode] = useState(setupRequired ? 'setup' : 'login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Wenn der Hash #bedarfsmeldung in der URL ist, direkt das Formular zeigen
  useEffect(() => {
    if (window.location.hash === '#bedarfsmeldung') setMode('report');
    const onHash = () => {
      if (window.location.hash === '#bedarfsmeldung') setMode('report');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (mode === 'report') {
    return <ReportForm onBack={() => { window.location.hash = ''; setMode(setupRequired ? 'setup' : 'login'); }} />;
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'setup') {
        if (password.length < 8) throw new Error('Passwort mind. 8 Zeichen');
        await setup(username, password, name);
      } else {
        await login(username, password);
      }
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#F8F5F0' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700;800&family=Bebas+Neue&family=Source+Sans+3:wght@300;400;500;600;700&display=swap');
        .font-editorial { font-family: 'Playfair Display', Georgia, serif; letter-spacing: -0.02em; }
        .font-sub { font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.18em; }
      `}</style>
      <div className="w-full max-w-md" style={{ fontFamily: "'Source Sans 3', sans-serif" }}>
        <div className="text-center mb-8">
          <div className="font-sub text-xs mb-3" style={{ color: '#0B2D5C' }}>F. C. FROHLINDE 1949 e. V.</div>
          <h1 className="font-editorial text-5xl leading-tight" style={{ color: '#1A1A1A' }}>Trikotverwaltung</h1>
          <div className="flex items-center justify-center gap-3 mt-4">
            <div className="h-px w-12" style={{ background: '#DCD6C8' }} />
            <p className="font-sub text-xs" style={{ color: '#807D78' }}>
              {mode === 'setup' ? 'ERSTINSTALLATION' : 'ANMELDUNG'}
            </p>
            <div className="h-px w-12" style={{ background: '#DCD6C8' }} />
          </div>
        </div>

        <form onSubmit={submit} className="bg-white p-8 space-y-4" style={{ border: '1px solid #DCD6C8' }}>
          {mode === 'setup' && (
            <div className="p-3 text-xs" style={{ background: '#F1ECDF', color: '#4A4845', borderLeft: '3px solid #0B2D5C' }}>
              Lege den ersten Admin-Account an. Weitere Nutzer können später aus der App heraus angelegt werden.
            </div>
          )}

          {mode === 'setup' && (
            <Field label="Anzeigename">
              <input className="w-full px-3 py-2 text-sm" style={{ border: '1px solid #DCD6C8', background: '#FCFAF6' }} value={name} onChange={e => setName(e.target.value)} required />
            </Field>
          )}

          <Field label="Benutzername">
            <input className="w-full px-3 py-2 text-sm" style={{ border: '1px solid #DCD6C8', background: '#FCFAF6' }} value={username} onChange={e => setUsername(e.target.value)} required autoComplete="username" />
          </Field>

          <Field label={mode === 'setup' ? 'Passwort (mind. 8 Zeichen)' : 'Passwort'}>
            <input type="password" className="w-full px-3 py-2 text-sm" style={{ border: '1px solid #DCD6C8', background: '#FCFAF6' }} value={password} onChange={e => setPassword(e.target.value)} required autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} />
          </Field>

          {error && (
            <div className="text-sm p-3" style={{ background: '#F5E6E6', color: '#9A2828', borderLeft: '3px solid #9A2828' }}>{error}</div>
          )}

          <button type="submit" disabled={busy} className="w-full py-3 text-sm font-medium tracking-wider uppercase disabled:opacity-50" style={{ background: '#0B2D5C', color: 'white', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
            {busy ? '...' : mode === 'setup' ? 'Admin anlegen' : 'Anmelden'}
          </button>
        </form>

        <div className="text-center mt-6 text-xs" style={{ color: '#807D78' }}>#DeinDorfverein</div>

        <div className="mt-8 p-5 bg-white" style={{ border: '1px solid #DCD6C8' }}>
          <div className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: '#0B2D5C', letterSpacing: '0.18em', fontFamily: "'Bebas Neue', sans-serif" }}>FÜR SPIELER</div>
          <p className="text-sm mb-3" style={{ color: '#4A4845' }}>
            Du hast ein Trikot, Trainingsteil oder anderes Material verloren, defekt oder mit kaputter Beflockung? Melde es hier — kein Login nötig.
          </p>
          <button
            onClick={() => { window.location.hash = '#bedarfsmeldung'; setMode('report'); }}
            className="w-full px-4 py-2.5 text-xs uppercase"
            style={{ background: '#C9A227', color: 'white', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}
          >
            Bedarfsmeldung abgeben
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="font-sub text-xs mb-2" style={{ color: '#0B2D5C', letterSpacing: '0.18em' }}>{label}</div>
      {children}
    </label>
  );
}
