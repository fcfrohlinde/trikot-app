import React, { useState, useEffect } from 'react';
import { Users, Shirt, Wallet, ShoppingCart, Plus, Trash2, Edit2, Download, ArrowLeft, Check, X, AlertCircle, Package, Euro, FileText, Settings, LogOut, UserCog, Mail, Bell, FileWarning } from 'lucide-react';
import { AuthProvider, useAuth } from './auth.jsx';
import LoginScreen from './LoginScreen.jsx';
import { useData } from './useData.js';
import { APP_VERSION, CHANGELOG } from './version.js';
import { ErrorBoundary } from './ErrorBoundary.jsx';

const DEFAULT_TEAMS = ['1. Mannschaft', '2. Mannschaft', '3. Mannschaft'];
const DEFAULT_ITEMS = [];

// FCF-Standardausstattung gemäß Pfandordnung (Stand 2025)
const FCF_DEFAULT_ITEMS = [
  { id: 'praesentationsjacke', name: 'Präsentationsjacke', price: 40, replacementValue: 25 },
  { id: 'praesentationshose', name: 'Präsentationshose', price: 29, replacementValue: 20 },
  { id: 'aufwaermshirt', name: 'Aufwärmshirt', price: 30, replacementValue: 20 },
  { id: 'trainingsshirt', name: 'Trainingsshirt', price: 18, replacementValue: 10 },
  { id: 'trainingshose_kurz', name: 'Trainingshose kurz', price: 14, replacementValue: 10 },
  { id: 'trainingshose_lang', name: 'Trainingshose lang', price: 29, replacementValue: 20 },
  { id: 'zip_top', name: 'Zip Top', price: 40, replacementValue: 25 },
  { id: 'pullover_sweat', name: 'Pullover / Sweat', price: 35, replacementValue: 22 },
];

const DEFAULT_CONDITION_FACTORS = {
  neu: { label: 'Neuwertig', factor: 1.0 },
  gut: { label: 'Gut', factor: 0.85 },
  mittel: { label: 'Mittel', factor: 0.6 },
  schlecht: { label: 'Schlecht', factor: 0.3 },
  defekt: { label: 'Defekt / Verloren', factor: 0 },
};

const DEFAULT_SEASON_DEPRECIATION = 0.25;

// Pfandregel-Modus: 'pauschal' (FCF-Standard) oder 'saison' (Abschreibung × Zustand)
const DEFAULT_DEPOSIT_MODE = 'pauschal';
const DEFAULT_DEPOSIT_AMOUNT = 70;

// Aktuelle Pfandregeln aus Settings holen, mit Defaults als Fallback
function getConditionFactors(settings) {
  return settings?.conditionFactors || DEFAULT_CONDITION_FACTORS;
}
function getSeasonDepreciation(settings) {
  const v = settings?.seasonDepreciation;
  return (typeof v === 'number' && v >= 0 && v <= 1) ? v : DEFAULT_SEASON_DEPRECIATION;
}
function getDepositMode(settings) {
  return settings?.depositMode || DEFAULT_DEPOSIT_MODE;
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoot />
    </AuthProvider>
  );
}

function AppRoot() {
  const { user, loading: authLoading } = useAuth();
  if (authLoading) return <FullScreenLoader />;
  if (!user) return <LoginScreen />;
  return <AppContent />;
}

function FullScreenLoader() {
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center">
      <div className="text-stone-600 font-light tracking-wider">Lade...</div>
    </div>
  );
}

