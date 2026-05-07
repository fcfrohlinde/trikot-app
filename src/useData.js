import { useState, useEffect } from 'react';
import { useAuth } from './auth.jsx';

const DEFAULT_TEAMS = ['1. Mannschaft', '2. Mannschaft', '3. Mannschaft'];
const DEFAULT_ITEMS = [
  { id: 'trikot_heim', name: 'Trikot Heim', price: 45 },
  { id: 'trikot_auswaerts', name: 'Trikot Auswärts', price: 45 },
  { id: 'short_heim', name: 'Short Heim', price: 25 },
  { id: 'short_auswaerts', name: 'Short Auswärts', price: 25 },
  { id: 'stutzen', name: 'Stutzen', price: 12 },
  { id: 'training_jacke', name: 'Trainingsjacke', price: 55 },
  { id: 'training_hose', name: 'Trainingshose', price: 40 },
  { id: 'training_shirt', name: 'Trainingsshirt', price: 28 },
  { id: 'regenjacke', name: 'Regenjacke', price: 65 },
];

const DEFAULTS = {
  players: [],
  inventory: [],
  items: DEFAULT_ITEMS,
  teams: DEFAULT_TEAMS,
  deposits: [],
  orders: [],
  transactions: [],
  settings: { defaultDeposit: 100, clubName: 'FC Frohlinde 1949 e.V.' },
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
