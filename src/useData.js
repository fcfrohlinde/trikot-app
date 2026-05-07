import { useState, useEffect } from 'react';
import { useAuth } from './auth.jsx';

const DEFAULT_TEAMS = ['1. Mannschaft', '2. Mannschaft', '3. Mannschaft'];

// FCF-Standardausstattung gemäß Pfandordnung (Stand 2025)
const DEFAULT_ITEMS = [
  { id: 'praesentationsjacke', name: 'Präsentationsjacke', price: 40, replacementValue: 25 },
  { id: 'praesentationshose', name: 'Präsentationshose', price: 29, replacementValue: 20 },
  { id: 'aufwaermshirt', name: 'Aufwärmshirt', price: 30, replacementValue: 20 },
  { id: 'trainingsshirt', name: 'Trainingsshirt', price: 18, replacementValue: 10 },
  { id: 'trainingshose_kurz', name: 'Trainingshose kurz', price: 14, replacementValue: 10 },
  { id: 'trainingshose_lang', name: 'Trainingshose lang', price: 29, replacementValue: 20 },
  { id: 'zip_top', name: 'Zip Top', price: 40, replacementValue: 25 },
  { id: 'pullover_sweat', name: 'Pullover / Sweat', price: 35, replacementValue: 22 },
];

const DEFAULTS = {
  players: [],
  inventory: [],
  items: DEFAULT_ITEMS,
  teams: DEFAULT_TEAMS,
  deposits: [],
  orders: [],
  transactions: [],
  reports: [],
  settings: {
    defaultDeposit: 70,
    clubName: 'FC Frohlinde 1949 e.V.',
    depositMode: 'pauschal',
  },
};

export function useData() {
  const { authFetch } = useAuth();
  const [data, setData] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await authFetch('/api/data');
      const d = await r.json();
      setData({ ...DEFAULTS, ...d });
    } catch (e) {
      console.error(e);
      setSaveError(e.message);
    }
    setLoading(false);
  }

  async function update(key, value) {
    setData(prev => ({ ...prev, [key]: value }));
    try {
      const r = await authFetch('/api/data', {
        method: 'POST',
        body: JSON.stringify({ key, value }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || 'Speichern fehlgeschlagen');
      }
      setSaveError(null);
    } catch (e) {
      setSaveError(e.message);
      console.error(e);
    }
  }

  return { data, loading, update, saveError, reload: load };
}
