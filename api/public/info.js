import { kv } from '../_lib/auth.js';

// Liefert Mannschaften, Artikel und einen Person-Lookup für die öffentliche Bedarfsmeldung.
// Keine sensiblen Daten — nur das, was zur Identifikation und Auflistung gebraucht wird.
//
// Endpunkte:
//  GET /api/public/info               → { teams, items, clubName }
//  GET /api/public/info?team=X&number=7 → { ...info, person: { name, role } | null }
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const teams = (await kv.get('data:teams')) || [];
  const items = (await kv.get('data:items')) || [];
  const settings = (await kv.get('data:settings')) || {};

  const baseResponse = {
    teams,
    items: items.map(i => ({ id: i.id, name: i.name })),
    clubName: settings.clubName || '',
  };

  // Optional: Person-Lookup
  const { team, number } = req.query || {};
  if (team && number !== undefined && number !== '') {
    const players = (await kv.get('data:players')) || [];
    const coaches = (await kv.get('data:coaches')) || [];

    // Spieler-Match: numerisch
    const numAsInt = parseInt(String(number).replace(/[^0-9]/g, ''), 10);
    const player = !isNaN(numAsInt)
      ? players.find(p => p.team === team && String(p.number) === String(numAsInt))
      : null;

    // Trainer-Match: alphabetisch
    const numAsInitials = String(number).trim().toUpperCase();
    const coach = numAsInitials
      ? coaches.find(c => c.team === team && String(c.number || '').trim().toUpperCase() === numAsInitials)
      : null;

    if (player) {
      baseResponse.person = {
        name: `${player.firstName} ${player.lastName}`.trim(),
        role: 'player',
      };
    } else if (coach) {
      baseResponse.person = {
        name: `${coach.firstName} ${coach.lastName}`.trim(),
        role: 'coach',
      };
    } else {
      baseResponse.person = null;
    }
  }

  res.json(baseResponse);
}
