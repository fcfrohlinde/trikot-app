import React, { useState, useEffect, useMemo } from 'react';
import { Users, Shirt, Wallet, ShoppingCart, Plus, Trash2, Edit2, Download, ArrowLeft, Check, X, AlertCircle, Package, Euro, FileText, Settings, LogOut, UserCog, Mail, Bell, FileWarning } from 'lucide-react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { AuthProvider, useAuth } from './auth.jsx';
import LoginScreen from './LoginScreen.jsx';
import { useData } from './useData.js';
import { APP_VERSION, CHANGELOG } from './version.js';
import { ErrorBoundary } from './ErrorBoundary.jsx';

const DEFAULT_TEAMS = ['1. Mannschaft', '2. Mannschaft', '3. Mannschaft'];
const DEFAULT_ITEMS = [];

// FCF-Standardausstattung gemäß Pfandordnung (Stand 2025)
const FCF_DEFAULT_ITEMS = [
  { id: 'praesentationsjacke', articleNumber: '', name: 'Präsentationsjacke', price: 40, replacementValue: 25 },
  { id: 'praesentationshose', articleNumber: '', name: 'Präsentationshose', price: 29, replacementValue: 20 },
  { id: 'aufwaermshirt', articleNumber: '', name: 'Aufwärmshirt', price: 30, replacementValue: 20 },
  { id: 'trainingsshirt', articleNumber: '', name: 'Trainingsshirt', price: 18, replacementValue: 10 },
  { id: 'trainingshose_kurz', articleNumber: '', name: 'Trainingshose kurz', price: 14, replacementValue: 10 },
  { id: 'trainingshose_lang', articleNumber: '', name: 'Trainingshose lang', price: 29, replacementValue: 20 },
  { id: 'zip_top', articleNumber: '', name: 'Zip Top', price: 40, replacementValue: 25 },
  { id: 'pullover_sweat', articleNumber: '', name: 'Pullover / Sweat', price: 35, replacementValue: 22 },
];

const DEFAULT_CONDITION_FACTORS = {
  neu: { label: 'Neuwertig', factor: 1.0 },
  gut: { label: 'Gut', factor: 0.85 },
  mittel: { label: 'Mittel', factor: 0.6 },
  schlecht: { label: 'Schlecht', factor: 0.3 },
  defekt: { label: 'Defekt / Verloren', factor: 0 },
};

const DEFAULT_SEASON_DEPRECIATION = 0.25;

// Pfandregel-Modus: 'pauschal' (FCF-Standard), 'saison' (Abschreibung × Zustand) oder 'ohne_pfand'
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
function getTeamDepositRule(settings, team) {
  const rules = settings?.teamDepositRules || {};
  return team && rules[team] ? rules[team] : {};
}
function getDepositMode(settings, team) {
  const mode = getTeamDepositRule(settings, team).depositMode || settings?.depositMode || DEFAULT_DEPOSIT_MODE;
  return ['pauschal', 'saison', 'ohne_pfand'].includes(mode) ? mode : DEFAULT_DEPOSIT_MODE;
}
function getDefaultDeposit(settings, team) {
  if (getDepositMode(settings, team) === 'ohne_pfand') return 0;
  const teamAmount = getTeamDepositRule(settings, team).defaultDeposit;
  return Number.isFinite(teamAmount) ? teamAmount : (settings?.defaultDeposit ?? DEFAULT_DEPOSIT_AMOUNT);
}

// Spieler + Trainer als gemeinsame Liste — für Material-Ausgabe, Pfand, Rückgabe, Bestellungen
function allPersons(data) {
  const players = (data.players || []).map(p => ({ ...p, _kind: 'player' }));
  const coaches = (data.coaches || []).map(c => ({ ...c, _kind: 'coach' }));
  return [...players, ...coaches];
}
function findPerson(data, id) {
  return allPersons(data).find(p => p.id === id);
}

function personNumberValue(person) {
  if (!person || person.number === undefined || person.number === null || person.number === '') return '';
  return person._kind === 'coach' ? String(person.number).trim().toUpperCase() : String(person.number).trim();
}

function inventoryMatchesPersonNumber(inv, person) {
  const invNumber = inv.assignedNumber === undefined || inv.assignedNumber === null ? '' : String(inv.assignedNumber).trim().toUpperCase();
  const personNumber = personNumberValue(person).toUpperCase();
  if (!invNumber || !personNumber || invNumber !== personNumber) return false;
  const invKind = inv.personKind || person._kind;
  return invKind === person._kind;
}

// Komprimiert eine Liste von Zahlen in lesbare Bereiche: [1,2,3,5,7,8,9] → "1–3, 5, 7–9"
function compressRanges(numbers) {
  if (!numbers || numbers.length === 0) return '';
  const sorted = [...numbers].sort((a, b) => a - b);
  const parts = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur !== prev + 1) {
      // Bereich abschließen
      if (start === prev) parts.push(String(start));
      else if (prev === start + 1) parts.push(`${start}, ${prev}`);
      else parts.push(`${start}–${prev}`);
      start = cur;
    }
    prev = cur;
  }
  return parts.join(', ');
}

// Default-Permissions für Nicht-Admins. Spiegel der Backend-Defaults.
const DEFAULT_USER_PERMISSIONS = {
  canDeletePeople: false,
  canCreateOrders: true,
  canEditInventory: true,
  canManageReports: true,
  canManageDeposits: true,
};

// Zentrale Berechtigungsprüfung. Admins haben immer alles.
function userCan(user, action) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const perms = { ...DEFAULT_USER_PERMISSIONS, ...(user.permissions || {}) };
  return perms[action] === true;
}

