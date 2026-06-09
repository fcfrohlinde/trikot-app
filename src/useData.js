import { useState, useEffect } from 'react';
import { useAuth } from './auth.jsx';

const DEFAULT_TEAMS = ['1. Mannschaft', '2. Mannschaft', '3. Mannschaft'];

// FCF-Standardausstattung gemäß Pfandordnung (Stand 2025)
const DEFAULT_ITEMS = [
  { id: 'praesentationsjacke', articleNumber: '', name: 'Präsentationsjacke', price: 40, replacementValue: 25 },
  { id: 'praesentationshose', articleNumber: '', name: 'Präsentationshose', price: 29, replacementValue: 20 },
  { id: 'aufwaermshirt', articleNumber: '', name: 'Aufwärmshirt', price: 30, replacementValue: 20 },
  { id: 'trainingsshirt', articleNumber: '', name: 'Trainingsshirt', price: 18, replacementValue: 10 },
  { id: 'trainingshose_kurz', articleNumber: '', name: 'Trainingshose kurz', price: 14, replacementValue: 10 },
  { id: 'trainingshose_lang', articleNumber: '', name: 'Trainingshose lang', price: 29, replacementValue: 20 },
  { id: 'zip_top', articleNumber: '', name: 'Zip Top', price: 40, replacementValue: 25 },
  { id: 'pullover_sweat', articleNumber: '', name: 'Pullover / Sweat', price: 35, replacementValue: 22 },
];

const DEFAULTS = {
  players: [],
  coaches: [],
  inventory: [],
  items: DEFAULT_ITEMS,
  teams: DEFAULT_TEAMS,
  deposits: [],
  orders: [],
  issueProtocols: [],
  transactions: [],
  reports: [],
  suppliers: [],
  settings: {
    defaultDeposit: 70,
    clubName: 'FC Frohlinde 1949 e.V.',
    depositMode: 'pauschal',
    sponsors: [],
  },
};

function normalizePersonKind(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (['player', 'spieler'].includes(raw)) return 'player';
  if (['coach', 'trainer'].includes(raw)) return 'coach';
  return raw;
}

function normalizeFlockIdentifier(value, kind = '') {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return '';
  const cleaned = raw.replace(/^#\s*/, '').replace(/^NR\.?\s*/i, '').trim();
  const normalizedKind = normalizePersonKind(kind);
  const digits = cleaned.replace(/[^0-9]/g, '');
  if (normalizedKind === 'player' || (/^\d/.test(cleaned) && digits)) {
    return digits.replace(/^0+(?=\d)/, '');
  }
  return cleaned.replace(/[^A-Z0-9]/g, '');
}

function normalizePersonRecord(person, kind) {
  const normalizedNumber = normalizeFlockIdentifier(
    person?.number ?? person?.initials ?? person?.trainerInitials ?? person?.shortName ?? '',
    kind
  );
  return {
    ...person,
    number: kind === 'coach'
      ? (normalizedNumber || null)
      : (normalizedNumber ? parseInt(normalizedNumber) : null),
  };
}

function normalizeDataShape(data) {
  return {
    ...data,
    players: (data.players || []).map(person => normalizePersonRecord(person, 'player')),
    coaches: (data.coaches || []).map(person => normalizePersonRecord(person, 'coach')),
  };
}

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

export function useData() {
  const { authFetch } = useAuth();
  const [data, setData] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await authFetch('/api/data');
      const d = await readJsonResponse(r, 'Daten konnten nicht geladen werden');
      setData(normalizeDataShape({ ...DEFAULTS, ...d }));
    } catch (e) {
      console.error(e);
      setSaveError(e.message);
    }
    setLoading(false);
  }

  async function update(key, value, options = {}) {
    const rawNextValue = typeof value === 'function' ? value(data[key]) : value;
    const nextValue = key === 'players'
      ? (rawNextValue || []).map(person => normalizePersonRecord(person, 'player'))
      : key === 'coaches'
        ? (rawNextValue || []).map(person => normalizePersonRecord(person, 'coach'))
        : rawNextValue;
    const previousSnapshot = data;
    setData(prev => {
      const rawOptimisticValue = typeof value === 'function' ? value(prev[key]) : value;
      const optimisticValue = key === 'players'
        ? (rawOptimisticValue || []).map(person => normalizePersonRecord(person, 'player'))
        : key === 'coaches'
          ? (rawOptimisticValue || []).map(person => normalizePersonRecord(person, 'coach'))
          : rawOptimisticValue;
      if (options.mode === 'mergeById' && Array.isArray(prev[key]) && Array.isArray(optimisticValue)) {
        const byId = new Map(prev[key].map(entry => [entry?.id, entry]).filter(([entryId]) => entryId));
        optimisticValue.forEach(entry => {
          if (entry?.id) byId.set(entry.id, { ...(byId.get(entry.id) || {}), ...entry });
        });
        return { ...prev, [key]: [...byId.values()] };
      }
      return { ...prev, [key]: optimisticValue };
    });
    try {
      const r = await authFetch('/api/data', {
        method: 'POST',
        body: JSON.stringify({ key, value: nextValue, mode: options.mode || 'replace' }),
      });
      await readJsonResponse(r, 'Speichern fehlgeschlagen');
      setSaveError(null);
    } catch (e) {
      setData(previousSnapshot);
      setSaveError(e.message);
      console.error(e);
    }
  }

  return { data, loading, update, saveError, reload: load };
}
