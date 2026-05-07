// Zentrale Versionsnummer der App.
// Bei jedem neuen Feature oder Bugfix hier hochzählen.
export const APP_VERSION = '1.5.2';

export const CHANGELOG = [
  {
    version: '1.5.2',
    date: '2026-05-07',
    changes: [
      'Hotfix: MIME-Type-Header für JS-Module in vercel.json korrigiert',
      'PDF-Bibliotheken werden jetzt direkt ins Hauptbundle gepackt (kein Lazy-Loading mehr)',
    ],
  },
  {
    version: '1.5.1',
    date: '2026-05-07',
    changes: [
      'Hotfix: PDF-Export funktioniert jetzt zuverlässig (statischer Import von jspdf, Side-Effect-API)',
      'PDF-Fehler werden sichtbar angezeigt statt stillschweigend zu scheitern',
      'Sicherer Dateiname beim PDF-Speichern',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-05-07',
    changes: [
      'Mailversand auf SMTP umgestellt (statt Resend) — funktioniert mit jedem Mail-Provider',
      'Test-Mail-Funktion in den Einstellungen mit SMTP-Statusanzeige',
      'Anleitung für SMTP-Einrichtung direkt in der App (mit Beispielen für IONOS, Strato, Telekom, Gmail, M365)',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-05-07',
    changes: [
      'FCF-Pfandordnung 2025 als Standard hinterlegt (Pfand 70 €, 8 Standardteile mit Ersatzwerten)',
      'Zwei Pfandmodi: Pauschal-Modus (FCF-Standard) und Saison-Abschreibung (alt)',
      'Ersatzwert pro Artikel im Katalog editierbar',
      'Total-Verfall des Pfands per Checkbox bei Rückgabe (Punkt 8 Pfandordnung)',
      'Auszug der Pfand- & Kleiderordnung in den Einstellungen',
      'Fotos werden nach 90 Tagen automatisch aus der Datenbank gelöscht',
      'Quick-Action "FCF-Pfandordnung laden" stellt Defaults wieder her',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-05-07',
    changes: [
      'Foto-Upload bei Bedarfsmeldungen (Browser-Komprimierung auf max. 1280px / ~150 KB)',
      'Foto-Anzeige in der Bedarfsübersicht (Klick öffnet Großansicht)',
      'PDF-Export für Bestellungen mit integrierter Flock-Liste, Sponsoren und Vereins-Branding',
      'Badge mit Anzahl offener Bedarfsmeldungen am Tab "Bedarf"',
    ],
  },
  {
    version: '1.2.2',
    date: '2026-05-07',
    changes: [
      'Hotfix: ReferenceError beim Öffnen der Einstellungen behoben (übersehene Konstante)',
    ],
  },
  {
    version: '1.2.1',
    date: '2026-05-07',
    changes: [
      'Hotfix: Crash beim Öffnen der Einstellungen behoben (Default-Werte für conditionFactors abgesichert)',
      'Error-Boundary: Fehler in einzelnen Bereichen blockieren nicht mehr die ganze App',
    ],
  },
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