// Prüft, ob eine Person sicher gelöscht werden kann. Diese harten Schutzregeln gelten
// AUCH für Admins — niemand soll versehentlich offene Pfänder oder ausgegebenes Material
// auf den Boden fallen lassen, weil eine Person aus dem Datensatz verschwindet.
function canDeletePerson(data, personId) {
  const reasons = [];
  const inventoryOut = (data.inventory || []).filter(i =>
    i.assignedTo === personId && i.status === 'ausgegeben'
  );
  if (inventoryOut.length > 0) {
    reasons.push(`${inventoryOut.length} ausgegebenes Materialteil${inventoryOut.length > 1 ? 'e' : ''} (zuerst zurückgeben)`);
  }
  const openDeposits = (data.deposits || []).filter(d =>
    d.playerId === personId && !d.refunded && (Number(d.amount) || 0) > 0
  );
  if (openDeposits.length > 0) {
    const sum = openDeposits.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    reasons.push(`${sum.toFixed(2)} € offenes Pfand (zuerst abrechnen)`);
  }
  return { ok: reasons.length === 0, reasons };
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
  const { data: rawData, loading, update, saveError } = useData();
  const { user, logout } = useAuth();

  // Daten-Sicht: Admins sehen alles. User sehen nur ihre zugeordneten Mannschaften.
  // Lagerware (status === 'lager', kein team) bleibt für alle sichtbar — das ist der gemeinsame Bestand.
  // Die Update-Funktion bleibt absichtlich ungefiltert: User können ihre Daten ändern,
  // dürfen aber Items aus fremden Teams nicht mutieren (visuell nicht erreichbar).
  const data = useMemo(() => {
    if (!rawData) return rawData;
    if (!user || user.role === 'admin') return rawData;
    const allowedTeams = Array.isArray(user.teams) ? user.teams : [];
    if (allowedTeams.length === 0) {
      // User ohne Team-Zuordnung sieht nur globale Daten (Lager, Items)
      return {
        ...rawData,
        players: [],
        coaches: [],
        teams: [],
        deposits: [],
        orders: [],
        reports: [],
      };
    }
    const teamSet = new Set(allowedTeams);
    const allowedPlayerIds = new Set((rawData.players || []).filter(p => teamSet.has(p.team)).map(p => p.id));
    const allowedCoachIds = new Set((rawData.coaches || []).filter(c => teamSet.has(c.team)).map(c => c.id));
    const allowedPersonIds = new Set([...allowedPlayerIds, ...allowedCoachIds]);

    return {
      ...rawData,
      teams: (rawData.teams || []).filter(t => teamSet.has(t)),
      players: (rawData.players || []).filter(p => teamSet.has(p.team)),
      coaches: (rawData.coaches || []).filter(c => teamSet.has(c.team)),
      deposits: (rawData.deposits || []).filter(d => allowedPersonIds.has(d.playerId)),
      orders: (rawData.orders || []).filter(o => {
        // Bestellungen: gehört dem Team oder hat zugewiesene Personen aus dem Team
        if (o.team && teamSet.has(o.team)) return true;
        if (Array.isArray(o.lines) && o.lines.some(l => l.playerId && allowedPersonIds.has(l.playerId))) return true;
        return false;
      }),
      reports: (rawData.reports || []).filter(r => teamSet.has(r.team)),
      // Inventur:
      //  - Ausgegebene Teile sichtbar, wenn die Person zum erlaubten Team gehört
      //  - Lagerware: sichtbar wenn ohne Team (Altbestand) ODER wenn das Team erlaubt ist
      inventory: (rawData.inventory || []).filter(i => {
        if (i.status === 'ausgegeben') {
          return i.assignedTo && allowedPersonIds.has(i.assignedTo);
        }
        // Lager
        if (!i.team) return true; // Altbestand ohne Team-Zuordnung bleibt für alle sichtbar
        return teamSet.has(i.team);
      }),
    };
  }, [rawData, user]);

  // Wenn der User auf einer View ist, die er nicht mehr darf (z.B. Settings nach Rollen-Downgrade),
  // schicken wir ihn zurück aufs Dashboard.
  useEffect(() => {
    if (user?.role !== 'admin' && (view === 'settings' || view === 'users')) {
      setView('dashboard');
    }
  }, [user?.role, view]);

  // Wenn Daten gefiltert sind, müssen Updates die ungefilterten Datensätze rekonstruieren —
  // sonst würden User-Edits Daten anderer Mannschaften überschreiben/löschen.
  // Wir merge'en die User-Updates in den Roh-Datensatz pro Eintrag-ID.
  const safeUpdate = useMemo(() => {
    if (!user || user.role === 'admin') return update;

    return (key, newValue) => {
      // Settings, items, suppliers, teams, transactions sind nicht team-gebunden — direkt durchreichen.
      const passThroughKeys = ['settings', 'items', 'suppliers', 'transactions'];
      if (passThroughKeys.includes(key)) return update(key, newValue);

      const allowedTeams = new Set(Array.isArray(user.teams) ? user.teams : []);
      const rawList = (rawData && rawData[key]) || [];

      if (key === 'teams') {
        // User dürfen die globale Team-Liste nicht ändern
        return;
      }

      if (key === 'inventory') {
        // Inventory: Wir behalten alle nicht sichtbaren Items unverändert,
        // ersetzen nur die sichtbaren durch newValue.
        const allowedPlayerIds = new Set((rawData?.players || []).filter(p => allowedTeams.has(p.team)).map(p => p.id));
        const allowedCoachIds = new Set((rawData?.coaches || []).filter(c => allowedTeams.has(c.team)).map(c => c.id));
        const allowedPersonIds = new Set([...allowedPlayerIds, ...allowedCoachIds]);
        const isVisible = (i) => {
          if (i.status === 'ausgegeben') return i.assignedTo && allowedPersonIds.has(i.assignedTo);
          // Lager
          if (!i.team) return true;
          return allowedTeams.has(i.team);
        };

        const invisibleOriginals = rawList.filter(i => !isVisible(i));
        return update(key, [...invisibleOriginals, ...newValue]);
      }

      if (key === 'players' || key === 'coaches') {
        const invisibleOriginals = rawList.filter(p => !allowedTeams.has(p.team));
        // Stelle sicher: User darf keinen Eintrag in fremde Teams umhängen
        const cleanedNew = newValue.map(p => allowedTeams.has(p.team) ? p : { ...p, team: [...allowedTeams][0] || p.team });
        return update(key, [...invisibleOriginals, ...cleanedNew]);
      }

      if (key === 'deposits') {
        const allowedPlayerIds = new Set((rawData?.players || []).filter(p => allowedTeams.has(p.team)).map(p => p.id));
        const allowedCoachIds = new Set((rawData?.coaches || []).filter(c => allowedTeams.has(c.team)).map(c => c.id));
        const allowedPersonIds = new Set([...allowedPlayerIds, ...allowedCoachIds]);
        const invisibleOriginals = rawList.filter(d => !allowedPersonIds.has(d.playerId));
        return update(key, [...invisibleOriginals, ...newValue]);
      }

      if (key === 'orders') {
        const allowedPlayerIds = new Set((rawData?.players || []).filter(p => allowedTeams.has(p.team)).map(p => p.id));
        const allowedCoachIds = new Set((rawData?.coaches || []).filter(c => allowedTeams.has(c.team)).map(c => c.id));
        const allowedPersonIds = new Set([...allowedPlayerIds, ...allowedCoachIds]);
        const isVisibleOrder = (o) => {
          if (o.team && allowedTeams.has(o.team)) return true;
          if (Array.isArray(o.lines) && o.lines.some(l => l.playerId && allowedPersonIds.has(l.playerId))) return true;
          return false;
        };
        const invisibleOriginals = rawList.filter(o => !isVisibleOrder(o));
        return update(key, [...invisibleOriginals, ...newValue]);
      }

      if (key === 'reports') {
        const invisibleOriginals = rawList.filter(r => !allowedTeams.has(r.team));
        return update(key, [...invisibleOriginals, ...newValue]);
      }

      // Fallback: direkt durchreichen
      return update(key, newValue);
    };
  }, [user, rawData, update]);

  // Erst NACH allen Hooks den frühen Return — sonst verstößt React gegen die Hook-Reihenfolge.
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
            {view === 'reports' && <ReportsView data={data} update={safeUpdate} />}
            {view === 'players' && <PlayersView data={data} update={safeUpdate} />}
            {view === 'coaches' && <CoachesView data={data} update={safeUpdate} />}
            {view === 'inventory' && <InventoryView data={data} update={safeUpdate} />}
            {view === 'deposits' && <DepositsView data={data} update={safeUpdate} />}
            {view === 'orders' && <OrdersView data={data} update={safeUpdate} />}
            {view === 'returns' && <ReturnsView data={data} update={safeUpdate} />}
            {view === 'settings' && user.role === 'admin' && <SettingsView data={data} update={safeUpdate} />}
            {view === 'users' && user.role === 'admin' && <UsersView data={data} />}
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
    { id: 'coaches', label: 'Trainer' },
    { id: 'inventory', label: 'Material' },
    { id: 'deposits', label: 'Pfand' },
    { id: 'returns', label: 'Rückgabe' },
    { id: 'orders', label: 'Bestellungen' },
  ];
  if (user?.role === 'admin') {
    nav.push({ id: 'settings', label: 'Einstellungen' });
    nav.push({ id: 'users', label: 'Nutzer' });
  }
  return (
    <header className="bg-white sticky top-0 z-10" style={{ borderBottom: '1px solid var(--rule)' }}>
      <div className="h-1" style={{ background: 'var(--vereinsblau)' }} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setView('dashboard')} className="text-left flex items-center gap-3">
            <img
              src="/fcf-logo.png?v=2"
              alt=""
              width="30"
              height="30"
              style={{ width: 30, height: 30, objectFit: 'contain', flexShrink: 0 }}
            />
            <div>
              <div className="font-sub text-xs" style={{ color: 'var(--vereinsblau)' }}>#DEINDORFVEREIN</div>
              <div className="font-display text-3xl sm:text-4xl leading-tight" style={{ color: 'var(--ink)' }}>Trikotverwaltung</div>
              <div className="text-xs mt-1" style={{ color: 'var(--ink-mute)' }}>{clubName}</div>
            </div>
          </button>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="text-xs" style={{ color: 'var(--ink-soft)' }}>{user?.name}</div>
              {user?.role === 'admin' ? (
                <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>Admin</div>
              ) : (
                <div className="text-[10px]" style={{ color: 'var(--ink-mute)' }}>
                  {Array.isArray(user?.teams) && user.teams.length > 0
                    ? user.teams.join(' · ')
                    : '— keine Mannschaft zugeordnet —'}
                </div>
              )}
            </div>
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
  const totalCoaches = (data.coaches || []).length;
  const playersWithMaterial = data.players.filter(p =>
    data.inventory.some(i => i.assignedTo === p.id && i.status === 'ausgegeben')
  ).length;
  const unusedItems = data.inventory.filter(i => i.status === 'lager').length;
  const totalDeposits = data.deposits.filter(d => !d.refunded).reduce((s, d) => s + d.amount, 0);
  const openOrders = data.orders.filter(o => o.status !== 'geliefert' && o.status !== 'storniert').length;

  const cards = [
    { label: 'Spieler & Trainer', value: totalPlayers + totalCoaches, target: 'players', sub: `${totalPlayers} Spieler · ${totalCoaches} Trainer` },
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
              const teamCoaches = (data.coaches || []).filter(c => c.team === team);
              const withMat = teamPlayers.filter(p => data.inventory.some(i => i.assignedTo === p.id && i.status === 'ausgegeben')).length;
              return (
                <div key={team} className="p-3 bg-white flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm" style={{ color: 'var(--ink)' }}>{team}</div>
                    <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>
                      {teamPlayers.length} Spieler · {teamCoaches.length} Trainer · {withMat} mit Material
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="stat-number text-3xl leading-none" style={{ color: 'var(--vereinsblau)' }}>{teamPlayers.length + teamCoaches.length}</div>
                    <div className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--ink-mute)' }}>Personen</div>
                  </div>
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
function SortHeader({ label, sortKey, sort, setSort, className = 'text-left p-3 font-medium' }) {
  const active = sort.key === sortKey;
  const dir = active ? sort.dir : null;
  function click() {
    setSort(active ? { key: sortKey, dir: dir === 'asc' ? 'desc' : 'asc' } : { key: sortKey, dir: 'asc' });
  }
  return (
    <th className={className}>
      <button onClick={click} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-stone-900">
        <span>{label}</span>
        <span className="text-[10px]" style={{ color: active ? 'var(--vereinsblau)' : 'var(--ink-mute)' }}>
          {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}

function compareValues(a, b, dir = 'asc') {
  const av = a === undefined || a === null || a === '' ? '~~~' : a;
  const bv = b === undefined || b === null || b === '' ? '~~~' : b;
  const bothNumbers = !isNaN(Number(av)) && !isNaN(Number(bv));
  const result = bothNumbers
    ? Number(av) - Number(bv)
    : String(av).localeCompare(String(bv), 'de', { numeric: true, sensitivity: 'base' });
  return dir === 'asc' ? result : -result;
}

// Generische Personen-Verwaltung: nutzt 'players' oder 'coaches' aus data
function PersonsView({ data, update, kind }) {
  const { user } = useAuth();
  const isPlayer = kind === 'player';
  const dataKey = isPlayer ? 'players' : 'coaches';
  const idPrefix = isPlayer ? 'p' : 'c';
  const labels = isPlayer
    ? { title: 'Spieler & Nummern', sectionLabel: 'KADER', sectionNumber: '04', singular: 'Spieler', plural: 'Spieler', addNew: 'Spieler anlegen', editNew: 'Spieler bearbeiten' }
    : { title: 'Trainer & Nummern', sectionLabel: 'TRAINERSTAB', sectionNumber: '04T', singular: 'Trainer', plural: 'Trainer', addNew: 'Trainer anlegen', editNew: 'Trainer bearbeiten' };

  const persons = data[dataKey] || [];
  const [filter, setFilter] = useState('alle');
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [equipmentPerson, setEquipmentPerson] = useState(null);
  const [equipmentTeam, setEquipmentTeam] = useState(null);
  const [sort, setSort] = useState({ key: 'number', dir: 'asc' });

  const canDelete = userCan(user, 'canDeletePeople');
  const canEditInventory = userCan(user, 'canEditInventory');

  const filtered = filter === 'alle' ? persons : persons.filter(p => p.team === filter);

  function save(person) {
    if (editing) {
      update(dataKey, persons.map(p => p.id === editing.id ? { ...person, id: editing.id } : p));
    } else {
      update(dataKey, [...persons, { ...person, id: `${idPrefix}_${Date.now()}` }]);
    }
    setShowForm(false); setEditing(null);
  }

  function bulkAdd(newPersons) {
    const withIds = newPersons.map((p, i) => ({
      ...p,
      id: `${idPrefix}_${Date.now()}_${i}`,
      number: isPlayer
        ? (p.number ? parseInt(p.number) : null)
        : (p.number ? String(p.number).trim().toUpperCase().slice(0, 3) : null),
    }));
    update(dataKey, [...persons, ...withIds]);
    setShowImport(false);
  }

  function remove(id) {
    // Harte Schutzregel (gilt auch für Admins): keine Person mit offenem Material/Pfand löschen.
    const check = canDeletePerson(data, id);
    if (!check.ok) {
      alert(`Diese ${labels.singular === 'Spieler' ? 'Person' : labels.singular} kann nicht gelöscht werden:\n\n• ${check.reasons.join('\n• ')}`);
      return;
    }
    if (!confirm(`${labels.singular} wirklich löschen?`)) return;
    update(dataKey, persons.filter(p => p.id !== id));
  }

  function saveEquipmentInventory(nextInventory) {
    update('inventory', nextInventory);
    setEquipmentPerson(null);
    setEquipmentTeam(null);
  }

  function sortPersonList(list) {
    return [...list].sort((a, b) => {
      if (sort.key === 'number') return compareValues(a.number, b.number, sort.dir);
      if (sort.key === 'name') return compareValues(`${a.lastName || ''} ${a.firstName || ''}`, `${b.lastName || ''} ${b.firstName || ''}`, sort.dir);
      if (sort.key === 'team') return compareValues(a.team, b.team, sort.dir);
      if (sort.key === 'size') return compareValues(a.size, b.size, sort.dir);
      if (sort.key === 'material') {
        const ac = data.inventory.filter(i => i.assignedTo === a.id && i.status === 'ausgegeben').length;
        const bc = data.inventory.filter(i => i.assignedTo === b.id && i.status === 'ausgegeben').length;
        return compareValues(ac, bc, sort.dir);
      }
      if (sort.key === 'deposit') {
        const ad = data.deposits.find(d => d.playerId === a.id && !d.refunded)?.amount || 0;
        const bd = data.deposits.find(d => d.playerId === b.id && !d.refunded)?.amount || 0;
        return compareValues(ad, bd, sort.dir);
      }
      return 0;
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <PageHeader number={labels.sectionNumber} label={labels.sectionLabel} title={labels.title} subtitle={`${persons.length} registriert`} />
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)}
            className="px-5 py-2.5 text-xs font-medium flex items-center gap-2 uppercase"
            style={{ background: 'var(--paper-dark)', color: 'var(--ink)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
            <Download size={14} style={{ transform: 'rotate(180deg)' }} /> CSV importieren
          </button>
          {canEditInventory && (
            <button onClick={() => setEquipmentTeam(filter === 'alle' ? (data.teams[0] || '') : filter)}
              className="px-5 py-2.5 text-xs font-medium flex items-center gap-2 uppercase"
              style={{ background: 'var(--paper-dark)', color: 'var(--ink)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
              <Package size={14} /> Team-Set
            </button>
          )}
          <button onClick={() => { setEditing(null); setShowForm(true); }}
            className="px-5 py-2.5 text-xs font-medium flex items-center gap-2 uppercase"
            style={{ background: 'var(--vereinsblau)', color: 'white', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
            <Plus size={14} /> {labels.addNew}
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto -mx-4 px-4 pb-1">
        <button onClick={() => setFilter('alle')}
          className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap ${filter === 'alle' ? 'bg-stone-900 text-white' : 'bg-white border border-stone-200'}`}>
          Alle ({persons.length})
        </button>
        {data.teams.map(t => (
          <button key={t} onClick={() => setFilter(t)}
            className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap ${filter === t ? 'bg-stone-900 text-white' : 'bg-white border border-stone-200'}`}>
            {t} ({persons.filter(p => p.team === t).length})
          </button>
        ))}
      </div>

      {showForm && <PlayerForm player={editing} players={persons} teams={data.teams} labels={labels} kind={kind} onSave={save} onCancel={() => { setShowForm(false); setEditing(null); }} />}
      {showImport && <PlayerImport teams={data.teams} existingPlayers={persons} labels={labels} kind={kind} onImport={bulkAdd} onCancel={() => setShowImport(false)} />}
      {equipmentPerson && (
        <BasicEquipmentDialog
          data={data}
          person={{ ...equipmentPerson, _kind: kind }}
          onSave={saveEquipmentInventory}
          onCancel={() => setEquipmentPerson(null)}
        />
      )}
      {equipmentTeam && (
        <TeamBasicEquipmentDialog
          data={data}
          kind={kind}
          team={equipmentTeam}
          onTeamChange={setEquipmentTeam}
          onSave={saveEquipmentInventory}
          onCancel={() => setEquipmentTeam(null)}
        />
      )}

      <div className="bg-white border border-stone-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-stone-500 text-sm">Noch keine {labels.plural} in dieser Auswahl.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wider text-stone-500">
                <tr>
                  <SortHeader label={isPlayer ? 'Nr.' : 'Init.'} sortKey="number" sort={sort} setSort={setSort} />
                  <SortHeader label="Name" sortKey="name" sort={sort} setSort={setSort} />
                  <SortHeader label="Mannschaft" sortKey="team" sort={sort} setSort={setSort} className="text-left p-3 font-medium hidden md:table-cell" />
                  <SortHeader label="Größe" sortKey="size" sort={sort} setSort={setSort} className="text-left p-3 font-medium hidden sm:table-cell" />
                  <SortHeader label="Material" sortKey="material" sort={sort} setSort={setSort} />
                  <SortHeader label="Pfand" sortKey="deposit" sort={sort} setSort={setSort} className="text-left p-3 font-medium hidden md:table-cell" />
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {sortPersonList(filtered).map(p => {
                  const itemCount = data.inventory.filter(i => i.assignedTo === p.id && i.status === 'ausgegeben').length;
                  const flaggedCount = data.inventory.filter(i => i.assignedTo === p.id && i.flagged).length;
                  const deposit = data.deposits.find(d => d.playerId === p.id && !d.refunded);
                  return (
                    <tr key={p.id} className="border-t border-stone-100">
                      <td className="p-3">
                        {isPlayer ? (
                          <span className="font-display text-xl">{p.number || '–'}</span>
                        ) : (
                          p.number ? (
                            <span className="inline-block px-2 py-1 text-xs font-medium" style={{ background: 'var(--paper-dark)', color: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.12em', minWidth: '2.5rem', textAlign: 'center' }}>
                              {p.number}
                            </span>
                          ) : <span className="text-stone-400">–</span>
                        )}
                      </td>
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
                        {flaggedCount > 0 && (
                          <span className="inline-block px-2 py-0.5 text-xs ml-1" style={{ background: '#F5EBDD', color: 'var(--warn)' }}
                            title="Aus Bedarfsmeldung markiert">
                            ⚠ {flaggedCount}
                          </span>
                        )}
                      </td>
                      <td className="p-3 hidden md:table-cell">
                        {deposit ? <span className="text-emerald-700 font-medium">{deposit.amount} €</span> : <span className="text-stone-400">–</span>}
                      </td>
                      <td className="p-3 text-right">
                        {canEditInventory && (
                          <button
                            onClick={() => setEquipmentPerson(p)}
                            className="text-stone-400 hover:text-stone-900 p-1 inline-flex items-center gap-1"
                            title="Grundbestückung / Ausgabevorschläge">
                            <Package size={14} />
                            <span className="hidden lg:inline text-xs">Set</span>
                          </button>
                        )}
                        <button onClick={() => { setEditing(p); setShowForm(true); }} className="text-stone-400 hover:text-stone-900 p-1">
                          <Edit2 size={14} />
                        </button>
                        {canDelete && (() => {
                          const check = canDeletePerson(data, p.id);
                          return (
                            <button
                              onClick={() => remove(p.id)}
                              disabled={!check.ok}
                              title={check.ok ? 'Löschen' : `Löschen blockiert: ${check.reasons.join(', ')}`}
                              className={`p-1 ${check.ok ? 'text-stone-400 hover:text-red-600' : 'text-stone-300 cursor-not-allowed'}`}>
                              <Trash2 size={14} />
                            </button>
                          );
                        })()}
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

function BasicEquipmentDialog({ data, person, onSave, onCancel }) {
  const allSets = migrateStandardSets(data.settings).filter(set =>
    set.target === 'both' ||
    (person._kind === 'coach' ? set.target === 'coach' : set.target === 'player')
  );
  const [setId, setSetId] = useState(allSets[0]?.id || '');
  const [correctionMode, setCorrectionMode] = useState(true);
  const selectedSet = allSets.find(s => s.id === setId);
  const targetNumber = personNumberValue(person);
  const targetName = (person.lastName || '').toUpperCase();

  function issuedCountForItem(itemId) {
    return (data.inventory || []).filter(inv =>
      inv.itemType === itemId &&
      inv.status === 'ausgegeben' &&
      (
        inv.assignedTo === person.id ||
        (inv.assignedTo == null && inv.team === person.team && inventoryMatchesPersonNumber(inv, person))
      )
    ).length;
  }

  function buildSuggestions() {
    if (!selectedSet) return [];
    const usedStock = new Set();
    const suggestions = [];
    (selectedSet.items || []).forEach(entry => {
      const item = (data.items || []).find(i => i.id === entry.itemId);
      if (!item) return;
      const qty = Number(entry.qty) || 1;
      const alreadyIssued = issuedCountForItem(item.id);
      const missing = Math.max(0, qty - alreadyIssued);
      for (let idx = 0; idx < missing; idx++) {
        const stock = (data.inventory || []).filter(inv =>
          inv.status === 'lager' &&
          inv.itemType === item.id &&
          (inv.size || person.size || 'L') === (person.size || inv.size || 'L') &&
          !usedStock.has(inv.id)
        );
        const exact = stock.find(inv => inventoryMatchesPersonNumber(inv, person));
        const sized = correctionMode ? (exact || null) : (exact || stock[0] || null);
        if (sized) usedStock.add(sized.id);
        const oldNumber = sized?.assignedNumber ? String(sized.assignedNumber) : '';
        const needsReprint = !correctionMode && !!sized && (!inventoryMatchesPersonNumber(sized, person));
        suggestions.push({
          id: `${item.id}_${idx}`,
          item,
          size: person.size || sized?.size || 'L',
          alreadyIssued,
          stock: sized,
          action: exact ? 'passend' : sized ? 'umbeflocken' : 'korrektur',
          needsReprint,
          oldNumber,
          newNumber: targetNumber,
        });
      }
    });
    return suggestions;
  }

  const suggestions = buildSuggestions();
  const reprintRows = suggestions.filter(s => s.needsReprint);

  function applySuggestions() {
    if (!selectedSet) return;
    const now = new Date().toISOString();
    const byId = new Map((data.inventory || []).map(inv => [inv.id, inv]));
    const additions = [];

    suggestions.forEach((s, idx) => {
      if (s.stock) {
        const oldNumber = s.oldNumber || null;
        byId.set(s.stock.id, {
          ...s.stock,
          status: 'ausgegeben',
          assignedTo: person.id,
          assignedNumber: targetNumber || null,
          assignedName: targetName || null,
          personKind: person._kind,
          team: person.team || s.stock.team || null,
          assignedAt: now,
          needsReprint: s.needsReprint,
          reprintFromNumber: s.needsReprint ? oldNumber : null,
          reprintToNumber: s.needsReprint ? (targetNumber || null) : null,
          reprintRequestedAt: s.needsReprint ? now : null,
        });
      } else if (correctionMode) {
        additions.push({
          id: `inv_corr_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 5)}`,
          itemType: s.item.id,
          itemName: s.item.name,
          articleNumber: s.item.articleNumber || null,
          size: s.size,
          team: person.team || null,
          status: 'ausgegeben',
          assignedTo: person.id,
          assignedNumber: targetNumber || null,
          assignedName: targetName || null,
          personKind: person._kind,
          assignedAt: now,
          acquiredAt: now,
          correctionEntry: true,
          correctionReason: 'Nachträgliche Grundbestückung ohne vorherigen Lagerbestand',
          seasonsUsed: 0,
          condition: 'gut',
          originalPrice: s.item.price || 0,
        });
      }
    });

    onSave([...byId.values(), ...additions]);
    alert(`Grundbestückung verarbeitet: ${suggestions.filter(s => s.stock).length} Lagerteil(e) ausgegeben, ${additions.length} Korrekturteil(e) angelegt.`);
  }

  function exportReprintCSV() {
    const rows = [
      ['Mannschaft', 'Person', person._kind === 'coach' ? 'Initialen alt' : 'Nummer alt', person._kind === 'coach' ? 'Initialen neu' : 'Nummer neu', 'Artikel', 'Größe', 'Inventar-ID'],
      ...reprintRows.map(s => [
        person.team || '',
        `${person.firstName} ${person.lastName}`.trim(),
        s.oldNumber || 'ohne',
        s.newNumber || '',
        s.item.name,
        s.stock?.size || s.size,
        s.stock?.id || '',
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `umbeflockung_${person.lastName || person.id}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="bg-white border-2 border-stone-900 p-6 mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display text-2xl">GRUNDBESTÜCKUNG</h2>
          <p className="text-sm text-stone-600">
            {person.firstName} {person.lastName} · {person.team} · {person._kind === 'coach' ? 'Initialen' : 'Nr.'} {targetNumber || '–'}
          </p>
        </div>
        <button onClick={onCancel} className="p-2 hover:bg-stone-100" title="Schließen">
          <X size={18} />
        </button>
      </div>

      {allSets.length === 0 ? (
        <div className="p-4 text-sm" style={{ background: 'var(--paper-dark)', color: 'var(--ink-soft)' }}>
          Kein passendes Standard-Set hinterlegt. Lege zuerst unter Einstellungen → Standard-Sets eine Erstausstattung an.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <Field label="Standard-Set als Basis">
              <select value={setId} onChange={e => setSetId(e.target.value)} className="w-full border border-stone-300 px-3 py-2 text-sm">
                {allSets.map(set => <option key={set.id} value={set.id}>{set.name}</option>)}
              </select>
            </Field>
            <label className="flex items-start gap-3 p-3 cursor-pointer" style={{ border: '1px solid var(--rule)', background: correctionMode ? '#F1ECDF' : 'white' }}>
              <input type="checkbox" checked={correctionMode} onChange={e => setCorrectionMode(e.target.checked)} className="mt-1" />
              <div>
                <div className="text-sm font-medium">Korrektur Ausgabemengen</div>
                <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>Fehlende Teile direkt als ausgegeben einpflegen, auch ohne vorherigen Lagerbestand.</div>
              </div>
            </label>
          </div>

          {correctionMode && (
            <div className="text-xs p-3 mb-3" style={{ background: 'var(--paper-dark)', color: 'var(--ink-soft)', borderLeft: '3px solid var(--vereinsblau)' }}>
              Korrekturmodus: Fehlende Teile werden mit der aktuell hinterlegten Nummer/Initiale {targetNumber || '–'} eingepflegt. Abweichend beflockte Lagerteile werden dabei nicht verwendet.
            </div>
          )}

          <div className="border border-stone-200 overflow-x-auto mb-3">
            <table className="w-full text-xs">
              <thead className="bg-stone-50 uppercase tracking-wider">
                <tr>
                  <th className="text-left p-2">Artikel</th>
                  <th className="text-left p-2">Größe</th>
                  <th className="text-left p-2">Vorschlag</th>
                  <th className="text-left p-2">Nr./Init. alt</th>
                  <th className="text-left p-2">Nr./Init. neu</th>
                  <th className="text-left p-2">Inventar</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.length === 0 ? (
                  <tr><td className="p-4 text-center text-stone-500" colSpan={6}>Standard-Set ist für diese Person bereits vollständig ausgegeben.</td></tr>
                ) : suggestions.map(s => (
                  <tr key={s.id} className="border-t border-stone-100">
                    <td className="p-2 font-medium">{s.item.name}</td>
                    <td className="p-2">{s.stock?.size || s.size}</td>
                    <td className="p-2">
                      {s.action === 'passend' && <span className="text-emerald-700">Passend aus Lager</span>}
                      {s.action === 'umbeflocken' && <span style={{ color: 'var(--warn)' }}>Aus Lager, Umbeflockung nötig</span>}
                      {s.action === 'korrektur' && <span style={{ color: correctionMode ? 'var(--vereinsblau)' : 'var(--danger)' }}>{correctionMode ? 'Korrektur-Ausgabe' : 'Kein Lagerbestand'}</span>}
                    </td>
                    <td className="p-2">{s.oldNumber || '–'}</td>
                    <td className="p-2 font-medium" style={{ color: 'var(--vereinsblau)' }}>{s.newNumber || '–'}</td>
                    <td className="p-2 font-mono">{s.stock?.id || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap justify-between gap-2">
            <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>
              {reprintRows.length} Teil(e) müssen umbeflockt oder mit neuer Nummer/Initialen versehen werden.
            </div>
            <div className="flex gap-2">
              <button onClick={exportReprintCSV} disabled={reprintRows.length === 0}
                className="px-4 py-2 text-xs uppercase disabled:opacity-50"
                style={{ border: '1px solid var(--rule)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
                Umbeflockungsliste CSV
              </button>
              <button onClick={applySuggestions} disabled={suggestions.length === 0 || (!correctionMode && suggestions.every(s => !s.stock))}
                className="px-4 py-2 text-xs uppercase text-white disabled:opacity-50"
                style={{ background: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
                Vorschläge übernehmen
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TeamBasicEquipmentDialog({ data, kind, team, onTeamChange, onSave, onCancel }) {
  const persons = (kind === 'coach' ? (data.coaches || []) : (data.players || [])).filter(p => p.team === team).map(p => ({ ...p, _kind: kind }));
  const allSets = migrateStandardSets(data.settings).filter(set =>
    set.target === 'both' || (kind === 'coach' ? set.target === 'coach' : set.target === 'player')
  );
  const [setId, setSetId] = useState(allSets[0]?.id || '');
  const [correctionMode, setCorrectionMode] = useState(true);
  const selectedSet = allSets.find(s => s.id === setId);

  function issuedCountForPersonItem(person, itemId) {
    return (data.inventory || []).filter(inv =>
      inv.itemType === itemId &&
      inv.status === 'ausgegeben' &&
      (
        inv.assignedTo === person.id ||
        (inv.assignedTo == null && inv.team === person.team && inventoryMatchesPersonNumber(inv, person))
      )
    ).length;
  }

  function buildAllSuggestions() {
    if (!selectedSet) return [];
    const usedStock = new Set();
    const out = [];
    persons.forEach(person => {
      const targetNumber = personNumberValue(person);
      (selectedSet.items || []).forEach(entry => {
        const item = (data.items || []).find(i => i.id === entry.itemId);
        if (!item) return;
        const missing = Math.max(0, (Number(entry.qty) || 1) - issuedCountForPersonItem(person, item.id));
        for (let idx = 0; idx < missing; idx++) {
          const stock = (data.inventory || []).filter(inv =>
            inv.status === 'lager' &&
            inv.itemType === item.id &&
            (inv.size || person.size || 'L') === (person.size || inv.size || 'L') &&
            !usedStock.has(inv.id)
          );
          const exact = stock.find(inv => inventoryMatchesPersonNumber(inv, person));
          const sized = correctionMode ? (exact || null) : (exact || stock[0] || null);
          if (sized) usedStock.add(sized.id);
          out.push({
            id: `${person.id}_${item.id}_${idx}`,
            person,
            item,
            stock: sized,
            size: person.size || sized?.size || 'L',
            oldNumber: sized?.assignedNumber ? String(sized.assignedNumber) : '',
            newNumber: targetNumber,
            needsReprint: !correctionMode && !!sized && !inventoryMatchesPersonNumber(sized, person),
            action: exact ? 'passend' : sized ? 'umbeflocken' : 'korrektur',
          });
        }
      });
    });
    return out;
  }

  const suggestions = buildAllSuggestions();
  const reprintRows = suggestions.filter(s => s.needsReprint);

  function applySuggestions() {
    const now = new Date().toISOString();
    const byId = new Map((data.inventory || []).map(inv => [inv.id, inv]));
    const additions = [];
    suggestions.forEach((s, idx) => {
      const person = s.person;
      const targetNumber = personNumberValue(person);
      const targetName = (person.lastName || '').toUpperCase();
      if (s.stock) {
        byId.set(s.stock.id, {
          ...s.stock,
          status: 'ausgegeben',
          assignedTo: person.id,
          assignedNumber: targetNumber || null,
          assignedName: targetName || null,
          personKind: person._kind,
          team: person.team || s.stock.team || null,
          assignedAt: now,
          needsReprint: s.needsReprint,
          reprintFromNumber: s.needsReprint ? (s.oldNumber || null) : null,
          reprintToNumber: s.needsReprint ? (targetNumber || null) : null,
          reprintRequestedAt: s.needsReprint ? now : null,
        });
      } else if (correctionMode) {
        additions.push({
          id: `inv_corr_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 5)}`,
          itemType: s.item.id,
          itemName: s.item.name,
          articleNumber: s.item.articleNumber || null,
          size: s.size,
          team: person.team || null,
          status: 'ausgegeben',
          assignedTo: person.id,
          assignedNumber: targetNumber || null,
          assignedName: targetName || null,
          personKind: person._kind,
          assignedAt: now,
          acquiredAt: now,
          correctionEntry: true,
          correctionReason: 'Team-Grundbestückung ohne vorherigen Lagerbestand',
          seasonsUsed: 0,
          condition: 'gut',
          originalPrice: s.item.price || 0,
        });
      }
    });
    onSave([...byId.values(), ...additions]);
    alert(`Team-Set verarbeitet: ${suggestions.filter(s => s.stock).length} Lagerteil(e) ausgegeben, ${additions.length} Korrekturteil(e) angelegt.`);
  }

  function exportReprintCSV() {
    const rows = [
      ['Mannschaft', 'Person', kind === 'coach' ? 'Initialen alt' : 'Nummer alt', kind === 'coach' ? 'Initialen neu' : 'Nummer neu', 'Artikel', 'Größe', 'Inventar-ID'],
      ...reprintRows.map(s => [
        s.person.team || '',
        `${s.person.firstName} ${s.person.lastName}`.trim(),
        s.oldNumber || 'ohne',
        s.newNumber || '',
        s.item.name,
        s.stock?.size || s.size,
        s.stock?.id || '',
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `umbeflockung_${team || 'team'}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="bg-white border-2 border-stone-900 p-6 mb-4">
      <div className="flex flex-wrap justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display text-2xl">TEAM-GRUNDBESTÜCKUNG</h2>
          <p className="text-sm text-stone-600">{persons.length} {kind === 'coach' ? 'Trainer' : 'Spieler'} · {team || 'ohne Mannschaft'}</p>
        </div>
        <button onClick={onCancel} className="p-2 hover:bg-stone-100" title="Schließen"><X size={18} /></button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Field label="Mannschaft">
          <select value={team} onChange={e => onTeamChange(e.target.value)} className="w-full border border-stone-300 px-3 py-2 text-sm">
            {(data.teams || []).map(t => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Standard-Set">
          <select value={setId} onChange={e => setSetId(e.target.value)} className="w-full border border-stone-300 px-3 py-2 text-sm">
            {allSets.map(set => <option key={set.id} value={set.id}>{set.name}</option>)}
          </select>
        </Field>
        <label className="flex items-start gap-3 p-3 cursor-pointer" style={{ border: '1px solid var(--rule)', background: correctionMode ? '#F1ECDF' : 'white' }}>
          <input type="checkbox" checked={correctionMode} onChange={e => setCorrectionMode(e.target.checked)} className="mt-1" />
          <div>
            <div className="text-sm font-medium">Korrektur Ausgabemengen</div>
            <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>Fehlende Teile ohne Lagerbestand einpflegen.</div>
          </div>
        </label>
      </div>
      {correctionMode && (
        <div className="text-xs p-3 mb-3" style={{ background: 'var(--paper-dark)', color: 'var(--ink-soft)', borderLeft: '3px solid var(--vereinsblau)' }}>
          Korrekturmodus: fehlende Teile werden je Person mit der im Kader hinterlegten Nummer/Initiale eingepflegt. Abweichend beflockte Lagerteile werden nicht verwendet und erzeugen keine Umbeflockung.
        </div>
      )}
      <div className="border border-stone-200 overflow-x-auto mb-3 max-h-80">
        <table className="w-full text-xs">
          <thead className="bg-stone-50 uppercase tracking-wider sticky top-0">
            <tr>
              <th className="text-left p-2">Person</th>
              <th className="text-left p-2">Artikel</th>
              <th className="text-left p-2">Vorschlag</th>
              <th className="text-left p-2">Alt</th>
              <th className="text-left p-2">Neu</th>
            </tr>
          </thead>
          <tbody>
            {suggestions.length === 0 ? (
              <tr><td className="p-4 text-center text-stone-500" colSpan={5}>Für dieses Team ist das Set vollständig ausgegeben.</td></tr>
            ) : suggestions.map(s => (
              <tr key={s.id} className="border-t border-stone-100">
                <td className="p-2">{s.person.firstName} {s.person.lastName}</td>
                <td className="p-2">{s.item.name} · {s.stock?.size || s.size}</td>
                <td className="p-2">
                  {s.action === 'passend' && <span className="text-emerald-700">Passend</span>}
                  {s.action === 'umbeflocken' && <span style={{ color: 'var(--warn)' }}>Umbeflockung</span>}
                  {s.action === 'korrektur' && <span style={{ color: correctionMode ? 'var(--vereinsblau)' : 'var(--danger)' }}>{correctionMode ? 'Korrektur' : 'Kein Lager'}</span>}
                </td>
                <td className="p-2">{s.oldNumber || '–'}</td>
                <td className="p-2 font-medium" style={{ color: 'var(--vereinsblau)' }}>{s.newNumber || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>{suggestions.length} offene Set-Position(en), {reprintRows.length} Umbeflockung(en).</div>
        <div className="flex gap-2">
          <button onClick={exportReprintCSV} disabled={reprintRows.length === 0} className="px-4 py-2 text-xs uppercase disabled:opacity-50" style={{ border: '1px solid var(--rule)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>Umbeflockungsliste CSV</button>
          <button onClick={applySuggestions} disabled={suggestions.length === 0 || (!correctionMode && suggestions.every(s => !s.stock))} className="px-4 py-2 text-xs uppercase text-white disabled:opacity-50" style={{ background: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>Team-Set übernehmen</button>
        </div>
      </div>
    </div>
  );
}

// Wrapper für Spieler und Trainer
function PlayersView({ data, update }) {
  return <PersonsView data={data} update={update} kind="player" />;
}

function CoachesView({ data, update }) {
  return <PersonsView data={data} update={update} kind="coach" />;
}

function PlayerForm({ player, players, teams, labels, kind, onSave, onCancel }) {
  const isCoach = kind === 'coach';
  const numberLabel = isCoach ? 'Initialen (max. 3 Zeichen)' : 'Rückennummer';
  const numberPlaceholder = isCoach ? 'z.B. DW' : '';
  const L = labels || { addNew: 'Spieler anlegen', editNew: 'Spieler bearbeiten', singular: 'Spieler' };
  const [form, setForm] = useState(player || { firstName: '', lastName: '', team: teams[0] || '', number: '', size: 'L', notes: '' });

  // Konflikt-Check funktioniert für Spieler (Nummer) wie Trainer (Initialen) gleich:
  // Pro Mannschaft darf der gleiche Wert nicht doppelt vergeben sein.
  const numberConflict = form.number && players.some(p =>
    p.id !== player?.id
    && p.team === form.team
    && String(p.number).trim().toLowerCase() === String(form.number).trim().toLowerCase()
  );

  function handleNumberChange(val) {
    if (isCoach) {
      // Trainer: nur Buchstaben, max. 3, automatisch Großbuchstaben
      const cleaned = val.replace(/[^a-zA-ZäöüÄÖÜß]/g, '').slice(0, 3).toUpperCase();
      setForm({ ...form, number: cleaned });
    } else {
      // Spieler: nur Ziffern
      const cleaned = val.replace(/[^0-9]/g, '');
      setForm({ ...form, number: cleaned });
    }
  }

  function submit() {
    if (!form.firstName || !form.lastName) return alert('Name fehlt');
    if (!form.team) return alert('Bitte zuerst eine Mannschaft in den Einstellungen anlegen.');
    if (numberConflict) return alert(`${isCoach ? 'Initialen' : 'Rückennummer'} in dieser Mannschaft bereits vergeben`);

    // Spieler-Nummer als Integer speichern, Trainer-Initialen als String
    const numberValue = isCoach
      ? (form.number ? String(form.number).trim().toUpperCase() : null)
      : (form.number ? parseInt(form.number) : null);

    onSave({ ...form, number: numberValue });
  }

  return (
    <div className="bg-white border-2 border-stone-900 p-6 mb-4">
      <h2 className="font-display text-2xl mb-4">{(player ? L.editNew : L.addNew).toUpperCase()}</h2>
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
        <Field label={`${numberLabel} ${numberConflict ? '⚠ vergeben' : ''}`}>
          <input
            type="text"
            inputMode={isCoach ? 'text' : 'numeric'}
            maxLength={isCoach ? 3 : 3}
            placeholder={numberPlaceholder}
            className={`w-full border px-3 py-2 text-sm ${numberConflict ? 'border-red-500' : 'border-stone-300'} ${isCoach ? 'uppercase' : ''}`}
            value={form.number || ''}
            onChange={e => handleNumberChange(e.target.value)}
          />
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
function PlayerImport({ teams, existingPlayers, kind, onImport, onCancel }) {
  const isCoach = kind === 'coach';
  const numberLabel = isCoach ? 'Initialen' : 'Rückennummer';

  const [step, setStep] = useState('upload'); // upload | preview
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  function downloadTemplate() {
    const header = ['Vorname', 'Nachname', 'Mannschaft', numberLabel, 'Größe', 'Notizen'];
    const example = isCoach ? [
      ['Dennis', 'Hasecke', teams[0] || '1. Mannschaft', 'DH', 'XL', 'Cheftrainer'],
      ['Sven', 'Berger', teams[0] || '1. Mannschaft', 'SB', 'L', 'Co-Trainer'],
    ] : [
      ['Max', 'Mustermann', teams[0] || '1. Mannschaft', '10', 'L', ''],
      ['Tim', 'Beispiel', teams[0] || '1. Mannschaft', '7', 'M', 'Kapitän'],
    ];
    const csv = [header, ...example].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = isCoach ? 'trainer_import_vorlage.csv' : 'spieler_import_vorlage.csv'; a.click();
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
      const iNumber = col('rückennummer', 'rueckennummer', 'nummer', 'number', 'nr', 'initialen', 'kürzel', 'kuerzel');
      const iSize = col('größe', 'groesse', 'size');
      const iNotes = col('notizen', 'notes', 'bemerkung');

      if (iVorname < 0 || iNachname < 0) {
        throw new Error('Spalten "Vorname" und "Nachname" sind Pflicht. Bitte die Vorlage verwenden.');
      }

      const dataRows = parsed.slice(1).filter(r => r.some(c => c && c.trim()));
      const rows = dataRows.map((r, idx) => {
        let numberRaw = iNumber >= 0 ? (r[iNumber] || '').trim() : '';
        if (isCoach) numberRaw = numberRaw.replace(/[^a-zA-ZäöüÄÖÜß]/g, '').slice(0, 3).toUpperCase();
        return {
          _idx: idx,
          firstName: (r[iVorname] || '').trim(),
          lastName: (r[iNachname] || '').trim(),
          team: iTeam >= 0 ? (r[iTeam] || '').trim() : (teams[0] || ''),
          number: numberRaw,
          size: iSize >= 0 ? ((r[iSize] || '').trim().toUpperCase() || 'L') : 'L',
          notes: iNotes >= 0 ? (r[iNotes] || '').trim() : '',
        };
      });

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
      if (isCoach) {
        // Trainer: Initialen, max. 3 Buchstaben
        if (!/^[a-zA-ZäöüÄÖÜß]{1,3}$/.test(row.number)) {
          errors.push('Initialen ungültig (1–3 Buchstaben)');
        } else {
          const norm = String(row.number).trim().toUpperCase();
          // Konflikt mit existierenden
          const conflictExisting = existingPlayers.some(p =>
            p.team === row.team && String(p.number).trim().toUpperCase() === norm
          );
          if (conflictExisting) errors.push('Initialen bereits vergeben');
          // Konflikt im Import
          const conflictImport = allRows.some(o =>
            o._idx !== row._idx && o.team === row.team && o.number && String(o.number).trim().toUpperCase() === norm
          );
          if (conflictImport) errors.push('Initialen doppelt im Import');
        }
      } else {
        const n = parseInt(row.number);
        if (isNaN(n)) errors.push('Nummer ungültig');
        else {
          const conflictExisting = existingPlayers.some(p => p.team === row.team && String(p.number) === String(n));
          if (conflictExisting) errors.push('Nummer bereits vergeben');
          const conflictImport = allRows.some(o =>
            o._idx !== row._idx && o.team === row.team && o.number && parseInt(o.number) === n
          );
          if (conflictImport) errors.push('Nummer doppelt im Import');
        }
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
            <strong style={{ color: 'var(--vereinsblau)' }}>Optionale Spalten:</strong> Mannschaft, {numberLabel}{isCoach ? ' (1–3 Buchstaben)' : ''}, Größe (XS/S/M/L/XL/XXL/3XL), Notizen<br />
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
                  <th className="text-left p-2">{isCoach ? 'Init.' : 'Nr.'}</th>
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
                    <td className="p-1">
                      <input
                        type="text"
                        inputMode={isCoach ? 'text' : 'numeric'}
                        maxLength={3}
                        className={`w-16 px-2 py-1 text-xs ${isCoach ? 'uppercase' : ''}`}
                        value={r.number}
                        onChange={e => {
                          const val = isCoach
                            ? e.target.value.replace(/[^a-zA-ZäöüÄÖÜß]/g, '').slice(0, 3).toUpperCase()
                            : e.target.value.replace(/[^0-9]/g, '');
                          updateRow(r._idx, 'number', val);
                        }}
                        style={{ border: '1px solid var(--rule)' }}
                      />
                    </td>
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

// Hilfsfunktion: aus Artikelname eine ID generieren (kleinbuchstaben, ohne Sonderzeichen)
function slugify(name) {
  return String(name).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ============ KATALOG-IMPORT (ARTIKELLISTE) ============
function CatalogImport({ existingItems, onImport, onCancel, suppliers = [] }) {
  const [step, setStep] = useState('upload'); // upload | preview
  const [rows, setRows] = useState([]);
  const [mode, setMode] = useState('update'); // update | add | replace
  const [error, setError] = useState('');

  function downloadTemplate() {
    const header = ['Artikelnummer', 'Name', 'Neupreis', 'Ersatzwert', 'Lieferant'];
    const example = [
      ['T-001', 'Präsentationsjacke', '40', '25', suppliers[0]?.name || ''],
      ['T-002', 'Trainingsshirt', '18', '10', suppliers[0]?.name || ''],
      ['T-003', 'Neuer Artikel', '35', '20', ''],
    ];
    const csv = [header, ...example].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'artikelkatalog_vorlage.csv'; a.click();
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
      const col = (...names) => {
        for (const n of names) {
          const idx = header.findIndex(h => h === n);
          if (idx >= 0) return idx;
        }
        return -1;
      };
      const iArtNr = col('artikelnummer', 'art-nr', 'art.-nr.', 'artnr', 'sku');
      const iName = col('name', 'artikel', 'bezeichnung');
      const iPrice = col('neupreis', 'preis', 'price');
      const iReplacement = col('ersatzwert', 'replacementvalue', 'replacement');
      const iSupplier = col('lieferant', 'supplier');

      if (iName < 0) {
        throw new Error('Spalte "Name" ist Pflicht. Bitte die Vorlage verwenden.');
      }

      const dataRows = parsed.slice(1).filter(r => r.some(c => c && c.trim()));
      const items = dataRows.map((r, idx) => {
        const name = (r[iName] || '').trim();
        const articleNumber = iArtNr >= 0 ? (r[iArtNr] || '').trim() : '';

        // Supplier: per Name auflösen (case-insensitive)
        let supplierId = null;
        let supplierWarning = null;
        if (iSupplier >= 0) {
          const supName = (r[iSupplier] || '').trim();
          if (supName) {
            const found = suppliers.find(s => s.name.trim().toLowerCase() === supName.toLowerCase());
            if (found) supplierId = found.id;
            else supplierWarning = supName;
          }
        }

        return {
          _idx: idx,
          articleNumber,
          name,
          price: iPrice >= 0 ? parseFloat((r[iPrice] || '0').replace(',', '.')) || 0 : 0,
          replacementValue: iReplacement >= 0 && (r[iReplacement] || '').trim()
            ? parseFloat((r[iReplacement] || '0').replace(',', '.')) || 0
            : null,
          supplierId,
          supplierWarning,
        };
      });

      setRows(items);
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

  // Match-Logik: vorhandene Artikel werden über articleNumber identifiziert (case-insensitive).
  // Fallback: Wenn keine Artikelnummer in CSV, dann auf Name matchen.
  function findExisting(row) {
    if (row.articleNumber) {
      const an = row.articleNumber.trim().toLowerCase();
      return existingItems.find(e => (e.articleNumber || '').trim().toLowerCase() === an);
    }
    return existingItems.find(e => e.name.trim().toLowerCase() === row.name.trim().toLowerCase());
  }

  function fateOf(row) {
    if (!row.name) return { type: 'skip', label: 'übersprungen', color: 'var(--ink-mute)' };
    const exists = findExisting(row);
    if (mode === 'replace') return { type: 'replace', label: 'ersetzt', color: 'var(--warn)' };
    if (mode === 'add') {
      return { type: 'add', label: 'hinzugefügt', color: 'var(--success)' };
    }
    if (mode === 'update') {
      return exists
        ? { type: 'update', label: 'aktualisiert', color: 'var(--vereinsblau)' }
        : { type: 'add', label: 'neu angelegt', color: 'var(--success)' };
    }
  }

  // Den Import durchführen — fügt korrektes ID-Mapping hinzu, behält bestehende IDs bei Update
  function buildMergedItems() {
    const validRows = rows.filter(r => r.name);

    if (mode === 'replace') {
      return validRows.map((r, i) => ({
        id: `item_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        articleNumber: r.articleNumber || '',
        name: r.name,
        price: r.price || 0,
        replacementValue: r.replacementValue,
        supplierId: r.supplierId || null,
      }));
    }

    if (mode === 'add') {
      const additions = validRows.map((r, i) => ({
        id: `item_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        articleNumber: r.articleNumber || '',
        name: r.name,
        price: r.price || 0,
        replacementValue: r.replacementValue,
        supplierId: r.supplierId || null,
      }));
      return [...existingItems, ...additions];
    }

    // mode === 'update'
    const result = [...existingItems];
    validRows.forEach((r, i) => {
      const existing = findExisting(r);
      if (existing) {
        const idx = result.findIndex(e => e.id === existing.id);
        result[idx] = {
          ...existing,
          articleNumber: r.articleNumber || existing.articleNumber || '',
          name: r.name,
          price: r.price || 0,
          replacementValue: r.replacementValue,
          // Supplier nur überschreiben, wenn in CSV explizit gesetzt
          supplierId: r.supplierId !== null ? r.supplierId : existing.supplierId,
        };
      } else {
        result.push({
          id: `item_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
          articleNumber: r.articleNumber || '',
          name: r.name,
          price: r.price || 0,
          replacementValue: r.replacementValue,
          supplierId: r.supplierId || null,
        });
      }
    });
    return result;
  }

  const validRowCount = rows.filter(r => r.name).length;
  const supplierWarnings = rows.filter(r => r.supplierWarning).map(r => r.supplierWarning);
  const uniqueWarnings = [...new Set(supplierWarnings)];

  function doImport() {
    if (mode === 'replace' && existingItems.length > 0) {
      if (!confirm(`Achtung: Im Modus "Komplett ersetzen" werden alle ${existingItems.length} bestehenden Artikel gelöscht und durch ${validRowCount} neue ersetzt. Fortfahren?`)) return;
    }
    if (validRowCount === 0) { alert('Keine gültigen Zeilen zum Import.'); return; }
    const merged = buildMergedItems();
    onImport(merged, mode);
  }

  return (
    <div className="bg-white p-7 mb-4" style={{ border: '2px solid var(--vereinsblau)' }}>
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="section-label mb-2">ARTIKELKATALOG-IMPORT</div>
          <h2 className="font-display text-3xl" style={{ color: 'var(--ink)' }}>
            {step === 'upload' ? 'CSV-Datei hochladen' : 'Vorschau & Import-Modus'}
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
              <li>Vorlage herunterladen oder eigene Liste vorbereiten.</li>
              <li>Spalten: <strong>Artikelnummer</strong>, <strong>Name</strong>, <strong>Neupreis</strong>, <strong>Ersatzwert</strong>, <strong>Lieferant</strong>. Pflicht ist nur „Name".</li>
              <li>CSV-Datei hochladen, Modus wählen, importieren.</li>
            </ol>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <button onClick={downloadTemplate} className="px-5 py-3 text-xs uppercase flex items-center justify-center gap-2"
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
            <strong style={{ color: 'var(--vereinsblau)' }}>Tipp:</strong> Mit einer eindeutigen Artikelnummer (z. B. „T-001" oder die Lieferanten-SKU) lassen sich Artikel später sauber per CSV aktualisieren. Lieferanten werden über den Namen zugeordnet — sie müssen vorher in den Einstellungen angelegt sein.
          </div>

          {error && (
            <div className="mt-4 p-3 text-sm" style={{ background: '#F5E6E6', color: 'var(--danger)', borderLeft: '3px solid var(--danger)' }}>{error}</div>
          )}
        </div>
      )}

      {step === 'preview' && (
        <div>
          <div className="mb-5">
            <div className="font-sub text-xs mb-2" style={{ color: 'var(--vereinsblau)', letterSpacing: '0.18em' }}>IMPORT-MODUS</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {[
                { id: 'update', label: 'Aktualisieren', desc: 'Bestehende Artikel (per Artikelnummer) werden überschrieben, neue zusätzlich angelegt. Empfohlen.' },
                { id: 'add', label: 'Hinzufügen', desc: 'Alle CSV-Zeilen werden als neue Artikel angelegt. Bestehende bleiben unverändert.' },
                { id: 'replace', label: 'Komplett ersetzen', desc: 'ALLE bestehenden Artikel werden gelöscht und durch die importierten ersetzt.' },
              ].map(m => (
                <label key={m.id} className="flex items-start gap-2 p-3 cursor-pointer text-sm"
                  style={{ border: mode === m.id ? '2px solid var(--vereinsblau)' : '1px solid var(--rule)', background: mode === m.id ? '#F1ECDF' : 'white' }}>
                  <input type="radio" name="importMode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} className="mt-1" />
                  <div>
                    <div className="font-medium" style={{ color: 'var(--ink)' }}>{m.label}</div>
                    <div className="text-xs mt-1" style={{ color: 'var(--ink-mute)' }}>{m.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {uniqueWarnings.length > 0 && (
            <div className="mb-4 p-3 text-xs" style={{ background: '#F5EBDD', color: 'var(--warn)', borderLeft: '3px solid var(--warn)' }}>
              <strong>Lieferant nicht gefunden:</strong> {uniqueWarnings.join(', ')}. Diese Zeilen werden ohne Lieferant importiert. Lege den Lieferanten in den Einstellungen an und importiere erneut, oder ordne ihn nach dem Import manuell zu.
            </div>
          )}

          <div className="overflow-x-auto mb-4" style={{ border: '1px solid var(--rule)' }}>
            <table className="w-full text-xs min-w-[800px]">
              <thead className="bg-stone-50">
                <tr>
                  <th className="text-left p-2">Art.-Nr.</th>
                  <th className="text-left p-2">Name</th>
                  <th className="text-right p-2">Neupreis</th>
                  <th className="text-right p-2">Ersatzwert</th>
                  <th className="text-left p-2">Lieferant</th>
                  <th className="text-left p-2">Aktion</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const f = fateOf(r);
                  const sup = r.supplierId ? suppliers.find(s => s.id === r.supplierId) : null;
                  return (
                    <tr key={r._idx} style={{ borderTop: '1px solid var(--rule)' }}>
                      <td className="p-1"><input className="w-24 px-2 py-1 text-xs font-mono" value={r.articleNumber} onChange={e => updateRow(r._idx, 'articleNumber', e.target.value)} style={{ border: '1px solid var(--rule)' }} placeholder="–" /></td>
                      <td className="p-1"><input className="w-full px-2 py-1 text-xs" value={r.name} onChange={e => updateRow(r._idx, 'name', e.target.value)} style={{ border: '1px solid var(--rule)' }} /></td>
                      <td className="p-1"><input type="number" step="0.01" className="w-20 px-2 py-1 text-xs text-right" value={r.price} onChange={e => updateRow(r._idx, 'price', parseFloat(e.target.value) || 0)} style={{ border: '1px solid var(--rule)' }} /></td>
                      <td className="p-1"><input type="number" step="0.01" className="w-20 px-2 py-1 text-xs text-right" value={r.replacementValue ?? ''} placeholder="–" onChange={e => updateRow(r._idx, 'replacementValue', e.target.value === '' ? null : (parseFloat(e.target.value) || 0))} style={{ border: '1px solid var(--rule)' }} /></td>
                      <td className="p-1">
                        <select className="w-full px-2 py-1 text-xs" value={r.supplierId || ''} onChange={e => updateRow(r._idx, 'supplierId', e.target.value || null)} style={{ border: '1px solid var(--rule)' }}>
                          <option value="">– kein –</option>
                          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        {r.supplierWarning && !sup && (
                          <div className="text-[10px] mt-0.5" style={{ color: 'var(--warn)' }}>„{r.supplierWarning}" unbekannt</div>
                        )}
                      </td>
                      <td className="p-2 text-xs" style={{ color: f.color }}>{f.label}</td>
                      <td className="p-1"><button onClick={() => removeRow(r._idx)} className="p-1" style={{ color: 'var(--ink-mute)' }}><Trash2 size={12} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={doImport} disabled={validRowCount === 0}
              className="px-6 py-3 text-xs uppercase text-white disabled:opacity-50"
              style={{ background: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
              {validRowCount} Artikel importieren ({mode})
            </button>
            <button onClick={() => { setStep('upload'); setRows([]); }}
              className="px-6 py-3 text-xs uppercase"
              style={{ border: '1px solid var(--rule)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
              Andere Datei
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

// ============ MATERIAL / INVENTORY ============
function InventoryView({ data, update }) {
  const [filter, setFilter] = useState('alle');
  const [showForm, setShowForm] = useState(false);
  const [showAssign, setShowAssign] = useState(null);
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [view, setView] = useState('aggregiert'); // 'aggregiert' | 'einzeln'
  const [openGroups, setOpenGroups] = useState({}); // {groupKey: true}
  const [sort, setSort] = useState({ key: 'item', dir: 'asc' });

  const filtered = data.inventory.filter(i => {
    if (filter === 'alle') return true;
    if (filter === 'lager') return i.status === 'lager';
    if (filter === 'ausgegeben') return i.status === 'ausgegeben';
    if (filter === 'markiert') return i.flagged;
    return i.itemType === filter;
  });

  // Aggregation: pro Artikel × Größe × Team eine Gruppe.
  // Lagerware wird so pro Mannschaft separat gezählt — wichtig fürs Bestandsmanagement.
  // Lagerware ohne Team-Zuordnung erscheint als „global".
  const groups = useMemo(() => {
    const map = new Map();
    filtered.forEach(i => {
      // Bei ausgegebenem Material gibt das Team der Person den Schlüssel,
      // bei Lagerware das Inventur-eigene team-Feld.
      let teamKey = '';
      if (i.status === 'ausgegeben') {
        const person = findPerson(data, i.assignedTo);
        teamKey = person?.team || '— ohne Team —';
      } else {
        teamKey = i.team || '— global —';
      }
      const key = `${i.itemType}__${i.size || '–'}__${teamKey}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          itemType: i.itemType,
          itemName: i.itemName,
          size: i.size || '–',
          team: teamKey,
          items: [],
          total: 0,
          lager: 0,
          ausgegeben: 0,
          markiert: 0,
        });
      }
      const g = map.get(key);
      g.items.push(i);
      g.total++;
      if (i.status === 'lager') g.lager++;
      if (i.status === 'ausgegeben') g.ausgegeben++;
      if (i.flagged) g.markiert++;
    });
    // Größen-Sortierung: XS, S, M, L, XL, XXL, dann Rest
    const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '116', '128', '140', '152', '164', '176', '188'];
    const sizeIdx = (s) => {
      const i = sizeOrder.indexOf(s);
      return i === -1 ? 999 : i;
    };
    return [...map.values()].sort((a, b) => {
      if (a.team !== b.team) return a.team.localeCompare(b.team);
      if (a.itemName !== b.itemName) return a.itemName.localeCompare(b.itemName);
      return sizeIdx(a.size) - sizeIdx(b.size);
    });
  }, [filtered, data]);

  const sortedGroups = useMemo(() => [...groups].sort((a, b) => {
    if (sort.key === 'item') return compareValues(a.itemName, b.itemName, sort.dir);
    if (sort.key === 'team') return compareValues(a.team, b.team, sort.dir);
    if (sort.key === 'number') return compareValues(groupAssignedNumbers(a), groupAssignedNumbers(b), sort.dir);
    if (sort.key === 'size') return compareValues(a.size, b.size, sort.dir);
    if (sort.key === 'lager') return compareValues(a.lager, b.lager, sort.dir);
    if (sort.key === 'ausgegeben') return compareValues(a.ausgegeben, b.ausgegeben, sort.dir);
    if (sort.key === 'markiert') return compareValues(a.markiert, b.markiert, sort.dir);
    if (sort.key === 'total') return compareValues(a.total, b.total, sort.dir);
    return 0;
  }), [groups, sort]);

  const sortedItems = useMemo(() => [...filtered].sort((a, b) => {
    if (sort.key === 'item') return compareValues(a.itemName, b.itemName, sort.dir);
    if (sort.key === 'number') return compareValues(assignedNumberLabel(a), assignedNumberLabel(b), sort.dir);
    if (sort.key === 'size') return compareValues(a.size, b.size, sort.dir);
    if (sort.key === 'status') return compareValues(a.status, b.status, sort.dir);
    if (sort.key === 'assigned') return compareValues(assignedPersonLabel(a)?.title, assignedPersonLabel(b)?.title, sort.dir);
    if (sort.key === 'condition') return compareValues(getConditionFactors(data.settings)[a.condition]?.label || a.condition, getConditionFactors(data.settings)[b.condition]?.label || b.condition, sort.dir);
    return 0;
  }), [filtered, sort, data]);

  function toggleGroup(key) {
    setOpenGroups(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function expandAll() {
    setOpenGroups(Object.fromEntries(groups.map(g => [g.key, true])));
  }

  function collapseAll() {
    setOpenGroups({});
  }

  function handleInventoryBatch({ newInventory, orderId, lineDeltas }) {
    if (!newInventory || newInventory.length === 0) {
      setShowForm(false);
      return;
    }

    // Inventur erweitern
    update('inventory', newInventory, { mode: 'mergeById' });

    // Bestell-Status aktualisieren, falls Wareneingang an einer Bestellung
    if (orderId) {
      const order = data.orders.find(o => o.id === orderId);
      if (order) {
        // Wieviel ist insgesamt offen über alle Lines?
        // Schon-eingebuchte Inventur-Items zählen + neue dazuaddieren
        const receivedAfter = {};
        const allInv = [...data.inventory, ...newInventory];
        allInv.forEach(inv => {
          if (inv.fromLineId) {
            receivedAfter[inv.fromLineId] = (receivedAfter[inv.fromLineId] || 0) + 1;
          }
        });

        let totalExpected = 0, totalReceived = 0;
        (order.lines || []).forEach(l => {
          totalExpected += Number(l.qty) || 0;
          totalReceived += receivedAfter[l.id] || 0;
        });

        let newStatus = order.status;
        if (totalReceived === 0) newStatus = order.status; // unverändert
        else if (totalReceived >= totalExpected) newStatus = 'geliefert';
        else newStatus = 'teilweise_geliefert';

        if (newStatus !== order.status) {
          update('orders', data.orders.map(o => o.id === orderId
            ? { ...o, status: newStatus, lastReceivedAt: new Date().toISOString() }
            : o));
        }
      }
    }

    setShowForm(false);
  }

  function assign(invId, playerId, number, reprint = {}) {
    update('inventory', data.inventory.map(i =>
      i.id === invId ? {
        ...i,
        status: 'ausgegeben',
        assignedTo: playerId,
        assignedAt: new Date().toISOString(),
        assignedNumber: number,
        personKind: reprint.personKind || i.personKind || null,
        needsReprint: !!reprint.needsReprint,
        reprintFromNumber: reprint.needsReprint ? (reprint.fromNumber || null) : null,
        reprintToNumber: reprint.needsReprint ? (reprint.toNumber || number || null) : null,
        reprintRequestedAt: reprint.needsReprint ? new Date().toISOString() : null,
      } : i
    ), { mode: 'replace' });
    setShowAssign(null);
  }

  function unassign(invId) {
    if (!confirm('Material zurück ins Lager buchen?')) return;
    update('inventory', data.inventory.map(i =>
      i.id === invId ? { ...i, status: 'lager', assignedTo: null, assignedAt: null } : i
    ), { mode: 'replace' });
  }

  function remove(invId) {
    if (!confirm('Materialteil komplett aus Bestand löschen?')) return;
    update('inventory', data.inventory.filter(i => i.id !== invId));
  }

  function assignedNumberLabel(i) {
    const person = findPerson(data, i.assignedTo);
    const number = i.assignedNumber || person?.number;
    if (number === undefined || number === null || number === '') return '';
    const kind = i.personKind || person?._kind;
    return kind === 'coach' ? `${number} (T)` : `#${number}`;
  }

  function assignedPersonLabel(i) {
    const person = findPerson(data, i.assignedTo);
    if (person) {
      return {
        title: `${person.firstName} ${person.lastName}`,
        subtitle: person.team,
        isCoach: person._kind === 'coach',
      };
    }
    if (i.assignedName || i.assignedNumber) {
      const parts = [];
      if (i.assignedName) parts.push(i.assignedName);
      if (i.sponsorKey) parts.push(i.sponsorKey);
      return {
        title: parts.length > 0 ? parts.join(' · ') : 'Vorbeflockt / reserviert',
        subtitle: i.team ? `Lager ${i.team}` : 'Lager',
        isCoach: i.personKind === 'coach',
      };
    }
    return null;
  }

  function groupAssignedNumbers(g) {
    const labels = g.items
      .map(assignedNumberLabel)
      .filter(Boolean);
    return [...new Set(labels)].join(', ');
  }

  function renderItemRow(i) {
    const assignment = assignedPersonLabel(i);
    const numberLabel = assignedNumberLabel(i);
    const conditionLabel = getConditionFactors(data.settings)[i.condition]?.label || i.condition;
    return (
      <tr key={i.id} className="border-t border-stone-100" style={{ background: 'var(--paper)' }}>
        <td className="p-3 pl-10 text-sm" style={{ color: 'var(--ink-mute)' }}>
          <span className="text-xs">↳</span> {i.itemName}
        </td>
        <td className="p-3 text-sm font-medium" style={{ color: numberLabel ? 'var(--vereinsblau)' : 'var(--ink-mute)' }}>
          {numberLabel || '–'}
        </td>
        <td className="p-3 hidden sm:table-cell text-sm">{i.size}</td>
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
          {i.needsReprint && (
            <span className="inline-block px-2 py-0.5 text-xs ml-1" style={{ background: '#F5EBDD', color: 'var(--warn)' }}
              title={`Umbeflockung: ${i.reprintFromNumber || 'ohne'} → ${i.reprintToNumber || i.assignedNumber || 'neu'}`}>
              Umbeflocken {i.reprintFromNumber || 'ohne'} → {i.reprintToNumber || i.assignedNumber || 'neu'}
            </span>
          )}
        </td>
        <td className="p-3">
          {assignment ? (
            <div>
              <div className="text-sm">
                {assignment.title}
                {assignment.isCoach && (
                  <span className="ml-1 text-[10px] px-1.5 py-0.5" style={{ background: 'var(--paper-dark)', color: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.12em' }}>TRAINER</span>
                )}
              </div>
              <div className="text-xs text-stone-500">{assignment.subtitle}</div>
            </div>
          ) : <span className="text-stone-400 text-sm">–</span>}
        </td>
        <td className="p-3 hidden lg:table-cell text-sm" style={{ color: 'var(--ink-soft)' }}>{conditionLabel}</td>
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
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <PageHeader number="05" label="AUSSTATTUNG" title="Material & Bestand" subtitle={`${data.inventory.length} Teile gesamt · ${data.inventory.filter(i => i.status === 'lager').length} im Lager · ${data.items.length} Katalog-Artikel`} />
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowPrintDialog(true)} className="px-5 py-2.5 text-xs font-medium flex items-center gap-2 uppercase"
            style={{ background: 'var(--paper-dark)', color: 'var(--ink)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
            <FileText size={14} /> Bestandsliste drucken (PDF)
          </button>
          <button onClick={() => setShowForm(true)} className="px-5 py-2.5 text-xs font-medium flex items-center gap-2 uppercase"
            style={{ background: 'var(--vereinsblau)', color: 'white', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
            <Plus size={14} /> Material einbuchen
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4 items-center justify-between">
        <div className="flex gap-2 overflow-x-auto pb-1">
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
        <div className="flex gap-1 items-center text-xs">
          <span style={{ color: 'var(--ink-mute)' }}>Ansicht:</span>
          <button onClick={() => setView('aggregiert')}
            className={`px-3 py-1.5 ${view === 'aggregiert' ? 'bg-stone-900 text-white' : 'bg-white border border-stone-200'}`}>
            Gruppiert
          </button>
          <button onClick={() => setView('einzeln')}
            className={`px-3 py-1.5 ${view === 'einzeln' ? 'bg-stone-900 text-white' : 'bg-white border border-stone-200'}`}>
            Einzeln
          </button>
          {view === 'aggregiert' && groups.length > 0 && (
            <>
              <button onClick={expandAll} className="px-2 py-1.5 underline ml-2" style={{ color: 'var(--vereinsblau)' }}>Alle auf</button>
              <button onClick={collapseAll} className="px-2 py-1.5 underline" style={{ color: 'var(--vereinsblau)' }}>Alle zu</button>
            </>
          )}
        </div>
      </div>

      {showForm && <InventoryAddForm data={data} onSaveBatch={handleInventoryBatch} onCancel={() => setShowForm(false)} />}
      {showAssign && <AssignForm inv={showAssign} persons={allPersons(data)} inventory={data.inventory} onAssign={assign} onCancel={() => setShowAssign(null)} />}
      {showPrintDialog && <InventoryPrintDialog data={data} onClose={() => setShowPrintDialog(false)} />}

      <div className="bg-white border border-stone-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-stone-500 text-sm">Kein Material in dieser Auswahl.</div>
        ) : view === 'aggregiert' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wider text-stone-500">
                <tr>
                  <SortHeader label="Artikel" sortKey="item" sort={sort} setSort={setSort} />
                  <SortHeader label="Mannschaft" sortKey="team" sort={sort} setSort={setSort} className="text-left p-3 font-medium hidden md:table-cell" />
                  <SortHeader label="Nr./Init." sortKey="number" sort={sort} setSort={setSort} />
                  <SortHeader label="Größe" sortKey="size" sort={sort} setSort={setSort} className="text-left p-3 font-medium hidden sm:table-cell" />
                  <SortHeader label="Lager" sortKey="lager" sort={sort} setSort={setSort} className="text-right p-3 font-medium" />
                  <SortHeader label="Ausgegeben" sortKey="ausgegeben" sort={sort} setSort={setSort} className="text-right p-3 font-medium" />
                  <SortHeader label="Markiert" sortKey="markiert" sort={sort} setSort={setSort} className="text-right p-3 font-medium" />
                  <SortHeader label="Gesamt" sortKey="total" sort={sort} setSort={setSort} className="text-right p-3 font-medium" />
                  <th className="p-3 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {sortedGroups.map(g => {
                  const isOpen = !!openGroups[g.key];
                  const assignedNumbers = groupAssignedNumbers(g);
                  return (
                    <React.Fragment key={g.key}>
                      <tr className="border-t border-stone-100 cursor-pointer hover:bg-stone-50" onClick={() => toggleGroup(g.key)}>
                        <td className="p-3 font-medium">
                          <span className="inline-block w-4 mr-1 text-xs" style={{ color: 'var(--vereinsblau)' }}>{isOpen ? '▾' : '▸'}</span>
                          {g.itemName}
                          <div className="text-xs md:hidden" style={{ color: 'var(--ink-mute)' }}>{g.team}</div>
                          {assignedNumbers && (
                            <div className="text-xs sm:hidden mt-1" style={{ color: 'var(--vereinsblau)' }}>{assignedNumbers}</div>
                          )}
                        </td>
                        <td className="p-3 hidden md:table-cell text-xs" style={{ color: 'var(--ink-soft)' }}>{g.team}</td>
                        <td className="p-3 text-sm" style={{ color: assignedNumbers ? 'var(--vereinsblau)' : 'var(--ink-mute)' }}>
                          {assignedNumbers || '–'}
                        </td>
                        <td className="p-3 hidden sm:table-cell">{g.size}</td>
                        <td className="p-3 text-right">
                          <span className={g.lager > 0 ? '' : 'text-stone-400'}>{g.lager}</span>
                        </td>
                        <td className="p-3 text-right">
                          <span className={g.ausgegeben > 0 ? '' : 'text-stone-400'}>{g.ausgegeben}</span>
                        </td>
                        <td className="p-3 text-right">
                          {g.markiert > 0 ? (
                            <span className="inline-block px-2 py-0.5 text-xs" style={{ background: '#F5EBDD', color: 'var(--warn)' }}>⚠ {g.markiert}</span>
                          ) : <span className="text-stone-400">0</span>}
                        </td>
                        <td className="p-3 text-right font-medium">{g.total}</td>
                        <td className="p-3 text-right text-xs" style={{ color: 'var(--ink-mute)' }}>
                          {isOpen ? 'zu' : 'auf'}
                        </td>
                      </tr>
                      {isOpen && g.items.map(i => renderItemRow(i))}
                    </React.Fragment>
                  );
                })}
                {/* Summenzeile */}
                <tr style={{ background: 'var(--paper-dark)', fontWeight: 600 }}>
                  <td className="p-3" colSpan={4}>Summe</td>
                  <td className="p-3 text-right">{sortedGroups.reduce((s, g) => s + g.lager, 0)}</td>
                  <td className="p-3 text-right">{sortedGroups.reduce((s, g) => s + g.ausgegeben, 0)}</td>
                  <td className="p-3 text-right">{sortedGroups.reduce((s, g) => s + g.markiert, 0)}</td>
                  <td className="p-3 text-right">{sortedGroups.reduce((s, g) => s + g.total, 0)}</td>
                  <td className="p-3"></td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wider text-stone-500">
                <tr>
                  <SortHeader label="Artikel" sortKey="item" sort={sort} setSort={setSort} />
                  <SortHeader label="Nr./Init." sortKey="number" sort={sort} setSort={setSort} />
                  <SortHeader label="Größe" sortKey="size" sort={sort} setSort={setSort} className="text-left p-3 font-medium hidden sm:table-cell" />
                  <SortHeader label="Status" sortKey="status" sort={sort} setSort={setSort} className="text-left p-3 font-medium hidden md:table-cell" />
                  <SortHeader label="Zugeordnet" sortKey="assigned" sort={sort} setSort={setSort} />
                  <SortHeader label="Zustand" sortKey="condition" sort={sort} setSort={setSort} className="text-left p-3 font-medium hidden lg:table-cell" />
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map(i => {
                  const assignment = assignedPersonLabel(i);
                  const numberLabel = assignedNumberLabel(i);
                  return (
                    <tr key={i.id} className="border-t border-stone-100">
                      <td className="p-3 font-medium">{i.itemName}</td>
                      <td className="p-3 font-medium" style={{ color: numberLabel ? 'var(--vereinsblau)' : 'var(--ink-mute)' }}>
                        {numberLabel || '–'}
                      </td>
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
                        {i.needsReprint && (
                          <span className="inline-block px-2 py-0.5 text-xs ml-1" style={{ background: '#F5EBDD', color: 'var(--warn)' }}
                            title={`Umbeflockung: ${i.reprintFromNumber || 'ohne'} → ${i.reprintToNumber || i.assignedNumber || 'neu'}`}>
                            Umbeflocken
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        {assignment ? (
                          <div>
                            <div>
                              {assignment.title}
                              {assignment.isCoach && (
                                <span className="ml-1 text-[10px] px-1.5 py-0.5" style={{ background: 'var(--paper-dark)', color: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.12em' }}>TRAINER</span>
                              )}
                            </div>
                            <div className="text-xs text-stone-500">{assignment.subtitle}</div>
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

function InventoryAddForm({ data, onSaveBatch, onCancel }) {
  const items = data.items || [];
  const orders = data.orders || [];

  // Modus: 'free' = freies Einbuchen, 'order' = an Bestellung gebunden
  const [mode, setMode] = useState('order');
  const [selectedOrderId, setSelectedOrderId] = useState('');

  // Globale Default-Mannschaft fürs freie Einbuchen — wird für neue Zeilen übernommen
  const [freeDefaultTeam, setFreeDefaultTeam] = useState((data.teams || [])[0] || '');

  // Freie Einbuchungs-Zeilen: [{ itemType, size, qty, number, name, team }]
  const [freeRows, setFreeRows] = useState([
    { id: `r_${Date.now()}`, itemType: items[0]?.id || '', size: 'L', qty: 1, number: '', name: '', team: (data.teams || [])[0] || '' },
  ]);

  // Bestell-Eingangs-Zeilen: für jede offene Order-Line eine Zuordnung
  // { lineId, itemType, size, expectedQty, alreadyReceived, deliveredQty, number, name, personKind }
  const [receiptRows, setReceiptRows] = useState([]);

  // Bestellungen, die offen oder teilweise geliefert sind
  const eligibleOrders = orders.filter(o =>
    !['storniert', 'geliefert'].includes(o.status)
  ).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  function orderSponsorLabel(order) {
    if (order.sponsorKey) return order.sponsorKey;
    const s = order.sponsors || {};
    return [s.brust, s.ruecken, s.aermel].filter(Boolean).join(' / ');
  }

  // Sobald eine Bestellung gewählt wird: receiptRows initialisieren
  useEffect(() => {
    if (mode !== 'order' || !selectedOrderId) {
      setReceiptRows([]);
      return;
    }
    const order = orders.find(o => o.id === selectedOrderId);
    if (!order) { setReceiptRows([]); return; }

    // Wieviele Stück pro Bestell-Line wurden schon eingebucht?
    const receivedCounts = {};
    (data.inventory || []).forEach(inv => {
      if (inv.fromLineId) {
        receivedCounts[inv.fromLineId] = (receivedCounts[inv.fromLineId] || 0) + 1;
      }
    });

    const rows = (order.lines || []).map(l => {
      const item = items.find(i => i.id === l.itemType);
      const expected = Number(l.qty) || 0;
      const received = receivedCounts[l.id] || 0;
      const open = Math.max(0, expected - received);
      return {
        lineId: l.id,
        itemType: l.itemType,
        itemName: item?.name || l.itemType,
        articleNumber: item?.articleNumber || '',
        size: l.size,
        playerId: l.playerId || null,
        personKind: l.personKind || null,
        number: l.number || '',
        name: l.name || '',
        expectedQty: expected,
        alreadyReceived: received,
        openQty: open,
        deliveredNow: open, // Default: alle offenen Stück werden jetzt eingebucht
      };
    });
    setReceiptRows(rows);
  }, [selectedOrderId, mode]);

  function updateFreeRow(id, key, value) {
    setFreeRows(freeRows.map(r => r.id === id ? { ...r, [key]: value } : r));
  }
  function addFreeRow() {
    const last = freeRows[freeRows.length - 1];
    setFreeRows([...freeRows, {
      id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      itemType: last?.itemType || items[0]?.id || '',
      size: last?.size || 'L',
      qty: 1, number: '', name: '',
      team: last?.team || freeDefaultTeam || '',
    }]);
  }
  function removeFreeRow(id) {
    if (freeRows.length === 1) {
      setFreeRows([{ id: `r_${Date.now()}`, itemType: items[0]?.id || '', size: 'L', qty: 1, number: '', name: '', team: freeDefaultTeam || '' }]);
    } else {
      setFreeRows(freeRows.filter(r => r.id !== id));
    }
  }

  // Default-Team-Wechsel überträgt sich auf alle Zeilen, die bisher den alten Default hatten
  function setAllFreeTeam(newTeam) {
    setFreeDefaultTeam(newTeam);
    setFreeRows(freeRows.map(r => ({ ...r, team: newTeam })));
  }

  function updateReceiptRow(lineId, key, value) {
    setReceiptRows(receiptRows.map(r => r.lineId === lineId ? { ...r, [key]: value } : r));
  }

  function submit() {
    const newInventory = [];
    let order = null;
    let lineDeltas = {}; // { lineId: deliveredCount } — für Status-Berechnung

    if (mode === 'order' && selectedOrderId) {
      order = orders.find(o => o.id === selectedOrderId);
      if (!order) { alert('Bestellung nicht gefunden'); return; }

      receiptRows.forEach(r => {
        const qty = Number(r.deliveredNow) || 0;
        if (qty <= 0) return;
        const item = items.find(i => i.id === r.itemType);
        // Team aus der Bestellung übernehmen (für Lager-Trennung pro Mannschaft).
        // Falls die Order kein Team hat (Sammelbestellung), schauen wir die Person an.
        let team = order.team || null;
        if (!team && r.playerId) {
          const person = findPerson(data, r.playerId);
          if (person) team = person.team;
        }
        for (let i = 0; i < qty; i++) {
          newInventory.push({
            id: `inv_${Date.now()}_${r.lineId}_${i}_${Math.random().toString(36).slice(2, 5)}`,
            itemType: r.itemType,
            itemName: r.itemName,
            articleNumber: r.articleNumber || null,
            size: r.size,
            team,
            status: 'lager',
            assignedTo: null,
            assignedNumber: r.number || null,
            assignedName: r.name || null,
            personKind: r.personKind || null,
            acquiredAt: new Date().toISOString(),
            seasonsUsed: 0,
            condition: 'neu',
            originalPrice: item?.price || 0,
            fromOrderId: order.id,
            fromLineId: r.lineId,
            sponsorKey: orderSponsorLabel(order) || null,
          });
        }
        lineDeltas[r.lineId] = qty;
      });

      if (newInventory.length === 0) {
        alert('Keine Stücke zum Einbuchen — bitte Mengen eintragen.');
        return;
      }
    } else {
      // Freier Modus
      const valid = freeRows.filter(r => r.itemType && r.qty > 0);
      if (valid.length === 0) {
        alert('Bitte mindestens eine Position mit Menge angeben.');
        return;
      }
      valid.forEach(r => {
        const item = items.find(i => i.id === r.itemType);
        for (let i = 0; i < r.qty; i++) {
          newInventory.push({
            id: `inv_${Date.now()}_${r.id}_${i}_${Math.random().toString(36).slice(2, 5)}`,
            itemType: r.itemType,
            itemName: item?.name || r.itemType,
            articleNumber: item?.articleNumber || null,
            size: r.size,
            team: r.team || null,
            status: 'lager',
            assignedTo: null,
            assignedNumber: r.number || null,
            assignedName: r.name || null,
            personKind: null,
            acquiredAt: new Date().toISOString(),
            seasonsUsed: 0,
            condition: 'neu',
            originalPrice: item?.price || 0,
          });
        }
      });
    }

    onSaveBatch({ newInventory, orderId: order?.id || null, lineDeltas });
  }

  // Übersicht: wieviel ist offen, wieviel kommt jetzt rein
  const openTotal = receiptRows.reduce((s, r) => s + r.openQty, 0);
  const deliveryTotal = receiptRows.reduce((s, r) => s + (Number(r.deliveredNow) || 0), 0);

  return (
    <div className="bg-white border-2 border-stone-900 p-6 mb-4">
      <h2 className="font-display text-2xl mb-4">MATERIAL EINBUCHEN</h2>

      {/* Modus-Wahl */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
        <label className="flex items-start gap-2 p-3 cursor-pointer text-sm"
          style={{ border: mode === 'order' ? '2px solid var(--vereinsblau)' : '1px solid var(--rule)', background: mode === 'order' ? '#F1ECDF' : 'white' }}>
          <input type="radio" checked={mode === 'order'} onChange={() => setMode('order')} className="mt-0.5" />
          <div>
            <div className="font-medium">Aus Bestellung einbuchen</div>
            <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>Wareneingang einer offenen Bestellung mit Mengenabgleich.</div>
          </div>
        </label>
        <label className="flex items-start gap-2 p-3 cursor-pointer text-sm"
          style={{ border: mode === 'free' ? '2px solid var(--vereinsblau)' : '1px solid var(--rule)', background: mode === 'free' ? '#F1ECDF' : 'white' }}>
          <input type="radio" checked={mode === 'free'} onChange={() => setMode('free')} className="mt-0.5" />
          <div>
            <div className="font-medium">Frei einbuchen</div>
            <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>Lagerzugang ohne Bezug zu einer Bestellung (z.B. Spende, alte Lagerware).</div>
          </div>
        </label>
      </div>

      {mode === 'order' && (
        <>
          <Field label="Bestellung wählen">
            <select value={selectedOrderId} onChange={e => setSelectedOrderId(e.target.value)} className="w-full border border-stone-300 px-3 py-2 text-sm">
              <option value="">– Bestellung wählen –</option>
              {eligibleOrders.length === 0 && <option disabled>(keine offenen Bestellungen)</option>}
              {eligibleOrders.map(o => {
                const totalQty = (o.lines || []).reduce((s, l) => s + (l.qty || 0), 0);
                const sponsor = orderSponsorLabel(o);
                return (
                  <option key={o.id} value={o.id}>
                    {o.title}{sponsor ? ` · ${sponsor}` : ''} ({totalQty} Teile, Status: {o.status || 'offen'})
                  </option>
                );
              })}
            </select>
          </Field>

          {selectedOrderId && receiptRows.length > 0 && (
            <div className="mt-4">
              <div className="flex justify-between items-center mb-2">
                <div className="font-sub text-xs" style={{ color: 'var(--vereinsblau)', letterSpacing: '0.18em' }}>WARENEINGANG</div>
                <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>
                  {deliveryTotal} von {openTotal} offenen Teilen werden eingebucht
                </div>
              </div>

              <div className="border border-stone-200 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-stone-50 uppercase tracking-wider">
                    <tr>
                      <th className="text-left p-2">Art.-Nr.</th>
                      <th className="text-left p-2">Artikel</th>
                      <th className="text-left p-2">Größe</th>
                      <th className="text-left p-2">Nr./Init.</th>
                      <th className="text-left p-2">Flock-Name</th>
                      <th className="text-right p-2">Erwartet</th>
                      <th className="text-right p-2">Schon ein</th>
                      <th className="text-right p-2">Offen</th>
                      <th className="text-right p-2 bg-emerald-50">Jetzt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receiptRows.map(r => {
                      const isCoach = r.personKind === 'coach';
                      const fullyReceived = r.openQty === 0;
                      return (
                        <tr key={r.lineId} className="border-t border-stone-100" style={fullyReceived ? { opacity: 0.5 } : {}}>
                          <td className="p-2 font-mono">{r.articleNumber || '–'}</td>
                          <td className="p-2">{r.itemName}</td>
                          <td className="p-2">{r.size}</td>
                          <td className="p-2 font-medium">
                            {r.number || '–'}
                            {isCoach && r.number && (
                              <span className="ml-1 text-[10px] px-1 py-0.5" style={{ background: 'var(--paper-dark)', color: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.12em' }}>T</span>
                            )}
                          </td>
                          <td className="p-2">{r.name || '–'}</td>
                          <td className="p-2 text-right">{r.expectedQty}</td>
                          <td className="p-2 text-right" style={{ color: 'var(--ink-mute)' }}>{r.alreadyReceived}</td>
                          <td className="p-2 text-right" style={{ color: r.openQty > 0 ? 'var(--warn)' : 'var(--ink-mute)' }}>{r.openQty}</td>
                          <td className="p-2 bg-emerald-50">
                            <input type="number" min="0" max={r.openQty}
                              value={r.deliveredNow}
                              onChange={e => updateReceiptRow(r.lineId, 'deliveredNow', Math.max(0, Math.min(r.openQty, parseInt(e.target.value) || 0)))}
                              disabled={fullyReceived}
                              className="w-14 border border-stone-300 px-1 py-1 text-right text-xs" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap gap-2 mt-2">
                <button onClick={() => setReceiptRows(receiptRows.map(r => ({ ...r, deliveredNow: r.openQty })))}
                  className="text-xs px-3 py-1.5" style={{ background: 'var(--paper-dark)', color: 'var(--ink)' }}>
                  Alle offenen → einbuchen
                </button>
                <button onClick={() => setReceiptRows(receiptRows.map(r => ({ ...r, deliveredNow: 0 })))}
                  className="text-xs px-3 py-1.5" style={{ background: 'var(--paper-dark)', color: 'var(--ink)' }}>
                  Alle auf 0
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {mode === 'free' && (
        <div className="mt-2">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="font-sub text-xs" style={{ color: 'var(--vereinsblau)', letterSpacing: '0.18em' }}>POSITIONEN</div>
            <div className="flex items-center gap-2 text-xs">
              <span style={{ color: 'var(--ink-mute)' }}>Mannschaft für alle Zeilen:</span>
              <select value={freeDefaultTeam} onChange={e => setAllFreeTeam(e.target.value)}
                className="border border-stone-300 px-2 py-1 text-xs">
                <option value="">– keine / global –</option>
                {(data.teams || []).map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="border border-stone-200 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-stone-50 uppercase tracking-wider">
                <tr>
                  <th className="text-left p-2">Artikel</th>
                  <th className="text-left p-2">Mannschaft</th>
                  <th className="text-left p-2">Größe</th>
                  <th className="text-right p-2">Menge</th>
                  <th className="text-left p-2">Nr./Init. (optional)</th>
                  <th className="text-left p-2">Flock-Name (optional)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {freeRows.map(r => (
                  <tr key={r.id} className="border-t border-stone-100">
                    <td className="p-1">
                      <select value={r.itemType} onChange={e => updateFreeRow(r.id, 'itemType', e.target.value)} className="border border-stone-300 px-2 py-1 text-xs w-full">
                        {items.map(i => (
                          <option key={i.id} value={i.id}>
                            {i.articleNumber ? `[${i.articleNumber}] ` : ''}{i.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-1">
                      <select value={r.team || ''} onChange={e => updateFreeRow(r.id, 'team', e.target.value)} className="border border-stone-300 px-2 py-1 text-xs">
                        <option value="">– global –</option>
                        {(data.teams || []).map(t => <option key={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="p-1">
                      <select value={r.size} onChange={e => updateFreeRow(r.id, 'size', e.target.value)} className="border border-stone-300 px-2 py-1 text-xs">
                        {['XS','S','M','L','XL','XXL','3XL'].map(s => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="p-1">
                      <input type="number" min="1" value={r.qty}
                        onChange={e => updateFreeRow(r.id, 'qty', parseInt(e.target.value) || 1)}
                        className="w-16 border border-stone-300 px-2 py-1 text-xs text-right" />
                    </td>
                    <td className="p-1">
                      <input type="text" maxLength={3} value={r.number}
                        onChange={e => updateFreeRow(r.id, 'number', e.target.value.toUpperCase())}
                        className="w-16 border border-stone-300 px-2 py-1 text-xs" placeholder="–" />
                    </td>
                    <td className="p-1">
                      <input type="text" value={r.name}
                        onChange={e => updateFreeRow(r.id, 'name', e.target.value.toUpperCase())}
                        className="w-full border border-stone-300 px-2 py-1 text-xs" placeholder="–" />
                    </td>
                    <td><button onClick={() => removeFreeRow(r.id)} className="p-1 text-stone-400 hover:text-red-600"><X size={12} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={addFreeRow} className="mt-2 text-xs bg-stone-100 px-3 py-1.5 flex items-center gap-1">
            <Plus size={12} /> Position
          </button>
        </div>
      )}

      <div className="flex gap-2 mt-5">
        <button onClick={submit} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium">Einbuchen</button>
        <button onClick={onCancel} className="border border-stone-300 px-4 py-2 text-sm">Abbrechen</button>
      </div>
    </div>
  );
}

// Druckdialog für die Bestandsliste mit Filter-Optionen.
// Erzeugt ein PDF mit allen passenden Inventur-Items, gruppiert nach Person bzw. Lager.
function InventoryPrintDialog({ data, onClose }) {
  const [filterStatus, setFilterStatus] = useState('alle'); // alle | lager | ausgegeben | markiert
  const [filterPersonKind, setFilterPersonKind] = useState('alle'); // alle | player | coach | lager
  const [filterTeam, setFilterTeam] = useState(''); // '' = alle Teams
  const [filterPersonId, setFilterPersonId] = useState(''); // '' = alle Personen
  const [groupBy, setGroupBy] = useState('person'); // 'person' | 'item'
  const [busy, setBusy] = useState(false);

  // Person-Auswahl auf Team einschränken
  const teamPlayers = (data.players || []).filter(p => !filterTeam || p.team === filterTeam);
  const teamCoaches = (data.coaches || []).filter(c => !filterTeam || c.team === filterTeam);

  // Vorschau-Filterung
  const filtered = (data.inventory || []).filter(inv => {
    if (filterStatus === 'lager' && inv.status !== 'lager') return false;
    if (filterStatus === 'ausgegeben' && inv.status !== 'ausgegeben') return false;
    if (filterStatus === 'markiert' && !inv.flagged) return false;

    if (filterPersonKind === 'lager' && inv.status !== 'lager') return false;
    if (filterPersonKind === 'player' || filterPersonKind === 'coach') {
      const person = findPerson(data, inv.assignedTo);
      if (!person) return false;
      if (filterPersonKind === 'player' && person._kind !== 'player') return false;
      if (filterPersonKind === 'coach' && person._kind !== 'coach') return false;
    }

    if (filterTeam) {
      const person = findPerson(data, inv.assignedTo);
      if (inv.status === 'lager') {
        // Lagerware: zum Team gehört, wenn das inv.team passt oder global (kein team)
        if (inv.team && inv.team !== filterTeam) return false;
        // Wenn der Filter explizit „nur ausgegeben" verlangt, ist Lager schon oben raus.
      } else if (!person || person.team !== filterTeam) {
        return false;
      }
    }

    if (filterPersonId) {
      if (inv.assignedTo !== filterPersonId) return false;
    }

    return true;
  });

  async function generatePDF() {
    setBusy(true);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      if (typeof doc.autoTable !== 'function') {
        throw new Error('jspdf-autotable ist nicht korrekt geladen.');
      }
      const W = doc.internal.pageSize.getWidth();
      const settings = data.settings || {};

      // Kopfblock
      doc.setFillColor(11, 45, 92);
      doc.rect(0, 0, W, 30, 'F');
      doc.setTextColor(201, 162, 39);
      doc.setFontSize(8);
      doc.text('BESTANDSLISTE · TRIKOTVERWALTUNG', 14, 11);
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.text(settings.clubName || 'F. C. Frohlinde 1949 e. V.', 14, 21);

      // Filter-Beschreibung
      let y = 38;
      const filterLines = [];
      filterLines.push(`Stichtag: ${new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}`);
      const statusText = { alle: 'alle', lager: 'nur Lagerware', ausgegeben: 'nur ausgegebene', markiert: 'nur markierte' }[filterStatus];
      filterLines.push(`Status: ${statusText}`);
      const kindText = { alle: 'alle', player: 'nur Spieler', coach: 'nur Trainer', lager: 'nur Lager' }[filterPersonKind];
      filterLines.push(`Personenkreis: ${kindText}`);
      if (filterTeam) filterLines.push(`Mannschaft: ${filterTeam}`);
      if (filterPersonId) {
        const person = findPerson(data, filterPersonId);
        if (person) filterLines.push(`Einzelperson: ${person.firstName} ${person.lastName}`);
      }
      filterLines.push(`${filtered.length} Teile insgesamt`);

      doc.setTextColor(128, 125, 120);
      doc.setFontSize(8);
      filterLines.forEach((line, i) => {
        doc.text(line, 14, y + i * 4);
      });
      y += filterLines.length * 4 + 4;

      // Daten gruppieren
      if (groupBy === 'person') {
        // Pro Person eine Sektion
        const groups = {};
        filtered.forEach(inv => {
          let key, label, kind;
          if (inv.status === 'lager') {
            key = '__lager__';
            label = 'IM LAGER';
            kind = 'lager';
          } else {
            const p = findPerson(data, inv.assignedTo);
            if (!p) {
              key = '__unbekannt__';
              label = 'Unbekannte Zuordnung';
              kind = 'unknown';
            } else {
              key = p.id;
              const isCoach = p._kind === 'coach';
              const numStr = p.number ? (isCoach ? p.number : `#${p.number}`) : '–';
              label = `${numStr}  ${p.firstName} ${p.lastName} (${p.team || '–'})${isCoach ? ' · TRAINER' : ''}`;
              kind = p._kind;
            }
          }
          if (!groups[key]) groups[key] = { label, kind, items: [] };
          groups[key].items.push(inv);
        });

        // Sortierung: Lager zuerst, dann Spieler nach Team+Nummer, dann Trainer nach Team+Initialen
        const sortedKeys = Object.keys(groups).sort((a, b) => {
          const ga = groups[a], gb = groups[b];
          if (ga.kind === 'lager') return -1;
          if (gb.kind === 'lager') return 1;
          if (ga.kind === 'unknown') return 1;
          if (gb.kind === 'unknown') return -1;
          return ga.label.localeCompare(gb.label);
        });

        sortedKeys.forEach(key => {
          const g = groups[key];
          // Section-Header (Vereinsblau)
          if (y > 250) { doc.addPage(); y = 20; }
          doc.autoTable({
            startY: y,
            head: [[g.label, '', '', '']],
            body: [],
            theme: 'plain',
            headStyles: { fillColor: [11, 45, 92], textColor: [255, 255, 255], fontSize: 9, halign: 'left' },
            margin: { left: 14, right: 14 },
          });
          doc.autoTable({
            startY: doc.lastAutoTable.finalY,
            head: [['Artikel', 'Nr./Init.', 'Größe', 'Zustand', 'Status']],
            body: g.items.map(inv => [
              inv.itemName,
              (() => {
                const p = findPerson(data, inv.assignedTo);
                const n = inv.assignedNumber || p?.number;
                return n ? (p?._kind === 'coach' ? `${n} (T)` : `#${n}`) : '–';
              })(),
              inv.size,
              getConditionFactors(data.settings)[inv.condition]?.label || inv.condition || '–',
              [
                inv.status === 'lager' ? 'Lager' : 'Ausgegeben',
                inv.flagged ? '⚠ markiert' : null,
                inv.needsReprint ? `Umbeflocken ${inv.reprintFromNumber || 'ohne'} → ${inv.reprintToNumber || inv.assignedNumber || 'neu'}` : null,
              ].filter(Boolean).join(' · '),
            ]),
            headStyles: { fillColor: [241, 236, 223], textColor: [11, 45, 92], fontSize: 8, fontStyle: 'bold' },
            bodyStyles: { fontSize: 9 },
            alternateRowStyles: { fillColor: [252, 250, 246] },
            columnStyles: {
              1: { halign: 'center', cellWidth: 20 },
              2: { halign: 'center', cellWidth: 18 },
              3: { cellWidth: 32 },
              4: { cellWidth: 44 },
            },
            margin: { left: 14, right: 14 },
          });
          y = doc.lastAutoTable.finalY + 4;
        });
      } else {
        // Pro Artikel (Übersicht). Eine Tabelle, sortiert nach Artikel + Größe + Person.
        const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '3XL'];
        const sizeIdx = (s) => {
          const i = sizeOrder.indexOf(s);
          return i === -1 ? 999 : i;
        };
        const rows = filtered
          .map(inv => {
            const p = findPerson(data, inv.assignedTo);
            const isCoach = (inv.personKind || p?._kind) === 'coach';
            const number = inv.assignedNumber || p?.number;
            const numberLabel = number ? (isCoach ? `${number} (T)` : `#${number}`) : '';
            const personLabel = inv.status === 'lager'
              ? (inv.assignedName ? `Lager · ${inv.assignedName}` : '— Lager —')
              : p
                ? `${p.firstName} ${p.lastName}${isCoach ? ' (T)' : ''}`
                : '— unbekannt —';
            return {
              articleNumber: data.items.find(i => i.id === inv.itemType)?.articleNumber || '',
              itemName: inv.itemName,
              size: inv.size,
              number: numberLabel,
              person: personLabel,
              team: p?.team || '',
              condition: getConditionFactors(data.settings)[inv.condition]?.label || inv.condition || '–',
              status: [
                inv.status === 'lager' ? 'Lager' : 'Ausgegeben',
                inv.flagged ? '⚠' : null,
                inv.needsReprint ? `Umbeflocken ${inv.reprintFromNumber || 'ohne'} → ${inv.reprintToNumber || inv.assignedNumber || 'neu'}` : null,
              ].filter(Boolean).join(' · '),
              _sortKey: `${inv.itemName}__${String(sizeIdx(inv.size)).padStart(3, '0')}__${p?.team || 'zzz'}__${p?.number ?? 'zzz'}`,
            };
          })
          .sort((a, b) => a._sortKey.localeCompare(b._sortKey));

        if (y > 250) { doc.addPage(); y = 20; }
        doc.autoTable({
          startY: y,
          head: [['Art.-Nr.', 'Artikel', 'Nr./Init.', 'Gr.', 'Person / Lager', 'Team', 'Zustand', 'Status']],
          body: rows.map(r => [r.articleNumber || '–', r.itemName, r.number || '–', r.size, r.person, r.team, r.condition, r.status]),
          headStyles: { fillColor: [11, 45, 92], textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
          bodyStyles: { fontSize: 8 },
          alternateRowStyles: { fillColor: [252, 250, 246] },
          columnStyles: {
            0: { fontStyle: 'bold', cellWidth: 22 },
            2: { halign: 'center', cellWidth: 18 },
            3: { halign: 'center', cellWidth: 12 },
            6: { cellWidth: 24 },
            7: { cellWidth: 24 },
          },
          margin: { left: 14, right: 14 },
        });
      }

      // ============ NUMMERN-/INITIALEN-ÜBERSICHT ============
      // Pro Mannschaft: belegte Spielernummern und Trainer-Initialen + freie Nummern.
      // So sieht man auf einen Blick, welche Trikotnummern für Neuzugänge verfügbar sind.
      const teamsForNumbers = filterTeam ? [filterTeam] : (data.teams || []);
      if (teamsForNumbers.length > 0) {
        // Neue Seite für die Übersicht, wenn wenig Platz
        const yCheck = doc.lastAutoTable?.finalY || 40;
        if (yCheck > 220) {
          doc.addPage();
        } else {
          // 12 mm Abstand zur vorigen Tabelle
          // (autoTable startet selbst mit etwas Abstand, wir pushen nur den Header)
        }

        doc.autoTable({
          startY: doc.lastAutoTable?.finalY ? doc.lastAutoTable.finalY + 8 : 40,
          head: [['NUMMERN- UND INITIALEN-UEBERSICHT', '']],
          body: [],
          theme: 'plain',
          headStyles: { fillColor: [11, 45, 92], textColor: [255, 255, 255], fontSize: 9, halign: 'left' },
          margin: { left: 14, right: 14 },
        });

        const numberRows = [];
        teamsForNumbers.forEach(teamName => {
          const teamPlayers = (data.players || []).filter(p => p.team === teamName);
          const teamCoaches = (data.coaches || []).filter(c => c.team === teamName);

          // Belegte Spielernummern
          const usedNumbers = teamPlayers
            .map(p => p.number)
            .filter(n => n != null && !isNaN(parseInt(n)))
            .map(n => parseInt(n))
            .sort((a, b) => a - b);
          const usedSet = new Set(usedNumbers);

          // Freie Nummern (1-99) — kompakt mit Bereichen darstellen
          const freeNumbers = [];
          for (let i = 1; i <= 99; i++) {
            if (!usedSet.has(i)) freeNumbers.push(i);
          }
          const freeRanges = compressRanges(freeNumbers);

          // Trainer-Initialen
          const usedInitials = teamCoaches
            .map(c => c.number)
            .filter(n => n != null && String(n).trim() !== '')
            .map(n => String(n).trim().toUpperCase())
            .sort();

          numberRows.push([
            teamName,
            'Belegte Nummern',
            usedNumbers.length > 0 ? usedNumbers.join(', ') : '—',
          ]);
          numberRows.push([
            '',
            'Freie Nummern (1–99)',
            freeRanges || '— alle belegt —',
          ]);
          if (usedInitials.length > 0) {
            numberRows.push([
              '',
              'Trainer-Initialen',
              usedInitials.join(', '),
            ]);
          }
          // Trennzeile
          numberRows.push(['', '', '']);
        });

        doc.autoTable({
          startY: doc.lastAutoTable.finalY,
          head: [['Mannschaft', 'Bereich', 'Nummern / Initialen']],
          body: numberRows,
          headStyles: { fillColor: [241, 236, 223], textColor: [11, 45, 92], fontSize: 8, fontStyle: 'bold' },
          bodyStyles: { fontSize: 8 },
          alternateRowStyles: { fillColor: [252, 250, 246] },
          columnStyles: {
            0: { fontStyle: 'bold', cellWidth: 38 },
            1: { cellWidth: 38, fontStyle: 'normal' },
          },
          margin: { left: 14, right: 14 },
        });
      }

      // Footer
      const pageCount = doc.internal.getNumberOfPages();
      for (let p = 1; p <= pageCount; p++) {
        doc.setPage(p);
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setFontSize(7);
        doc.setTextColor(128, 125, 120);
        doc.text(`Seite ${p} von ${pageCount}`, W - 14, pageHeight - 8, { align: 'right' });
        doc.text(`${settings.clubName || 'F. C. Frohlinde'} · #DeinDorfverein`, 14, pageHeight - 8);
      }

      const stamp = new Date().toISOString().slice(0, 10);
      doc.save(`bestandsliste_${stamp}.pdf`);
      onClose();
    } catch (e) {
      console.error('Bestands-PDF fehlgeschlagen:', e);
      alert(`PDF konnte nicht erstellt werden: ${e.message}`);
    }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white max-w-2xl w-full max-h-[90vh] flex flex-col" style={{ border: '2px solid var(--vereinsblau)' }}>
        <div className="p-5 border-b border-stone-200 flex justify-between items-start">
          <div>
            <div className="section-label mb-1">BESTANDSLISTE DRUCKEN</div>
            <h2 className="font-display text-2xl">PDF erzeugen</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-100"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Status">
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="w-full border border-stone-300 px-3 py-2 text-sm">
                <option value="alle">Alle Statuswerte</option>
                <option value="lager">Nur Lagerware</option>
                <option value="ausgegeben">Nur ausgegebenes Material</option>
                <option value="markiert">Nur als markiert geflaggt</option>
              </select>
            </Field>
            <Field label="Personenkreis">
              <select value={filterPersonKind} onChange={e => { setFilterPersonKind(e.target.value); setFilterPersonId(''); }} className="w-full border border-stone-300 px-3 py-2 text-sm">
                <option value="alle">Spieler + Trainer + Lager</option>
                <option value="player">Nur Spieler</option>
                <option value="coach">Nur Trainer</option>
                <option value="lager">Nur Lager</option>
              </select>
            </Field>
            <Field label="Mannschaft (Filter)">
              <select value={filterTeam} onChange={e => { setFilterTeam(e.target.value); setFilterPersonId(''); }} className="w-full border border-stone-300 px-3 py-2 text-sm">
                <option value="">Alle Mannschaften</option>
                {(data.teams || []).map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Einzelperson (optional)">
              <select value={filterPersonId} onChange={e => setFilterPersonId(e.target.value)} className="w-full border border-stone-300 px-3 py-2 text-sm">
                <option value="">— alle ausgewählten Personen —</option>
                {filterPersonKind !== 'coach' && filterPersonKind !== 'lager' && (
                  <optgroup label="Spieler">
                    {teamPlayers.sort((a, b) => (Number(a.number) || 999) - (Number(b.number) || 999)).map(p => (
                      <option key={p.id} value={p.id}>#{p.number || '–'} {p.firstName} {p.lastName} ({p.team})</option>
                    ))}
                  </optgroup>
                )}
                {filterPersonKind !== 'player' && filterPersonKind !== 'lager' && (
                  <optgroup label="Trainer">
                    {teamCoaches.sort((a, b) => (a.lastName || '').localeCompare(b.lastName || '')).map(c => (
                      <option key={c.id} value={c.id}>{c.number || '–'} {c.firstName} {c.lastName} ({c.team})</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </Field>
          </div>

          <div>
            <div className="font-sub text-xs mb-2" style={{ color: 'var(--vereinsblau)', letterSpacing: '0.18em' }}>GLIEDERUNG</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-start gap-2 p-3 cursor-pointer text-sm"
                style={{ border: groupBy === 'person' ? '2px solid var(--vereinsblau)' : '1px solid var(--rule)', background: groupBy === 'person' ? '#F1ECDF' : 'white' }}>
                <input type="radio" checked={groupBy === 'person'} onChange={() => setGroupBy('person')} className="mt-0.5" />
                <div>
                  <div className="font-medium">Pro Person / Lager</div>
                  <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>Eine Sektion je Person mit allen Materialteilen — gut für Übergaben.</div>
                </div>
              </label>
              <label className="flex items-start gap-2 p-3 cursor-pointer text-sm"
                style={{ border: groupBy === 'item' ? '2px solid var(--vereinsblau)' : '1px solid var(--rule)', background: groupBy === 'item' ? '#F1ECDF' : 'white' }}>
                <input type="radio" checked={groupBy === 'item'} onChange={() => setGroupBy('item')} className="mt-0.5" />
                <div>
                  <div className="font-medium">Lange Liste, sortiert nach Artikel</div>
                  <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>Tabellarisch alle Teile mit Person und Status — gut für die Inventur.</div>
                </div>
              </label>
            </div>
          </div>

          <div className="text-sm p-3" style={{ background: 'var(--paper)', color: 'var(--ink-soft)' }}>
            Vorschau: <strong>{filtered.length} Teile</strong> entsprechen den gewählten Filtern.
          </div>
        </div>

        <div className="p-5 border-t border-stone-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-stone-300">Abbrechen</button>
          <button onClick={generatePDF} disabled={busy || filtered.length === 0}
            className="px-5 py-2 text-sm uppercase text-white disabled:opacity-50"
            style={{ background: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
            {busy ? 'Erzeuge…' : `${filtered.length} Teile als PDF`}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssignForm({ inv, persons, inventory, onAssign, onCancel }) {
  const [personId, setPersonId] = useState('');
  const [number, setNumber] = useState('');
  const [reprintFromNumber, setReprintFromNumber] = useState(inv.assignedNumber ? String(inv.assignedNumber) : '');
  const [needsReprint, setNeedsReprint] = useState(false);
  const person = persons.find(p => p.id === personId);
  const isCoach = person?._kind === 'coach';

  // Wenn das Material einer Mannschaft zugeordnet ist, dürfen nur Personen aus genau
  // diesem Team es bekommen — sonst würde der Lagerbestand der einen Mannschaft
  // implizit zur anderen verschoben.
  const compatible = inv.team
    ? persons.filter(p => p.team === inv.team)
    : persons;

  useEffect(() => {
    if (person) {
      // Bei Spielern: Nummer als String speichern (kann später als Int gespeichert werden)
      // Bei Trainern: Initialen als String (1-3 Großbuchstaben)
      setNumber(person.number != null ? String(person.number) : '');
      const from = inv.assignedNumber ? String(inv.assignedNumber) : '';
      const to = person.number != null ? String(person.number) : '';
      setNeedsReprint(!!from && !!to && from.toUpperCase() !== to.toUpperCase());
    } else {
      setNumber('');
      setNeedsReprint(false);
    }
  }, [personId]);

  function handleNumberChange(val) {
    if (isCoach) {
      const cleaned = val.replace(/[^a-zA-ZäöüÄÖÜß]/g, '').slice(0, 3).toUpperCase();
      setNumber(cleaned);
    } else {
      const cleaned = val.replace(/[^0-9]/g, '');
      setNumber(cleaned);
    }
  }

  function submit() {
    if (!personId) return;
    let storedNumber;
    if (isCoach) {
      storedNumber = number ? String(number).trim().toUpperCase() : null;
    } else {
      storedNumber = number ? parseInt(number) : null;
    }
    onAssign(inv.id, personId, storedNumber, {
      needsReprint,
      fromNumber: reprintFromNumber || null,
      toNumber: storedNumber || null,
      personKind: person?._kind || null,
    });
  }

  return (
    <div className="bg-white border-2 border-stone-900 p-6 mb-4">
      <h2 className="font-display text-2xl mb-4">MATERIAL AUSGEBEN</h2>
      <p className="text-sm text-stone-600 mb-4">
        {inv.itemName} · Größe {inv.size}
        {inv.team && <span> · Lagerbestand <strong>{inv.team}</strong></span>}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Person (Spieler oder Trainer)">
          <select className="w-full border border-stone-300 px-3 py-2 text-sm" value={personId} onChange={e => setPersonId(e.target.value)}>
            <option value="">– wählen –</option>
            <optgroup label="Spieler">
              {compatible.filter(p => p._kind === 'player').map(p => <option key={p.id} value={p.id}>#{p.number || '–'} {p.firstName} {p.lastName} ({p.team})</option>)}
            </optgroup>
            <optgroup label="Trainer">
              {compatible.filter(p => p._kind === 'coach').map(p => <option key={p.id} value={p.id}>{p.number || '–'} {p.firstName} {p.lastName} ({p.team})</option>)}
            </optgroup>
          </select>
          {inv.team && compatible.length === 0 && (
            <p className="text-xs mt-1" style={{ color: 'var(--warn)' }}>Keine Personen in Mannschaft „{inv.team}" — Material an dieses Team gebunden.</p>
          )}
        </Field>
        <Field label={isCoach ? 'Initialen (1–3 Buchstaben)' : 'Rückennummer (auf diesem Teil)'}>
          <input
            type="text"
            inputMode={isCoach ? 'text' : 'numeric'}
            maxLength={3}
            placeholder={isCoach ? 'z.B. DH' : 'z.B. 7'}
            className={`w-full border border-stone-300 px-3 py-2 text-sm ${isCoach ? 'uppercase' : ''}`}
            value={number}
            onChange={e => handleNumberChange(e.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <label className="flex items-start gap-3 p-3 cursor-pointer" style={{ border: '1px solid var(--rule)', background: needsReprint ? '#F5EBDD' : 'white' }}>
            <input type="checkbox" checked={needsReprint} onChange={e => setNeedsReprint(e.target.checked)} className="mt-1" />
            <div className="flex-1">
              <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Umbeflockung / Nummernwechsel erfassen</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <Field label="Alt">
                  <input
                    className="w-full border border-stone-300 px-3 py-2 text-sm"
                    value={reprintFromNumber}
                    onChange={e => setReprintFromNumber(e.target.value)}
                    placeholder="bisherige Nr./Initialen"
                  />
                </Field>
                <Field label="Neu">
                  <input
                    className="w-full border border-stone-300 px-3 py-2 text-sm"
                    value={number}
                    onChange={e => handleNumberChange(e.target.value)}
                    placeholder="neue Nr./Initialen"
                  />
                </Field>
              </div>
            </div>
          </label>
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={submit}
          disabled={!personId} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">Ausgeben</button>
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

      {showForm && <DepositForm persons={allPersons(data)} deposits={data.deposits} settings={data.settings} onSave={addDeposit} onCancel={() => setShowForm(false)} />}

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
                <tr><th className="text-left p-3">Person</th><th className="text-left p-3 hidden md:table-cell">Eingegangen</th><th className="text-left p-3">Betrag</th><th className="text-left p-3 hidden lg:table-cell">Notiz</th><th className="p-3"></th></tr>
              </thead>
              <tbody>
                {active.map(d => {
                  const p = findPerson(data, d.playerId);
                  return (
                    <tr key={d.id} className="border-t border-stone-100">
                      <td className="p-3 font-medium">
                        {p ? `${p.firstName} ${p.lastName}` : '–'}
                        {p?._kind === 'coach' && <span className="ml-1 text-[10px] px-1.5 py-0.5" style={{ background: 'var(--paper-dark)', color: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.12em' }}>TRAINER</span>}
                        <div className="text-xs text-stone-500">{p?.team}</div>
                      </td>
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
                <tr><th className="text-left p-3">Person</th><th className="text-left p-3">Eingenommen</th><th className="text-left p-3">Rückzahlung</th><th className="text-left p-3">Einbehalten</th><th className="text-left p-3 hidden md:table-cell">Datum</th></tr>
              </thead>
              <tbody>
                {refunded.map(d => {
                  const p = findPerson(data, d.playerId);
                  return (
                    <tr key={d.id} className="border-t border-stone-100">
                      <td className="p-3 font-medium">
                        {p ? `${p.firstName} ${p.lastName}` : '–'}
                        {p?._kind === 'coach' && <span className="ml-1 text-[10px] px-1.5 py-0.5" style={{ background: 'var(--paper-dark)', color: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.12em' }}>TRAINER</span>}
                      </td>
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

function DepositForm({ persons, deposits, settings, onSave, onCancel }) {
  const [playerId, setPlayerId] = useState('');
  const selectedPerson = persons.find(p => p.id === playerId);
  const depositMode = getDepositMode(settings, selectedPerson?.team);
  const [amount, setAmount] = useState(getDefaultDeposit(settings, selectedPerson?.team));
  const [note, setNote] = useState('');
  const existing = deposits.find(d => d.playerId === playerId && !d.refunded);

  useEffect(() => {
    setAmount(getDefaultDeposit(settings, selectedPerson?.team));
  }, [playerId, selectedPerson?.team, settings]);

  return (
    <div className="bg-white border-2 border-stone-900 p-6 mb-4">
      <h2 className="font-display text-2xl mb-4">PFAND EINNEHMEN</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={`Person ${existing ? '⚠ hat bereits Pfand hinterlegt' : ''}`}>
          <select className={`w-full border px-3 py-2 text-sm ${existing ? 'border-orange-500' : 'border-stone-300'}`}
            value={playerId} onChange={e => setPlayerId(e.target.value)}>
            <option value="">– wählen –</option>
            <optgroup label="Spieler">
              {persons.filter(p => p._kind === 'player').map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName} ({p.team})</option>)}
            </optgroup>
            <optgroup label="Trainer">
              {persons.filter(p => p._kind === 'coach').map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName} ({p.team})</option>)}
            </optgroup>
          </select>
        </Field>
        <Field label="Betrag (€)">
          <input type="number" step="0.01" disabled={depositMode === 'ohne_pfand'}
            className="w-full border border-stone-300 px-3 py-2 text-sm disabled:opacity-60"
            value={amount} onChange={e => setAmount(e.target.value)} />
          {depositMode === 'ohne_pfand' && (
            <p className="text-xs mt-1" style={{ color: 'var(--ink-mute)' }}>Für diese Mannschaft ist „ohne Pfand" eingestellt.</p>
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notiz">
            <input className="w-full border border-stone-300 px-3 py-2 text-sm" value={note} onChange={e => setNote(e.target.value)} placeholder="z.B. Saison 2026/27" />
          </Field>
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={() => playerId && amount && onSave(playerId, amount, note)}
          disabled={!playerId || !amount || depositMode === 'ohne_pfand'} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">Speichern</button>
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

  const player = findPerson(data, selectedPlayer);
  const playerItems = data.inventory.filter(i => i.assignedTo === selectedPlayer && i.status === 'ausgegeben');
  const deposit = data.deposits.find(d => d.playerId === selectedPlayer && !d.refunded);

  // Berechnung — abhängig vom Pfandmodus
  const mode = getDepositMode(data.settings, player?.team);
  const conditionFactors = getConditionFactors(data.settings);
  const seasonDepreciation = getSeasonDepreciation(data.settings);

  const calc = playerItems.map(item => {
    const cond = conditions[item.id] || (mode === 'saison' ? (item.condition || 'gut') : 'ok');
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
    } else if (mode === 'saison') {
      // Saison-Modell: Abschreibung × Zustandsfaktor
      const seasons = item.seasonsUsed || 0;
      const seasonValue = Math.max(0, 1 - (seasons * seasonDepreciation));
      const condFactor = conditionFactors[cond]?.factor ?? 0;
      currentValue = item.originalPrice * seasonValue * condFactor;
      lossValue = item.originalPrice - currentValue;
    } else {
      // Ohne Pfand: Material wird zurückgenommen, aber es gibt keine Pfandverrechnung.
      lossValue = 0;
      currentValue = item.originalPrice;
    }
    return { item, cond, currentValue, lossValue };
  });

  const itemLossSum = calc.reduce((s, c) => s + c.lossValue, 0);
  // Pauschal-Modus: Wenn "Total-Verfall" angehakt ist, verfällt das ganze Pfand (Punkt 8 Pfandordnung)
  const totalLoss = mode === 'ohne_pfand' ? 0 : ((mode === 'pauschal' && totalForfeit) ? (deposit?.amount ?? 0) : itemLossSum);
  const refund = deposit ? Math.max(0, deposit.amount - totalLoss) : 0;
  const retained = deposit ? deposit.amount - refund : 0;

  function processReturn() {
    if (!confirming) { setConfirming(true); return; }
    const now = new Date().toISOString();
    // Material zurück ins Lager mit Zustandsupdate
    const newInv = data.inventory.map(i => {
      if (i.assignedTo === selectedPlayer && i.status === 'ausgegeben') {
        const cond = conditions[i.id] || (mode === 'saison' ? 'gut' : 'ok');
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
        <Field label="Person auswählen (Spieler oder Trainer)">
          <select className="w-full border border-stone-300 px-3 py-2 text-sm max-w-md" value={selectedPlayer} onChange={e => { setSelectedPlayer(e.target.value); setConditions({}); setConfirming(false); }}>
            <option value="">– wählen –</option>
            <optgroup label="Spieler">
              {data.players.filter(p =>
                data.inventory.some(i => i.assignedTo === p.id && i.status === 'ausgegeben') ||
                data.deposits.some(d => d.playerId === p.id && !d.refunded)
              ).map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName} ({p.team})</option>)}
            </optgroup>
            <optgroup label="Trainer">
              {(data.coaches || []).filter(p =>
                data.inventory.some(i => i.assignedTo === p.id && i.status === 'ausgegeben') ||
                data.deposits.some(d => d.playerId === p.id && !d.refunded)
              ).map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName} ({p.team})</option>)}
            </optgroup>
          </select>
        </Field>
      </div>

      {player && (
        <>
          {mode === 'ohne_pfand' && (
            <div className="p-4 mb-4 text-sm" style={{ background: 'var(--paper-dark)', color: 'var(--ink-soft)', borderLeft: '3px solid var(--vereinsblau)' }}>
              Für die Mannschaft {player.team} ist „ohne Pfand" eingestellt. Die Rückgabe bucht Material zurück, ohne eine Pfandabrechnung zu erzeugen.
            </div>
          )}

          <div className="bg-white border border-stone-200 mb-4">
            <div className="p-4 border-b border-stone-200 bg-stone-50 flex flex-wrap justify-between items-center gap-2">
              <div>
                <h2 className="font-display text-xl">
                  {player.firstName} {player.lastName} – {player.team}
                  {player._kind === 'coach' && <span className="ml-2 text-[10px] px-1.5 py-0.5 align-middle" style={{ background: 'var(--paper-dark)', color: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.12em' }}>TRAINER</span>}
                </h2>
                <p className="text-xs text-stone-500">{playerItems.length} ausgegebene Teile · Pfand: {deposit ? `${deposit.amount.toFixed(2)} €` : 'kein Pfand hinterlegt'}</p>
              </div>
            </div>

            {playerItems.length === 0 ? (
              <div className="p-6 text-center text-stone-500 text-sm">Kein Material ausgegeben an diese Person.</div>
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
                            {mode === 'ohne_pfand' ? (
                              <span className="text-xs" style={{ color: 'var(--ink-mute)' }}>Keine Pfandbewertung</span>
                            ) : mode === 'pauschal' ? (
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
              <h3 className="font-display text-3xl mb-6">
                Schlussbilanz für {player.firstName} {player.lastName}
                {player._kind === 'coach' && <span className="ml-2 text-xs px-2 py-1 align-middle" style={{ background: 'rgba(255,255,255,0.15)', color: 'var(--gold)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.12em' }}>TRAINER</span>}
              </h3>
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
  const [selected, setSelected] = useState([]);
  const [mergeMode, setMergeMode] = useState(false);
  const [sort, setSort] = useState({ key: 'createdAt', dir: 'desc' });

  function saveOrder(order) {
    const newOrder = { ...order, id: `ord_${Date.now()}`, createdAt: new Date().toISOString(), status: 'angelegt' };
    update('orders', [...data.orders, newOrder]);

    // Wenn die Bestellung aus Bedarfsmeldungen erzeugt wurde, diese sperren
    if (newOrder.fromReports && newOrder.fromReports.length > 0) {
      const updatedReports = (data.reports || []).map(r =>
        newOrder.fromReports.includes(r.id)
          ? { ...r, status: 'bestellt', orderId: newOrder.id, handledAt: new Date().toISOString() }
          : r
      );
      update('reports', updatedReports);
    }
    setShowForm(false);
  }

  function orderSponsorLabel(order) {
    if (order.sponsorKey) return order.sponsorKey;
    const s = order.sponsors || {};
    return [s.brust, s.ruecken, s.aermel].filter(Boolean).join(' / ');
  }

  const sortedOrders = [...data.orders].sort((a, b) => {
    if (sort.key === 'title') return compareValues(a.title, b.title, sort.dir);
    if (sort.key === 'team') return compareValues(a.team || 'div.', b.team || 'div.', sort.dir);
    if (sort.key === 'supplier') {
      const as = (data.suppliers || []).find(s => s.id === a.articleSupplierId)?.name || '';
      const bs = (data.suppliers || []).find(s => s.id === b.articleSupplierId)?.name || '';
      return compareValues(as, bs, sort.dir);
    }
    if (sort.key === 'sponsor') return compareValues(orderSponsorLabel(a), orderSponsorLabel(b), sort.dir);
    if (sort.key === 'qty') return compareValues((a.lines || []).reduce((s, l) => s + (l.qty || 0), 0), (b.lines || []).reduce((s, l) => s + (l.qty || 0), 0), sort.dir);
    if (sort.key === 'status') return compareValues(a.status, b.status, sort.dir);
    return compareValues(a.createdAt, b.createdAt, sort.dir);
  });

  function setStatus(id, status) {
    update('orders', data.orders.map(o => o.id === id ? { ...o, status, updatedAt: new Date().toISOString() } : o));
  }

  function remove(id) {
    if (!confirm('Bestellung löschen? Eventuell verknüpfte Bedarfsmeldungen werden wieder freigegeben.')) return;
    // Verknüpfte Bedarfsmeldungen wieder auf "gesehen" zurücksetzen, damit sie neu bestellt werden können
    const order = data.orders.find(o => o.id === id);
    if (order?.fromReports?.length) {
      const updatedReports = (data.reports || []).map(r =>
        order.fromReports.includes(r.id)
          ? { ...r, status: 'gesehen', orderId: null }
          : r
      );
      update('reports', updatedReports);
    }
    update('orders', data.orders.filter(o => o.id !== id));
  }

  function toggleSelect(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function mergeSelected() {
    if (selected.length < 2) { alert('Bitte mindestens 2 Bestellungen auswählen.'); return; }
    const ordersToMerge = data.orders.filter(o => selected.includes(o.id));
    const title = prompt('Titel der zusammengeführten Bestellung:', `Sammelbestellung ${new Date().toLocaleDateString('de-DE')}`);
    if (!title) return;

    // Lines, fromReports, sponsors und Lieferanten zusammenführen
    const allLines = ordersToMerge.flatMap(o => o.lines || []);
    const allReports = [...new Set(ordersToMerge.flatMap(o => o.fromReports || []))];
    const teams = [...new Set(ordersToMerge.map(o => o.team).filter(Boolean))];
    const articleSuppliers = [...new Set(ordersToMerge.map(o => o.articleSupplierId).filter(Boolean))];
    const flockSuppliers = [...new Set(ordersToMerge.map(o => o.flockSupplierId).filter(Boolean))];

    const merged = {
      id: `ord_${Date.now()}`,
      title,
      type: 'sammel',
      team: teams.length === 1 ? teams[0] : 'mehrere',
      articleSupplierId: articleSuppliers.length === 1 ? articleSuppliers[0] : null,
      flockSupplierId: flockSuppliers.length === 1 ? flockSuppliers[0] : null,
      flockBy: ordersToMerge[0]?.flockBy || 'haus',
      notes: `Zusammengeführt aus: ${ordersToMerge.map(o => o.title).join(', ')}`,
      lines: allLines.map((l, idx) => ({ ...l, id: l.id || `l_${Date.now()}_${idx}` })),
      sponsors: ordersToMerge[0]?.sponsors || { brust: '', ruecken: '', aermel: '' },
      sponsorKey: orderSponsorLabel(ordersToMerge[0]) || '',
      fromReports: allReports,
      mergedFrom: ordersToMerge.map(o => o.id),
      createdAt: new Date().toISOString(),
      status: 'angelegt',
    };

    // Quellen löschen, neue Bestellung anlegen, Bedarfsmeldungen auf neue Order-ID umhängen
    const remaining = data.orders.filter(o => !selected.includes(o.id));
    update('orders', [...remaining, merged]);

    if (allReports.length > 0) {
      const updatedReports = (data.reports || []).map(r =>
        allReports.includes(r.id) ? { ...r, orderId: merged.id } : r
      );
      update('reports', updatedReports);
    }

    setSelected([]);
    setMergeMode(false);
  }

  if (viewing) return <OrderDetail order={viewing} data={data} onBack={() => setViewing(null)} onStatus={setStatus} />;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <PageHeader number="08" label="BESCHAFFUNG" title="Bestellungen" subtitle={`${data.orders.length} Bestellungen · Flock-Liste integriert`} />
        <div className="flex gap-2 flex-wrap">
          {!mergeMode && (
            <>
              <button onClick={() => setMergeMode(true)} disabled={data.orders.length < 2}
                className="px-5 py-2.5 text-xs font-medium flex items-center gap-2 uppercase disabled:opacity-50"
                style={{ background: 'var(--paper-dark)', color: 'var(--ink)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
                Zusammenführen
              </button>
              <button onClick={() => setShowForm(true)} className="px-5 py-2.5 text-xs font-medium flex items-center gap-2 uppercase"
                style={{ background: 'var(--vereinsblau)', color: 'white', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
                <Plus size={14} /> Neue Bestellung
              </button>
            </>
          )}
          {mergeMode && (
            <>
              <button onClick={mergeSelected} disabled={selected.length < 2}
                className="px-5 py-2.5 text-xs font-medium flex items-center gap-2 uppercase text-white disabled:opacity-50"
                style={{ background: 'var(--success)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
                {selected.length} Bestellungen zusammenführen
              </button>
              <button onClick={() => { setMergeMode(false); setSelected([]); }}
                className="px-5 py-2.5 text-xs font-medium uppercase"
                style={{ border: '1px solid var(--rule)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
                Abbrechen
              </button>
            </>
          )}
        </div>
      </div>

      {mergeMode && (
        <div className="mb-4 p-3 text-xs" style={{ background: 'var(--paper-dark)', color: 'var(--ink-soft)', borderLeft: '3px solid var(--vereinsblau)' }}>
          Wähle 2 oder mehr Bestellungen zum Zusammenführen aus. Die ausgewählten Bestellungen werden gelöscht und durch eine neue Sammelbestellung ersetzt.
        </div>
      )}

      {showForm && <OrderForm data={data} onSave={saveOrder} onCancel={() => setShowForm(false)} />}

      <div className="bg-white border border-stone-200 overflow-hidden">
        {data.orders.length === 0 ? (
          <div className="p-12 text-center text-stone-500 text-sm">Noch keine Bestellungen.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wider text-stone-500">
                <tr>
                  {mergeMode && <th className="p-3 w-8"></th>}
                  <SortHeader label="Bestellung" sortKey="title" sort={sort} setSort={setSort} />
                  <SortHeader label="Mannschaft" sortKey="team" sort={sort} setSort={setSort} className="text-left p-3 hidden sm:table-cell" />
                  <SortHeader label="Lieferant" sortKey="supplier" sort={sort} setSort={setSort} className="text-left p-3 hidden md:table-cell" />
                  <SortHeader label="Sponsor" sortKey="sponsor" sort={sort} setSort={setSort} className="text-left p-3 hidden lg:table-cell" />
                  <SortHeader label="Teile" sortKey="qty" sort={sort} setSort={setSort} className="text-left p-3 hidden md:table-cell" />
                  <SortHeader label="Status" sortKey="status" sort={sort} setSort={setSort} />
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {sortedOrders.map(o => {
                  const articleSupplier = (data.suppliers || []).find(s => s.id === o.articleSupplierId);
                  return (
                    <tr key={o.id} className="border-t border-stone-100">
                      {mergeMode && (
                        <td className="p-3">
                          <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggleSelect(o.id)} />
                        </td>
                      )}
                      <td className="p-3">
                        <div className="font-medium">{o.title}</div>
                        <div className="text-xs text-stone-500">
                          {new Date(o.createdAt).toLocaleDateString('de-DE')}
                          {o.mergedFrom && <span className="ml-1" style={{ color: 'var(--vereinsblau)' }}>· Sammelbestellung</span>}
                          {o.fromReports?.length > 0 && <span className="ml-1" style={{ color: 'var(--ink-mute)' }}>· aus {o.fromReports.length} Bedarfsmeldung(en)</span>}
                        </div>
                      </td>
                      <td className="p-3 hidden sm:table-cell">{o.team || 'div.'}</td>
                      <td className="p-3 hidden md:table-cell text-xs" style={{ color: 'var(--ink-soft)' }}>
                        {articleSupplier?.name || '–'}
                      </td>
                      <td className="p-3 hidden lg:table-cell text-xs" style={{ color: 'var(--vereinsblau)' }}>
                        {orderSponsorLabel(o) || '–'}
                      </td>
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

function OrderForm({ data, onSave, onCancel }) {
  const [type, setType] = useState('komplett');
  const [team, setTeam] = useState(data.teams[0] || '');
  const [title, setTitle] = useState('');
  const [articleSupplierId, setArticleSupplierId] = useState('');
  const [flockSupplierId, setFlockSupplierId] = useState('');
  const [flockBy, setFlockBy] = useState('haus'); // 'haus' | 'lieferant' | 'extern'
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([]);
  const [sponsors, setSponsors] = useState({ brust: '', ruecken: '', aermel: '' });
  const [sponsorKey, setSponsorKey] = useState('');
  const [showPersonPicker, setShowPersonPicker] = useState(false);
  const [distributingLineId, setDistributingLineId] = useState(null);

  const suppliers = data.suppliers || [];
  const articleSuppliers = suppliers.filter(s => s.type === 'artikel' || s.type === 'beides');
  const flockSuppliers = suppliers.filter(s => s.type === 'flock' || s.type === 'beides');

  // Mannschafts-Filter wird in allen Bestelltypen verwendet (auch "einzeln")
  const teamPlayers = team ? data.players.filter(p => p.team === team) : data.players;
  const teamCoaches = team ? (data.coaches || []).filter(c => c.team === team) : (data.coaches || []);

  // Hilfsfunktion: Person-Anzeige mit Nummer/Initialen
  function personLabel(p, kind) {
    const isCoach = kind === 'coach';
    const numStr = p.number ? (isCoach ? p.number : `#${p.number}`) : '';
    return `${numStr ? numStr + ' ' : ''}${p.firstName} ${p.lastName}${p.size ? ` · ${p.size}` : ''}`;
  }

  function addLine() {
    setLines([...lines, {
      id: `l_${Date.now()}_${Math.random()}`,
      itemType: data.items[0]?.id || '',
      size: 'L',
      qty: 1,
      playerId: '',
      personKind: null,
      number: '',
      name: '',
    }]);
  }

  function updateLine(id, key, val) {
    setLines(lines.map(l => {
      if (l.id !== id) return l;
      const nl = { ...l, [key]: val };
      // Wenn Spieler/Trainer gewählt → automatisch Nummer und Name vorbelegen
      if (key === 'playerId') {
        if (val) {
          // Person finden
          let person = data.players.find(p => p.id === val);
          let kind = 'player';
          if (!person) {
            person = (data.coaches || []).find(c => c.id === val);
            kind = 'coach';
          }
          if (person) {
            nl.personKind = kind;
            nl.number = person.number != null ? String(person.number) : '';
            nl.name = (person.lastName || '').toUpperCase();
            // Größe übernehmen, falls noch Standardwert
            if (person.size && (!l.size || l.size === 'L')) {
              nl.size = person.size;
            }
          }
        } else {
          nl.personKind = null;
        }
      }
      return nl;
    }));
  }

  function removeLine(id) { setLines(lines.filter(l => l.id !== id)); }

  // Erzeugt Linien aus einer Auswahl von Personen
  function addLinesForPersons({ itemType, size, persons }) {
    const newLines = persons.map((entry, idx) => {
      const { person, kind } = entry;
      return {
        id: `l_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 5)}`,
        itemType,
        size: size || person.size || 'L',
        qty: 1,
        playerId: person.id,
        personKind: kind,
        number: person.number != null ? String(person.number) : '',
        name: (person.lastName || '').toUpperCase(),
      };
    });
    setLines([...lines, ...newLines]);
  }

  // Verteilt eine Sammelposition auf ausgewählte Personen:
  // 1 Sammelzeile mit Menge N → N einzelne Personen-Zeilen mit Menge 1
  function distributeLine({ lineId, persons }) {
    const line = lines.find(l => l.id === lineId);
    if (!line) return;
    const newLines = persons.map((entry, idx) => {
      const { person, kind } = entry;
      return {
        id: `l_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 5)}`,
        itemType: line.itemType,
        size: line.size,
        qty: 1,
        playerId: person.id,
        personKind: kind,
        number: person.number != null ? String(person.number) : '',
        name: (person.lastName || '').toUpperCase(),
      };
    });
    // Sammelzeile ersetzen
    setLines(lines.flatMap(l => l.id === lineId ? newLines : [l]));
  }

  // Standard-Sets aus den Settings holen — neue flexible Liste (settings.standardSets)
  // mit Migration von alten standardSetPlayer/-Coach-Feldern.
  const settings = data.settings || {};
  const allSets = (() => {
    const list = Array.isArray(settings.standardSets) ? [...settings.standardSets] : [];
    // Backward-compat: alte Felder bei Bedarf einlesen
    if (Array.isArray(settings.standardSetPlayer) && settings.standardSetPlayer.length > 0 && !list.some(s => s.id === 'set_player_default')) {
      list.push({ id: 'set_player_default', name: 'Spieler-Set (Erstausstattung)', target: 'player', items: settings.standardSetPlayer });
    }
    if (Array.isArray(settings.standardSetCoach) && settings.standardSetCoach.length > 0 && !list.some(s => s.id === 'set_coach_default')) {
      list.push({ id: 'set_coach_default', name: 'Trainer-Set (Erstausstattung)', target: 'coach', items: settings.standardSetCoach });
    }
    return list.filter(s => Array.isArray(s.items) && s.items.length > 0);
  })();

  // Wer hat schon was? Wir prüfen das aktuelle Inventar — wenn eine Person bereits
  // ein Item desselben Typs (Artikel) ausgegeben hat, gilt sie für dieses Item als ausgestattet.
  // Das ist absichtlich grob: wir prüfen pro Artikel, nicht pro Stückzahl. Wer schon ein
  // Trainingsshirt hat, kriegt aus dem Set kein zweites — auch wenn das Set 2 Stück sagt.
  // Wer mehr will, bestellt manuell nach.
  function hasItemAssigned(personId, itemId) {
    return (data.inventory || []).some(inv =>
      inv.assignedTo === personId
      && inv.itemType === itemId
      && inv.status === 'ausgegeben'
    );
  }

  function applySetById(setId) {
    const set = allSets.find(s => s.id === setId);
    if (!set) return;
    const newLines = [];
    const seen = new Set(lines.map(l => `${l.playerId}__${l.itemType}__${l.size}`));

    // Welche Personen bekommen das Set?
    const candidates = [];
    if (set.target === 'player' || set.target === 'both') {
      teamPlayers.forEach(p => candidates.push({ person: p, kind: 'player' }));
    }
    if (set.target === 'coach' || set.target === 'both') {
      teamCoaches.forEach(c => candidates.push({ person: c, kind: 'coach' }));
    }

    let skippedFully = 0;
    candidates.forEach(({ person, kind }, idxP) => {
      const size = person.size || 'L';
      let addedForPerson = 0;
      set.items.forEach((entry, idxItem) => {
        const item = data.items.find(i => i.id === entry.itemId);
        if (!item) return;
        // Filter: Nur Personen, die diesen Artikel noch nicht haben
        if (hasItemAssigned(person.id, item.id)) return;
        const key = `${person.id}__${item.id}__${size}`;
        if (seen.has(key)) return;
        seen.add(key);
        newLines.push({
          id: `l_${Date.now()}_${idxP}_${idxItem}_${Math.random().toString(36).slice(2, 5)}`,
          itemType: item.id,
          size,
          qty: Number(entry.qty) || 1,
          playerId: person.id,
          personKind: kind,
          number: person.number != null ? String(person.number) : '',
          name: (person.lastName || '').toUpperCase(),
        });
        addedForPerson++;
      });
      if (addedForPerson === 0) skippedFully++;
    });

    if (newLines.length === 0) {
      alert(`Keine neuen Bestellzeilen erzeugt — alle ${candidates.length} Personen sind bereits mit diesem Set ausgestattet.`);
      return;
    }
    const personsAdded = candidates.length - skippedFully;
    setLines([...lines, ...newLines]);
    if (skippedFully > 0) {
      alert(`Set angewendet: ${newLines.length} Zeilen für ${personsAdded} Personen erzeugt. ${skippedFully} Personen waren bereits ausgestattet und wurden übersprungen.`);
    }
  }

  function submit() {
    if (!title) return alert('Titel fehlt');
    if (lines.length === 0) return alert('Keine Positionen');
    onSave({
      title, type,
      team: team || null,
      articleSupplierId, flockSupplierId, flockBy,
      notes, lines, sponsors, sponsorKey,
      fromReports: [],
    });
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
        <Field label="Mannschaft (Vorfilter)">
          <select className="w-full border border-stone-300 px-3 py-2 text-sm" value={team} onChange={e => setTeam(e.target.value)}>
            <option value="">– alle / mehrere –</option>
            {data.teams.map(t => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Artikel-Lieferant (Ausrüster)">
          <select className="w-full border border-stone-300 px-3 py-2 text-sm" value={articleSupplierId} onChange={e => setArticleSupplierId(e.target.value)}>
            <option value="">– kein Lieferant ausgewählt –</option>
            {articleSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {articleSuppliers.length === 0 && (
            <p className="text-xs mt-1" style={{ color: 'var(--ink-mute)' }}>Noch keine Lieferanten angelegt — in den Einstellungen unter „Lieferanten" hinzufügen.</p>
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notizen">
            <textarea className="w-full border border-stone-300 px-3 py-2 text-sm" rows="2" value={notes} onChange={e => setNotes(e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="p-4 mb-4" style={{ background: 'var(--paper-dark)', border: '1px solid var(--rule)' }}>
        <div className="font-sub text-xs mb-3" style={{ color: 'var(--vereinsblau)', letterSpacing: '0.18em' }}>BEFLOCKUNG</div>
        <p className="text-xs mb-3" style={{ color: 'var(--ink-mute)' }}>Wer übernimmt die Beflockung mit Spielernamen und Nummern?</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
          <label className="flex items-start gap-2 p-3 cursor-pointer text-sm" style={{ border: flockBy === 'haus' ? '2px solid var(--vereinsblau)' : '1px solid var(--rule)', background: flockBy === 'haus' ? 'white' : 'transparent' }}>
            <input type="radio" name="flockBy" value="haus" checked={flockBy === 'haus'} onChange={() => setFlockBy('haus')} className="mt-1" />
            <div>
              <div className="font-medium" style={{ color: 'var(--ink)' }}>Im Haus</div>
              <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>Verein beflockt selbst</div>
            </div>
          </label>
          <label className="flex items-start gap-2 p-3 cursor-pointer text-sm" style={{ border: flockBy === 'lieferant' ? '2px solid var(--vereinsblau)' : '1px solid var(--rule)', background: flockBy === 'lieferant' ? 'white' : 'transparent' }}>
            <input type="radio" name="flockBy" value="lieferant" checked={flockBy === 'lieferant'} onChange={() => setFlockBy('lieferant')} className="mt-1" />
            <div>
              <div className="font-medium" style={{ color: 'var(--ink)' }}>Lieferant macht Flock</div>
              <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>Artikel-Lieferant beflockt mit</div>
            </div>
          </label>
          <label className="flex items-start gap-2 p-3 cursor-pointer text-sm" style={{ border: flockBy === 'extern' ? '2px solid var(--vereinsblau)' : '1px solid var(--rule)', background: flockBy === 'extern' ? 'white' : 'transparent' }}>
            <input type="radio" name="flockBy" value="extern" checked={flockBy === 'extern'} onChange={() => setFlockBy('extern')} className="mt-1" />
            <div>
              <div className="font-medium" style={{ color: 'var(--ink)' }}>Externer Beflocker</div>
              <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>Eigener Flock-Lieferant</div>
            </div>
          </label>
        </div>
        {flockBy === 'extern' && (
          <Field label="Flock-Lieferant">
            <select className="w-full border border-stone-300 px-3 py-2 text-sm" value={flockSupplierId} onChange={e => setFlockSupplierId(e.target.value)}>
              <option value="">– wählen –</option>
              {flockSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {flockSuppliers.length === 0 && (
              <p className="text-xs mt-1" style={{ color: 'var(--ink-mute)' }}>Noch keine Flock-Lieferanten angelegt.</p>
            )}
          </Field>
        )}
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
          <div className="sm:col-span-3">
            <Field label="Sponsor-Kennung / Trikotsatz-ID">
              <input className="w-full border border-stone-300 px-3 py-2 text-sm" value={sponsorKey}
                onChange={e => setSponsorKey(e.target.value)}
                placeholder="z. B. Heimtrikot Brabus 2026 oder Satz Sparkasse A-Jugend" />
            </Field>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <button onClick={addLine} className="text-xs bg-stone-100 px-3 py-1.5 flex items-center gap-1"><Plus size={12} /> Einzelne Position</button>
        <button onClick={() => setShowPersonPicker(true)} className="text-xs px-3 py-1.5 flex items-center gap-1 text-white"
          style={{ background: 'var(--vereinsblau)' }}>
          <Users size={12} /> Personen auswählen…
        </button>

        {allSets.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-xs" style={{ color: 'var(--ink-mute)' }}>Set:</span>
            <select
              onChange={e => {
                if (e.target.value) {
                  applySetById(e.target.value);
                  e.target.value = '';
                }
              }}
              className="text-xs border border-stone-300 px-2 py-1.5 bg-white"
              defaultValue=""
            >
              <option value="">– Standard-Set anwenden –</option>
              {allSets.map(set => {
                // Anzeigen: wieviele Personen würden was bekommen
                const target = set.target;
                const candidates =
                  target === 'player' ? teamPlayers.length :
                  target === 'coach' ? teamCoaches.length :
                  teamPlayers.length + teamCoaches.length;
                if (candidates === 0) return null;
                const targetLabel = target === 'player' ? 'Spieler' : target === 'coach' ? 'Trainer' : 'Sp.+Tr.';
                return (
                  <option key={set.id} value={set.id}>
                    {set.name} ({targetLabel}, max. {candidates} Personen)
                  </option>
                );
              })}
            </select>
          </div>
        )}
      </div>

      {showPersonPicker && (
        <PersonPicker
          data={data}
          team={team}
          onSelect={(payload) => {
            addLinesForPersons(payload);
            setShowPersonPicker(false);
          }}
          onCancel={() => setShowPersonPicker(false)}
        />
      )}

      {distributingLineId && (() => {
        const line = lines.find(l => l.id === distributingLineId);
        if (!line) return null;
        const itemName = data.items.find(i => i.id === line.itemType)?.name || line.itemType;
        return (
          <PersonPicker
            data={data}
            team={team}
            mode="distribute"
            preselectQty={line.qty}
            preselectSize={line.size}
            preselectItemName={itemName}
            onSelect={({ persons }) => {
              distributeLine({ lineId: distributingLineId, persons });
              setDistributingLineId(null);
            }}
            onCancel={() => setDistributingLineId(null)}
          />
        );
      })()}

      {lines.length > 0 && (
        <div className="border border-stone-200 mb-4 overflow-x-auto">
          <table className="w-full text-xs min-w-[700px]">
            <thead className="bg-stone-50 uppercase tracking-wider text-stone-500">
              <tr>
                <th className="text-left p-2">Artikel</th>
                <th className="text-left p-2">Größe</th>
                <th className="text-left p-2">Menge</th>
                <th className="text-left p-2">Person</th>
                <th className="text-left p-2">Nr./Init.</th>
                <th className="text-left p-2">Flock-Name</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => {
                const isCoach = l.personKind === 'coach';
                const isCollective = !l.playerId && l.qty > 1;
                return (
                  <tr key={l.id} className="border-t border-stone-100">
                    <td className="p-1">
                      <select value={l.itemType} onChange={e => updateLine(l.id, 'itemType', e.target.value)} className="border border-stone-300 px-1 py-1 text-xs w-full">
                        {data.items.map(i => (
                          <option key={i.id} value={i.id}>
                            {i.articleNumber ? `[${i.articleNumber}] ` : ''}{i.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-1">
                      <select value={l.size} onChange={e => updateLine(l.id, 'size', e.target.value)} className="border border-stone-300 px-1 py-1 text-xs">
                        {['XS','S','M','L','XL','XXL','3XL'].map(s => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="p-1">
                      <div className="flex items-center gap-1">
                        <input type="number" min="1" value={l.qty} onChange={e => updateLine(l.id, 'qty', parseInt(e.target.value) || 1)} className="border border-stone-300 px-1 py-1 text-xs w-14" />
                        {isCollective && (
                          <button
                            onClick={() => setDistributingLineId(l.id)}
                            title={`${l.qty} Stück auf Personen verteilen`}
                            className="text-[10px] px-1.5 py-1 whitespace-nowrap"
                            style={{ background: 'var(--vereinsblau)', color: 'white', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.1em' }}>
                            verteilen
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="p-1">
                      <select value={l.playerId} onChange={e => updateLine(l.id, 'playerId', e.target.value)} className="border border-stone-300 px-1 py-1 text-xs w-full">
                        <option value="">– Lager / Sammelpos. –</option>
                        <optgroup label="Spieler">
                          {teamPlayers.map(p => <option key={p.id} value={p.id}>#{p.number || '–'} {p.firstName} {p.lastName}{team ? '' : ` (${p.team})`}</option>)}
                        </optgroup>
                        <optgroup label="Trainer">
                          {teamCoaches.map(p => <option key={p.id} value={p.id}>{p.number || '–'} {p.firstName} {p.lastName}{team ? '' : ` (${p.team})`}</option>)}
                        </optgroup>
                      </select>
                    </td>
                    <td className="p-1">
                      <input
                        type="text"
                        inputMode={isCoach ? 'text' : 'numeric'}
                        maxLength={3}
                        placeholder={isCoach ? 'DW' : '7'}
                        value={l.number}
                        onChange={e => {
                          const val = isCoach
                            ? e.target.value.replace(/[^a-zA-ZäöüÄÖÜß]/g, '').slice(0, 3).toUpperCase()
                            : e.target.value.replace(/[^0-9]/g, '');
                          updateLine(l.id, 'number', val);
                        }}
                        className={`border border-stone-300 px-1 py-1 text-xs w-14 ${isCoach ? 'uppercase' : ''}`}
                      />
                    </td>
                    <td className="p-1"><input value={l.name} onChange={e => updateLine(l.id, 'name', e.target.value.toUpperCase())} className="border border-stone-300 px-1 py-1 text-xs w-full" /></td>
                    <td><button onClick={() => removeLine(l.id)} className="text-red-600 p-1"><X size={12} /></button></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-stone-50 text-xs">
              <tr>
                <td className="p-2 font-medium" colSpan={2}>Summe Positionen</td>
                <td className="p-2 font-medium">{lines.reduce((s, l) => s + (l.qty || 0), 0)} Teile</td>
                <td className="p-2" colSpan={4}></td>
              </tr>
            </tfoot>
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

// Picker für Spieler/Trainer-Multi-Select.
// Modus 'add': Artikel + Größe wählen, beliebig viele Personen → eine Zeile pro Person.
// Modus 'distribute': Artikel/Größe sind vorgegeben (Sammelposition), Auswahl auf preselectQty begrenzt.
function PersonPicker({ data, team, mode = 'add', preselectQty, preselectSize, preselectItemName, onSelect, onCancel }) {
  const isDistribute = mode === 'distribute';
  const [filterTeam, setFilterTeam] = useState(team || '');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState({}); // { personId: 'player' | 'coach' }
  const [itemType, setItemType] = useState(isDistribute ? null : (data.items[0]?.id || ''));
  const [size, setSize] = useState(preselectSize || 'L');

  // Pool je nach Filter
  const allPlayers = (data.players || []).filter(p => !filterTeam || p.team === filterTeam);
  const allCoaches = (data.coaches || []).filter(c => !filterTeam || c.team === filterTeam);

  const searchLower = search.trim().toLowerCase();
  function matchesSearch(p) {
    if (!searchLower) return true;
    const haystack = `${p.firstName} ${p.lastName} ${p.number || ''}`.toLowerCase();
    return haystack.includes(searchLower);
  }
  const filteredPlayers = allPlayers.filter(matchesSearch);
  const filteredCoaches = allCoaches.filter(matchesSearch);

  function toggle(id, kind) {
    setSelected(prev => {
      const copy = { ...prev };
      if (copy[id]) delete copy[id];
      else copy[id] = kind;
      return copy;
    });
  }

  function selectAllVisible() {
    const all = { ...selected };
    filteredPlayers.forEach(p => { all[p.id] = 'player'; });
    filteredCoaches.forEach(c => { all[c.id] = 'coach'; });
    setSelected(all);
  }

  function clearAll() {
    setSelected({});
  }

  const selectedCount = Object.keys(selected).length;
  const limitReached = isDistribute && preselectQty && selectedCount > preselectQty;

  function confirm() {
    if (!isDistribute && !itemType) {
      alert('Bitte einen Artikel auswählen.');
      return;
    }
    if (selectedCount === 0) {
      alert('Bitte mindestens eine Person auswählen.');
      return;
    }
    if (isDistribute && preselectQty && selectedCount !== preselectQty) {
      if (!window.confirm(`Du hast ${selectedCount} Personen ausgewählt, die Sammelposition hatte aber Menge ${preselectQty}. Trotzdem fortfahren? Es wird je eine Zeile mit Menge 1 pro Person erzeugt.`)) {
        return;
      }
    }

    const persons = [];
    [...filteredPlayers, ...allPlayers.filter(p => !filteredPlayers.includes(p))].forEach(p => {
      if (selected[p.id] === 'player' && !persons.find(x => x.person.id === p.id)) {
        persons.push({ person: p, kind: 'player' });
      }
    });
    [...filteredCoaches, ...allCoaches.filter(c => !filteredCoaches.includes(c))].forEach(c => {
      if (selected[c.id] === 'coach' && !persons.find(x => x.person.id === c.id)) {
        persons.push({ person: c, kind: 'coach' });
      }
    });

    onSelect({
      itemType,
      size,
      persons,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white max-w-2xl w-full max-h-[90vh] flex flex-col" style={{ border: '2px solid var(--vereinsblau)' }}>
        <div className="p-5 border-b border-stone-200 flex justify-between items-start">
          <div>
            <div className="section-label mb-1">{isDistribute ? 'POSITION VERTEILEN' : 'PERSONEN AUSWÄHLEN'}</div>
            <h2 className="font-display text-2xl">
              {isDistribute ? `${preselectItemName || 'Artikel'} · Größe ${preselectSize} · ${preselectQty} Stück` : 'Spieler & Trainer wählen'}
            </h2>
            {isDistribute && (
              <p className="text-xs mt-1" style={{ color: 'var(--ink-mute)' }}>
                Wähle bis zu {preselectQty} Personen aus. Die Sammelposition wird in einzelne Zeilen aufgesplittet.
              </p>
            )}
          </div>
          <button onClick={onCancel} className="p-1 hover:bg-stone-100"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto flex-1">
          {!isDistribute && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Artikel">
                <select value={itemType} onChange={e => setItemType(e.target.value)} className="w-full border border-stone-300 px-3 py-2 text-sm">
                  {data.items.map(i => (
                    <option key={i.id} value={i.id}>
                      {i.articleNumber ? `[${i.articleNumber}] ` : ''}{i.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Größe">
                <select value={size} onChange={e => setSize(e.target.value)} className="w-full border border-stone-300 px-3 py-2 text-sm">
                  {['XS','S','M','L','XL','XXL','3XL'].map(s => <option key={s}>{s}</option>)}
                </select>
              </Field>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Mannschaft (Filter)">
              <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)} className="w-full border border-stone-300 px-3 py-2 text-sm">
                <option value="">– alle Mannschaften –</option>
                {(data.teams || []).map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Suche (Name oder Nummer)">
              <input value={search} onChange={e => setSearch(e.target.value)} className="w-full border border-stone-300 px-3 py-2 text-sm" placeholder="z.B. Müller oder 7" />
            </Field>
          </div>

          <div className="flex justify-between items-center text-xs">
            <div style={{ color: 'var(--ink-mute)' }}>
              {selectedCount} ausgewählt
              {isDistribute && preselectQty ? ` von ${preselectQty}` : ''}
              {limitReached && <span className="ml-2" style={{ color: 'var(--warn)' }}>· mehr als Sammelposition</span>}
            </div>
            <div className="flex gap-2">
              <button onClick={selectAllVisible} className="underline" style={{ color: 'var(--vereinsblau)' }}>Alle sichtbaren wählen</button>
              <button onClick={clearAll} className="underline" style={{ color: 'var(--vereinsblau)' }}>Auswahl leeren</button>
            </div>
          </div>

          {filteredPlayers.length > 0 && (
            <div>
              <div className="font-sub text-xs mb-2 mt-2" style={{ color: 'var(--ink-mute)', letterSpacing: '0.18em' }}>
                SPIELER ({filteredPlayers.length})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {filteredPlayers.sort((a, b) => (Number(a.number) || 999) - (Number(b.number) || 999)).map(p => (
                  <label key={p.id} className="flex items-center gap-2 p-2 cursor-pointer text-sm hover:bg-stone-50"
                    style={{ border: '1px solid', borderColor: selected[p.id] ? 'var(--vereinsblau)' : 'var(--rule)', background: selected[p.id] ? '#F1ECDF' : 'white' }}>
                    <input type="checkbox" checked={!!selected[p.id]} onChange={() => toggle(p.id, 'player')} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-base" style={{ color: 'var(--vereinsblau)', minWidth: '1.5rem' }}>{p.number || '–'}</span>
                        <span className="truncate">{p.firstName} {p.lastName}</span>
                      </div>
                      <div className="text-[10px]" style={{ color: 'var(--ink-mute)' }}>{p.team} · {p.size || '–'}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {filteredCoaches.length > 0 && (
            <div>
              <div className="font-sub text-xs mb-2 mt-2" style={{ color: 'var(--ink-mute)', letterSpacing: '0.18em' }}>
                TRAINER ({filteredCoaches.length})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {filteredCoaches.sort((a, b) => (a.lastName || '').localeCompare(b.lastName || '')).map(c => (
                  <label key={c.id} className="flex items-center gap-2 p-2 cursor-pointer text-sm hover:bg-stone-50"
                    style={{ border: '1px solid', borderColor: selected[c.id] ? 'var(--vereinsblau)' : 'var(--rule)', background: selected[c.id] ? '#F1ECDF' : 'white' }}>
                    <input type="checkbox" checked={!!selected[c.id]} onChange={() => toggle(c.id, 'coach')} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-1.5 py-0.5" style={{ background: 'var(--paper-dark)', color: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.12em', minWidth: '2rem', textAlign: 'center' }}>
                          {c.number || '–'}
                        </span>
                        <span className="truncate">{c.firstName} {c.lastName}</span>
                      </div>
                      <div className="text-[10px]" style={{ color: 'var(--ink-mute)' }}>{c.team} · {c.size || '–'}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {filteredPlayers.length === 0 && filteredCoaches.length === 0 && (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--ink-mute)' }}>Keine Personen für diese Auswahl.</p>
          )}
        </div>

        <div className="p-5 border-t border-stone-200 flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm border border-stone-300">Abbrechen</button>
          <button onClick={confirm} disabled={selectedCount === 0}
            className="px-5 py-2 text-sm uppercase text-white disabled:opacity-50"
            style={{ background: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
            {isDistribute ? `${selectedCount} Zeilen erzeugen` : `${selectedCount} Personen übernehmen`}
          </button>
        </div>
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

  // Gruppiert die Bestellzeilen nach Artikel × Größe und sammelt pro Gruppe
  // alle Beflockungen (Personen mit Nummer/Initialen und Flock-Name) sowie
  // unbedruckte Lagerware. Größen-Reihenfolge: XS, S, M, L, XL, XXL, dann numerisch.
  function buildFlockGroups() {
    const map = new Map();
    (order.lines || []).forEach(l => {
      const key = `${l.itemType}__${l.size}`;
      if (!map.has(key)) {
        const item = data.items.find(i => i.id === l.itemType);
        map.set(key, {
          itemType: l.itemType,
          itemName: item?.name || l.itemType,
          articleNumber: item?.articleNumber || '',
          size: l.size,
          totalQty: 0,
          flockEntries: [],   // [{ number, name, personKind, qty, personName, team }]
          plainQty: 0,        // Lagerware ohne Beflockung
        });
      }
      const g = map.get(key);
      g.totalQty += l.qty || 0;

      const hasFlock = (l.number && String(l.number).trim() !== '') || (l.name && String(l.name).trim() !== '');
      if (!hasFlock) {
        g.plainQty += l.qty || 0;
      } else {
        const person = findPerson(data, l.playerId);
        g.flockEntries.push({
          number: l.number || '',
          name: l.name || '',
          personKind: l.personKind || (person ? 'player' : null),
          qty: l.qty || 1,
          personName: person ? `${person.firstName} ${person.lastName}` : '',
          team: person?.team || order.team || '',
        });
      }
    });

    // Sortierung der Gruppen: Artikel alphabetisch, dann Größen-Reihenfolge
    const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '3XL', '116', '128', '140', '152', '164', '176', '188'];
    const sizeIdx = (s) => {
      const i = sizeOrder.indexOf(s);
      return i === -1 ? 999 : i;
    };

    // Beflockungen pro Gruppe sortieren: Spieler zuerst (nach Nummer), dann Trainer (nach Initialen)
    const groups = [...map.values()].map(g => ({
      ...g,
      flockEntries: g.flockEntries.sort((a, b) => {
        const aIsCoach = a.personKind === 'coach';
        const bIsCoach = b.personKind === 'coach';
        if (aIsCoach !== bIsCoach) return aIsCoach ? 1 : -1;
        if (aIsCoach) return String(a.number).localeCompare(String(b.number));
        return (Number(a.number) || 999) - (Number(b.number) || 999);
      }),
    }));

    groups.sort((a, b) => {
      if (a.itemName !== b.itemName) return a.itemName.localeCompare(b.itemName);
      return sizeIdx(a.size) - sizeIdx(b.size);
    });
    return groups;
  }

  function formatFlockEntry(e) {
    // Anzeige-Format auf reine Nummern/Initialen reduziert (Wunsch des Vorstands).
    // "x2 #5" wenn Mehrfachstück, "DH" für Trainer mit Initialen, "(T)" markiert Trainer.
    const isCoach = e.personKind === 'coach';
    const num = e.number ? (isCoach ? e.number : `#${e.number}`) : '–';
    const qtyPrefix = e.qty > 1 ? `${e.qty}× ` : '';
    const coachMark = isCoach ? ' (T)' : '';
    return `${qtyPrefix}${num}${coachMark}`.trim();
  }

  function exportFlockList() {
    const sponsors = order.sponsors || {};
    const rows = [['Art.-Nr.', 'Artikel', 'Größe', 'Menge gesamt', 'Lagerware', 'Beflockungen', 'Sponsor Brust', 'Sponsor Rücken', 'Sponsor Ärmel']];
    buildFlockGroups().forEach(g => {
      const flockText = g.flockEntries.map(formatFlockEntry).join(' · ');
      rows.push([
        g.articleNumber || '',
        g.itemName,
        g.size,
        g.totalQty,
        g.plainQty || '',
        flockText,
        sponsors.brust || '',
        sponsors.ruecken || '',
        sponsors.aermel || '',
      ]);
    });
    downloadCSV(rows, `flockliste_${order.title.replace(/\s+/g, '_')}.csv`);
  }

  function exportOrderList() {
    const rows = [['Art.-Nr.', 'Artikel', 'Größe', 'Menge']];
    let total = 0;
    buildFlockGroups().forEach(g => {
      rows.push([g.articleNumber || '', g.itemName, g.size, g.totalQty]);
      total += g.totalQty;
    });
    rows.push(['', 'GESAMT', '', total]);
    downloadCSV(rows, `bestellliste_${order.title.replace(/\s+/g, '_')}.csv`);
  }

  function exportPDF() {
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      // jspdf-autotable installiert sich beim Import auf den jsPDF-Prototyp.
      // Wir nutzen die Instanz-Methode doc.autoTable(...) — das ist die zuverlässigste API.
      if (typeof doc.autoTable !== 'function') {
        throw new Error('jspdf-autotable ist nicht korrekt geladen.');
      }

      const W = doc.internal.pageSize.getWidth();
      const sponsors = order.sponsors || {};
      const settings = data.settings || {};

      // Kopfblock mit Vereinsblau
      doc.setFillColor(11, 45, 92);
      doc.rect(0, 0, W, 30, 'F');
      doc.setTextColor(201, 162, 39);
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
      const articleSupplier = (data.suppliers || []).find(s => s.id === order.articleSupplierId);
      const flockSupplier = (data.suppliers || []).find(s => s.id === order.flockSupplierId);
      const flockByLabel = order.flockBy === 'haus' ? 'Im Haus'
        : order.flockBy === 'lieferant' ? `Lieferant: ${articleSupplier?.name || '-'}`
        : order.flockBy === 'extern' ? `Extern: ${flockSupplier?.name || '-'}`
        : '-';

      doc.setTextColor(26, 26, 26);
      doc.setFontSize(9);
      doc.text(`Erstellt: ${new Date(order.createdAt).toLocaleDateString('de-DE')}`, 14, y);
      doc.text(`Status: ${order.status}`, 14, y + 5);
      if (order.team) doc.text(`Mannschaft: ${order.team}`, 14, y + 10);
      if (articleSupplier) doc.text(`Artikel-Lieferant: ${articleSupplier.name}`, W - 14, y, { align: 'right' });
      doc.text(`Beflockung: ${flockByLabel}`, W - 14, y + 5, { align: 'right' });
      doc.text(`${order.lines.reduce((s, l) => s + l.qty, 0)} Teile gesamt`, W - 14, y + 10, { align: 'right' });
      y += 22;

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
          { k: 'ruecken', l: 'RUECKEN' },
          { k: 'aermel', l: 'AERMEL' },
        ];
        labels.forEach((s, i) => {
          const x = 18 + i * colW;
          doc.setFontSize(7);
          doc.setTextColor(128, 125, 120);
          doc.text(s.l, x, y + 11);
          doc.setFontSize(11);
          doc.setTextColor(26, 26, 26);
          doc.text(sponsors[s.k] || '-', x, y + 17);
        });
        y += 26;
      }

      // Aggregierte Bestellliste + Flock-Liste teilen sich die Gruppierung
      const groups = buildFlockGroups();
      const totalAll = groups.reduce((s, g) => s + g.totalQty, 0);

      doc.autoTable({
        startY: y,
        head: [['BESTELLLISTE FUER LIEFERANTEN', '', '', '']],
        body: [],
        theme: 'plain',
        headStyles: { fillColor: [11, 45, 92], textColor: [255, 255, 255], fontSize: 9, halign: 'left' },
        margin: { left: 14, right: 14 },
      });
      doc.autoTable({
        startY: doc.lastAutoTable.finalY,
        head: [['Art.-Nr.', 'Artikel', 'Groesse', 'Menge']],
        body: [
          ...groups.map(g => [g.articleNumber || '-', g.itemName, g.size, String(g.totalQty)]),
          ['', 'GESAMT', '', String(totalAll)],
        ],
        headStyles: { fillColor: [241, 236, 223], textColor: [11, 45, 92], fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 9 },
        alternateRowStyles: { fillColor: [252, 250, 246] },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 28 },
          2: { halign: 'center', cellWidth: 18 },
          3: { halign: 'right', cellWidth: 18 },
        },
        // Letzte Zeile (Gesamt) hervorheben
        didParseCell: (hookData) => {
          if (hookData.section === 'body' && hookData.row.index === groups.length) {
            hookData.cell.styles.fontStyle = 'bold';
            hookData.cell.styles.fillColor = [11, 45, 92];
            hookData.cell.styles.textColor = [255, 255, 255];
          }
        },
        margin: { left: 14, right: 14 },
      });

      // Flock-Liste — gruppiert nach Artikel × Größe, alle Beflockungen je Gruppe in einer Zelle
      doc.autoTable({
        startY: doc.lastAutoTable.finalY + 8,
        head: [['FLOCK-LISTE FUER DEN AUSRUESTER (gruppiert nach Artikel & Groesse)', '', '', '', '', '']],
        body: [],
        theme: 'plain',
        headStyles: { fillColor: [11, 45, 92], textColor: [255, 255, 255], fontSize: 9, halign: 'left' },
        margin: { left: 14, right: 14 },
      });

      // Pro Gruppe eine Zeile, mit Beflockungen mehrzeilig (jede Person in einer Zeile)
      const flockBody = groups.map(g => {
        const flockLines = g.flockEntries.map(e => formatFlockEntry(e));
        if (g.plainQty > 0) {
          flockLines.push(`(${g.plainQty}x ohne Beflockung / Lagerware)`);
        }
        return [
          g.articleNumber || '-',
          g.itemName,
          g.size,
          String(g.totalQty),
          flockLines.length > 0 ? flockLines.join('\n') : '—',
        ];
      });

      doc.autoTable({
        startY: doc.lastAutoTable.finalY,
        head: [['Art.-Nr.', 'Artikel', 'Gr.', 'Mge', 'Beflockungen (Nr./Init. + Name)']],
        body: flockBody,
        headStyles: { fillColor: [241, 236, 223], textColor: [11, 45, 92], fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 9, valign: 'top' },
        alternateRowStyles: { fillColor: [252, 250, 246] },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 22 },
          2: { halign: 'center', cellWidth: 12 },
          3: { halign: 'right', cellWidth: 12 },
          4: { fontStyle: 'normal' },
        },
        margin: { left: 14, right: 14 },
        didDrawPage: () => {
          const pageHeight = doc.internal.pageSize.getHeight();
          doc.setFontSize(8);
          doc.setTextColor(128, 125, 120);
          doc.text(`Seite ${doc.internal.getNumberOfPages()}`, W - 14, pageHeight - 8, { align: 'right' });
          doc.text(`${settings.clubName || 'F. C. Frohlinde'} · #DeinDorfverein`, 14, pageHeight - 8);
        },
      });

      const safeName = (order.title || 'bestellung').replace(/[^\w\-]+/g, '_');
      doc.save(`bestellung_${safeName}.pdf`);
    } catch (e) {
      console.error('PDF-Export fehlgeschlagen:', e);
      alert(`PDF konnte nicht erstellt werden: ${e.message}\n\nBitte den Fehler an den Vorstand melden oder die CSV-Exporte nutzen.`);
    }
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
            {(() => {
              const articleSupplier = (data.suppliers || []).find(s => s.id === order.articleSupplierId);
              const flockSupplier = (data.suppliers || []).find(s => s.id === order.flockSupplierId);
              const flockLabel = order.flockBy === 'haus' ? 'Im Haus'
                : order.flockBy === 'lieferant' ? `durch ${articleSupplier?.name || 'Artikel-Lieferanten'}`
                : order.flockBy === 'extern' ? (flockSupplier?.name || 'externer Beflocker')
                : null;
              return (
                <div className="text-xs mt-2 flex flex-wrap gap-x-4 gap-y-1" style={{ color: 'var(--ink-mute)' }}>
                  {articleSupplier && <span>Artikel-Lieferant: <strong style={{ color: 'var(--ink-soft)' }}>{articleSupplier.name}</strong></span>}
                  {flockLabel && <span>Beflockung: <strong style={{ color: 'var(--ink-soft)' }}>{flockLabel}</strong></span>}
                  {order.fromReports?.length > 0 && <span style={{ color: 'var(--vereinsblau)' }}>· aus {order.fromReports.length} Bedarfsmeldung(en)</span>}
                </div>
              );
            })()}
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
          <h2 className="font-display text-xl">BESTELLLISTE FÜR LIEFERANTEN</h2>
          <p className="text-xs text-stone-500 mt-1">Aggregiert nach Artikel und Größe — die reine Stückzahl, die der Lieferant produziert.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wider text-stone-500">
              <tr>
                <th className="text-left p-3">Art.-Nr.</th>
                <th className="text-left p-3">Artikel</th>
                <th className="text-left p-3">Größe</th>
                <th className="text-right p-3">Menge</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const groups = buildFlockGroups();
                const total = groups.reduce((s, g) => s + g.totalQty, 0);
                return [
                  ...groups.map(g => (
                    <tr key={`bl_${g.itemType}_${g.size}`} className="border-t border-stone-100">
                      <td className="p-3 font-mono text-xs" style={{ color: 'var(--ink-soft)' }}>{g.articleNumber || '–'}</td>
                      <td className="p-3">{g.itemName}</td>
                      <td className="p-3">{g.size}</td>
                      <td className="p-3 text-right font-medium">{g.totalQty}</td>
                    </tr>
                  )),
                  <tr key="bl_total" style={{ background: 'var(--vereinsblau)', color: 'white' }}>
                    <td className="p-3" colSpan={2}><strong>GESAMT</strong></td>
                    <td className="p-3"></td>
                    <td className="p-3 text-right font-medium">{total}</td>
                  </tr>,
                ];
              })()}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-stone-200 overflow-hidden mb-4">
        <div className="p-4 border-b border-stone-200 bg-stone-50">
          <h2 className="font-display text-xl">FLOCK-LISTE FÜR DEN AUSRÜSTER</h2>
          <p className="text-xs text-stone-500 mt-1">Gruppiert nach Artikel × Größe. Pro Gruppe sind alle Beflockungen aufgelistet — eine Zeile pro Person mit Nummer/Initialen und Flock-Name. Sponsoren oben gelten für alle Teile.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wider text-stone-500">
              <tr>
                <th className="text-left p-3">Art.-Nr.</th>
                <th className="text-left p-3">Artikel</th>
                <th className="text-left p-3">Größe</th>
                <th className="text-right p-3">Menge</th>
                <th className="text-left p-3">Beflockungen</th>
              </tr>
            </thead>
            <tbody>
              {buildFlockGroups().map(g => (
                <tr key={`fl_${g.itemType}_${g.size}`} className="border-t border-stone-100" style={{ verticalAlign: 'top' }}>
                  <td className="p-3 font-mono text-xs" style={{ color: 'var(--ink-soft)' }}>{g.articleNumber || '–'}</td>
                  <td className="p-3 font-medium">{g.itemName}</td>
                  <td className="p-3">{g.size}</td>
                  <td className="p-3 text-right font-medium">{g.totalQty}</td>
                  <td className="p-3">
                    {g.flockEntries.length === 0 && g.plainQty === g.totalQty ? (
                      <span className="text-stone-400 text-xs">— ohne Beflockung (Lagerware) —</span>
                    ) : (
                      <div className="space-y-1">
                        {g.flockEntries.map((e, i) => {
                          const isCoach = e.personKind === 'coach';
                          return (
                            <div key={i} className="flex items-baseline gap-2">
                              {e.qty > 1 && (
                                <span className="text-xs px-1.5 py-0.5" style={{ background: 'var(--paper-dark)', color: 'var(--ink-soft)' }}>{e.qty}×</span>
                              )}
                              <span className={isCoach ? 'font-sub text-base' : 'font-display text-lg'}
                                style={isCoach
                                  ? { fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.05em', color: 'var(--vereinsblau)', minWidth: '2.5rem', display: 'inline-block' }
                                  : { color: 'var(--vereinsblau)', minWidth: '2.5rem', display: 'inline-block' }
                                }>
                                {e.number ? (isCoach ? e.number : `#${e.number}`) : '–'}
                              </span>
                              {isCoach && (
                                <span className="text-[10px] px-1 py-0.5" style={{ background: 'var(--paper-dark)', color: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.12em' }}>TRAINER</span>
                              )}
                            </div>
                          );
                        })}
                        {g.plainQty > 0 && (
                          <div className="text-xs italic pt-1" style={{ color: 'var(--ink-mute)' }}>
                            + {g.plainQty}× ohne Beflockung (Lagerware)
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============ EINSTELLUNGEN ============

// Migrations-Helper: Wandelt alte standardSetPlayer/-Coach in die neue Liste um
function migrateStandardSets(rawSettings) {
  const existing = Array.isArray(rawSettings?.standardSets) ? rawSettings.standardSets : null;
  if (existing) return existing;

  const migrated = [];
  if (Array.isArray(rawSettings?.standardSetPlayer) && rawSettings.standardSetPlayer.length > 0) {
    migrated.push({
      id: `set_player_default`,
      name: 'Spieler-Set (Erstausstattung)',
      target: 'player',
      items: rawSettings.standardSetPlayer,
    });
  }
  if (Array.isArray(rawSettings?.standardSetCoach) && rawSettings.standardSetCoach.length > 0) {
    migrated.push({
      id: `set_coach_default`,
      name: 'Trainer-Set (Erstausstattung)',
      target: 'coach',
      items: rawSettings.standardSetCoach,
    });
  }
  return migrated;
}

function SettingsView({ data, update }) {
  const [settings, setSettings] = useState({
    defaultDeposit: 100,
    clubName: 'FC Frohlinde 1949 e.V.',
    depositMode: 'pauschal',
    seasonDepreciation: DEFAULT_SEASON_DEPRECIATION,
    conditionFactors: DEFAULT_CONDITION_FACTORS,
    weeklyReportEnabled: false,
    weeklyReportEmail: '',
    weeklyReportFrom: '',
    standardSets: [],
    teamDepositRules: {},
    ...(data.settings || {}),
    // conditionFactors absichern: jedes Feld muss label und factor haben
    conditionFactors: Object.fromEntries(
      Object.entries({ ...DEFAULT_CONDITION_FACTORS, ...(data.settings?.conditionFactors || {}) })
        .map(([k, v]) => [k, {
          label: typeof v?.label === 'string' ? v.label : (DEFAULT_CONDITION_FACTORS[k]?.label || k),
          factor: typeof v?.factor === 'number' ? v.factor : (DEFAULT_CONDITION_FACTORS[k]?.factor ?? 0),
        }])
    ),
    // Standard-Sets: neue Liste mit Migration aus den alten beiden Feldern
    standardSets: migrateStandardSets(data.settings),
  });
  const [items, setItems] = useState(Array.isArray(data.items) ? data.items : []);
  const [newTeam, setNewTeam] = useState('');
  const [renamingTeam, setRenamingTeam] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [showItemImport, setShowItemImport] = useState(false);

  function saveSettings() {
    // Beim Speichern entfernen wir die alten Felder, falls vorhanden — die neue
    // standardSets-Liste ist die Single Source of Truth.
    const { standardSetPlayer, standardSetCoach, ...cleanSettings } = settings;
    update('settings', cleanSettings);
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

  function updateTeamDepositRule(team, patch) {
    const current = settings.teamDepositRules || {};
    setSettings({
      ...settings,
      teamDepositRules: {
        ...current,
        [team]: { ...(current[team] || {}), ...patch },
      },
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

      <SuppliersBlock data={data} update={update} />

      <div className="bg-white border border-stone-200 p-6 mb-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-display text-2xl">ARTIKELKATALOG</h2>
          <div className="flex gap-2">
            <button onClick={() => setShowItemImport(true)} className="text-xs px-3 py-1.5 flex items-center gap-1"
              style={{ background: 'var(--paper-dark)', color: 'var(--ink)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.12em' }}>
              <Download size={12} style={{ transform: 'rotate(180deg)' }} /> CSV importieren
            </button>
            <button onClick={addItem} className="text-xs bg-stone-100 px-3 py-1.5 flex items-center gap-1"><Plus size={12} /> Artikel</button>
          </div>
        </div>
        <p className="text-xs text-stone-500 mb-3">
          Neupreis wird im Saison-Modell zur Zeitwertberechnung genutzt. Ersatzwert ist der Festbetrag, der im Pauschal-Modus (FCF-Pfandordnung) bei beschädigten oder verlorenen Teilen vom Pfand abgezogen wird. Artikelnummer dient zur Identifikation beim Re-Import.
        </p>

        {showItemImport && (
          <CatalogImport
            existingItems={items}
            suppliers={data.suppliers || []}
            onImport={(mergedItems) => {
              // CatalogImport liefert die fertige Liste — direkt übernehmen
              setItems(mergedItems);
              setShowItemImport(false);
            }}
            onCancel={() => setShowItemImport(false)}
          />
        )}

        <div className="grid grid-cols-12 gap-2 text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--ink-mute)' }}>
          <div className="col-span-2">Art.-Nr.</div>
          <div className="col-span-3">Artikel</div>
          <div className="col-span-3">Lieferant</div>
          <div className="col-span-2 text-right">Preis €</div>
          <div className="col-span-1 text-right">Ersatz €</div>
          <div className="col-span-1"></div>
        </div>
        <div className="space-y-2">
          {items.map((it, idx) => (
            <div key={it.id} className="grid grid-cols-12 gap-2 items-center">
              <input className="col-span-2 border border-stone-300 px-2 py-2 text-sm font-mono" value={it.articleNumber || ''}
                placeholder="z.B. T-12345"
                onChange={e => setItems(items.map((i, ix) => ix === idx ? { ...i, articleNumber: e.target.value } : i))} />
              <input className="col-span-3 border border-stone-300 px-3 py-2 text-sm" value={it.name}
                onChange={e => setItems(items.map((i, ix) => ix === idx ? { ...i, name: e.target.value } : i))} />
              <select className="col-span-3 border border-stone-300 px-2 py-2 text-sm" value={it.supplierId || ''}
                onChange={e => setItems(items.map((i, ix) => ix === idx ? { ...i, supplierId: e.target.value || null } : i))}>
                <option value="">– kein Lieferant –</option>
                {(data.suppliers || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input type="number" step="0.01" className="col-span-2 border border-stone-300 px-2 py-2 text-sm text-right"
                value={Number.isFinite(it.price) ? it.price : 0}
                onChange={e => setItems(items.map((i, ix) => ix === idx ? { ...i, price: parseFloat(e.target.value) || 0 } : i))} />
              <input type="number" step="0.01" className="col-span-1 border border-stone-300 px-2 py-2 text-sm text-right"
                value={Number.isFinite(it.replacementValue) ? it.replacementValue : ''}
                placeholder="–"
                onChange={e => setItems(items.map((i, ix) => ix === idx ? { ...i, replacementValue: e.target.value === '' ? null : (parseFloat(e.target.value) || 0) } : i))} />
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

        {data.teams.length > 0 && (
          <div className="mb-5 p-4" style={{ background: 'var(--paper)', border: '1px solid var(--rule)' }}>
            <div className="font-sub text-xs mb-2" style={{ color: 'var(--vereinsblau)', letterSpacing: '0.18em' }}>JE MANNSCHAFT</div>
            <p className="text-xs text-stone-500 mb-3">Standard ist immer Pauschal. Pro Mannschaft kann davon auf Saison-Abschreibung oder ohne Pfand abgewichen werden.</p>
            <div className="space-y-2">
              {data.teams.map(teamName => {
                const rule = (settings.teamDepositRules || {})[teamName] || {};
                const teamMode = rule.depositMode || 'pauschal';
                return (
                  <div key={teamName} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-12 sm:col-span-4 text-sm font-medium">{teamName}</div>
                    <select
                      className="col-span-7 sm:col-span-5 border border-stone-300 px-2 py-2 text-sm"
                      value={teamMode}
                      onChange={e => updateTeamDepositRule(teamName, { depositMode: e.target.value })}
                    >
                      <option value="pauschal">Pauschal</option>
                      <option value="saison">Saison-Abschreibung</option>
                      <option value="ohne_pfand">Ohne Pfand</option>
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      disabled={teamMode === 'ohne_pfand'}
                      className="col-span-5 sm:col-span-3 border border-stone-300 px-2 py-2 text-sm text-right disabled:opacity-60"
                      value={teamMode === 'ohne_pfand' ? 0 : (Number.isFinite(rule.defaultDeposit) ? rule.defaultDeposit : '')}
                      placeholder={teamMode === 'ohne_pfand' ? '0 €' : `${settings.defaultDeposit ?? DEFAULT_DEPOSIT_AMOUNT} €`}
                      onChange={e => updateTeamDepositRule(teamName, {
                        defaultDeposit: e.target.value === '' ? undefined : (parseFloat(e.target.value) || 0),
                      })}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
          <label className="flex items-start gap-3 p-4 cursor-pointer"
            style={{ border: (settings.depositMode === 'pauschal' || !settings.depositMode) ? '2px solid var(--vereinsblau)' : '1px solid var(--rule)', background: (settings.depositMode === 'pauschal' || !settings.depositMode) ? '#F1ECDF' : 'white' }}>
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

      <SuppliersBlock data={data} update={update} />

      <div className="bg-white border border-stone-200 p-6 mb-4">
        <h2 className="font-display text-2xl mb-2">STANDARD-SETS (ERSTAUSSTATTUNG)</h2>
        <p className="text-xs text-stone-500 mb-4">
          Lege beliebig viele Sets an — etwa „Erstausstattung Senioren", „Trainer-Set 1. Mannschaft" oder „Jugend-Basis". Pro Set wählst du, ob es für Spieler, Trainer oder beide gilt. In der Bestellung erscheint ein Auswahlmenü mit allen passenden Sets, das nur Personen ohne diese Ausstattung berücksichtigt.
        </p>

        <StandardSetsManager
          items={items}
          sets={settings.standardSets || []}
          onChange={(newSets) => setSettings({ ...settings, standardSets: newSets })}
        />
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

// Editor für Standard-Sets (Spieler/Trainer-Erstausstattung)
// Manager für die Liste der Standard-Sets — anlegen / umbenennen / Ziel ändern / löschen.
// Pro Set öffnet sich darunter ein Editor mit Artikeln und Stückzahlen.
function StandardSetsManager({ items, sets, onChange }) {
  const validItems = (items || []).filter(i => i && i.id && i.name);
  const [openSetId, setOpenSetId] = useState(null);

  function addSet() {
    const id = `set_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const newSet = { id, name: 'Neues Set', target: 'player', items: [] };
    onChange([...sets, newSet]);
    setOpenSetId(id);
  }

  function updateSet(id, updates) {
    onChange(sets.map(s => s.id === id ? { ...s, ...updates } : s));
  }

  function removeSet(id) {
    const set = sets.find(s => s.id === id);
    if (!set) return;
    if (!confirm(`Set „${set.name}" wirklich löschen?`)) return;
    onChange(sets.filter(s => s.id !== id));
    if (openSetId === id) setOpenSetId(null);
  }

  function duplicateSet(id) {
    const original = sets.find(s => s.id === id);
    if (!original) return;
    const newId = `set_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const copy = { ...original, id: newId, name: `${original.name} (Kopie)` };
    onChange([...sets, copy]);
    setOpenSetId(newId);
  }

  function targetLabel(target) {
    if (target === 'player') return 'Nur Spieler';
    if (target === 'coach') return 'Nur Trainer';
    return 'Spieler + Trainer';
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={addSet} className="text-xs px-3 py-1.5 flex items-center gap-1 text-white"
          style={{ background: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.12em' }}>
          <Plus size={12} /> Neues Set
        </button>
      </div>

      {sets.length === 0 ? (
        <div className="text-xs py-4 px-3" style={{ background: 'var(--paper-dark)', color: 'var(--ink-mute)' }}>
          Noch keine Sets angelegt. Klicke auf „Neues Set", um deine erste Erstausstattung zu definieren.
        </div>
      ) : (
        <div className="space-y-2">
          {sets.map(set => {
            const totalPieces = (set.items || []).reduce((s, r) => s + (Number(r.qty) || 0), 0);
            const isOpen = openSetId === set.id;
            return (
              <div key={set.id} className="border border-stone-200">
                <div className="flex items-center justify-between p-3" style={{ background: isOpen ? 'var(--paper)' : 'white' }}>
                  <button
                    onClick={() => setOpenSetId(isOpen ? null : set.id)}
                    className="flex-1 text-left flex items-center gap-3"
                  >
                    <span className="text-xs" style={{ color: 'var(--vereinsblau)' }}>{isOpen ? '▾' : '▸'}</span>
                    <div>
                      <div className="font-medium">{set.name}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--ink-mute)' }}>
                        {targetLabel(set.target)} · {(set.items || []).length} Artikel · {totalPieces} Teile
                      </div>
                    </div>
                  </button>
                  <div className="flex gap-2">
                    <button onClick={() => duplicateSet(set.id)} className="text-xs underline" style={{ color: 'var(--vereinsblau)' }} title="Kopieren">
                      Kopieren
                    </button>
                    <button onClick={() => removeSet(set.id)} className="text-stone-400 hover:text-red-600 p-1" title="Löschen">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="p-4 border-t border-stone-200" style={{ background: 'var(--paper)' }}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                      <Field label="Set-Name">
                        <input
                          className="w-full border border-stone-300 px-3 py-2 text-sm"
                          value={set.name}
                          onChange={e => updateSet(set.id, { name: e.target.value })}
                          placeholder="z.B. Erstausstattung Senioren"
                        />
                      </Field>
                      <Field label="Gilt für">
                        <select
                          className="w-full border border-stone-300 px-3 py-2 text-sm"
                          value={set.target}
                          onChange={e => updateSet(set.id, { target: e.target.value })}
                        >
                          <option value="player">Nur Spieler</option>
                          <option value="coach">Nur Trainer</option>
                          <option value="both">Spieler und Trainer</option>
                        </select>
                      </Field>
                    </div>

                    <SetItemsEditor
                      items={set.items || []}
                      catalog={validItems}
                      onChange={(newItems) => updateSet(set.id, { items: newItems })}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Innerer Editor: Artikel-Zeilen eines einzelnen Sets
function SetItemsEditor({ items, catalog, onChange }) {
  function addRow() {
    if (catalog.length === 0) {
      alert('Bitte zuerst Artikel im Katalog anlegen.');
      return;
    }
    const used = new Set(items.map(s => s.itemId));
    const available = catalog.find(i => !used.has(i.id)) || catalog[0];
    onChange([...items, { itemId: available.id, qty: 1 }]);
  }

  function updateRow(idx, key, value) {
    onChange(items.map((row, i) => i === idx ? { ...row, [key]: value } : row));
  }

  function removeRow(idx) {
    onChange(items.filter((_, i) => i !== idx));
  }

  const totalPieces = items.reduce((s, r) => s + (Number(r.qty) || 0), 0);

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <div className="font-sub text-xs" style={{ color: 'var(--vereinsblau)', letterSpacing: '0.18em' }}>ARTIKEL</div>
        <button onClick={addRow} className="text-xs bg-stone-100 px-3 py-1.5 flex items-center gap-1">
          <Plus size={12} /> Artikel
        </button>
      </div>

      {items.length === 0 ? (
        <div className="text-xs py-3 px-3" style={{ background: 'white', color: 'var(--ink-mute)' }}>
          Noch keine Artikel im Set. Klicke auf „Artikel", um den ersten Eintrag hinzuzufügen.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-12 gap-2 text-xs uppercase tracking-wider" style={{ color: 'var(--ink-mute)' }}>
            <div className="col-span-8">Artikel</div>
            <div className="col-span-3 text-right">Stückzahl</div>
          </div>
          {items.map((row, idx) => {
            const item = catalog.find(i => i.id === row.itemId);
            return (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <select
                  className="col-span-8 border border-stone-300 px-3 py-2 text-sm"
                  value={row.itemId}
                  onChange={e => updateRow(idx, 'itemId', e.target.value)}
                >
                  {!item && <option value={row.itemId}>— unbekannter Artikel —</option>}
                  {catalog.map(i => (
                    <option key={i.id} value={i.id}>
                      {i.articleNumber ? `[${i.articleNumber}] ` : ''}{i.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  className="col-span-3 border border-stone-300 px-2 py-2 text-sm text-right"
                  value={row.qty}
                  onChange={e => updateRow(idx, 'qty', parseInt(e.target.value) || 1)}
                />
                <button onClick={() => removeRow(idx)} className="col-span-1 text-stone-400 hover:text-red-600 p-1 justify-self-end">
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
          <div className="text-xs pt-2" style={{ color: 'var(--ink-mute)' }}>
            Summe: {totalPieces} Teile pro Person
          </div>
        </div>
      )}
    </div>
  );
}

// Lieferanten-Verwaltung (Artikel + Flock getrennt)
function SuppliersBlock({ data, update }) {
  const suppliers = data.suppliers || [];
  const [editing, setEditing] = useState(null); // { id?, name, type, contact, notes } | null

  function save(s) {
    if (!s.name?.trim()) { alert('Name fehlt'); return; }
    if (s.id) {
      update('suppliers', suppliers.map(x => x.id === s.id ? s : x));
    } else {
      update('suppliers', [...suppliers, { ...s, id: `sup_${Date.now()}` }]);
    }
    setEditing(null);
  }
  function remove(id) {
    if (!confirm('Lieferant löschen? Bestehende Bestellungen behalten den Namen, verlieren aber die Verknüpfung.')) return;
    update('suppliers', suppliers.filter(x => x.id !== id));
  }

  const TYPE_LABELS = { artikel: 'Artikel', flock: 'Flock', beides: 'Artikel & Flock' };

  return (
    <div className="bg-white border border-stone-200 p-6 mb-4">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="font-display text-2xl">LIEFERANTEN</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--ink-mute)' }}>
            Lieferanten für Artikel und/oder Beflockung. In Bestellungen kann jeweils einer ausgewählt werden.
          </p>
        </div>
        <button onClick={() => setEditing({ name: '', type: 'artikel', contact: '', notes: '' })}
          className="px-4 py-2 text-xs uppercase flex items-center gap-2"
          style={{ background: 'var(--vereinsblau)', color: 'white', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
          <Plus size={12} /> Lieferant
        </button>
      </div>

      {editing && (
        <div className="p-4 mb-4" style={{ background: 'var(--paper-dark)', border: '1px solid var(--vereinsblau)' }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <Field label="Name">
              <input className="w-full border border-stone-300 px-3 py-2 text-sm" value={editing.name}
                onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="z. B. Teamsport Müller" />
            </Field>
            <Field label="Typ">
              <select className="w-full border border-stone-300 px-3 py-2 text-sm" value={editing.type}
                onChange={e => setEditing({ ...editing, type: e.target.value })}>
                <option value="artikel">Artikel</option>
                <option value="flock">Flock</option>
                <option value="beides">Artikel & Flock</option>
              </select>
            </Field>
            <Field label="Kontakt (E-Mail / Telefon)">
              <input className="w-full border border-stone-300 px-3 py-2 text-sm" value={editing.contact}
                onChange={e => setEditing({ ...editing, contact: e.target.value })} placeholder="z. B. info@example.de" />
            </Field>
            <Field label="Notiz">
              <input className="w-full border border-stone-300 px-3 py-2 text-sm" value={editing.notes}
                onChange={e => setEditing({ ...editing, notes: e.target.value })} placeholder="z. B. Kundennummer 12345" />
            </Field>
          </div>
          <div className="flex gap-2">
            <button onClick={() => save(editing)} className="px-4 py-2 text-xs uppercase text-white"
              style={{ background: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>Speichern</button>
            <button onClick={() => setEditing(null)} className="px-4 py-2 text-xs uppercase"
              style={{ border: '1px solid var(--rule)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>Abbrechen</button>
          </div>
        </div>
      )}

      {suppliers.length === 0 && !editing && (
        <p className="text-sm py-4" style={{ color: 'var(--ink-mute)' }}>Noch keine Lieferanten angelegt.</p>
      )}

      {suppliers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider" style={{ color: 'var(--ink-mute)' }}>
              <tr style={{ borderBottom: '1px solid var(--rule)' }}>
                <th className="text-left p-2">Name</th>
                <th className="text-left p-2">Typ</th>
                <th className="text-left p-2 hidden md:table-cell">Kontakt</th>
                <th className="text-left p-2 hidden lg:table-cell">Notiz</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map(s => (
                <tr key={s.id} style={{ borderBottom: '1px solid var(--rule-soft, #EFEAE0)' }}>
                  <td className="p-2 font-medium">{s.name}</td>
                  <td className="p-2 text-xs">{TYPE_LABELS[s.type] || s.type}</td>
                  <td className="p-2 hidden md:table-cell text-xs" style={{ color: 'var(--ink-soft)' }}>{s.contact || '–'}</td>
                  <td className="p-2 hidden lg:table-cell text-xs" style={{ color: 'var(--ink-soft)' }}>{s.notes || '–'}</td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(s)} className="p-1" style={{ color: 'var(--ink-mute)' }}><Edit2 size={14} /></button>
                    <button onClick={() => remove(s.id)} className="p-1" style={{ color: 'var(--ink-mute)' }}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
function UsersView({ data }) {
  const { authFetch, user: currentUser, refreshUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    username: '', password: '', name: '', role: 'user', teams: [],
    permissions: { ...DEFAULT_USER_PERMISSIONS },
  });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [error, setError] = useState('');

  const allTeams = (data?.teams) || [];

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const r = await authFetch('/api/auth/users');
      const d = await r.json();
      setUsers(d);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function add() {
    setError('');
    if (!form.username || form.password.length < 8) {
      setError('Benutzername und Passwort (mind. 8 Zeichen) sind Pflicht.');
      return;
    }
    try {
      const r = await authFetch('/api/auth/users', { method: 'POST', body: JSON.stringify(form) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setForm({
        username: '', password: '', name: '', role: 'user', teams: [],
        permissions: { ...DEFAULT_USER_PERMISSIONS },
      });
      setShowForm(false);
      load();
    } catch (e) { setError(e.message); }
  }

  async function remove(username) {
    if (!confirm(`Nutzer "${username}" wirklich löschen?`)) return;
    setError('');
    try {
      const r = await authFetch('/api/auth/users', { method: 'DELETE', body: JSON.stringify({ username }) });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
      load();
    } catch (e) { setError(e.message); }
  }

  function startEdit(u) {
    setEditingId(u.id);
    setEditForm({
      username: u.username,
      name: u.name || '',
      role: u.role,
      teams: Array.isArray(u.teams) ? [...u.teams] : [],
      permissions: { ...DEFAULT_USER_PERMISSIONS, ...(u.permissions || {}) },
      password: '',
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
  }

  async function saveEdit() {
    setError('');
    if (!editForm) return;
    if (editForm.password && editForm.password.length < 8) {
      setError('Passwort muss mindestens 8 Zeichen haben.');
      return;
    }
    try {
      const payload = {
        username: editForm.username,
        name: editForm.name,
        role: editForm.role,
        teams: editForm.role === 'admin' ? [] : editForm.teams,
        permissions: editForm.role === 'admin' ? null : editForm.permissions,
      };
      if (editForm.password) payload.password = editForm.password;
      const r = await authFetch('/api/auth/users', { method: 'PUT', body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);

      // Wenn der eingeloggte Nutzer sich selbst bearbeitet hat,
      // muss der lokale Auth-State neu geladen werden.
      if (editForm.username === currentUser?.username && refreshUser) {
        await refreshUser();
      }

      cancelEdit();
      load();
    } catch (e) { setError(e.message); }
  }

  function toggleFormTeam(team) {
    setForm(f => ({
      ...f,
      teams: f.teams.includes(team) ? f.teams.filter(t => t !== team) : [...f.teams, team],
    }));
  }
  function toggleEditTeam(team) {
    setEditForm(f => ({
      ...f,
      teams: f.teams.includes(team) ? f.teams.filter(t => t !== team) : [...f.teams, team],
    }));
  }
  function toggleFormPerm(key) {
    setForm(f => ({ ...f, permissions: { ...f.permissions, [key]: !f.permissions[key] } }));
  }
  function toggleEditPerm(key) {
    setEditForm(f => ({ ...f, permissions: { ...f.permissions, [key]: !f.permissions[key] } }));
  }

  function teamSummary(u) {
    if (u.role === 'admin') return 'alle (Admin)';
    if (!u.teams || u.teams.length === 0) return '— keine zugeordnet —';
    if (u.teams.length === allTeams.length && allTeams.length > 0) return 'alle Mannschaften';
    return u.teams.join(' · ');
  }

  // Permission-Labels für die UI
  const PERMISSION_LABELS = [
    { key: 'canDeletePeople',   label: 'Spieler/Trainer löschen', desc: 'Endgültiges Entfernen aus dem Kader' },
    { key: 'canCreateOrders',   label: 'Bestellungen anlegen',     desc: 'Neue Bestellungen, Sammelbestellungen, Status ändern' },
    { key: 'canEditInventory',  label: 'Material verwalten',       desc: 'Einbuchen, ausgeben, zurücknehmen' },
    { key: 'canManageDeposits', label: 'Pfand verwalten',          desc: 'Einnehmen, zurückzahlen, Saison-Rückgabe' },
    { key: 'canManageReports',  label: 'Bedarfsmeldungen bearbeiten', desc: 'Status setzen, Bestellungen daraus erzeugen' },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <PageHeader number="10" label="ZUGÄNGE" title="Nutzer" subtitle={`${users.length} Konten · nur Admins können Nutzer verwalten`} />
        <button onClick={() => setShowForm(true)} className="px-5 py-2.5 text-xs font-medium flex items-center gap-2 uppercase"
          style={{ background: 'var(--vereinsblau)', color: 'white', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
          <Plus size={14} /> Nutzer anlegen
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 mb-4">{error}</div>}

      {showForm && (
        <div className="bg-white border-2 border-stone-900 p-6 mb-4">
          <h2 className="font-display text-2xl mb-4">NEUER NUTZER</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <Field label="Anzeigename">
              <input className="w-full border border-stone-300 px-3 py-2 text-sm" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="z. B. Sandra Heldt" />
            </Field>
            <Field label="Benutzername">
              <input className="w-full border border-stone-300 px-3 py-2 text-sm" value={form.username} onChange={e => setForm({ ...form, username: e.target.value.toLowerCase() })} placeholder="z. B. s.heldt" />
            </Field>
            <Field label="Passwort (mind. 8 Zeichen)">
              <input type="password" className="w-full border border-stone-300 px-3 py-2 text-sm" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Field label="Rolle">
              <select className="w-full border border-stone-300 px-3 py-2 text-sm" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                <option value="user">Nutzer (eingeschränkt auf Mannschaften)</option>
                <option value="admin">Admin (Vollzugriff inkl. Nutzerverwaltung)</option>
              </select>
            </Field>
          </div>

          {form.role === 'user' && (
            <div className="mb-3">
              <div className="font-sub text-xs mb-2" style={{ color: 'var(--vereinsblau)', letterSpacing: '0.18em' }}>
                ZUGEORDNETE MANNSCHAFTEN ({form.teams.length})
              </div>
              {allTeams.length === 0 ? (
                <p className="text-sm text-stone-500">Noch keine Mannschaften angelegt — in den Einstellungen anlegen.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {allTeams.map(t => {
                    const active = form.teams.includes(t);
                    return (
                      <button key={t} type="button" onClick={() => toggleFormTeam(t)}
                        className="text-xs px-3 py-1.5"
                        style={{
                          border: active ? '2px solid var(--vereinsblau)' : '1px solid var(--rule)',
                          background: active ? '#F1ECDF' : 'white',
                          color: active ? 'var(--vereinsblau)' : 'var(--ink-soft)',
                          fontWeight: active ? 600 : 400,
                        }}>
                        {active ? '✓ ' : ''}{t}
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="text-xs mt-2" style={{ color: 'var(--ink-mute)' }}>
                Ohne Zuordnung sieht der Nutzer keine Mannschaft. Mehrfachauswahl möglich.
              </p>
            </div>
          )}

          {form.role === 'user' && (
            <div className="mb-3">
              <div className="font-sub text-xs mb-2" style={{ color: 'var(--vereinsblau)', letterSpacing: '0.18em' }}>
                BERECHTIGUNGEN
              </div>
              <div className="space-y-2">
                {PERMISSION_LABELS.map(perm => (
                  <label key={perm.key} className="flex items-start gap-3 p-2 cursor-pointer text-sm"
                    style={{ border: '1px solid var(--rule)', background: form.permissions[perm.key] ? '#F1ECDF' : 'white' }}>
                    <input type="checkbox" checked={!!form.permissions[perm.key]}
                      onChange={() => toggleFormPerm(perm.key)} className="mt-0.5" />
                    <div>
                      <div className="font-medium">{perm.label}</div>
                      <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>{perm.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
              <p className="text-xs mt-2" style={{ color: 'var(--ink-mute)' }}>
                Hinweis: Personen mit ausgegebenem Material oder offenem Pfand können nie gelöscht werden — diese Schutzregel gilt auch für Admins.
              </p>
            </div>
          )}

          <div className="flex gap-2 mt-4">
            <button onClick={add} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium">Anlegen</button>
            <button onClick={() => { setShowForm(false); setError(''); }} className="border border-stone-300 px-4 py-2 text-sm">Abbrechen</button>
          </div>
        </div>
      )}

      <div className="bg-white border border-stone-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-stone-500 text-sm">Lade...</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-stone-500 text-sm">Keine Nutzer angelegt.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wider text-stone-500">
                <tr>
                  <th className="text-left p-3">Name / Benutzer</th>
                  <th className="text-left p-3">Rolle</th>
                  <th className="text-left p-3">Mannschaften</th>
                  <th className="p-3 w-32"></th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const isMe = u.username === currentUser?.username;
                  const isEditing = editingId === u.id;
                  if (isEditing) {
                    return (
                      <tr key={u.id} className="border-t border-stone-100" style={{ background: 'var(--paper)' }}>
                        <td className="p-3" colSpan={4}>
                          <div className="font-sub text-xs mb-3" style={{ color: 'var(--vereinsblau)', letterSpacing: '0.18em' }}>
                            BEARBEITE: {u.username}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                            <Field label="Anzeigename">
                              <input className="w-full border border-stone-300 px-3 py-2 text-sm" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                            </Field>
                            <Field label="Rolle">
                              <select className="w-full border border-stone-300 px-3 py-2 text-sm" value={editForm.role}
                                onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                                disabled={isMe && editForm.role === 'admin'}>
                                <option value="user">Nutzer (eingeschränkt)</option>
                                <option value="admin">Admin (Vollzugriff)</option>
                              </select>
                              {isMe && editForm.role === 'admin' && (
                                <p className="text-xs mt-1" style={{ color: 'var(--ink-mute)' }}>Eigene Admin-Rolle kann nicht entzogen werden.</p>
                              )}
                            </Field>
                            <Field label="Neues Passwort (optional, leer lassen für unverändert)">
                              <input type="password" className="w-full border border-stone-300 px-3 py-2 text-sm" value={editForm.password} onChange={e => setEditForm({ ...editForm, password: e.target.value })} placeholder="mind. 8 Zeichen" />
                            </Field>
                          </div>

                          {editForm.role === 'user' && (
                            <div className="mb-3">
                              <div className="font-sub text-xs mb-2" style={{ color: 'var(--vereinsblau)', letterSpacing: '0.18em' }}>
                                MANNSCHAFTEN ({editForm.teams.length})
                              </div>
                              {allTeams.length === 0 ? (
                                <p className="text-sm text-stone-500">Keine Mannschaften vorhanden.</p>
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  {allTeams.map(t => {
                                    const active = editForm.teams.includes(t);
                                    return (
                                      <button key={t} type="button" onClick={() => toggleEditTeam(t)}
                                        className="text-xs px-3 py-1.5"
                                        style={{
                                          border: active ? '2px solid var(--vereinsblau)' : '1px solid var(--rule)',
                                          background: active ? '#F1ECDF' : 'white',
                                          color: active ? 'var(--vereinsblau)' : 'var(--ink-soft)',
                                          fontWeight: active ? 600 : 400,
                                        }}>
                                        {active ? '✓ ' : ''}{t}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}

                          {editForm.role === 'user' && (
                            <div className="mb-4">
                              <div className="font-sub text-xs mb-2" style={{ color: 'var(--vereinsblau)', letterSpacing: '0.18em' }}>
                                BERECHTIGUNGEN
                              </div>
                              <div className="space-y-2">
                                {PERMISSION_LABELS.map(perm => (
                                  <label key={perm.key} className="flex items-start gap-3 p-2 cursor-pointer text-sm"
                                    style={{ border: '1px solid var(--rule)', background: editForm.permissions?.[perm.key] ? '#F1ECDF' : 'white' }}>
                                    <input type="checkbox" checked={!!editForm.permissions?.[perm.key]}
                                      onChange={() => toggleEditPerm(perm.key)} className="mt-0.5" />
                                    <div>
                                      <div className="font-medium">{perm.label}</div>
                                      <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>{perm.desc}</div>
                                    </div>
                                  </label>
                                ))}
                              </div>
                              <p className="text-xs mt-2" style={{ color: 'var(--ink-mute)' }}>
                                Hinweis: Personen mit ausgegebenem Material oder offenem Pfand können nie gelöscht werden — diese Schutzregel gilt auch für Admins.
                              </p>
                            </div>
                          )}

                          <div className="flex gap-2">
                            <button onClick={saveEdit} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium">Speichern</button>
                            <button onClick={cancelEdit} className="border border-stone-300 px-4 py-2 text-sm">Abbrechen</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={u.id} className="border-t border-stone-100">
                      <td className="p-3">
                        <div className="font-medium">{u.name || u.username} {isMe && <span className="text-xs ml-1" style={{ color: 'var(--ink-mute)' }}>(Sie)</span>}</div>
                        <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>{u.username}</div>
                      </td>
                      <td className="p-3">
                        <span className="text-xs px-2 py-0.5"
                          style={u.role === 'admin'
                            ? { background: 'var(--vereinsblau)', color: 'white', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.12em' }
                            : { background: 'var(--paper-dark)', color: 'var(--ink)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.12em' }
                          }>
                          {u.role === 'admin' ? 'ADMIN' : 'NUTZER'}
                        </span>
                      </td>
                      <td className="p-3 text-xs" style={{ color: 'var(--ink-soft)' }}>
                        {teamSummary(u)}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <button onClick={() => startEdit(u)} className="text-xs underline mr-2" style={{ color: 'var(--vereinsblau)' }}>Bearbeiten</button>
                        {!isMe && (
                          <button onClick={() => remove(u.username)} className="text-stone-400 hover:text-red-600 p-1" title="Nutzer löschen">
                            <Trash2 size={14} />
                          </button>
                        )}
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
  const [photoModal, setPhotoModal] = useState(null);
  const [photoCache, setPhotoCache] = useState({});
  const [selectedReports, setSelectedReports] = useState([]);

  function toggleReport(id) {
    setSelectedReports(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function createOrderFromReports() {
    if (selectedReports.length === 0) { alert('Keine Meldungen ausgewählt.'); return; }
    const selected = reports.filter(r => selectedReports.includes(r.id));

    // Lock-Check: schon bestellt?
    const alreadyOrdered = selected.filter(r => r.status === 'bestellt' || r.orderId);
    if (alreadyOrdered.length > 0) {
      alert(`${alreadyOrdered.length} der ausgewählten Meldungen wurden bereits bestellt. Bitte erst freigeben (Status zurücksetzen) oder entfernen.`);
      return;
    }

    const title = prompt('Titel der neuen Bestellung:', `Bedarf ${new Date().toLocaleDateString('de-DE')}`);
    if (!title) return;

    // Lines aus den Reports erzeugen — eine Zeile pro Person/Artikel
    const lines = selected.map((r, idx) => {
      const person = getPlayer(r.team, r.number);
      const item = getItem(r.item);
      // personKind aus Report (identifiedRole) oder durch Lookup ableiten
      let personKind = r.identifiedRole || null;
      if (!personKind && person) {
        personKind = data.players.find(p => p.id === person.id) ? 'player' : 'coach';
      }
      return {
        id: `l_${Date.now()}_${idx}`,
        itemType: r.item,
        size: person?.size || 'L',
        qty: 1,
        playerId: person?.id || '',
        personKind,
        number: r.number || '',
        name: person?.lastName?.toUpperCase() || '',
        reportRef: r.id,
        reasons: r.reasons || [],
      };
    });

    const teams = [...new Set(selected.map(r => r.team).filter(Boolean))];
    const newOrder = {
      id: `ord_${Date.now()}`,
      title,
      type: 'aus_bedarf',
      team: teams.length === 1 ? teams[0] : 'mehrere',
      articleSupplierId: null,
      flockSupplierId: null,
      flockBy: 'haus',
      notes: `Aus ${selected.length} Bedarfsmeldung(en) erzeugt.`,
      lines,
      sponsors: { brust: '', ruecken: '', aermel: '' },
      fromReports: selected.map(r => r.id),
      createdAt: new Date().toISOString(),
      status: 'angelegt',
    };
    update('orders', [...(data.orders || []), newOrder]);

    // Reports sperren
    const updated = reports.map(r =>
      selectedReports.includes(r.id)
        ? { ...r, status: 'bestellt', orderId: newOrder.id, handledAt: new Date().toISOString() }
        : r
    );
    setReports(updated);
    update('reports', updated);
    setSelectedReports([]);
    alert(`Bestellung „${title}" mit ${lines.length} Position(en) angelegt. Du findest sie unter Bestellungen — dort kannst du Lieferant, Größen, Beflockung und Sponsoren noch anpassen.`);
  }

  async function showPhoto(reportId) {
    if (photoCache[reportId]) {
      setPhotoModal({ id: reportId, url: photoCache[reportId] });
      return;
    }
    setPhotoModal({ id: reportId, url: null });
    try {
      const r = await authFetch(`/api/reports/photo?id=${encodeURIComponent(reportId)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      if (d.photo) {
        setPhotoCache(prev => ({ ...prev, [reportId]: d.photo }));
        setPhotoModal({ id: reportId, url: d.photo });
      } else {
        setPhotoModal(null);
        alert('Foto nicht gefunden.');
      }
    } catch (e) {
      setPhotoModal(null);
      alert(`Foto konnte nicht geladen werden: ${e.message}`);
    }
  }

  // Reports werden serverseitig direkt vom öffentlichen Endpunkt geschrieben.
  useEffect(() => { setReports(data.reports || []); }, [data.reports]);

  // Filter
  const filtered = filter === 'alle' ? reports : reports.filter(r => r.status === filter);

  function getPlayer(team, number) {
    // Spieler: numerisch matchen
    const player = data.players.find(p => p.team === team && String(p.number) === String(number));
    if (player) return player;
    // Trainer: alphabetisch matchen, case-insensitive (Initialen)
    const initials = String(number || '').trim().toUpperCase();
    return (data.coaches || []).find(c => c.team === team && String(c.number || '').trim().toUpperCase() === initials);
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
      let personKind = r.identifiedRole || null;
      if (!personKind && player) {
        personKind = data.players.find(p => p.id === player.id) ? 'player' : 'coach';
      }
      lines.push({
        id: `l_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        itemType: r.item,
        size: player?.size || 'L',
        qty: 1,
        playerId: player?.id || '',
        personKind,
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
      <div className="flex flex-wrap gap-2 items-center justify-between mb-4">
        <div className="flex gap-2 overflow-x-auto pb-1">
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
        {selectedReports.length > 0 && (
          <button onClick={createOrderFromReports}
            className="px-4 py-2 text-xs uppercase flex items-center gap-2 text-white"
            style={{ background: 'var(--success)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
            <ShoppingCart size={14} /> {selectedReports.length} Meldung(en) → Bestellung
          </button>
        )}
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
                  <th className="p-3 w-8"></th>
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
                  const isLocked = r.status === 'bestellt' || r.orderId;
                  return (
                    <tr key={r.id} className="border-t border-stone-100" style={{ opacity: isLocked ? 0.6 : 1 }}>
                      <td className="p-3">
                        {!isLocked ? (
                          <input type="checkbox" checked={selectedReports.includes(r.id)} onChange={() => toggleReport(r.id)} />
                        ) : (
                          <span title="Bereits bestellt" style={{ color: 'var(--ink-mute)' }}>🔒</span>
                        )}
                      </td>
                      <td className="p-3 text-xs" style={{ color: 'var(--ink-mute)' }}>
                        {new Date(r.createdAt).toLocaleDateString('de-DE')}<br />
                        {new Date(r.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="p-3">
                        <div className="font-medium">
                          {r.team} · {r.identifiedRole === 'coach' ? r.number : `#${r.number}`}
                          {r.identifiedRole === 'coach' && (
                            <span className="ml-1 text-[10px] px-1.5 py-0.5" style={{ background: 'var(--paper-dark)', color: 'var(--vereinsblau)', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.12em' }}>TRAINER</span>
                          )}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--ink-mute)' }}>
                          {player
                            ? `${player.firstName} ${player.lastName}`
                            : (r.identifiedPersonName || '— Person nicht gefunden —')}
                        </div>
                        {r.materialMarked > 0 && (
                          <div className="text-[10px] mt-0.5" style={{ color: 'var(--success)' }}>
                            ✓ {r.materialMarked} Materialteil{r.materialMarked > 1 ? 'e' : ''} markiert
                          </div>
                        )}
                        {isLocked && (
                          <div className="text-[10px] mt-0.5" style={{ color: 'var(--vereinsblau)' }}>
                            Bestellung erstellt
                          </div>
                        )}
                      </td>
                      <td className="p-3 font-medium">
                        {item?.name || r.item}
                        {r.hasPhoto && (
                          <button onClick={() => showPhoto(r.id)} className="block mt-1 inline-flex items-center gap-1 text-xs hover:underline"
                            style={{ color: 'var(--vereinsblau)' }}>
                            📷 Foto ansehen
                          </button>
                        )}
                      </td>
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
