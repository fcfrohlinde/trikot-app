// Zentrale Versionsnummer der App.
// Bei jedem neuen Feature oder Bugfix hier hochzählen.
export const APP_VERSION = '1.7.4';

export const CHANGELOG = [
  {
    version: '1.7.4',
    date: '2026-05-08',
    changes: [
      'Standard-Sets für Spieler und Trainer in den Einstellungen konfigurierbar (jeder Artikel mit eigener Stückzahl)',
      'Im Bestellformular zwei Buttons: „Spieler-Set" und „Spieler + Trainer-Set" — erzeugt die komplette Erstausstattung in einem Klick',
      'Standard-Set-Buttons sind jetzt unabhängig vom Bestelltyp verfügbar (auch für Teilbestellungen)',
      'Trainer-Erstausstattung wird nur erzeugt, wenn ein Trainer-Set definiert ist und Trainer in der Mannschaft sind',
      'Doppelte Zeilen pro Person×Artikel×Größe werden beim Erzeugen automatisch übersprungen (kein doppelter Eintrag bei mehrfachem Klick)',
      'Bestellliste und Flock-Liste sind jetzt nach Artikel × Größe gruppiert — keine Einzelposten mehr',
      'Pro Gruppe werden alle Beflockungen mit Nummer/Initialen und Flock-Name in einer Spalte aufgelistet',
      'Lagerware ohne Beflockung wird separat ausgewiesen („+ 3× ohne Beflockung")',
      'Bestellliste mit Gesamtsumme am Ende (in Vereinsblau hervorgehoben)',
      'Trainer-Beflockungen werden in Bebas Neue dargestellt (passend zur Initialen-Logik)',
      'Beflockungs-Sortierung: Spieler nach Nummer, Trainer nach Initialen',
    ],
  },
  {
    version: '1.7.3',
    date: '2026-05-08',
    changes: [
      'Trainer haben jetzt Initialen statt Rückennummer (1–3 Buchstaben, automatisch Großbuchstaben)',
      'Konflikt-Check pro Mannschaft funktioniert für Initialen wie für Spielernummern',
      'Trainer-CSV-Import mit eigener Vorlage (Spalte „Initialen", Beispieldaten)',
      'ReportForm akzeptiert sowohl Nummern als auch Initialen — automatische Erkennung im Backend',
      'Bestellungs-Import-Bug behoben: Artikelnummern aus CSV werden jetzt korrekt im Katalog angezeigt',
      'Artikelkatalog-Import unterstützt zusätzlich die Spalte „Lieferant" (Auflösung über Name, Warnung bei unbekannten Lieferanten)',
      'Neuer Button „Personen auswählen" im Bestellformular: Multi-Select für Spieler + Trainer mit Filtern (Mannschaft, Suche)',
      'Bei Sammelpositionen mit Menge > 1 erscheint ein „verteilen"-Button — die Menge wird auf ausgewählte Personen aufgesplittet',
      'Bestellpositionen zeigen Artikelnummer im Dropdown ([T-001] Trainingsshirt)',
      'Artikelnummer wird im PDF-Export, in beiden CSV-Listen und in der Bestelldetail-Ansicht ausgewiesen',
      'Trainer in Bestelltabellen mit TRAINER-Badge gekennzeichnet, Initialen werden in Bebas Neue dargestellt',
      'Mannschaft im Bestellformular dient jetzt als optionaler Filter — auch Einzelteil-Bestellungen profitieren',
    ],
  },
  {
    version: '1.7.2',
    date: '2026-05-08',
    changes: [
      'Material-Übersicht standardmäßig gruppiert: pro Artikel × Größe Summen für Lager / Ausgegeben / Markiert / Gesamt',
      'Klick auf eine Gruppenzeile öffnet die Einzelteile mit Status, Zuordnung und Zustand',
      'Buttons „Alle auf" / „Alle zu" zum schnellen Auf-/Zuklappen aller Gruppen',
      'Toggle „Gruppiert" / „Einzeln" — die alte ungruppierte Liste bleibt zugänglich',
      'Summenzeile am Tabellenende zeigt Gesamtbestand auf einen Blick',
      'Größen werden in natürlicher Reihenfolge sortiert (XS, S, M, L, XL, XXL, dann Jugend-Größen)',
    ],
  },
  {
    version: '1.7.1',
    date: '2026-05-08',
    changes: [
      'Vereinslogo auf der Login-Seite (100×100) und in der öffentlichen Bedarfsmeldung (80×80)',
      'Favicon im Browser-Tab und auf dem Home-Bildschirm (alle gängigen Größen 16/32/48/96/180/192/512 plus .ico)',
      'Vereinsblau als Theme-Farbe im mobilen Browser-UI',
      'Tab-Titel zeigt jetzt „FC Frohlinde · Trikotverwaltung"',
    ],
  },
  {
    version: '1.7.0',
    date: '2026-05-08',
    changes: [
      'Lieferanten-Verwaltung in den Einstellungen (Name, Typ, Kontakt, Notizen)',
      'In Bestellungen wählbar: Artikel-Lieferant und Beflockungs-Quelle (Im Haus / Lieferant / extern)',
      'Bei externer Beflockung separater Flock-Lieferant aus der Liste',
      'Material-CSV-Import mit drei Modi: Aktualisieren über Artikelnummer / Hinzufügen / Komplett ersetzen',
      'CSV-Import erkennt Spalten Artikelnummer, Name, Preis, Ersatzwert, Lieferant automatisch',
      'Vorschau vor dem Import zeigt, welche Artikel aktualisiert / neu hinzugefügt werden',
      'Standard-Lieferant für CSV-Zeilen ohne Zuordnung kann beim Import gesetzt werden',
      'Artikelkatalog mit zusätzlichen Spalten: Artikelnummer und Lieferant',
      'Bedarfsmeldungen werden gesperrt, sobald sie in eine Bestellung übernommen wurden (kein doppelter Bestelleingang)',
      'Bestellungen können zusammengeführt werden (Sammelbestellung) — Lines, Bedarfsmeldungen und Sponsoren werden verschmolzen',
      'Beim Löschen einer Bestellung werden gesperrte Bedarfsmeldungen automatisch wieder freigegeben',
      'Sammelbestellungen werden in Übersicht und PDF gekennzeichnet',
    ],
  },
  {
    version: '1.6.0',
    date: '2026-05-07',
    changes: [
      'Trainer-Bereich mit eigenem Tab und kompletter Logik analog zu Spielern',
      'Automatische Personen-Identifikation bei Bedarfsmeldung (Mannschaft + Nummer)',
      'Automatische Material-Markierung beim Eingang einer Meldung (kein manuelles Klicken mehr)',
      'Foto-Button in der Bedarfs-Übersicht jetzt immer sichtbar (in der Artikel-Spalte)',
      'Fotos werden aggressiver komprimiert (max. 500 KB) für stabile Speicherung',
      'Trainer werden überall mit TRAINER-Badge gekennzeichnet (Material, Pfand, Bestellungen)',
      'Material-Markierungen sind jetzt in der Spieler-/Trainer-Liste als ⚠ Badge sichtbar',
    ],
  },
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
