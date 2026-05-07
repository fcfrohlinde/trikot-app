// Zentrale Versionsnummer der App.
// Bei jedem neuen Feature oder Bugfix hier hochzählen.
export const APP_VERSION = '1.2.0';

export const CHANGELOG = [
  {
    version: '1.2.0',
    date: '2026-05-07',
    changes: [
      'Bedarfsmeldung für Spieler ohne Login',
      'Editierbare Pfandregeln (Saison-Abschreibung, Zustandsfaktoren)',
      'Wochenbericht über offene Bedarfsmeldungen',
      'Mailversand des Wochenberichts (mit Resend)',
      'Sponsoren-Platzierungen in Bestellungen (Brust, Rücken, Ärmel)',
      'Automatische Material-Markierung aus Spieler-Meldungen',
      'Versionsnummer und Changelog in Einstellungen',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-05-07',
    changes: [
      'CSV-Import für Spieler mit Validierung und Vorschau',
      'Editorial-Design "Dorfverein" (Vereinsblau, Playfair, Bebas Neue)',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-05-07',
    changes: [
      'Spieler- und Mannschaftsverwaltung',
      'Material- und Bestandsführung',
      'Pfandkasse mit Saison-Rückgabe und Zeitwertberechnung',
      'Bestellungen mit Flock-Liste',
      'Multi-User-Login mit Admin-Rolle',
      'Vercel KV als Datenspeicher',
    ],
  },
];