function AppContent() {
  const [view, setView] = useState('dashboard');
  const { data, loading, update, saveError } = useData();
  const { user, logout } = useAuth();

  if (loading) return <FullScreenLoader />;

  const openReportsCount = (data.reports || []).filter(r => r.status === 'offen' || r.status === 'gesehen').length;

  return (
    <div className="min-h-screen bg-stone-50">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;0,700;0,800;1,500&family=Bebas+Neue&family=Source+Sans+3:wght@300;400;500;600;700&display=swap');

        :root {
          --paper: #F8F5F0;
          --paper-dark: #EFEAE0;
          --ink: #1A1A1A;
          --ink-soft: #4A4845;
          --ink-mute: #807D78;
          --rule: #DCD6C8;
          --vereinsblau: #0B2D5C;
          --vereinsblau-soft: #1E4A8A;
          --gold: #C9A227;
          --success: #4A6B3A;
          --warn: #B8651E;
          --danger: #9A2828;
        }

        body { background: var(--paper); }

        .font-display { font-family: 'Playfair Display', Georgia, serif; letter-spacing: -0.01em; }
        .font-sub { font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.04em; }
        .font-body { font-family: 'Source Sans 3', system-ui, sans-serif; font-weight: 400; }

        /* Hintergrund-Stones → warmes Off-White */
        .bg-stone-50 { background-color: var(--paper) !important; }
        .bg-stone-100 { background-color: var(--paper-dark) !important; }
        .hover\\:bg-stone-50:hover { background-color: var(--paper) !important; }
        .hover\\:bg-stone-100:hover { background-color: var(--paper-dark) !important; }

        /* Dunkle Stones → Vereinsblau */
        .bg-stone-900 { background-color: var(--vereinsblau) !important; }
        .hover\\:bg-stone-900:hover { background-color: var(--vereinsblau) !important; }
        .text-stone-900 { color: var(--ink) !important; }
        .hover\\:text-stone-900:hover { color: var(--ink) !important; }
        .border-stone-900 { border-color: var(--vereinsblau) !important; }
        .hover\\:border-stone-900:hover { border-color: var(--vereinsblau) !important; }

        /* Mittlere Stones → gedämpfte Tinte */
        .text-stone-500, .text-stone-600 { color: var(--ink-mute) !important; }
        .text-stone-700 { color: var(--ink-soft) !important; }
        .text-stone-400 { color: #9C9892 !important; }
        .text-stone-300 { color: #BAB6AE !important; }
        .border-stone-100 { border-color: var(--rule) !important; opacity: 0.6; }
        .border-stone-200 { border-color: var(--rule) !important; }
        .border-stone-300 { border-color: #C5BFB1 !important; }

        /* Akzente: Erfolg/Warn/Gefahr in editorial-tönen */
        .text-emerald-700, .text-emerald-300 { color: var(--success) !important; }
        .bg-emerald-50 { background-color: #EBF0E5 !important; }
        .text-orange-700, .text-orange-300, .text-orange-800 { color: var(--warn) !important; }
        .bg-orange-50 { background-color: #F5EBDD !important; }
        .border-orange-200, .border-orange-500 { border-color: var(--warn) !important; }
        .text-red-600, .text-red-700, .text-red-800 { color: var(--danger) !important; }
        .hover\\:text-red-600:hover { color: var(--danger) !important; }
        .bg-red-50, .bg-red-100 { background-color: #F5E6E6 !important; }
        .border-red-200, .border-red-500 { border-color: var(--danger) !important; }

        /* Editoriale Details */
        .editorial-rule {
          height: 1px;
          background: var(--rule);
          position: relative;
        }
        .section-label {
          font-family: 'Bebas Neue', sans-serif;
          letter-spacing: 0.18em;
          font-size: 0.7rem;
          color: var(--vereinsblau);
        }
        .stat-number {
          font-family: 'Playfair Display', Georgia, serif;
          font-weight: 700;
          letter-spacing: -0.03em;
        }
        .magazine-card {
          background: white;
          border: 1px solid var(--rule);
        }
        /* Dezenter Tafel-Akzent links bei Karten */
        .bg-white { background-color: #FFFFFF !important; }

        /* Buttons feiner */
        button { font-family: 'Source Sans 3', sans-serif; }

        /* Inputs editorial */
        input, select, textarea {
          background: #FCFAF6 !important;
          border-color: var(--rule) !important;
          font-family: 'Source Sans 3', sans-serif;
        }
        input:focus, select:focus, textarea:focus {
          outline: 2px solid var(--vereinsblau);
          outline-offset: -1px;
          border-color: var(--vereinsblau) !important;
        }

        /* Tabellen-Header */
        thead.bg-stone-50 { background-color: #F1ECDF !important; }
        thead.bg-stone-50 tr th { color: var(--vereinsblau) !important; font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.12em; }
      `}</style>
      <div className="font-body">
        <Header view={view} setView={setView} clubName={data.settings.clubName} user={user} logout={logout} openReportsCount={openReportsCount} />
        {saveError && (
          <div className="bg-red-100 border-b border-red-200 text-red-800 text-sm px-4 py-2">
            ⚠ Speicherfehler: {saveError}
          </div>
        )}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
          <ErrorBoundary key={view} onReset={() => setView('dashboard')}>
            {view === 'dashboard' && <Dashboard data={data} setView={setView} />}
            {view === 'reports' && <ReportsView data={data} update={update} />}
            {view === 'players' && <PlayersView data={data} update={update} />}
            {view === 'inventory' && <InventoryView data={data} update={update} />}
            {view === 'deposits' && <DepositsView data={data} update={update} />}
            {view === 'orders' && <OrdersView data={data} update={update} />}
            {view === 'returns' && <ReturnsView data={data} update={update} />}
            {view === 'settings' && <SettingsView data={data} update={update} />}
            {view === 'users' && user.role === 'admin' && <UsersView />}
          </ErrorBoundary>
        </main>
        <footer className="max-w-7xl mx-auto px-4 sm:px-6 py-6 text-xs" style={{ color: 'var(--ink-mute)' }}>
          <div className="flex justify-between items-center">
            <span>Trikotverwaltung v{APP_VERSION}</span>
            <span style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.18em', color: 'var(--vereinsblau)' }}>#DEINDORFVEREIN</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Header({ view, setView, clubName, user, logout, openReportsCount = 0 }) {
  const nav = [
    { id: 'dashboard', label: 'Übersicht' },
    { id: 'reports', label: 'Bedarf', badge: openReportsCount },
    { id: 'players', label: 'Spieler' },
    { id: 'inventory', label: 'Material' },
    { id: 'deposits', label: 'Pfand' },
    { id: 'returns', label: 'Rückgabe' },
    { id: 'orders', label: 'Bestellungen' },
    { id: 'settings', label: 'Einstellungen' },
  ];
  if (user?.role === 'admin') nav.push({ id: 'users', label: 'Nutzer' });
  return (
    <header className="bg-white sticky top-0 z-10" style={{ borderBottom: '1px solid var(--rule)' }}>
      <div className="h-1" style={{ background: 'var(--vereinsblau)' }} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setView('dashboard')} className="text-left">
            <div className="font-sub text-xs" style={{ color: 'var(--vereinsblau)' }}>#DEINDORFVEREIN</div>
            <div className="font-display text-3xl sm:text-4xl leading-tight" style={{ color: 'var(--ink)' }}>Trikotverwaltung</div>
            <div className="text-xs mt-1" style={{ color: 'var(--ink-mute)' }}>{clubName}</div>
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs hidden sm:inline" style={{ color: 'var(--ink-mute)' }}>{user?.name}</span>
            <button onClick={logout} className="hover:text-stone-900 p-2" style={{ color: 'var(--ink-mute)' }} title="Abmelden">
              <LogOut size={16} />
            </button>
          </div>
        </div>
        <nav className="flex gap-1 sm:gap-2 overflow-x-auto -mx-4 px-4 pb-1">
          {nav.map(n => (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              className={`relative px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium whitespace-nowrap transition uppercase tracking-wider ${
                view === n.id ? 'text-white' : 'hover:bg-stone-100'
              }`}
              style={{
                background: view === n.id ? 'var(--vereinsblau)' : 'transparent',
                color: view === n.id ? 'white' : 'var(--ink-soft)',
                fontFamily: "'Bebas Neue', sans-serif",
                letterSpacing: '0.12em',
              }}
            >
              {n.label}
              {n.badge > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center text-[10px] font-bold"
                  style={{
                    background: view === n.id ? 'var(--gold)' : '#9A2828',
                    color: view === n.id ? 'var(--vereinsblau)' : 'white',
                    minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                    fontFamily: "'Source Sans 3', sans-serif", letterSpacing: 0,
                  }}>
                  {n.badge > 99 ? '99+' : n.badge}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}

function Dashboard({ data, setView }) {
  const totalPlayers = data.players.length;
  const playersWithMaterial = data.players.filter(p =>
    data.inventory.some(i => i.assignedTo === p.id && i.status === 'ausgegeben')
  ).length;
  const unusedItems = data.inventory.filter(i => i.status === 'lager').length;
  const totalDeposits = data.deposits.filter(d => !d.refunded).reduce((s, d) => s + d.amount, 0);
  const openOrders = data.orders.filter(o => o.status !== 'geliefert' && o.status !== 'storniert').length;

  const cards = [
    { label: 'Spieler', value: totalPlayers, target: 'players', sub: `${playersWithMaterial} mit Material` },
    { label: 'Material im Lager', value: unusedItems, target: 'inventory', sub: `von ${data.inventory.length} gesamt` },
    { label: 'Pfand gehalten', value: `${totalDeposits.toFixed(0)} €`, target: 'deposits', sub: `${data.deposits.filter(d => !d.refunded).length} aktive Pfänder` },
    { label: 'Offene Bestellungen', value: openOrders, target: 'orders', sub: `${data.orders.length} gesamt` },
  ];

  return (
    <div>
      <div className="mb-10">
        <div className="section-label mb-3">01 — ÜBERSICHT</div>
        <h1 className="font-display text-5xl sm:text-6xl leading-tight" style={{ color: 'var(--ink)' }}>Saison auf einen Blick.</h1>
        <div className="flex items-center gap-3 mt-4">
          <div className="h-px w-16" style={{ background: 'var(--vereinsblau)' }} />
          <p className="text-sm" style={{ color: 'var(--ink-mute)' }}>Stand {new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px mb-12" style={{ background: 'var(--rule)' }}>
        {cards.map(c => (
          <button key={c.label} onClick={() => setView(c.target)}
            className="bg-white p-5 sm:p-7 text-left transition group hover:bg-stone-50">
            <div className="font-sub text-xs uppercase mb-3" style={{ color: 'var(--vereinsblau)', letterSpacing: '0.18em' }}>{c.label}</div>
            <div className="stat-number text-4xl sm:text-6xl leading-none" style={{ color: 'var(--ink)' }}>{c.value}</div>
            <div className="text-xs mt-3" style={{ color: 'var(--ink-mute)' }}>{c.sub}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-px" style={{ background: 'var(--rule)' }}>
        <div className="bg-white p-7">
          <div className="section-label mb-3">02 — SCHNELLZUGRIFF</div>
          <h2 className="font-display text-2xl mb-5" style={{ color: 'var(--ink)' }}>Was möchtest du erledigen?</h2>
          <div className="space-y-px" style={{ background: 'var(--rule)' }}>
            {[
              { label: 'Spieler hinzufügen / Nummer vergeben', icon: Users, target: 'players' },
              { label: 'Material ausgeben / einbuchen', icon: Shirt, target: 'inventory' },
              { label: 'Neue Bestellung anlegen (mit Flock-Liste)', icon: ShoppingCart, target: 'orders' },
              { label: 'Saison-Rückgabe / Pfandabrechnung', icon: Wallet, target: 'returns' },
            ].map(({ label, icon: Icon, target }) => (
              <button key={target} onClick={() => setView(target)} className="w-full text-left p-3 bg-white hover:bg-stone-50 flex items-center justify-between group">
                <span className="text-sm" style={{ color: 'var(--ink-soft)' }}>{label}</span>
                <Icon size={16} style={{ color: 'var(--vereinsblau)' }} />
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white p-7">
          <div className="section-label mb-3">03 — MANNSCHAFTEN</div>
          <h2 className="font-display text-2xl mb-5" style={{ color: 'var(--ink)' }}>Unsere Teams.</h2>
          <div className="space-y-px" style={{ background: 'var(--rule)' }}>
            {data.teams.length === 0 ? (
              <div className="p-3 bg-white text-sm" style={{ color: 'var(--ink-mute)' }}>Noch keine Mannschaften angelegt. In den Einstellungen anlegen.</div>
            ) : data.teams.map(team => {
              const teamPlayers = data.players.filter(p => p.team === team);
              const withMat = teamPlayers.filter(p => data.inventory.some(i => i.assignedTo === p.id && i.status === 'ausgegeben')).length;
              return (
                <div key={team} className="p-3 bg-white flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm" style={{ color: 'var(--ink)' }}>{team}</div>
                    <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>{teamPlayers.length} Spieler · {withMat} mit Material</div>
                  </div>
                  <div className="stat-number text-3xl" style={{ color: 'var(--vereinsblau)' }}>{teamPlayers.length}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ SPIELER ============
function PlayersView({ data, update }) {
  const [filter, setFilter] = useState('alle');
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const filtered = filter === 'alle' ? data.players : data.players.filter(p => p.team === filter);

  function save(player) {
    if (editing) {
      update('players', data.players.map(p => p.id === editing.id ? { ...player, id: editing.id } : p));
    } else {
      update('players', [...data.players, { ...player, id: `p_${Date.now()}` }]);
    }
    setShowForm(false); setEditing(null);
  }

  function bulkAdd(newPlayers) {
    const withIds = newPlayers.map((p, i) => ({
      ...p,
      id: `p_${Date.now()}_${i}`,
      number: p.number ? parseInt(p.number) : null,
    }));
    update('players', [...data.players, ...withIds]);
    setShowImport(false);
  }

  function remove(id) {
    if (!confirm('Spieler wirklich löschen?')) return;
    update('players', data.players.filter(p => p.id !== id));
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <PageHeader number="04" label="KADER" title="Spieler & Nummern" subtitle={`${data.players.length} registriert`} />
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)}
            className="px-5 py-2.5 text-xs font-medium flex items-center gap-2 uppercase"
            style={{ background: 'var(--paper-dark)', color: 'var(--ink)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
            <Download size={14} style={{ transform: 'rotate(180deg)' }} /> CSV importieren
          </button>
          <button onClick={() => { setEditing(null); setShowForm(true); }}
            className="px-5 py-2.5 text-xs font-medium flex items-center gap-2 uppercase"
            style={{ background: 'var(--vereinsblau)', color: 'white', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
            <Plus size={14} /> Spieler anlegen
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto -mx-4 px-4 pb-1">
        <button onClick={() => setFilter('alle')}
          className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap ${filter === 'alle' ? 'bg-stone-900 text-white' : 'bg-white border border-stone-200'}`}>
          Alle ({data.players.length})
        </button>
        {data.teams.map(t => (
          <button key={t} onClick={() => setFilter(t)}
            className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap ${filter === t ? 'bg-stone-900 text-white' : 'bg-white border border-stone-200'}`}>
            {t} ({data.players.filter(p => p.team === t).length})
          </button>
        ))}
      </div>

      {showForm && <PlayerForm player={editing} players={data.players} teams={data.teams} onSave={save} onCancel={() => { setShowForm(false); setEditing(null); }} />}
      {showImport && <PlayerImport teams={data.teams} existingPlayers={data.players} onImport={bulkAdd} onCancel={() => setShowImport(false)} />}

      <div className="bg-white border border-stone-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-stone-500 text-sm">Noch keine Spieler in dieser Auswahl.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wider text-stone-500">
                <tr>
                  <th className="text-left p-3 font-medium">Nr.</th>
                  <th className="text-left p-3 font-medium">Name</th>
                  <th className="text-left p-3 font-medium hidden md:table-cell">Mannschaft</th>
                  <th className="text-left p-3 font-medium hidden sm:table-cell">Größe</th>
                  <th className="text-left p-3 font-medium">Material</th>
                  <th className="text-left p-3 font-medium hidden md:table-cell">Pfand</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.sort((a, b) => (a.number || 999) - (b.number || 999)).map(p => {
                  const itemCount = data.inventory.filter(i => i.assignedTo === p.id && i.status === 'ausgegeben').length;
                  const deposit = data.deposits.find(d => d.playerId === p.id && !d.refunded);
                  return (
                    <tr key={p.id} className="border-t border-stone-100">
                      <td className="p-3 font-display text-xl">{p.number || '–'}</td>
                      <td className="p-3 font-medium">
                        {p.firstName} {p.lastName}
                        <div className="text-xs text-stone-500 md:hidden">{p.team}</div>
                      </td>
                      <td className="p-3 hidden md:table-cell text-stone-600">{p.team}</td>
                      <td className="p-3 hidden sm:table-cell text-stone-600">{p.size || '–'}</td>
                      <td className="p-3">
                        <span className={`inline-block px-2 py-0.5 text-xs ${itemCount > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
                          {itemCount} Teile
                        </span>
                      </td>
                      <td className="p-3 hidden md:table-cell">
                        {deposit ? <span className="text-emerald-700 font-medium">{deposit.amount} €</span> : <span className="text-stone-400">–</span>}
                      </td>
                      <td className="p-3 text-right">
                        <button onClick={() => { setEditing(p); setShowForm(true); }} className="text-stone-400 hover:text-stone-900 p-1">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => remove(p.id)} className="text-stone-400 hover:text-red-600 p-1">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerForm({ player, players, teams, onSave, onCancel }) {
  const [form, setForm] = useState(player || { firstName: '', lastName: '', team: teams[0] || '', number: '', size: 'L', notes: '' });
  const numberConflict = form.number && players.some(p => p.id !== player?.id && p.team === form.team && String(p.number) === String(form.number));

  function submit() {
    if (!form.firstName || !form.lastName) return alert('Name fehlt');
    if (!form.team) return alert('Bitte zuerst eine Mannschaft in den Einstellungen anlegen.');
    if (numberConflict) return alert('Rückennummer in dieser Mannschaft bereits vergeben');
    onSave({ ...form, number: form.number ? parseInt(form.number) : null });
  }

  return (
    <div className="bg-white border-2 border-stone-900 p-6 mb-4">
      <h2 className="font-display text-2xl mb-4">{player ? 'SPIELER BEARBEITEN' : 'NEUER SPIELER'}</h2>
      {teams.length === 0 && (
        <div className="bg-orange-50 border border-orange-200 p-3 mb-4 text-sm text-orange-800">
          Es gibt noch keine Mannschaften. Bitte zuerst in den Einstellungen anlegen.
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Vorname"><input className="w-full border border-stone-300 px-3 py-2 text-sm" value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} /></Field>
        <Field label="Nachname"><input className="w-full border border-stone-300 px-3 py-2 text-sm" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} /></Field>
        <Field label="Mannschaft">
          <select className="w-full border border-stone-300 px-3 py-2 text-sm" value={form.team} onChange={e => setForm({ ...form, team: e.target.value })}>
            <option value="">– wählen –</option>
            {teams.map(t => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label={`Rückennummer ${numberConflict ? '⚠ vergeben' : ''}`}>
          <input type="number" className={`w-full border px-3 py-2 text-sm ${numberConflict ? 'border-red-500' : 'border-stone-300'}`}
            value={form.number || ''} onChange={e => setForm({ ...form, number: e.target.value })} />
        </Field>
        <Field label="Größe">
          <select className="w-full border border-stone-300 px-3 py-2 text-sm" value={form.size} onChange={e => setForm({ ...form, size: e.target.value })}>
            {['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'].map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Notizen"><input className="w-full border border-stone-300 px-3 py-2 text-sm" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={submit} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium">Speichern</button>
        <button onClick={onCancel} className="border border-stone-300 px-4 py-2 text-sm">Abbrechen</button>
      </div>
    </div>
  );
}

// ============ SPIELER-IMPORT ============
function PlayerImport({ teams, existingPlayers, onImport, onCancel }) {
  const [step, setStep] = useState('upload'); // upload | preview
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  function downloadTemplate() {
    const header = ['Vorname', 'Nachname', 'Mannschaft', 'Rückennummer', 'Größe', 'Notizen'];
    const example = [
      ['Max', 'Mustermann', teams[0] || '1. Mannschaft', '10', 'L', ''],
      ['Tim', 'Beispiel', teams[0] || '1. Mannschaft', '7', 'M', 'Kapitän'],
    ];
    const csv = [header, ...example].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'spieler_import_vorlage.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      if (parsed.length === 0) throw new Error('Datei ist leer.');
      const header = parsed[0].map(h => h.trim().toLowerCase());
      // Spalten-Indizes finden
      const col = (...names) => {
        for (const n of names) {
          const idx = header.findIndex(h => h === n);
          if (idx >= 0) return idx;
        }
        return -1;
      };
      const iVorname = col('vorname', 'firstname', 'first name');
      const iNachname = col('nachname', 'lastname', 'last name', 'name');
      const iTeam = col('mannschaft', 'team');
      const iNumber = col('rückennummer', 'rueckennummer', 'nummer', 'number', 'nr');
      const iSize = col('größe', 'groesse', 'size');
      const iNotes = col('notizen', 'notes', 'bemerkung');

      if (iVorname < 0 || iNachname < 0) {
        throw new Error('Spalten "Vorname" und "Nachname" sind Pflicht. Bitte die Vorlage verwenden.');
      }

      const dataRows = parsed.slice(1).filter(r => r.some(c => c && c.trim()));
      const rows = dataRows.map((r, idx) => ({
        _idx: idx,
        firstName: (r[iVorname] || '').trim(),
        lastName: (r[iNachname] || '').trim(),
        team: iTeam >= 0 ? (r[iTeam] || '').trim() : (teams[0] || ''),
        number: iNumber >= 0 ? (r[iNumber] || '').trim() : '',
        size: iSize >= 0 ? ((r[iSize] || '').trim().toUpperCase() || 'L') : 'L',
        notes: iNotes >= 0 ? (r[iNotes] || '').trim() : '',
      }));

      setRows(rows);
      setStep('preview');
    } catch (err) {
      setError(err.message);
    }
  }

  function updateRow(idx, key, value) {
    setRows(rows.map(r => r._idx === idx ? { ...r, [key]: value } : r));
  }

  function removeRow(idx) {
    setRows(rows.filter(r => r._idx !== idx));
  }

  // Validierung pro Zeile
  function validate(row, allRows) {
    const errors = [];
    if (!row.firstName) errors.push('Vorname fehlt');
    if (!row.lastName) errors.push('Nachname fehlt');
    if (!row.team) errors.push('Mannschaft fehlt');
    else if (!teams.includes(row.team)) errors.push('Mannschaft unbekannt');
    if (row.number) {
      const n = parseInt(row.number);
      if (isNaN(n)) errors.push('Nummer ungültig');
      else {
        // Konflikt mit existierenden Spielern
        const conflictExisting = existingPlayers.some(p => p.team === row.team && String(p.number) === String(n));
        if (conflictExisting) errors.push('Nummer bereits vergeben');
        // Konflikt innerhalb der Importliste
        const conflictImport = allRows.some(o =>
          o._idx !== row._idx && o.team === row.team && o.number && parseInt(o.number) === n
        );
        if (conflictImport) errors.push('Nummer doppelt im Import');
      }
    }
    return errors;
  }

  const validatedRows = rows.map(r => ({ ...r, errors: validate(r, rows) }));
  const validCount = validatedRows.filter(r => r.errors.length === 0).length;
  const errorCount = validatedRows.length - validCount;

  function importValid() {
    const valid = validatedRows.filter(r => r.errors.length === 0).map(r => ({
      firstName: r.firstName,
      lastName: r.lastName,
      team: r.team,
      number: r.number,
      size: r.size,
      notes: r.notes,
    }));
    if (valid.length === 0) { alert('Keine gültigen Zeilen zum Import.'); return; }
    onImport(valid);
  }

  return (
    <div className="bg-white p-7 mb-4" style={{ border: '2px solid var(--vereinsblau)' }}>
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="section-label mb-2">SPIELER-IMPORT</div>
          <h2 className="font-display text-3xl" style={{ color: 'var(--ink)' }}>
            {step === 'upload' ? 'CSV-Datei hochladen' : 'Vorschau & Bestätigung'}
          </h2>
        </div>
        <button onClick={onCancel} className="p-2 hover:bg-stone-100" title="Schließen">
          <X size={18} />
        </button>
      </div>

      {step === 'upload' && (
        <div>
          <div className="mb-6 text-sm" style={{ color: 'var(--ink-soft)' }}>
            <p className="mb-3">So funktioniert's:</p>
            <ol className="list-decimal pl-5 space-y-1.5">
              <li>Vorlage herunterladen (CSV mit den richtigen Spalten).</li>
              <li>In Excel, Numbers oder Google Sheets öffnen und befüllen.</li>
              <li>Als CSV speichern und hier hochladen.</li>
              <li>Vorschau prüfen, Fehler korrigieren, importieren.</li>
            </ol>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <button onClick={downloadTemplate}
              className="px-5 py-3 text-xs uppercase flex items-center justify-center gap-2"
              style={{ background: 'var(--paper-dark)', color: 'var(--ink)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
              <Download size={14} /> Vorlage herunterladen
            </button>
            <label className="px-5 py-3 text-xs uppercase flex items-center justify-center gap-2 cursor-pointer text-white"
              style={{ background: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
              <Download size={14} style={{ transform: 'rotate(180deg)' }} /> CSV-Datei wählen
              <input type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
            </label>
          </div>

          <div className="text-xs p-4" style={{ background: 'var(--paper-dark)', color: 'var(--ink-soft)' }}>
            <strong style={{ color: 'var(--vereinsblau)' }}>Pflichtspalten:</strong> Vorname, Nachname<br />
            <strong style={{ color: 'var(--vereinsblau)' }}>Optionale Spalten:</strong> Mannschaft, Rückennummer, Größe (XS/S/M/L/XL/XXL/3XL), Notizen<br />
            <strong style={{ color: 'var(--vereinsblau)' }}>Trennzeichen:</strong> Semikolon (;) oder Komma (,) — wird automatisch erkannt<br />
            <strong style={{ color: 'var(--vereinsblau)' }}>Verfügbare Mannschaften:</strong> {teams.length > 0 ? teams.join(' · ') : '— keine angelegt —'}
          </div>

          {error && (
            <div className="mt-4 p-3 text-sm" style={{ background: '#F5E6E6', color: 'var(--danger)', borderLeft: '3px solid var(--danger)' }}>{error}</div>
          )}
        </div>
      )}

      {step === 'preview' && (
        <div>
          <div className="grid grid-cols-3 gap-px mb-5" style={{ background: 'var(--rule)' }}>
            <div className="bg-white p-4">
              <div className="font-sub text-xs" style={{ color: 'var(--ink-mute)', letterSpacing: '0.18em' }}>GESAMT</div>
              <div className="stat-number text-3xl" style={{ color: 'var(--ink)' }}>{validatedRows.length}</div>
            </div>
            <div className="bg-white p-4">
              <div className="font-sub text-xs" style={{ color: 'var(--success)', letterSpacing: '0.18em' }}>GÜLTIG</div>
              <div className="stat-number text-3xl" style={{ color: 'var(--success)' }}>{validCount}</div>
            </div>
            <div className="bg-white p-4">
              <div className="font-sub text-xs" style={{ color: 'var(--danger)', letterSpacing: '0.18em' }}>FEHLER</div>
              <div className="stat-number text-3xl" style={{ color: 'var(--danger)' }}>{errorCount}</div>
            </div>
          </div>

          {errorCount > 0 && (
            <div className="mb-4 p-3 text-sm" style={{ background: '#F5EBDD', color: 'var(--warn)', borderLeft: '3px solid var(--warn)' }}>
              Zeilen mit Fehlern können direkt unten korrigiert werden. Beim Import werden nur gültige Zeilen übernommen — fehlerhafte werden übersprungen.
            </div>
          )}

          <div className="overflow-x-auto mb-4" style={{ border: '1px solid var(--rule)' }}>
            <table className="w-full text-xs min-w-[800px]">
              <thead className="bg-stone-50">
                <tr>
                  <th className="text-left p-2">Vorname</th>
                  <th className="text-left p-2">Nachname</th>
                  <th className="text-left p-2">Mannschaft</th>
                  <th className="text-left p-2">Nr.</th>
                  <th className="text-left p-2">Größe</th>
                  <th className="text-left p-2">Notizen</th>
                  <th className="text-left p-2">Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {validatedRows.map(r => (
                  <tr key={r._idx} style={{ borderTop: '1px solid var(--rule)', background: r.errors.length > 0 ? '#F5E6E6' : 'transparent' }}>
                    <td className="p-1"><input className="w-full px-2 py-1 text-xs" value={r.firstName} onChange={e => updateRow(r._idx, 'firstName', e.target.value)} style={{ border: '1px solid var(--rule)' }} /></td>
                    <td className="p-1"><input className="w-full px-2 py-1 text-xs" value={r.lastName} onChange={e => updateRow(r._idx, 'lastName', e.target.value)} style={{ border: '1px solid var(--rule)' }} /></td>
                    <td className="p-1">
                      <select className="w-full px-2 py-1 text-xs" value={r.team} onChange={e => updateRow(r._idx, 'team', e.target.value)} style={{ border: '1px solid var(--rule)' }}>
                        <option value="">– wählen –</option>
                        {teams.map(t => <option key={t}>{t}</option>)}
                        {r.team && !teams.includes(r.team) && <option value={r.team}>{r.team} (unbekannt)</option>}
                      </select>
                    </td>
                    <td className="p-1"><input type="number" className="w-16 px-2 py-1 text-xs" value={r.number} onChange={e => updateRow(r._idx, 'number', e.target.value)} style={{ border: '1px solid var(--rule)' }} /></td>
                    <td className="p-1">
                      <select className="px-2 py-1 text-xs" value={r.size} onChange={e => updateRow(r._idx, 'size', e.target.value)} style={{ border: '1px solid var(--rule)' }}>
                        {['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'].map(s => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="p-1"><input className="w-full px-2 py-1 text-xs" value={r.notes} onChange={e => updateRow(r._idx, 'notes', e.target.value)} style={{ border: '1px solid var(--rule)' }} /></td>
                    <td className="p-2">
                      {r.errors.length === 0 ? (
                        <span style={{ color: 'var(--success)' }}>✓ OK</span>
                      ) : (
                        <span style={{ color: 'var(--danger)' }} title={r.errors.join(', ')}>✗ {r.errors[0]}</span>
                      )}
                    </td>
                    <td className="p-1">
                      <button onClick={() => removeRow(r._idx)} className="p-1 hover:text-red-600" style={{ color: 'var(--ink-mute)' }}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={importValid} disabled={validCount === 0}
              className="px-6 py-3 text-xs uppercase text-white disabled:opacity-50"
              style={{ background: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
              {validCount} {validCount === 1 ? 'Spieler' : 'Spieler'} importieren
            </button>
            <button onClick={() => { setStep('upload'); setRows([]); }}
              className="px-6 py-3 text-xs uppercase"
              style={{ border: '1px solid var(--rule)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
              Andere Datei wählen
            </button>
            <button onClick={onCancel}
              className="px-6 py-3 text-xs uppercase"
              style={{ border: '1px solid var(--rule)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// CSV-Parser: erkennt automatisch Semikolon oder Komma als Trenner, behandelt Anführungszeichen
function parseCSV(text) {
  // BOM entfernen
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  // Trenner ermitteln: Erste Zeile prüfen
  const firstLine = text.split(/\r?\n/)[0] || '';
  const semis = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const sep = semis >= commas ? ';' : ',';

  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === sep) { row.push(cell); cell = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += c; i++;
  }
  // Letzte Zeile
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ============ MATERIAL / INVENTORY ============
function InventoryView({ data, update }) {
  const [filter, setFilter] = useState('alle');
  const [showForm, setShowForm] = useState(false);
  const [showAssign, setShowAssign] = useState(null);

  const filtered = data.inventory.filter(i => {
    if (filter === 'alle') return true;
    if (filter === 'lager') return i.status === 'lager';
    if (filter === 'ausgegeben') return i.status === 'ausgegeben';
    if (filter === 'markiert') return i.flagged;
    return i.itemType === filter;
  });

  function addBulk(itemType, qty, size) {
    const item = data.items.find(i => i.id === itemType);
    const newOnes = Array.from({ length: qty }, (_, idx) => ({
      id: `inv_${Date.now()}_${idx}`,
      itemType,
      itemName: item.name,
      size,
      status: 'lager',
      assignedTo: null,
      acquiredAt: new Date().toISOString(),
      seasonsUsed: 0,
      condition: 'neu',
      originalPrice: item.price,
    }));
    update('inventory', [...data.inventory, ...newOnes]);
    setShowForm(false);
  }

  function assign(invId, playerId, number) {
    update('inventory', data.inventory.map(i =>
      i.id === invId ? { ...i, status: 'ausgegeben', assignedTo: playerId, assignedAt: new Date().toISOString(), assignedNumber: number } : i
    ));
    setShowAssign(null);
  }

  function unassign(invId) {
    if (!confirm('Material zurück ins Lager buchen?')) return;
    update('inventory', data.inventory.map(i =>
      i.id === invId ? { ...i, status: 'lager', assignedTo: null, assignedAt: null, assignedNumber: null } : i
    ));
  }

  function remove(invId) {
    if (!confirm('Materialteil komplett aus Bestand löschen?')) return;
    update('inventory', data.inventory.filter(i => i.id !== invId));
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <PageHeader number="05" label="AUSSTATTUNG" title="Material & Bestand" subtitle={`${data.inventory.length} Teile gesamt · ${data.inventory.filter(i => i.status === 'lager').length} im Lager`} />
        <button onClick={() => setShowForm(true)} className="px-5 py-2.5 text-xs font-medium flex items-center gap-2 uppercase"
          style={{ background: 'var(--vereinsblau)', color: 'white', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
          <Plus size={14} /> Material einbuchen
        </button>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto -mx-4 px-4 pb-1">
        {[
          { id: 'alle', label: `Alle (${data.inventory.length})` },
          { id: 'lager', label: `Im Lager (${data.inventory.filter(i => i.status === 'lager').length})` },
          { id: 'ausgegeben', label: `Ausgegeben (${data.inventory.filter(i => i.status === 'ausgegeben').length})` },
          { id: 'markiert', label: `Markiert (${data.inventory.filter(i => i.flagged).length})` },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap ${filter === f.id ? 'bg-stone-900 text-white' : 'bg-white border border-stone-200'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {showForm && <InventoryAddForm items={data.items} onSave={addBulk} onCancel={() => setShowForm(false)} />}
      {showAssign && <AssignForm inv={showAssign} players={data.players} inventory={data.inventory} onAssign={assign} onCancel={() => setShowAssign(null)} />}

      <div className="bg-white border border-stone-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-stone-500 text-sm">Kein Material in dieser Auswahl.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wider text-stone-500">
                <tr>
                  <th className="text-left p-3 font-medium">Artikel</th>
                  <th className="text-left p-3 font-medium hidden sm:table-cell">Größe</th>
                  <th className="text-left p-3 font-medium hidden md:table-cell">Status</th>
                  <th className="text-left p-3 font-medium">Zugeordnet</th>
                  <th className="text-left p-3 font-medium hidden lg:table-cell">Zustand</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(i => {
                  const player = data.players.find(p => p.id === i.assignedTo);
                  return (
                    <tr key={i.id} className="border-t border-stone-100">
                      <td className="p-3 font-medium">{i.itemName}</td>
                      <td className="p-3 hidden sm:table-cell">{i.size}</td>
                      <td className="p-3 hidden md:table-cell">
                        <span className={`inline-block px-2 py-0.5 text-xs ${i.status === 'lager' ? 'bg-stone-100 text-stone-700' : 'bg-emerald-50 text-emerald-700'}`}>
                          {i.status === 'lager' ? 'Lager' : 'Ausgegeben'}
                        </span>
                        {i.flagged && (
                          <span className="inline-block px-2 py-0.5 text-xs ml-1" style={{ background: '#F5EBDD', color: 'var(--warn)' }}
                            title={`Markiert: ${(i.flagReasons || []).map(x => REASON_LABELS[x] || x).join(', ')}`}>
                            ⚠ markiert
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        {player ? (
                          <div>
                            <div>#{i.assignedNumber || player.number} {player.firstName} {player.lastName}</div>
                            <div className="text-xs text-stone-500">{player.team}</div>
                          </div>
                        ) : <span className="text-stone-400">–</span>}
                      </td>
                      <td className="p-3 hidden lg:table-cell text-stone-600">{getConditionFactors(data.settings)[i.condition]?.label || i.condition}</td>
                      <td className="p-3 text-right whitespace-nowrap">
                        {i.status === 'lager' ? (
                          <button onClick={() => setShowAssign(i)} className="text-xs bg-stone-900 text-white px-2 py-1">Ausgeben</button>
                        ) : (
                          <button onClick={() => unassign(i.id)} className="text-xs border border-stone-300 px-2 py-1">Zurück</button>
                        )}
                        <button onClick={() => remove(i.id)} className="text-stone-400 hover:text-red-600 p-1 ml-1">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function InventoryAddForm({ items, onSave, onCancel }) {
  const [itemType, setItemType] = useState(items[0].id);
  const [qty, setQty] = useState(1);
  const [size, setSize] = useState('L');

  return (
    <div className="bg-white border-2 border-stone-900 p-6 mb-4">
      <h2 className="font-display text-2xl mb-4">MATERIAL EINBUCHEN</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Artikel">
          <select className="w-full border border-stone-300 px-3 py-2 text-sm" value={itemType} onChange={e => setItemType(e.target.value)}>
            {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </Field>
        <Field label="Größe">
          <select className="w-full border border-stone-300 px-3 py-2 text-sm" value={size} onChange={e => setSize(e.target.value)}>
            {['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'].map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Menge">
          <input type="number" min="1" className="w-full border border-stone-300 px-3 py-2 text-sm" value={qty} onChange={e => setQty(parseInt(e.target.value) || 1)} />
        </Field>
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={() => onSave(itemType, qty, size)} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium">Einbuchen</button>
        <button onClick={onCancel} className="border border-stone-300 px-4 py-2 text-sm">Abbrechen</button>
      </div>
    </div>
  );
}

function AssignForm({ inv, players, inventory, onAssign, onCancel }) {
  const [playerId, setPlayerId] = useState('');
  const [number, setNumber] = useState('');
  const player = players.find(p => p.id === playerId);

  useEffect(() => {
    if (player) setNumber(player.number || '');
  }, [playerId]);

  return (
    <div className="bg-white border-2 border-stone-900 p-6 mb-4">
      <h2 className="font-display text-2xl mb-4">MATERIAL AUSGEBEN</h2>
      <p className="text-sm text-stone-600 mb-4">{inv.itemName} · Größe {inv.size}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Spieler">
          <select className="w-full border border-stone-300 px-3 py-2 text-sm" value={playerId} onChange={e => setPlayerId(e.target.value)}>
            <option value="">– wählen –</option>
            {players.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName} ({p.team})</option>)}
          </select>
        </Field>
        <Field label="Rückennummer (auf diesem Teil)">
          <input type="number" className="w-full border border-stone-300 px-3 py-2 text-sm" value={number} onChange={e => setNumber(e.target.value)} />
        </Field>
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={() => playerId && onAssign(inv.id, playerId, number ? parseInt(number) : null)}
          disabled={!playerId} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">Ausgeben</button>
        <button onClick={onCancel} className="border border-stone-300 px-4 py-2 text-sm">Abbrechen</button>
      </div>
    </div>
  );
}

// ============ PFAND ============
function DepositsView({ data, update }) {
  const [showForm, setShowForm] = useState(false);

  function addDeposit(playerId, amount, note) {
    const dep = {
      id: `dep_${Date.now()}`,
      playerId, amount: parseFloat(amount),
      paidAt: new Date().toISOString(),
      refunded: false,
      note,
    };
    update('deposits', [...data.deposits, dep]);
    update('transactions', [...data.transactions, {
      id: `tx_${Date.now()}`, type: 'pfand_eingang', amount: parseFloat(amount),
      playerId, depositId: dep.id, date: new Date().toISOString(), note: note || 'Pfandeingang',
    }]);
    setShowForm(false);
  }

  function deleteDeposit(id) {
    if (!confirm('Pfandeintrag löschen?')) return;
    update('deposits', data.deposits.filter(d => d.id !== id));
  }

  const active = data.deposits.filter(d => !d.refunded);
  const refunded = data.deposits.filter(d => d.refunded);
  const total = active.reduce((s, d) => s + d.amount, 0);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <PageHeader number="06" label="VERWALTUNG" title="Pfandkasse" subtitle={`${active.length} aktive Pfänder · gesamt ${total.toFixed(2)} €`} />
        <button onClick={() => setShowForm(true)} className="px-5 py-2.5 text-xs font-medium flex items-center gap-2 uppercase"
          style={{ background: 'var(--vereinsblau)', color: 'white', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
          <Plus size={14} /> Pfand einnehmen
        </button>
      </div>

      {showForm && <DepositForm players={data.players} deposits={data.deposits} defaultAmount={data.settings.defaultDeposit} onSave={addDeposit} onCancel={() => setShowForm(false)} />}

      <div className="bg-white border border-stone-200 overflow-hidden mb-6">
        <div className="p-4 border-b border-stone-200 bg-stone-50">
          <h2 className="font-display text-xl">AKTIVE PFÄNDER</h2>
        </div>
        {active.length === 0 ? (
          <div className="p-8 text-center text-stone-500 text-sm">Keine aktiven Pfänder.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wider text-stone-500">
                <tr><th className="text-left p-3">Spieler</th><th className="text-left p-3 hidden md:table-cell">Eingegangen</th><th className="text-left p-3">Betrag</th><th className="text-left p-3 hidden lg:table-cell">Notiz</th><th className="p-3"></th></tr>
              </thead>
              <tbody>
                {active.map(d => {
                  const p = data.players.find(pl => pl.id === d.playerId);
                  return (
                    <tr key={d.id} className="border-t border-stone-100">
                      <td className="p-3 font-medium">{p ? `${p.firstName} ${p.lastName}` : '–'}<div className="text-xs text-stone-500">{p?.team}</div></td>
                      <td className="p-3 hidden md:table-cell text-stone-600">{new Date(d.paidAt).toLocaleDateString('de-DE')}</td>
                      <td className="p-3 font-display text-lg text-emerald-700">{d.amount.toFixed(2)} €</td>
                      <td className="p-3 hidden lg:table-cell text-stone-600 text-xs">{d.note || '–'}</td>
                      <td className="p-3 text-right">
                        <button onClick={() => deleteDeposit(d.id)} className="text-stone-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {refunded.length > 0 && (
        <div className="bg-white border border-stone-200 overflow-hidden">
          <div className="p-4 border-b border-stone-200 bg-stone-50">
            <h2 className="font-display text-xl">ABGERECHNETE PFÄNDER</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wider text-stone-500">
                <tr><th className="text-left p-3">Spieler</th><th className="text-left p-3">Eingenommen</th><th className="text-left p-3">Rückzahlung</th><th className="text-left p-3">Einbehalten</th><th className="text-left p-3 hidden md:table-cell">Datum</th></tr>
              </thead>
              <tbody>
                {refunded.map(d => {
                  const p = data.players.find(pl => pl.id === d.playerId);
                  return (
                    <tr key={d.id} className="border-t border-stone-100">
                      <td className="p-3 font-medium">{p ? `${p.firstName} ${p.lastName}` : '–'}</td>
                      <td className="p-3">{d.amount.toFixed(2)} €</td>
                      <td className="p-3 text-emerald-700">{(d.refundAmount || 0).toFixed(2)} €</td>
                      <td className="p-3 text-orange-700">{(d.amount - (d.refundAmount || 0)).toFixed(2)} €</td>
                      <td className="p-3 hidden md:table-cell text-stone-600">{d.refundedAt ? new Date(d.refundedAt).toLocaleDateString('de-DE') : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function DepositForm({ players, deposits, defaultAmount, onSave, onCancel }) {
  const [playerId, setPlayerId] = useState('');
  const [amount, setAmount] = useState(defaultAmount);
  const [note, setNote] = useState('');
  const existing = deposits.find(d => d.playerId === playerId && !d.refunded);

  return (
    <div className="bg-white border-2 border-stone-900 p-6 mb-4">
      <h2 className="font-display text-2xl mb-4">PFAND EINNEHMEN</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={`Spieler ${existing ? '⚠ hat bereits Pfand hinterlegt' : ''}`}>
          <select className={`w-full border px-3 py-2 text-sm ${existing ? 'border-orange-500' : 'border-stone-300'}`}
            value={playerId} onChange={e => setPlayerId(e.target.value)}>
            <option value="">– wählen –</option>
            {players.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName} ({p.team})</option>)}
          </select>
        </Field>
        <Field label="Betrag (€)">
          <input type="number" step="0.01" className="w-full border border-stone-300 px-3 py-2 text-sm" value={amount} onChange={e => setAmount(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notiz">
            <input className="w-full border border-stone-300 px-3 py-2 text-sm" value={note} onChange={e => setNote(e.target.value)} placeholder="z.B. Saison 2026/27" />
          </Field>
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={() => playerId && amount && onSave(playerId, amount, note)}
          disabled={!playerId || !amount} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">Speichern</button>
        <button onClick={onCancel} className="border border-stone-300 px-4 py-2 text-sm">Abbrechen</button>
      </div>
    </div>
  );
}

// ============ RÜCKGABE / ZEITWERTBERECHNUNG ============
function ReturnsView({ data, update }) {
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [conditions, setConditions] = useState({});
  const [totalForfeit, setTotalForfeit] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const player = data.players.find(p => p.id === selectedPlayer);
  const playerItems = data.inventory.filter(i => i.assignedTo === selectedPlayer && i.status === 'ausgegeben');
  const deposit = data.deposits.find(d => d.playerId === selectedPlayer && !d.refunded);

  // Berechnung — abhängig vom Pfandmodus
  const mode = getDepositMode(data.settings);
  const conditionFactors = getConditionFactors(data.settings);
  const seasonDepreciation = getSeasonDepreciation(data.settings);

  const calc = playerItems.map(item => {
    const cond = conditions[item.id] || (mode === 'pauschal' ? 'ok' : (item.condition || 'gut'));
    let lossValue = 0;
    let currentValue = item.originalPrice;

    if (mode === 'pauschal') {
      // FCF-Pfandordnung: Festwert nur bei "beschädigt" oder "fehlt"
      // ok = vollständig & nutzbar → 0 € Abzug
      // beschaedigt / fehlt → Ersatzwert wird abgezogen
      if (cond === 'beschaedigt' || cond === 'fehlt') {
        const item_def = data.items.find(i => i.id === item.itemType);
        lossValue = item_def?.replacementValue ?? Math.round(item.originalPrice * 0.6);
        currentValue = item.originalPrice - lossValue;
      }
    } else {
      // Saison-Modell: Abschreibung × Zustandsfaktor
      const seasons = item.seasonsUsed || 0;
      const seasonValue = Math.max(0, 1 - (seasons * seasonDepreciation));
      const condFactor = conditionFactors[cond]?.factor ?? 0;
      currentValue = item.originalPrice * seasonValue * condFactor;
      lossValue = item.originalPrice - currentValue;
    }
    return { item, cond, currentValue, lossValue };
  });

  const itemLossSum = calc.reduce((s, c) => s + c.lossValue, 0);
  // Pauschal-Modus: Wenn "Total-Verfall" angehakt ist, verfällt das ganze Pfand (Punkt 8 Pfandordnung)
  const totalLoss = (mode === 'pauschal' && totalForfeit) ? (deposit?.amount ?? 0) : itemLossSum;
  const refund = deposit ? Math.max(0, deposit.amount - totalLoss) : 0;
  const retained = deposit ? deposit.amount - refund : 0;

  function processReturn() {
    if (!confirming) { setConfirming(true); return; }
    const now = new Date().toISOString();
    // Material zurück ins Lager mit Zustandsupdate
    const newInv = data.inventory.map(i => {
      if (i.assignedTo === selectedPlayer && i.status === 'ausgegeben') {
        const cond = conditions[i.id] || (mode === 'pauschal' ? 'ok' : 'gut');
        // Status "verloren" / nicht mehr im Lager: bei Pauschal-Modus "fehlt", bei Saison "defekt"
        const isLost = (mode === 'pauschal' && cond === 'fehlt') || (mode === 'saison' && cond === 'defekt');
        if (isLost) {
          return { ...i, status: 'verloren', returnedAt: now, condition: cond };
        }
        return {
          ...i,
          status: 'lager',
          assignedTo: null,
          assignedNumber: null,
          returnedAt: now,
          condition: cond,
          seasonsUsed: (i.seasonsUsed || 0) + 1,
        };
      }
      return i;
    });
    update('inventory', newInv);

    // Pfand abrechnen
    if (deposit) {
      update('deposits', data.deposits.map(d => d.id === deposit.id ? {
        ...d, refunded: true, refundedAt: now, refundAmount: refund, retainedAmount: retained,
      } : d));
      if (refund > 0) {
        update('transactions', [...data.transactions, {
          id: `tx_${Date.now()}`, type: 'pfand_rueckzahlung', amount: -refund,
          playerId: selectedPlayer, depositId: deposit.id, date: now,
          note: `Rückzahlung an ${player.firstName} ${player.lastName}`,
        }]);
      }
      if (retained > 0) {
        update('transactions', [...data.transactions, {
          id: `tx_${Date.now() + 1}`, type: 'pfand_einbehalten', amount: 0,
          playerId: selectedPlayer, depositId: deposit.id, date: now,
          note: `${retained.toFixed(2)} € einbehalten für Verschleiß/Verlust`,
        }]);
      }
    }
    setSelectedPlayer(''); setConditions({}); setConfirming(false);
    alert('Rückgabe abgeschlossen.');
  }

  return (
    <div>
      <div className="mb-8">
        <PageHeader number="07" label="SAISONABSCHLUSS" title="Material zurücknehmen" subtitle="Material einsammeln · Zeitwert berechnen · Pfand abrechnen" />
      </div>

      <div className="bg-white border border-stone-200 p-6 mb-4">
        <Field label="Spieler auswählen">
          <select className="w-full border border-stone-300 px-3 py-2 text-sm max-w-md" value={selectedPlayer} onChange={e => { setSelectedPlayer(e.target.value); setConditions({}); setConfirming(false); }}>
            <option value="">– wählen –</option>
            {data.players.filter(p => data.inventory.some(i => i.assignedTo === p.id && i.status === 'ausgegeben') ||
              data.deposits.some(d => d.playerId === p.id && !d.refunded))
              .map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName} ({p.team})</option>)}
          </select>
        </Field>
      </div>

      {player && (
        <>
          <div className="bg-white border border-stone-200 mb-4">
            <div className="p-4 border-b border-stone-200 bg-stone-50 flex flex-wrap justify-between items-center gap-2">
              <div>
                <h2 className="font-display text-xl">{player.firstName} {player.lastName} – {player.team}</h2>
                <p className="text-xs text-stone-500">{playerItems.length} ausgegebene Teile · Pfand: {deposit ? `${deposit.amount.toFixed(2)} €` : 'kein Pfand hinterlegt'}</p>
              </div>
            </div>

            {playerItems.length === 0 ? (
              <div className="p-6 text-center text-stone-500 text-sm">Kein Material ausgegeben an diesen Spieler.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 text-xs uppercase tracking-wider text-stone-500">
                    <tr>
                      <th className="text-left p-3">Artikel</th>
                      {mode === 'saison' && <th className="text-left p-3 hidden sm:table-cell">Saisons</th>}
                      <th className="text-left p-3 hidden md:table-cell">{mode === 'pauschal' ? 'Ersatzwert' : 'Neupreis'}</th>
                      <th className="text-left p-3">{mode === 'pauschal' ? 'Rückgabe-Status' : 'Zustand'}</th>
                      <th className="text-left p-3 hidden lg:table-cell">Abzug</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calc.map(({ item, cond, lossValue }) => {
                      const itemDef = data.items.find(i => i.id === item.itemType);
                      const replacementValue = itemDef?.replacementValue ?? Math.round(item.originalPrice * 0.6);
                      return (
                        <tr key={item.id} className="border-t border-stone-100">
                          <td className="p-3"><div className="font-medium">{item.itemName}</div><div className="text-xs text-stone-500">Größe {item.size}</div></td>
                          {mode === 'saison' && <td className="p-3 hidden sm:table-cell">{item.seasonsUsed || 0}</td>}
                          <td className="p-3 hidden md:table-cell">
                            {mode === 'pauschal' ? `${replacementValue.toFixed(2)} €` : `${item.originalPrice.toFixed(2)} €`}
                          </td>
                          <td className="p-3">
                            {mode === 'pauschal' ? (
                              <select className="border border-stone-300 px-2 py-1 text-xs"
                                value={cond}
                                onChange={e => setConditions({ ...conditions, [item.id]: e.target.value })}>
                                <option value="ok">✓ Vollständig & nutzbar</option>
                                <option value="beschaedigt">O Beschädigt</option>
                                <option value="fehlt">X Fehlt</option>
                              </select>
                            ) : (
                              <select className="border border-stone-300 px-2 py-1 text-xs"
                                value={cond}
                                onChange={e => setConditions({ ...conditions, [item.id]: e.target.value })}>
                                {Object.entries(conditionFactors).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                              </select>
                            )}
                          </td>
                          <td className="p-3 hidden lg:table-cell" style={{ color: lossValue > 0 ? 'var(--warn)' : 'var(--ink-mute)' }}>
                            {lossValue.toFixed(2)} €
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {mode === 'pauschal' && deposit && (
            <div className="bg-white p-4 mb-4" style={{ border: '1px solid var(--rule)', borderLeft: '3px solid var(--warn)' }}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={totalForfeit} onChange={e => setTotalForfeit(e.target.checked)} className="mt-1" />
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Pfand vollständig einbehalten (gemäß Punkt 8 Pfandordnung)</div>
                  <div className="text-xs mt-1" style={{ color: 'var(--ink-mute)' }}>
                    Anwenden, wenn keine Kleidung zurückgegeben wurde, die Kleidung stark beschädigt / nicht nutzbar ist, oder Rückgabehinweise mehrfach ignoriert wurden.
                  </div>
                </div>
              </label>
            </div>
          )}

          {deposit && (
            <div className="p-7 mb-4 text-white" style={{ background: 'var(--vereinsblau)' }}>
              <div className="font-sub text-xs mb-2" style={{ color: 'var(--gold)', letterSpacing: '0.18em' }}>PFANDABRECHNUNG</div>
              <h3 className="font-display text-3xl mb-6">Schlussbilanz für {player.firstName} {player.lastName}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-sm">
                <div>
                  <div className="font-sub text-xs mb-1" style={{ color: '#A8B8D0', letterSpacing: '0.18em' }}>PFAND</div>
                  <div className="stat-number text-3xl sm:text-4xl">{deposit.amount.toFixed(2)} €</div>
                </div>
                <div>
                  <div className="font-sub text-xs mb-1" style={{ color: '#A8B8D0', letterSpacing: '0.18em' }}>VERLUST</div>
                  <div className="stat-number text-3xl sm:text-4xl" style={{ color: '#F5C77A' }}>{totalLoss.toFixed(2)} €</div>
                </div>
                <div>
                  <div className="font-sub text-xs mb-1" style={{ color: '#A8B8D0', letterSpacing: '0.18em' }}>EINBEHALT</div>
                  <div className="stat-number text-3xl sm:text-4xl" style={{ color: '#F5C77A' }}>{retained.toFixed(2)} €</div>
                </div>
                <div>
                  <div className="font-sub text-xs mb-1" style={{ color: '#A8B8D0', letterSpacing: '0.18em' }}>AUSZAHLUNG</div>
                  <div className="stat-number text-3xl sm:text-4xl" style={{ color: '#9DD89D' }}>{refund.toFixed(2)} €</div>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={processReturn}
              className="px-7 py-3 text-xs font-medium uppercase text-white"
              style={{
                background: confirming ? 'var(--danger)' : 'var(--vereinsblau)',
                fontFamily: "'Bebas Neue', sans-serif",
                letterSpacing: '0.15em',
              }}>
              {confirming ? 'Bestätigen: Rückgabe abschließen' : 'Rückgabe verarbeiten'}
            </button>
            {confirming && <button onClick={() => setConfirming(false)} className="px-7 py-3 text-xs uppercase" style={{ border: '1px solid var(--rule)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>Abbrechen</button>}
          </div>
        </>
      )}
    </div>
  );
}

// ============ BESTELLUNGEN + FLOCK-LISTE ============
function OrdersView({ data, update }) {
  const [showForm, setShowForm] = useState(false);
  const [viewing, setViewing] = useState(null);

  function saveOrder(order) {
    const newOrder = { ...order, id: `ord_${Date.now()}`, createdAt: new Date().toISOString(), status: 'angelegt' };
    update('orders', [...data.orders, newOrder]);
    setShowForm(false);
  }

  function setStatus(id, status) {
    update('orders', data.orders.map(o => o.id === id ? { ...o, status, updatedAt: new Date().toISOString() } : o));
  }

  function remove(id) {
    if (!confirm('Bestellung löschen?')) return;
    update('orders', data.orders.filter(o => o.id !== id));
  }

  if (viewing) return <OrderDetail order={viewing} data={data} onBack={() => setViewing(null)} onStatus={setStatus} />;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <PageHeader number="08" label="BESCHAFFUNG" title="Bestellungen" subtitle={`${data.orders.length} Bestellungen · Flock-Liste integriert`} />
        <button onClick={() => setShowForm(true)} className="px-5 py-2.5 text-xs font-medium flex items-center gap-2 uppercase"
          style={{ background: 'var(--vereinsblau)', color: 'white', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
          <Plus size={14} /> Neue Bestellung
        </button>
      </div>

      {showForm && <OrderForm data={data} onSave={saveOrder} onCancel={() => setShowForm(false)} />}

      <div className="bg-white border border-stone-200 overflow-hidden">
        {data.orders.length === 0 ? (
          <div className="p-12 text-center text-stone-500 text-sm">Noch keine Bestellungen.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wider text-stone-500">
                <tr>
                  <th className="text-left p-3">Bestellung</th>
                  <th className="text-left p-3 hidden sm:table-cell">Mannschaft</th>
                  <th className="text-left p-3 hidden md:table-cell">Teile</th>
                  <th className="text-left p-3">Status</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {[...data.orders].reverse().map(o => (
                  <tr key={o.id} className="border-t border-stone-100">
                    <td className="p-3"><div className="font-medium">{o.title}</div><div className="text-xs text-stone-500">{new Date(o.createdAt).toLocaleDateString('de-DE')}</div></td>
                    <td className="p-3 hidden sm:table-cell">{o.team || 'div.'}</td>
                    <td className="p-3 hidden md:table-cell">{o.lines.reduce((s, l) => s + l.qty, 0)}</td>
                    <td className="p-3">
                      <select value={o.status} onChange={e => setStatus(o.id, e.target.value)} className="border border-stone-300 px-2 py-1 text-xs">
                        {['angelegt', 'bestellt', 'in_produktion', 'geliefert', 'storniert'].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <button onClick={() => setViewing(o)} className="text-xs bg-stone-900 text-white px-2 py-1">Details</button>
                      <button onClick={() => remove(o.id)} className="text-stone-400 hover:text-red-600 p-1 ml-1"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function OrderForm({ data, onSave, onCancel }) {
  const [type, setType] = useState('komplett');
  const [team, setTeam] = useState(data.teams[0] || '');
  const [title, setTitle] = useState('');
  const [supplier, setSupplier] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([]);
  const [sponsors, setSponsors] = useState({ brust: '', ruecken: '', aermel: '' });

  const teamPlayers = data.players.filter(p => p.team === team);

  function addLine() {
    setLines([...lines, { id: `l_${Date.now()}_${Math.random()}`, itemType: data.items[0].id, size: 'L', qty: 1, playerId: '', number: '', name: '' }]);
  }

  function updateLine(id, key, val) {
    setLines(lines.map(l => {
      if (l.id !== id) return l;
      const nl = { ...l, [key]: val };
      // Wenn Spieler gewählt → automatisch Nummer und Name vorbelegen
      if (key === 'playerId' && val) {
        const p = data.players.find(pl => pl.id === val);
        if (p) {
          nl.number = p.number || '';
          nl.name = p.lastName.toUpperCase();
        }
      }
      return nl;
    }));
  }

  function removeLine(id) { setLines(lines.filter(l => l.id !== id)); }

  function generateComplete() {
    // Komplettbestellung: für jeden Spieler der Mannschaft eine Standard-Set
    const newLines = [];
    teamPlayers.forEach(p => {
      data.items.slice(0, 3).forEach(item => { // Trikot heim, auswärts, short heim als Beispiel-Standard
        newLines.push({
          id: `l_${Date.now()}_${Math.random()}`,
          itemType: item.id, size: p.size || 'L', qty: 1,
          playerId: p.id, number: p.number || '', name: p.lastName.toUpperCase(),
        });
      });
    });
    setLines(newLines);
  }

  function submit() {
    if (!title) return alert('Titel fehlt');
    if (lines.length === 0) return alert('Keine Positionen');
    onSave({ title, type, team: type === 'komplett' || type === 'teilweise' ? team : null, supplier, notes, lines, sponsors });
  }

  return (
    <div className="bg-white border-2 border-stone-900 p-6 mb-4">
      <h2 className="font-display text-2xl mb-4">NEUE BESTELLUNG</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <Field label="Titel">
          <input className="w-full border border-stone-300 px-3 py-2 text-sm" value={title} onChange={e => setTitle(e.target.value)} placeholder="z.B. Saison 2026/27 1. Mannschaft" />
        </Field>
        <Field label="Typ">
          <select className="w-full border border-stone-300 px-3 py-2 text-sm" value={type} onChange={e => setType(e.target.value)}>
            <option value="komplett">Komplettbestellung (ganze Mannschaft)</option>
            <option value="teilweise">Teilbestellung (mehrere Spieler)</option>
            <option value="einzeln">Einzelteile (Verschleiß-Ersatz)</option>
          </select>
        </Field>
        {(type === 'komplett' || type === 'teilweise') && (
          <Field label="Mannschaft">
            <select className="w-full border border-stone-300 px-3 py-2 text-sm" value={team} onChange={e => setTeam(e.target.value)}>
              <option value="">– wählen –</option>
              {data.teams.map(t => <option key={t}>{t}</option>)}
            </select>
          </Field>
        )}
        <Field label="Ausrüster / Lieferant">
          <input className="w-full border border-stone-300 px-3 py-2 text-sm" value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="z.B. Teamsport Müller" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notizen">
            <textarea className="w-full border border-stone-300 px-3 py-2 text-sm" rows="2" value={notes} onChange={e => setNotes(e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="bg-stone-50 p-4 mb-4" style={{ border: '1px solid var(--rule)' }}>
        <div className="font-sub text-xs mb-3" style={{ color: 'var(--vereinsblau)', letterSpacing: '0.18em' }}>SPONSOREN-PLATZIERUNG (OPTIONAL)</div>
        <p className="text-xs mb-3" style={{ color: 'var(--ink-mute)' }}>Wird in der Flock-Liste für den Ausrüster ausgewiesen. Leer lassen, wenn kein Sponsor an dieser Stelle.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Brust">
            <input className="w-full border border-stone-300 px-3 py-2 text-sm" value={sponsors.brust}
              onChange={e => setSponsors({ ...sponsors, brust: e.target.value })} placeholder="z. B. Brabus" />
          </Field>
          <Field label="Rücken">
            <input className="w-full border border-stone-300 px-3 py-2 text-sm" value={sponsors.ruecken}
              onChange={e => setSponsors({ ...sponsors, ruecken: e.target.value })} placeholder="z. B. Sparkasse" />
          </Field>
          <Field label="Ärmel">
            <input className="w-full border border-stone-300 px-3 py-2 text-sm" value={sponsors.aermel}
              onChange={e => setSponsors({ ...sponsors, aermel: e.target.value })} placeholder="z. B. Stadtwerke" />
          </Field>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <button onClick={addLine} className="text-xs bg-stone-100 px-3 py-1.5 flex items-center gap-1"><Plus size={12} /> Position</button>
        {type === 'komplett' && teamPlayers.length > 0 && (
          <button onClick={generateComplete} className="text-xs bg-stone-100 px-3 py-1.5">
            Standard-Set für {teamPlayers.length} Spieler erzeugen
          </button>
        )}
      </div>

      {lines.length > 0 && (
        <div className="border border-stone-200 mb-4 overflow-x-auto">
          <table className="w-full text-xs min-w-[600px]">
            <thead className="bg-stone-50 uppercase tracking-wider text-stone-500">
              <tr>
                <th className="text-left p-2">Artikel</th>
                <th className="text-left p-2">Größe</th>
                <th className="text-left p-2">Menge</th>
                <th className="text-left p-2">Spieler</th>
                <th className="text-left p-2">Nr.</th>
                <th className="text-left p-2">Flock-Name</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.id} className="border-t border-stone-100">
                  <td className="p-1">
                    <select value={l.itemType} onChange={e => updateLine(l.id, 'itemType', e.target.value)} className="border border-stone-300 px-1 py-1 text-xs w-full">
                      {data.items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                  </td>
                  <td className="p-1">
                    <select value={l.size} onChange={e => updateLine(l.id, 'size', e.target.value)} className="border border-stone-300 px-1 py-1 text-xs">
                      {['XS','S','M','L','XL','XXL','3XL'].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="p-1"><input type="number" min="1" value={l.qty} onChange={e => updateLine(l.id, 'qty', parseInt(e.target.value) || 1)} className="border border-stone-300 px-1 py-1 text-xs w-14" /></td>
                  <td className="p-1">
                    <select value={l.playerId} onChange={e => updateLine(l.id, 'playerId', e.target.value)} className="border border-stone-300 px-1 py-1 text-xs w-full">
                      <option value="">– Lager –</option>
                      {data.players.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName} ({p.team})</option>)}
                    </select>
                  </td>
                  <td className="p-1"><input type="number" value={l.number} onChange={e => updateLine(l.id, 'number', e.target.value)} className="border border-stone-300 px-1 py-1 text-xs w-12" /></td>
                  <td className="p-1"><input value={l.name} onChange={e => updateLine(l.id, 'name', e.target.value.toUpperCase())} className="border border-stone-300 px-1 py-1 text-xs w-full" /></td>
                  <td><button onClick={() => removeLine(l.id)} className="text-red-600 p-1"><X size={12} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={submit} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium">Bestellung anlegen</button>
        <button onClick={onCancel} className="border border-stone-300 px-4 py-2 text-sm">Abbrechen</button>
      </div>
    </div>
  );
}

function OrderDetail({ order, data, onBack, onStatus }) {
  function downloadCSV(rows, filename) {
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function exportFlockList() {
    const sponsors = order.sponsors || {};
    const rows = [['Artikel', 'Größe', 'Menge', 'Mannschaft', 'Spieler', 'Rückennummer', 'Flock-Name', 'Sponsor Brust', 'Sponsor Rücken', 'Sponsor Ärmel']];
    order.lines.forEach(l => {
      const player = data.players.find(p => p.id === l.playerId);
      rows.push([
        data.items.find(i => i.id === l.itemType)?.name || l.itemType,
        l.size, l.qty,
        player?.team || order.team || '–',
        player ? `${player.firstName} ${player.lastName}` : 'Lagerware',
        l.number || '–',
        l.name || '–',
        sponsors.brust || '',
        sponsors.ruecken || '',
        sponsors.aermel || '',
      ]);
    });
    downloadCSV(rows, `flockliste_${order.title.replace(/\s+/g, '_')}.csv`);
  }

  function exportOrderList() {
    const rows = [['Artikel', 'Größe', 'Menge']];
    // Aggregiert nach Artikel + Größe (für Lieferantenbestellung)
    const agg = {};
    order.lines.forEach(l => {
      const key = `${l.itemType}__${l.size}`;
      if (!agg[key]) agg[key] = { ...l, qty: 0 };
      agg[key].qty += l.qty;
    });
    Object.values(agg).forEach(l => {
      rows.push([data.items.find(i => i.id === l.itemType)?.name || l.itemType, l.size, l.qty]);
    });
    downloadCSV(rows, `bestellliste_${order.title.replace(/\s+/g, '_')}.csv`);
  }

  async function exportPDF() {
    // Dynamischer Import, damit der Hauptbundle klein bleibt
    const [{ default: jsPDF }, autoTableModule] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const autoTable = autoTableModule.default || autoTableModule.autoTable;

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const sponsors = order.sponsors || {};
    const settings = data.settings || {};

    // Kopfblock mit Vereinsblau
    doc.setFillColor(11, 45, 92); // Vereinsblau
    doc.rect(0, 0, W, 30, 'F');
    doc.setTextColor(201, 162, 39); // Gold
    doc.setFontSize(8);
    doc.text('BESTELLUNG · TRIKOTVERWALTUNG', 14, 11);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.text(order.title, 14, 21);
    doc.setFontSize(9);
    doc.setTextColor(168, 184, 208);
    doc.text(settings.clubName || 'F. C. Frohlinde 1949 e. V.', 14, 27);

    // Metadaten-Block
    let y = 40;
    doc.setTextColor(26, 26, 26);
    doc.setFontSize(9);
    doc.text(`Erstellt: ${new Date(order.createdAt).toLocaleDateString('de-DE')}`, 14, y);
    doc.text(`Status: ${order.status}`, 14, y + 5);
    if (order.team) doc.text(`Mannschaft: ${order.team}`, 14, y + 10);
    if (order.supplier) doc.text(`Lieferant: ${order.supplier}`, W - 14, y, { align: 'right' });
    doc.text(`${order.lines.reduce((s, l) => s + l.qty, 0)} Teile gesamt`, W - 14, y + 5, { align: 'right' });
    y += 18;

    if (order.notes) {
      doc.setFontSize(9);
      doc.setTextColor(74, 72, 69);
      const noteLines = doc.splitTextToSize(`Notiz: ${order.notes}`, W - 28);
      doc.text(noteLines, 14, y);
      y += noteLines.length * 4 + 4;
    }

    // Sponsoren-Block
    if (sponsors.brust || sponsors.ruecken || sponsors.aermel) {
      doc.setFillColor(241, 236, 223);
      doc.rect(14, y, W - 28, 22, 'F');
      doc.setTextColor(11, 45, 92);
      doc.setFontSize(8);
      doc.text('SPONSOREN-PLATZIERUNG', 18, y + 5);
      doc.setTextColor(26, 26, 26);
      doc.setFontSize(10);
      const colW = (W - 28) / 3;
      const labels = [
        { k: 'brust', l: 'BRUST' },
        { k: 'ruecken', l: 'RÜCKEN' },
        { k: 'aermel', l: 'ÄRMEL' },
      ];
      labels.forEach((s, i) => {
        const x = 18 + i * colW;
        doc.setFontSize(7);
        doc.setTextColor(128, 125, 120);
        doc.text(s.l, x, y + 11);
        doc.setFontSize(11);
        doc.setTextColor(26, 26, 26);
        doc.text(sponsors[s.k] || '–', x, y + 17);
      });
      y += 26;
    }

    // Aggregierte Bestellliste
    const agg = {};
    order.lines.forEach(l => {
      const key = `${l.itemType}__${l.size}`;
      if (!agg[key]) {
        const item = data.items.find(i => i.id === l.itemType);
        agg[key] = { name: item?.name || l.itemType, size: l.size, qty: 0 };
      }
      agg[key].qty += l.qty;
    });

    autoTable(doc, {
      startY: y,
      head: [['BESTELLLISTE FÜR LIEFERANTEN', '', '']],
      body: [],
      theme: 'plain',
      headStyles: { fillColor: [11, 45, 92], textColor: [255, 255, 255], fontSize: 9, halign: 'left' },
      margin: { left: 14, right: 14 },
    });
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY,
      head: [['Artikel', 'Größe', 'Menge']],
      body: Object.values(agg).map(a => [a.name, a.size, String(a.qty)]),
      headStyles: { fillColor: [241, 236, 223], textColor: [11, 45, 92], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 9 },
      alternateRowStyles: { fillColor: [252, 250, 246] },
      columnStyles: { 2: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });

    // Flock-Liste
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 8,
      head: [['FLOCK-LISTE FÜR DEN AUSRÜSTER', '', '', '', '', '']],
      body: [],
      theme: 'plain',
      headStyles: { fillColor: [11, 45, 92], textColor: [255, 255, 255], fontSize: 9, halign: 'left' },
      margin: { left: 14, right: 14 },
    });
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY,
      head: [['Artikel', 'Gr.', 'Mge', 'Mannschaft / Spieler', 'Nr.', 'Flock-Name']],
      body: order.lines.map(l => {
        const player = data.players.find(p => p.id === l.playerId);
        const item = data.items.find(i => i.id === l.itemType);
        return [
          item?.name || l.itemType,
          l.size,
          String(l.qty),
          player ? `${player.team || order.team || '–'}\n${player.firstName} ${player.lastName}` : `${order.team || '–'}\nLagerware`,
          l.number ? String(l.number) : '–',
          l.name || '–',
        ];
      }),
      headStyles: { fillColor: [241, 236, 223], textColor: [11, 45, 92], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 9, valign: 'middle' },
      alternateRowStyles: { fillColor: [252, 250, 246] },
      columnStyles: {
        1: { halign: 'center' },
        2: { halign: 'right' },
        4: { halign: 'center', fontStyle: 'bold', fontSize: 11 },
        5: { fontStyle: 'bold' },
      },
      margin: { left: 14, right: 14 },
      didDrawPage: (data) => {
        // Footer
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setFontSize(8);
        doc.setTextColor(128, 125, 120);
        doc.text(`Seite ${doc.internal.getNumberOfPages()}`, W - 14, pageHeight - 8, { align: 'right' });
        doc.text(`${settings.clubName || 'F. C. Frohlinde'} · #DeinDorfverein`, 14, pageHeight - 8);
      },
    });

    doc.save(`bestellung_${order.title.replace(/\s+/g, '_')}.pdf`);
  }

  const totalQty = order.lines.reduce((s, l) => s + l.qty, 0);

  return (
    <div>
      <button onClick={onBack} className="text-sm mb-6 flex items-center gap-1 hover:underline" style={{ color: 'var(--vereinsblau)' }}><ArrowLeft size={14} /> Zurück zu Bestellungen</button>
      <div className="bg-white p-7 mb-4" style={{ border: '1px solid var(--rule)' }}>
        <div className="flex flex-wrap justify-between items-start gap-4">
          <div>
            <div className="section-label mb-2">BESTELLUNG</div>
            <h1 className="font-display text-3xl sm:text-4xl leading-tight" style={{ color: 'var(--ink)' }}>{order.title}</h1>
            <div className="flex items-center gap-3 mt-3">
              <div className="h-px w-12" style={{ background: 'var(--vereinsblau)' }} />
              <p className="text-sm" style={{ color: 'var(--ink-mute)' }}>
                {order.team || 'mehrere Mannschaften'} · {totalQty} Teile · Status: <span className="font-medium" style={{ color: 'var(--ink)' }}>{order.status}</span>
              </p>
            </div>
            {order.supplier && <p className="text-xs mt-2" style={{ color: 'var(--ink-mute)' }}>Lieferant: {order.supplier}</p>}
            {order.notes && <p className="text-sm mt-3 italic" style={{ color: 'var(--ink-soft)' }}>{order.notes}</p>}
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={exportOrderList} className="px-4 py-2 text-xs uppercase flex items-center gap-2" style={{ background: 'var(--paper-dark)', color: 'var(--ink)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
              <Download size={14} /> Bestellliste CSV
            </button>
            <button onClick={exportFlockList} className="px-4 py-2 text-xs uppercase flex items-center gap-2" style={{ background: 'var(--paper-dark)', color: 'var(--ink)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
              <Download size={14} /> Flock-Liste CSV
            </button>
            <button onClick={exportPDF} className="px-4 py-2 text-xs uppercase flex items-center gap-2 text-white" style={{ background: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
              <FileText size={14} /> Komplett-PDF
            </button>
          </div>
        </div>
      </div>

      {(order.sponsors?.brust || order.sponsors?.ruecken || order.sponsors?.aermel) && (
        <div className="bg-white border border-stone-200 mb-4 p-5">
          <div className="font-sub text-xs mb-3" style={{ color: 'var(--vereinsblau)', letterSpacing: '0.18em' }}>SPONSOREN-PLATZIERUNG</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { key: 'brust', label: 'Brust' },
              { key: 'ruecken', label: 'Rücken' },
              { key: 'aermel', label: 'Ärmel' },
            ].map(s => order.sponsors[s.key] && (
              <div key={s.key} className="border-l-2 pl-3" style={{ borderColor: 'var(--gold)' }}>
                <div className="font-sub text-xs" style={{ color: 'var(--ink-mute)', letterSpacing: '0.18em' }}>{s.label.toUpperCase()}</div>
                <div className="font-display text-xl" style={{ color: 'var(--ink)' }}>{order.sponsors[s.key]}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-stone-200 overflow-hidden mb-4">
        <div className="p-4 border-b border-stone-200 bg-stone-50">
          <h2 className="font-display text-xl">FLOCK-LISTE FÜR DEN AUSRÜSTER</h2>
          <p className="text-xs text-stone-500 mt-1">Diese Übersicht enthält alle Beflockungen pro Teil. Sponsoren-Platzierungen sind oben gelistet und gelten für alle Teile dieser Bestellung.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wider text-stone-500">
              <tr>
                <th className="text-left p-3">Artikel</th>
                <th className="text-left p-3">Größe</th>
                <th className="text-left p-3">Menge</th>
                <th className="text-left p-3">Mannschaft</th>
                <th className="text-left p-3">Spieler</th>
                <th className="text-left p-3 font-display text-base">NR.</th>
                <th className="text-left p-3 font-display text-base">FLOCK-NAME</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map(l => {
                const player = data.players.find(p => p.id === l.playerId);
                const item = data.items.find(i => i.id === l.itemType);
                return (
                  <tr key={l.id} className="border-t border-stone-100">
                    <td className="p-3">{item?.name}</td>
                    <td className="p-3">{l.size}</td>
                    <td className="p-3 font-medium">{l.qty}</td>
                    <td className="p-3 text-stone-600">{player?.team || order.team || '–'}</td>
                    <td className="p-3">{player ? `${player.firstName} ${player.lastName}` : <span className="text-stone-400">Lagerware</span>}</td>
                    <td className="p-3 font-display text-2xl">{l.number || '–'}</td>
                    <td className="p-3 font-display text-xl tracking-wider">{l.name || '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============ EINSTELLUNGEN ============
function SettingsView({ data, update }) {
  const [settings, setSettings] = useState({
    defaultDeposit: 100,
    clubName: 'FC Frohlinde 1949 e.V.',
    seasonDepreciation: DEFAULT_SEASON_DEPRECIATION,
    conditionFactors: DEFAULT_CONDITION_FACTORS,
    weeklyReportEnabled: false,
    weeklyReportEmail: '',
    weeklyReportFrom: '',
    ...(data.settings || {}),
    // conditionFactors absichern: jedes Feld muss label und factor haben
    conditionFactors: Object.fromEntries(
      Object.entries({ ...DEFAULT_CONDITION_FACTORS, ...(data.settings?.conditionFactors || {}) })
        .map(([k, v]) => [k, {
          label: typeof v?.label === 'string' ? v.label : (DEFAULT_CONDITION_FACTORS[k]?.label || k),
          factor: typeof v?.factor === 'number' ? v.factor : (DEFAULT_CONDITION_FACTORS[k]?.factor ?? 0),
        }])
    ),
  });
  const [items, setItems] = useState(Array.isArray(data.items) ? data.items : []);
  const [newTeam, setNewTeam] = useState('');
  const [renamingTeam, setRenamingTeam] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  function saveSettings() {
    update('settings', settings);
    update('items', items);
    alert('Einstellungen gespeichert.');
  }

  function addTeam() {
    const name = newTeam.trim();
    if (!name) return;
    if (data.teams.includes(name)) { alert('Mannschaft existiert bereits.'); return; }
    update('teams', [...data.teams, name]);
    setNewTeam('');
  }

  function removeTeam(name) {
    const playerCount = data.players.filter(p => p.team === name).length;
    if (playerCount > 0) {
      alert(`Diese Mannschaft hat noch ${playerCount} Spieler. Bitte zuerst Spieler verschieben oder löschen.`);
      return;
    }
    if (!confirm(`Mannschaft "${name}" wirklich löschen?`)) return;
    update('teams', data.teams.filter(t => t !== name));
  }

  function startRename(name) {
    setRenamingTeam(name);
    setRenameValue(name);
  }

  function commitRename() {
    const oldName = renamingTeam;
    const newName = renameValue.trim();
    if (!newName) { setRenamingTeam(null); return; }
    if (newName === oldName) { setRenamingTeam(null); return; }
    if (data.teams.includes(newName)) { alert('Name bereits vergeben.'); return; }
    // Mannschaft umbenennen + alle Spieler mitziehen + alle Bestellungen mitziehen
    update('teams', data.teams.map(t => t === oldName ? newName : t));
    update('players', data.players.map(p => p.team === oldName ? { ...p, team: newName } : p));
    update('orders', data.orders.map(o => o.team === oldName ? { ...o, team: newName } : o));
    setRenamingTeam(null);
  }

  function moveTeam(name, direction) {
    const idx = data.teams.indexOf(name);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= data.teams.length) return;
    const newTeams = [...data.teams];
    [newTeams[idx], newTeams[newIdx]] = [newTeams[newIdx], newTeams[idx]];
    update('teams', newTeams);
  }

  function addItem() {
    setItems([...items, { id: `custom_${Date.now()}`, name: 'Neuer Artikel', price: 30, replacementValue: 20 }]);
  }

  function loadFCFDefaults() {
    if (!confirm('FCF-Pfandordnung 2025 laden? Der aktuelle Artikelkatalog wird ersetzt. Pfand: 70 €, 8 Standardteile mit Ersatzwerten gemäß Pfandordnung.')) return;
    setItems(FCF_DEFAULT_ITEMS);
    setSettings({
      ...settings,
      defaultDeposit: 70,
      depositMode: 'pauschal',
    });
  }

  function exportAll() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `trikotverwaltung_backup_${new Date().toISOString().split('T')[0]}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  async function importAll(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('Aktueller Bestand wird überschrieben. Fortfahren?')) return;
    const text = await file.text();
    try {
      const imported = JSON.parse(text);
      Object.entries(imported).forEach(([k, v]) => update(k, v));
      alert('Daten importiert.');
    } catch { alert('Datei konnte nicht gelesen werden.'); }
  }

  return (
    <div>
      <PageHeader number="09" label="KONFIGURATION" title="Einstellungen" subtitle="Mannschaften, Artikelkatalog, Backup" />

      <div className="bg-white border border-stone-200 p-6 mb-4">
        <h2 className="font-display text-2xl mb-4">ALLGEMEIN</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Vereinsname">
            <input className="w-full border border-stone-300 px-3 py-2 text-sm" value={settings.clubName} onChange={e => setSettings({ ...settings, clubName: e.target.value })} />
          </Field>
          <Field label="Standard-Pfandbetrag (€)">
            <input type="number" className="w-full border border-stone-300 px-3 py-2 text-sm" value={Number.isFinite(settings.defaultDeposit) ? settings.defaultDeposit : 0} onChange={e => setSettings({ ...settings, defaultDeposit: parseFloat(e.target.value) || 0 })} />
          </Field>
        </div>
      </div>

      <div className="bg-white border border-stone-200 p-6 mb-4">
        <h2 className="font-display text-2xl mb-4">MANNSCHAFTEN</h2>
        <p className="text-xs text-stone-500 mb-3">Mannschaften anlegen, umbenennen, sortieren oder löschen. Beim Umbenennen ziehen Spieler und Bestellungen automatisch mit.</p>

        <div className="flex gap-2 mb-4">
          <input
            className="flex-1 border border-stone-300 px-3 py-2 text-sm"
            value={newTeam}
            onChange={e => setNewTeam(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addTeam()}
            placeholder="z.B. A-Jugend, Damen, Alte Herren"
          />
          <button onClick={addTeam} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium flex items-center gap-1">
            <Plus size={14} /> Hinzufügen
          </button>
        </div>

        {data.teams.length === 0 ? (
          <div className="text-sm text-stone-500 italic">Noch keine Mannschaften angelegt.</div>
        ) : (
          <div className="space-y-2">
            {data.teams.map((t, idx) => {
              const playerCount = data.players.filter(p => p.team === t).length;
              const isRenaming = renamingTeam === t;
              return (
                <div key={t} className="flex items-center gap-2 border border-stone-200 p-2">
                  <div className="flex flex-col">
                    <button onClick={() => moveTeam(t, -1)} disabled={idx === 0} className="text-stone-400 hover:text-stone-900 disabled:opacity-20 text-xs leading-none">▲</button>
                    <button onClick={() => moveTeam(t, 1)} disabled={idx === data.teams.length - 1} className="text-stone-400 hover:text-stone-900 disabled:opacity-20 text-xs leading-none">▼</button>
                  </div>
                  {isRenaming ? (
                    <input
                      autoFocus
                      className="flex-1 border border-stone-900 px-2 py-1 text-sm"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setRenamingTeam(null);
                      }}
                    />
                  ) : (
                    <div className="flex-1 text-sm font-medium">{t}</div>
                  )}
                  <span className="text-xs text-stone-500 hidden sm:inline">{playerCount} Spieler</span>
                  {!isRenaming && (
                    <button onClick={() => startRename(t)} className="text-stone-400 hover:text-stone-900 p-1" title="Umbenennen">
                      <Edit2 size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => removeTeam(t)}
                    className={`p-1 ${playerCount > 0 ? 'text-stone-300 cursor-not-allowed' : 'text-stone-400 hover:text-red-600'}`}
                    title={playerCount > 0 ? `Erst ${playerCount} Spieler verschieben` : 'Löschen'}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white border border-stone-200 p-6 mb-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-display text-2xl">ARTIKELKATALOG</h2>
          <button onClick={addItem} className="text-xs bg-stone-100 px-3 py-1.5 flex items-center gap-1"><Plus size={12} /> Artikel</button>
        </div>
        <p className="text-xs text-stone-500 mb-3">
          Neupreis wird im Saison-Modell zur Zeitwertberechnung genutzt. Ersatzwert ist der Festbetrag, der im Pauschal-Modus (FCF-Pfandordnung) bei beschädigten oder verlorenen Teilen vom Pfand abgezogen wird.
        </p>
        <div className="grid grid-cols-12 gap-2 text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--ink-mute)' }}>
          <div className="col-span-6">Artikel</div>
          <div className="col-span-3 text-right">Neupreis</div>
          <div className="col-span-2 text-right">Ersatzwert</div>
        </div>
        <div className="space-y-2">
          {items.map((it, idx) => (
            <div key={it.id} className="grid grid-cols-12 gap-2 items-center">
              <input className="col-span-6 border border-stone-300 px-3 py-2 text-sm" value={it.name}
                onChange={e => setItems(items.map((i, ix) => ix === idx ? { ...i, name: e.target.value } : i))} />
              <div className="col-span-3 flex items-center gap-1">
                <input type="number" step="0.01" className="flex-1 border border-stone-300 px-2 py-2 text-sm text-right"
                  value={Number.isFinite(it.price) ? it.price : 0}
                  onChange={e => setItems(items.map((i, ix) => ix === idx ? { ...i, price: parseFloat(e.target.value) || 0 } : i))} />
                <span className="text-xs" style={{ color: 'var(--ink-mute)' }}>€</span>
              </div>
              <div className="col-span-2 flex items-center gap-1">
                <input type="number" step="0.01" className="flex-1 border border-stone-300 px-2 py-2 text-sm text-right"
                  value={Number.isFinite(it.replacementValue) ? it.replacementValue : ''}
                  placeholder="–"
                  onChange={e => setItems(items.map((i, ix) => ix === idx ? { ...i, replacementValue: e.target.value === '' ? null : (parseFloat(e.target.value) || 0) } : i))} />
                <span className="text-xs" style={{ color: 'var(--ink-mute)' }}>€</span>
              </div>
              <button onClick={() => setItems(items.filter((_, ix) => ix !== idx))} className="col-span-1 text-stone-400 hover:text-red-600 p-1 justify-self-end"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs flex justify-between items-center" style={{ color: 'var(--ink-mute)' }}>
          <span>Summe aktueller Artikelwerte (Neupreis): {items.reduce((s, i) => s + (i.price || 0), 0).toFixed(2)} €</span>
          <button onClick={loadFCFDefaults}
            className="px-3 py-1.5 text-xs uppercase"
            style={{ background: 'var(--paper-dark)', color: 'var(--ink)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
            FCF-Pfandordnung laden
          </button>
        </div>
      </div>

      <div className="bg-white border border-stone-200 p-6 mb-4">
        <h2 className="font-display text-2xl mb-2">PFANDREGELN</h2>
        <p className="text-xs text-stone-500 mb-4">Wie wird bei der Rückgabe abgerechnet? Wähle das Modell, das zur Pfandordnung des Vereins passt.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
          <label className="flex items-start gap-3 p-4 cursor-pointer"
            style={{ border: settings.depositMode === 'pauschal' ? '2px solid var(--vereinsblau)' : '1px solid var(--rule)', background: settings.depositMode === 'pauschal' ? '#F1ECDF' : 'white' }}>
            <input type="radio" name="depositMode" value="pauschal" checked={settings.depositMode === 'pauschal' || !settings.depositMode}
              onChange={e => setSettings({ ...settings, depositMode: 'pauschal' })} className="mt-1" />
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Pauschal-Modus (FCF-Standard)</div>
              <div className="text-xs mt-1" style={{ color: 'var(--ink-soft)' }}>
                Pfand wird voll zurückgezahlt, wenn alles vollständig & nutzbar ist. Bei beschädigten oder verlorenen Teilen wird der Ersatzwert (siehe Artikelkatalog) abgezogen. Punkt 8: Bei Total-Verlust verfällt das gesamte Pfand.
              </div>
            </div>
          </label>
          <label className="flex items-start gap-3 p-4 cursor-pointer"
            style={{ border: settings.depositMode === 'saison' ? '2px solid var(--vereinsblau)' : '1px solid var(--rule)', background: settings.depositMode === 'saison' ? '#F1ECDF' : 'white' }}>
            <input type="radio" name="depositMode" value="saison" checked={settings.depositMode === 'saison'}
              onChange={e => setSettings({ ...settings, depositMode: 'saison' })} className="mt-1" />
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Saison-Abschreibung</div>
              <div className="text-xs mt-1" style={{ color: 'var(--ink-soft)' }}>
                Zeitwert pro Teil = Neupreis × (1 − Saisons × Abschreibung) × Zustandsfaktor. Differenz wird vom Pfand abgezogen.
              </div>
            </div>
          </label>
        </div>

        {settings.depositMode === 'saison' && (<>
          <div className="mb-5">
            <Field label="Saison-Abschreibung pro Saison (%)">
              <input type="number" min="0" max="100" step="1" className="w-32 border border-stone-300 px-3 py-2 text-sm"
                value={Math.round((settings.seasonDepreciation ?? DEFAULT_SEASON_DEPRECIATION) * 100)}
                onChange={e => setSettings({ ...settings, seasonDepreciation: (parseFloat(e.target.value) || 0) / 100 })} />
            </Field>
            <p className="text-xs text-stone-500 mt-1">Üblich: 25 % — also nach 4 Saisons ist der Zeitwert allein durch Alter null.</p>
          </div>

          <div className="mb-3">
            <div className="font-sub text-xs mb-2" style={{ color: 'var(--vereinsblau)', letterSpacing: '0.18em' }}>ZUSTANDS-FAKTOREN</div>
            <p className="text-xs text-stone-500 mb-3">Faktor 100 % = voller Zeitwert · 0 % = kein Wert (z. B. verloren oder zerstört). Bezeichnungen anpassbar, Schlüssel (links) bleiben fest.</p>
          </div>

          <div className="space-y-2">
            {Object.entries(getConditionFactors(settings)).map(([k, v]) => (
              <div key={k} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-3 text-xs uppercase tracking-wider" style={{ color: 'var(--ink-mute)' }}>{k}</div>
                <input
                  className="col-span-6 border border-stone-300 px-3 py-2 text-sm"
                  value={v.label}
                  onChange={e => setSettings({
                    ...settings,
                    conditionFactors: {
                      ...getConditionFactors(settings),
                      [k]: { ...v, label: e.target.value },
                    },
                  })}
                />
                <div className="col-span-3 flex items-center gap-1">
                  <input
                    type="number" min="0" max="100" step="1"
                    className="w-20 border border-stone-300 px-3 py-2 text-sm text-right"
                    value={Math.round(v.factor * 100)}
                    onChange={e => setSettings({
                      ...settings,
                      conditionFactors: {
                        ...getConditionFactors(settings),
                        [k]: { ...v, factor: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) / 100 },
                      },
                    })}
                  />
                  <span className="text-xs" style={{ color: 'var(--ink-mute)' }}>%</span>
                </div>
              </div>
            ))}
          </div>
        </>)}

        {settings.depositMode === 'pauschal' && (
          <div className="text-xs p-4" style={{ background: 'var(--paper-dark)', color: 'var(--ink-soft)' }}>
            <strong style={{ color: 'var(--vereinsblau)' }}>Hinweis zum Pauschal-Modus:</strong> Die Ersatzwerte für jedes Kleidungsstück werden im Artikelkatalog gepflegt. Die Standardwerte folgen der FCF-Pfandordnung 2025. Ein Klick auf „FCF-Pfandordnung laden" stellt die Werte wieder her.
          </div>
        )}
      </div>

      {/* Folgende Block (alter Wochenbericht-Versand) wird unverändert weitergeführt */}

      <div className="bg-white border border-stone-200 p-6 mb-4">
        <h2 className="font-display text-2xl mb-2">PFAND- & KLEIDERORDNUNG (FCF, STAND 2025)</h2>
        <p className="text-xs text-stone-500 mb-4">Diese Regelung ist im aktuellen Pauschal-Modus hinterlegt. Ein Auszug für die Spielersicht — die vollständige Ordnung gibt's als PDF-Anhang.</p>
        <ol className="text-sm space-y-2 pl-5 list-decimal" style={{ color: 'var(--ink-soft)' }}>
          <li>Vereinsausstattung bleibt Eigentum des FC Frohlinde, Ausgabe als Leihgabe gegen Pfand.</li>
          <li>Standardausstattung im Wert von ca. 200 € umfasst Präsentationsjacke, Präsentationshose, Aufwärmshirt, Trainingsshirt, Trainingshose kurz, Trainingshose lang und Pullover/Sweat.</li>
          <li>Laufzeit bis zum nächsten Kollektionswechsel; normaler Verschleiß wird ersetzt.</li>
          <li><strong>Pfandbetrag: 70 €</strong> — vollständig erstattet bei sauberer, vollständiger und nutzbarer Rückgabe.</li>
          <li>Rückgabe sauber (gewaschen, trocken), vollständig und funktionsfähig (Reißverschlüsse, Nähte, Logos intakt).</li>
          <li>Fehlende oder beschädigte Teile werden mit dem Ersatzwert (siehe Artikelkatalog) vom Pfand abgezogen. Übersteigen die Kosten den Pfand, wird die Differenz nachgefordert.</li>
          <li><strong>Vollständiger Pfandverfall</strong>, wenn keine Kleidung zurückgegeben wird, die Kleidung stark beschädigt / nicht mehr nutzbar ist oder Rückgabehinweise mehrfach ignoriert werden.</li>
          <li>Mit Entgegennahme der Ausstattung erkennen Spieler/Erziehungsberechtigte diese Pfand- & Kleiderordnung an.</li>
        </ol>
      </div>

      <div className="bg-white border border-stone-200 p-6 mb-4">
        <h2 className="font-display text-2xl mb-2">WOCHENBERICHT-VERSAND (SMTP)</h2>
        <p className="text-xs text-stone-500 mb-4">
          Aus den eingegangenen Bedarfsmeldungen wird ein Wochenbericht erzeugt und per E-Mail versendet. SMTP-Zugangsdaten werden als Umgebungsvariablen in Vercel hinterlegt — siehe Anleitung im README oder unten.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <label className="flex items-start gap-3 p-3 cursor-pointer" style={{ border: '1px solid var(--rule)' }}>
            <input type="checkbox" checked={!!settings.weeklyReportEnabled}
              onChange={e => setSettings({ ...settings, weeklyReportEnabled: e.target.checked })} className="mt-1" />
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Versand aktiv</div>
              <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>Nur wenn aktiv, kann der Wochenbericht versendet werden</div>
            </div>
          </label>
          <Field label="Empfänger-E-Mail (Komma-separiert für mehrere)">
            <input className="w-full border border-stone-300 px-3 py-2 text-sm" value={settings.weeklyReportEmail || ''}
              onChange={e => setSettings({ ...settings, weeklyReportEmail: e.target.value })}
              placeholder="zeugwart@fc-frohlinde.de, vorstand@fc-frohlinde.de" />
          </Field>
        </div>

        <SmtpStatus />

        <details className="mt-4">
          <summary className="cursor-pointer text-xs uppercase tracking-wider" style={{ color: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.18em' }}>
            ▸ Anleitung: SMTP in Vercel einrichten
          </summary>
          <div className="mt-3 text-xs p-4" style={{ background: 'var(--paper-dark)', color: 'var(--ink-soft)', lineHeight: 1.6 }}>
            <p className="mb-2">In Vercel → Projekt → Settings → Environment Variables die folgenden Variablen anlegen:</p>
            <table className="w-full mt-2 text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'white' }}>
                  <th className="text-left p-2" style={{ border: '1px solid var(--rule)', color: 'var(--vereinsblau)' }}>Name</th>
                  <th className="text-left p-2" style={{ border: '1px solid var(--rule)', color: 'var(--vereinsblau)' }}>Beispielwert</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className="p-2" style={{ border: '1px solid var(--rule)' }}><code>SMTP_HOST</code></td><td className="p-2" style={{ border: '1px solid var(--rule)' }}>smtp.ionos.de</td></tr>
                <tr><td className="p-2" style={{ border: '1px solid var(--rule)' }}><code>SMTP_PORT</code></td><td className="p-2" style={{ border: '1px solid var(--rule)' }}>587</td></tr>
                <tr><td className="p-2" style={{ border: '1px solid var(--rule)' }}><code>SMTP_SECURE</code></td><td className="p-2" style={{ border: '1px solid var(--rule)' }}>false (für Port 587 mit STARTTLS) oder true (für Port 465)</td></tr>
                <tr><td className="p-2" style={{ border: '1px solid var(--rule)' }}><code>SMTP_USER</code></td><td className="p-2" style={{ border: '1px solid var(--rule)' }}>noreply@fc-frohlinde.de</td></tr>
                <tr><td className="p-2" style={{ border: '1px solid var(--rule)' }}><code>SMTP_PASS</code></td><td className="p-2" style={{ border: '1px solid var(--rule)' }}>(Postfach-Passwort)</td></tr>
                <tr><td className="p-2" style={{ border: '1px solid var(--rule)' }}><code>SMTP_FROM</code></td><td className="p-2" style={{ border: '1px solid var(--rule)' }}>FC Frohlinde Trikotverwaltung &lt;noreply@fc-frohlinde.de&gt;</td></tr>
              </tbody>
            </table>
            <p className="mt-3"><strong>Typische Anbieter:</strong></p>
            <ul className="list-disc pl-5 mt-1 space-y-0.5">
              <li>IONOS: Host smtp.ionos.de, Port 587, Secure false</li>
              <li>Strato: Host smtp.strato.de, Port 465, Secure true</li>
              <li>Telekom: Host securesmtp.t-online.de, Port 465, Secure true</li>
              <li>Gmail: Host smtp.gmail.com, Port 587, Secure false (App-Passwort nötig)</li>
              <li>Microsoft 365: Host smtp.office365.com, Port 587, Secure false</li>
            </ul>
            <p className="mt-3">Nach dem Setzen der Variablen einmal in Vercel → Deployments → letztes Deployment → ⋯ → <strong>Redeploy</strong>, damit die Variablen aktiv werden.</p>
          </div>
        </details>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <button onClick={saveSettings} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium">Speichern</button>
        <button onClick={exportAll} className="border border-stone-300 px-4 py-2 text-sm flex items-center gap-1"><Download size={14} /> Backup exportieren</button>
        <label className="border border-stone-300 px-4 py-2 text-sm cursor-pointer">
          Backup importieren
          <input type="file" accept=".json" onChange={importAll} className="hidden" />
        </label>
      </div>

      <div className="bg-white border border-stone-200 p-6 mb-4">
        <h2 className="font-display text-2xl mb-2">VERSION & VERLAUF</h2>
        <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>Aktuelle Version: <strong style={{ color: 'var(--vereinsblau)' }}>v{APP_VERSION}</strong></p>
        <div className="mt-4 space-y-3">
          {CHANGELOG.map(entry => (
            <div key={entry.version} className="border-l-2 pl-4" style={{ borderColor: 'var(--rule)' }}>
              <div className="flex items-baseline gap-2">
                <span className="font-sub text-sm" style={{ color: 'var(--vereinsblau)', letterSpacing: '0.12em' }}>v{entry.version}</span>
                <span className="text-xs" style={{ color: 'var(--ink-mute)' }}>{entry.date}</span>
              </div>
              <ul className="mt-1 text-xs space-y-0.5" style={{ color: 'var(--ink-soft)' }}>
                {entry.changes.map((c, i) => <li key={i}>· {c}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// SMTP-Status anzeigen + Test-Mail senden können
function SmtpStatus() {
  const { authFetch } = useAuth();
  const [status, setStatus] = useState(null); // null | { configured, lastSent }
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    let active = true;
    authFetch('/api/reports/weekly')
      .then(r => r.json())
      .then(d => { if (active) setStatus({ configured: !!d.smtpConfigured, lastSent: d.lastSent }); })
      .catch(() => { if (active) setStatus({ configured: false, lastSent: null }); });
    return () => { active = false; };
  }, []);

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await authFetch('/api/reports/weekly', {
        method: 'POST',
        body: JSON.stringify({ test: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Test-Versand fehlgeschlagen');
      setTestResult({ ok: true, msg: `Test-Mail gesendet (Message-ID: ${d.messageId || '–'})` });
    } catch (e) {
      setTestResult({ ok: false, msg: e.message });
    }
    setTesting(false);
  }

  if (!status) return <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>Lade SMTP-Status...</div>;

  return (
    <div className="mt-2 p-4" style={{ background: status.configured ? '#EBF0E5' : '#F5EBDD', borderLeft: `3px solid ${status.configured ? 'var(--success)' : 'var(--warn)'}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm" style={{ color: 'var(--ink)' }}>
          <strong>{status.configured ? '✓ SMTP konfiguriert' : '⚠ SMTP nicht konfiguriert'}</strong>
          {status.lastSent && (
            <span className="text-xs ml-2" style={{ color: 'var(--ink-mute)' }}>
              Letzter Versand: {new Date(status.lastSent).toLocaleString('de-DE')}
            </span>
          )}
        </div>
        {status.configured && (
          <button onClick={sendTest} disabled={testing}
            className="px-4 py-2 text-xs uppercase flex items-center gap-2 disabled:opacity-50"
            style={{ background: 'var(--vereinsblau)', color: 'white', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
            <Mail size={14} /> {testing ? 'Sende Test...' : 'Test-Mail senden'}
          </button>
        )}
      </div>
      {testResult && (
        <div className="mt-3 text-xs p-2" style={{ background: testResult.ok ? 'rgba(74,107,58,0.1)' : 'rgba(154,40,40,0.1)', color: testResult.ok ? 'var(--success)' : 'var(--danger)' }}>
          {testResult.ok ? '✓ ' : '✗ '}{testResult.msg}
        </div>
      )}
      {!status.configured && (
        <div className="mt-2 text-xs" style={{ color: 'var(--ink-soft)' }}>
          SMTP-Zugangsdaten als Umgebungsvariablen in Vercel hinterlegen (siehe Anleitung unten), dann <strong>Redeploy</strong> auslösen.
        </div>
      )}
    </div>
  );
}

// ============ NUTZERVERWALTUNG ============
function UsersView() {
  const { authFetch, user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', name: '', role: 'user' });
  const [editPwd, setEditPwd] = useState({});
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await authFetch('/api/auth/users');
      const d = await r.json();
      setUsers(d);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function add() {
    setError('');
    try {
      const r = await authFetch('/api/auth/users', { method: 'POST', body: JSON.stringify(form) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setForm({ username: '', password: '', name: '', role: 'user' });
      setShowForm(false);
      load();
    } catch (e) { setError(e.message); }
  }

  async function remove(username) {
    if (!confirm(`Nutzer "${username}" wirklich löschen?`)) return;
    try {
      const r = await authFetch('/api/auth/users', { method: 'DELETE', body: JSON.stringify({ username }) });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
      load();
    } catch (e) { setError(e.message); }
  }

  async function changeRole(username, role) {
    try {
      await authFetch('/api/auth/users', { method: 'PUT', body: JSON.stringify({ username, role }) });
      load();
    } catch (e) { setError(e.message); }
  }

  async function changePassword(username) {
    const pwd = editPwd[username];
    if (!pwd || pwd.length < 8) { alert('Passwort mind. 8 Zeichen'); return; }
    try {
      await authFetch('/api/auth/users', { method: 'PUT', body: JSON.stringify({ username, password: pwd }) });
      setEditPwd({ ...editPwd, [username]: '' });
      alert('Passwort geändert.');
    } catch (e) { setError(e.message); }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <PageHeader number="10" label="ZUGÄNGE" title="Nutzer" subtitle={`${users.length} Konten · nur Admins können Nutzer verwalten`} />
        <button onClick={() => setShowForm(true)} className="px-5 py-2.5 text-xs font-medium flex items-center gap-2 uppercase"
          style={{ background: 'var(--vereinsblau)', color: 'white', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
          <Plus size={14} /> Nutzer anlegen
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-2 mb-4">{error}</div>}

      {showForm && (
        <div className="bg-white border-2 border-stone-900 p-6 mb-4">
          <h2 className="font-display text-2xl mb-4">NEUER NUTZER</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Anzeigename"><input className="w-full border border-stone-300 px-3 py-2 text-sm" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Benutzername"><input className="w-full border border-stone-300 px-3 py-2 text-sm" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></Field>
            <Field label="Passwort (mind. 8 Zeichen)"><input type="password" className="w-full border border-stone-300 px-3 py-2 text-sm" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label="Rolle">
              <select className="w-full border border-stone-300 px-3 py-2 text-sm" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                <option value="user">Nutzer (Vollzugriff App)</option>
                <option value="admin">Admin (zusätzl. Nutzerverwaltung)</option>
              </select>
            </Field>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={add} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium">Anlegen</button>
            <button onClick={() => setShowForm(false)} className="border border-stone-300 px-4 py-2 text-sm">Abbrechen</button>
          </div>
        </div>
      )}

      <div className="bg-white border border-stone-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-stone-500 text-sm">Lade...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wider text-stone-500">
                <tr>
                  <th className="text-left p-3">Name</th>
                  <th className="text-left p-3 hidden sm:table-cell">Benutzer</th>
                  <th className="text-left p-3">Rolle</th>
                  <th className="text-left p-3 hidden lg:table-cell">Passwort ändern</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-t border-stone-100">
                    <td className="p-3 font-medium">{u.name}<div className="text-xs text-stone-500 sm:hidden">{u.username}</div></td>
                    <td className="p-3 hidden sm:table-cell text-stone-600">{u.username}</td>
                    <td className="p-3">
                      {u.username === currentUser.username ? (
                        <span className="text-xs px-2 py-0.5 bg-stone-100">{u.role} (Sie)</span>
                      ) : (
                        <select value={u.role} onChange={e => changeRole(u.username, e.target.value)} className="border border-stone-300 px-2 py-1 text-xs">
                          <option value="user">user</option>
                          <option value="admin">admin</option>
                        </select>
                      )}
                    </td>
                    <td className="p-3 hidden lg:table-cell">
                      <div className="flex gap-1">
                        <input type="password" placeholder="neues Passwort" className="border border-stone-300 px-2 py-1 text-xs w-32" value={editPwd[u.username] || ''} onChange={e => setEditPwd({ ...editPwd, [u.username]: e.target.value })} />
                        <button onClick={() => changePassword(u.username)} className="text-xs bg-stone-100 px-2 py-1">Setzen</button>
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      {u.username !== currentUser.username && (
                        <button onClick={() => remove(u.username)} className="text-stone-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ============ BEDARFSMELDUNGEN ============
const REASON_LABELS = {
  verloren: 'Verloren',
  verschlissen: 'Verschlissen',
  flock_kaputt: 'Flock kaputt',
  beschaedigt: 'Beschädigt',
};

function ReportsView({ data, update }) {
  const { authFetch } = useAuth();
  const [reports, setReports] = useState(data.reports || []);
  const [filter, setFilter] = useState('offen');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [lastSent, setLastSent] = useState(null);
  const [photoModal, setPhotoModal] = useState(null); // { id, url } | null
  const [photoCache, setPhotoCache] = useState({});

  async function showPhoto(reportId) {
    if (photoCache[reportId]) {
      setPhotoModal({ id: reportId, url: photoCache[reportId] });
      return;
    }
    setPhotoModal({ id: reportId, url: null });
    try {
      const r = await authFetch(`/api/reports/photo?id=${encodeURIComponent(reportId)}`);
      const d = await r.json();
      if (d.photo) {
        setPhotoCache(prev => ({ ...prev, [reportId]: d.photo }));
        setPhotoModal({ id: reportId, url: d.photo });
      } else {
        setPhotoModal(null);
        alert('Foto nicht gefunden.');
      }
    } catch (e) {
      setPhotoModal(null);
      alert('Foto konnte nicht geladen werden.');
    }
  }

  // Reports werden serverseitig direkt vom öffentlichen Endpunkt geschrieben.
  // Damit eingegangene Meldungen sichtbar werden, hier ein Refresh aus useData via update wäre umständlich.
  // Wir lesen sie über die normale data.reports-Loading-Logik mit (siehe useData.js).
  useEffect(() => { setReports(data.reports || []); }, [data.reports]);

  // Filter
  const filtered = filter === 'alle' ? reports : reports.filter(r => r.status === filter);

  function getPlayer(team, number) {
    return data.players.find(p => p.team === team && String(p.number) === String(number));
  }
  function getItem(itemId) {
    return data.items.find(i => i.id === itemId);
  }

  function setStatus(id, status) {
    const updated = reports.map(r => r.id === id ? { ...r, status, handledAt: new Date().toISOString() } : r);
    setReports(updated);
    update('reports', updated);
  }

  function removeReport(id) {
    if (!confirm('Meldung wirklich löschen?')) return;
    const updated = reports.filter(r => r.id !== id);
    setReports(updated);
    update('reports', updated);
  }

  // Material-Markierung: alle Inventory-Items dieses Spielers, die zu diesem Artikel passen,
  // mit dem Grund-Tag versehen
  function markMaterial(report) {
    const player = getPlayer(report.team, report.number);
    if (!player) {
      alert('Spieler mit dieser Nummer in dieser Mannschaft nicht gefunden. Material kann nicht automatisch markiert werden.');
      return;
    }
    const matchingItems = data.inventory.filter(i =>
      i.assignedTo === player.id && i.itemType === report.item && i.status === 'ausgegeben'
    );
    if (matchingItems.length === 0) {
      alert('Kein passendes ausgegebenes Material gefunden. Bitte manuell prüfen.');
      return;
    }
    const updated = data.inventory.map(i => {
      if (matchingItems.find(m => m.id === i.id)) {
        return {
          ...i,
          flagged: true,
          flagReasons: report.reasons,
          flagComment: report.comment,
          flagReportId: report.id,
          flagAt: new Date().toISOString(),
        };
      }
      return i;
    });
    update('inventory', updated);
    setStatus(report.id, 'gesehen');
    alert(`${matchingItems.length} Materialteil(e) markiert.`);
  }

  // Wochenbericht aggregieren
  const openReports = reports.filter(r => r.status === 'offen' || r.status === 'gesehen');
  const aggregation = {};
  openReports.forEach(r => {
    const key = `${r.team}__${r.item}`;
    if (!aggregation[key]) {
      aggregation[key] = { team: r.team, itemId: r.item, count: 0, reportIds: [] };
    }
    aggregation[key].count += 1;
    aggregation[key].reportIds.push(r.id);
  });
  const aggArray = Object.values(aggregation);

  async function sendReport() {
    setSending(true);
    setSendResult(null);
    try {
      const r = await authFetch('/api/reports/weekly', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Versand fehlgeschlagen');
      setSendResult({ ok: true, sentAt: d.sentAt });
      setLastSent(d.sentAt);
    } catch (e) {
      setSendResult({ ok: false, error: e.message });
    }
    setSending(false);
  }

  function exportReportCSV() {
    const rows = [['Mannschaft', 'Nr.', 'Spieler', 'Artikel', 'Anzahl Meldungen', 'Gründe (zusammengefasst)']];
    aggArray.forEach(a => {
      const item = getItem(a.itemId);
      const reportsForKey = openReports.filter(r => a.reportIds.includes(r.id));
      const reasonsSet = new Set();
      reportsForKey.forEach(r => r.reasons.forEach(x => reasonsSet.add(x)));
      // Pro Spieler eine Zeile
      const byPlayer = {};
      reportsForKey.forEach(r => {
        const k = `${r.team}__${r.number}`;
        if (!byPlayer[k]) byPlayer[k] = { team: r.team, number: r.number, reasons: new Set() };
        r.reasons.forEach(x => byPlayer[k].reasons.add(x));
      });
      Object.values(byPlayer).forEach(bp => {
        const player = getPlayer(bp.team, bp.number);
        rows.push([
          bp.team,
          bp.number,
          player ? `${player.firstName} ${player.lastName}` : '–',
          item?.name || a.itemId,
          1,
          [...bp.reasons].map(x => REASON_LABELS[x] || x).join(', '),
        ]);
      });
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `wochenbericht_${new Date().toISOString().split('T')[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // Bestellung aus offenen Meldungen erzeugen
  function createOrder() {
    if (openReports.length === 0) return;
    const lines = [];
    openReports.forEach(r => {
      const player = getPlayer(r.team, r.number);
      const item = getItem(r.item);
      lines.push({
        id: `l_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        itemType: r.item,
        size: player?.size || 'L',
        qty: 1,
        playerId: player?.id || '',
        number: r.number,
        name: player ? player.lastName.toUpperCase() : '',
        reportRef: r.id,
        reasons: r.reasons,
      });
    });
    const newOrder = {
      id: `ord_${Date.now()}`,
      title: `Bedarfsbestellung ${new Date().toLocaleDateString('de-DE')}`,
      type: 'einzeln',
      team: null,
      supplier: '',
      notes: `Aus ${openReports.length} Bedarfsmeldungen erzeugt.`,
      lines,
      sponsors: { brust: '', ruecken: '', aermel: '' },
      status: 'angelegt',
      createdAt: new Date().toISOString(),
      fromReports: openReports.map(r => r.id),
    };
    update('orders', [...data.orders, newOrder]);
    // Meldungen auf "bestellt" setzen
    const updatedReports = reports.map(r => openReports.find(o => o.id === r.id) ? { ...r, status: 'bestellt', orderId: newOrder.id } : r);
    setReports(updatedReports);
    update('reports', updatedReports);
    alert(`Bestellung mit ${lines.length} Position(en) angelegt. Findest du im Tab "Bestellungen".`);
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <PageHeader number="03" label="MELDUNGEN" title="Bedarf der Spieler" subtitle={`${openReports.length} offen · ${reports.length} gesamt`} />
      </div>

      {/* Wochenbericht-Panel */}
      {openReports.length > 0 && (
        <div className="p-7 mb-6 text-white" style={{ background: 'var(--vereinsblau)' }}>
          <div className="flex flex-wrap justify-between items-start gap-4">
            <div>
              <div className="font-sub text-xs mb-2" style={{ color: 'var(--gold)', letterSpacing: '0.18em' }}>WOCHENBERICHT</div>
              <h3 className="font-display text-3xl">{aggArray.length} Artikel · {openReports.length} Meldungen</h3>
              <p className="text-sm mt-2" style={{ color: '#A8B8D0' }}>
                {data.settings.weeklyReportEnabled ? 'Mailversand aktiv' : 'Mailversand inaktiv'}
                {data.settings.weeklyReportEmail ? ` · An: ${data.settings.weeklyReportEmail}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={exportReportCSV} className="px-4 py-2 text-xs uppercase flex items-center gap-2"
                style={{ background: 'rgba(255,255,255,0.15)', color: 'white', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
                <Download size={14} /> CSV
              </button>
              {data.settings.weeklyReportEnabled && data.settings.weeklyReportEmail && (
                <button onClick={sendReport} disabled={sending} className="px-4 py-2 text-xs uppercase flex items-center gap-2 disabled:opacity-50"
                  style={{ background: 'var(--gold)', color: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
                  <Mail size={14} /> {sending ? 'Sende...' : 'Per Mail senden'}
                </button>
              )}
              <button onClick={createOrder} className="px-4 py-2 text-xs uppercase flex items-center gap-2"
                style={{ background: 'white', color: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
                <ShoppingCart size={14} /> Bestellung erzeugen
              </button>
            </div>
          </div>
          {sendResult && (
            <div className="mt-4 text-sm p-3" style={{ background: sendResult.ok ? 'rgba(155, 216, 157, 0.2)' : 'rgba(245, 198, 198, 0.2)' }}>
              {sendResult.ok ? `✓ Versendet um ${new Date(sendResult.sentAt).toLocaleTimeString('de-DE')}` : `✗ ${sendResult.error}`}
            </div>
          )}

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-px" style={{ background: 'rgba(255,255,255,0.1)' }}>
            {aggArray.map(a => {
              const item = getItem(a.itemId);
              return (
                <div key={`${a.team}__${a.itemId}`} className="p-3 text-sm" style={{ background: 'var(--vereinsblau)' }}>
                  <div className="flex justify-between">
                    <div className="font-medium">{item?.name || a.itemId}</div>
                    <div className="stat-number text-xl" style={{ color: 'var(--gold)' }}>{a.count}</div>
                  </div>
                  <div className="text-xs" style={{ color: '#A8B8D0' }}>{a.team}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2 mb-4 overflow-x-auto -mx-4 px-4 pb-1">
        {[
          { id: 'offen', label: `Offen (${reports.filter(r => r.status === 'offen').length})` },
          { id: 'gesehen', label: `In Bearbeitung (${reports.filter(r => r.status === 'gesehen').length})` },
          { id: 'bestellt', label: `Bestellt (${reports.filter(r => r.status === 'bestellt').length})` },
          { id: 'erledigt', label: `Erledigt (${reports.filter(r => r.status === 'erledigt').length})` },
          { id: 'alle', label: `Alle (${reports.length})` },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className="px-3 py-1.5 text-xs uppercase whitespace-nowrap"
            style={{
              background: filter === f.id ? 'var(--vereinsblau)' : 'white',
              color: filter === f.id ? 'white' : 'var(--ink-soft)',
              fontFamily: "'Bebas Neue', sans-serif",
              letterSpacing: '0.12em',
              border: '1px solid var(--rule)',
            }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Liste */}
      <div className="bg-white border border-stone-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-sm" style={{ color: 'var(--ink-mute)' }}>
            Keine Meldungen in dieser Auswahl.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left p-3">Eingegangen</th>
                  <th className="text-left p-3">Mannschaft / Nr.</th>
                  <th className="text-left p-3">Artikel</th>
                  <th className="text-left p-3">Gründe</th>
                  <th className="text-left p-3 hidden lg:table-cell">Anmerkung</th>
                  <th className="text-left p-3">Status</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {[...filtered].reverse().map(r => {
                  const player = getPlayer(r.team, r.number);
                  const item = getItem(r.item);
                  return (
                    <tr key={r.id} className="border-t border-stone-100">
                      <td className="p-3 text-xs" style={{ color: 'var(--ink-mute)' }}>
                        {new Date(r.createdAt).toLocaleDateString('de-DE')}<br />
                        {new Date(r.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="p-3">
                        <div className="font-medium">{r.team} · #{r.number}</div>
                        <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>
                          {player ? `${player.firstName} ${player.lastName}` : '— Spieler nicht gefunden —'}
                        </div>
                      </td>
                      <td className="p-3 font-medium">{item?.name || r.item}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {r.reasons.map(x => (
                            <span key={x} className="text-xs px-2 py-0.5"
                              style={{ background: 'var(--paper-dark)', color: 'var(--ink-soft)' }}>
                              {REASON_LABELS[x] || x}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 hidden lg:table-cell text-xs" style={{ color: 'var(--ink-soft)' }}>
                        {r.comment || '–'}
                        {r.reporterName && <div style={{ color: 'var(--ink-mute)' }}>– {r.reporterName}</div>}
                        {r.hasPhoto && (
                          <button onClick={() => showPhoto(r.id)} className="mt-1 inline-flex items-center gap-1 text-xs hover:underline"
                            style={{ color: 'var(--vereinsblau)' }}>
                            📷 Foto ansehen
                          </button>
                        )}
                      </td>
                      <td className="p-3">
                        <select value={r.status} onChange={e => setStatus(r.id, e.target.value)} className="text-xs border border-stone-300 px-2 py-1">
                          <option value="offen">offen</option>
                          <option value="gesehen">gesehen</option>
                          <option value="bestellt">bestellt</option>
                          <option value="erledigt">erledigt</option>
                        </select>
                      </td>
                      <td className="p-3 whitespace-nowrap text-right">
                        {(r.status === 'offen' || r.status === 'gesehen') && player && (
                          <button onClick={() => markMaterial(r)} className="text-xs px-2 py-1 mr-1"
                            style={{ background: 'var(--paper-dark)', color: 'var(--ink)' }}
                            title="Materialteil im Lager markieren">
                            <FileWarning size={12} className="inline" /> Markieren
                          </button>
                        )}
                        <button onClick={() => removeReport(r.id)} className="p-1" style={{ color: 'var(--ink-mute)' }}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {photoModal && (
        <div onClick={() => setPhotoModal(null)}
          className="fixed inset-0 flex items-center justify-center p-4 z-50"
          style={{ background: 'rgba(0,0,0,0.85)' }}>
          <div onClick={e => e.stopPropagation()} className="bg-white p-3 max-w-3xl w-full" style={{ border: '1px solid var(--rule)' }}>
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs" style={{ color: 'var(--ink-mute)' }}>Foto zur Bedarfsmeldung</span>
              <button onClick={() => setPhotoModal(null)} className="p-1 hover:bg-stone-100">
                <X size={18} />
              </button>
            </div>
            {photoModal.url ? (
              <img src={photoModal.url} alt="Bedarfsfoto" style={{ width: '100%', maxHeight: '80vh', objectFit: 'contain', display: 'block' }} />
            ) : (
              <div className="p-12 text-center text-sm" style={{ color: 'var(--ink-mute)' }}>Lade Foto...</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="font-sub text-xs mb-1.5" style={{ color: 'var(--vereinsblau)', letterSpacing: '0.18em' }}>{label}</div>
      {children}
    </label>
  );
}

function PageHeader({ number, label, title, subtitle }) {
  return (
    <div className="mb-8">
      <div className="section-label mb-3">{number} — {label}</div>
      <h1 className="font-display text-4xl sm:text-5xl leading-tight" style={{ color: 'var(--ink)' }}>{title}</h1>
      {subtitle && (
        <div className="flex items-center gap-3 mt-3">
          <div className="h-px w-12" style={{ background: 'var(--vereinsblau)' }} />
          <p className="text-sm" style={{ color: 'var(--ink-mute)' }}>{subtitle}</p>
        </div>
      )}
    </div>
  );
}
