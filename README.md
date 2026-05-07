# Trikotverwaltung — Vercel Deployment

Web-App zur Verwaltung von Trikots, Trainingsausstattung, Pfandbeträgen und Bestellungen für Fußballvereine.

## Features

- Spieler- und Rückennummern-Verwaltung pro Mannschaft
- Mannschaften frei konfigurierbar (anlegen, umbenennen, löschen)
- Materialbestand mit Status (Lager / ausgegeben / verloren)
- Pfandkasse mit Ein- und Auszahlungshistorie
- Saison-Rückgabe mit automatischer Zeitwertberechnung
- Bestellungen (Komplett, Teilbestellung, Einzelteile) mit CSV-Export der Flock-Liste
- Multi-User-Login mit Rollen (Admin / Nutzer)

## Schritt-für-Schritt-Anleitung zum Deployment

### Voraussetzungen
- Ein GitHub-Account (kostenlos auf github.com)
- Ein Vercel-Account (kostenlos auf vercel.com — kann mit GitHub verbunden werden)

### 1) Code zu GitHub bringen

Es gibt zwei Wege:

**Weg A — Über die GitHub-Webseite (am einfachsten):**

1. Auf github.com einloggen, oben rechts auf das `+` und „New repository" klicken.
2. Repository-Name z. B. `trikotverwaltung`, „Private" auswählen, „Create repository".
3. Auf der neu erscheinenden Seite den blauen Button „uploading an existing file" klicken.
4. Den Inhalt des Ordners `trikot-app` (alle Dateien und Unterordner) per Drag-and-Drop hochladen. WICHTIG: nicht den Ordner selbst, sondern seinen Inhalt.
5. Unten „Commit changes" klicken.

**Weg B — Per Kommandozeile (wenn Git installiert):**

```bash
cd trikot-app
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/DEIN-USERNAME/trikotverwaltung.git
git push -u origin main
```

### 2) Bei Vercel das Projekt anlegen

1. Auf vercel.com einloggen (mit GitHub).
2. Auf dem Dashboard „Add New..." → „Project" klicken.
3. Das eben angelegte Repository auswählen → „Import".
4. Bei „Configure Project" alles auf den Standardwerten lassen (Vercel erkennt Vite automatisch).
5. Den Bereich „Environment Variables" aufklappen und EINE Variable hinzufügen:
   - Name: `JWT_SECRET`
   - Value: eine zufällige Zeichenkette mit mindestens 32 Zeichen, z. B. `kF7zPq2x9LmN8vRtY3cWbE4hJaG5sD6M` (selbst ausdenken oder unter https://1password.com/de/password-generator generieren)
6. „Deploy" klicken. Der erste Build dauert ca. 1–2 Minuten.

Nach dem Build ist die App unter einer URL wie `trikotverwaltung-xyz.vercel.app` erreichbar — funktioniert aber noch nicht, weil die Datenbank fehlt.

### 3) Vercel KV (Datenbank) anlegen und verbinden

1. Im Vercel-Dashboard das Projekt öffnen.
2. Oben auf den Tab „Storage" klicken.
3. „Create Database" → „KV (Redis)" auswählen.
4. Namen vergeben (z. B. `trikot-kv`), Region „Frankfurt" wählen, „Create" klicken.
5. Auf der nächsten Seite „Connect to Project" — das Projekt `trikotverwaltung` auswählen, in allen drei Umgebungen (Production, Preview, Development) verbinden.
6. Vercel setzt jetzt automatisch die Umgebungsvariablen `KV_URL`, `KV_REST_API_URL` und `KV_REST_API_TOKEN`.

### 4) Neu deployen, damit KV greift

1. Im Projekt auf den Tab „Deployments" gehen.
2. Beim neuesten Deployment auf die drei Punkte (...) → „Redeploy" → „Redeploy" bestätigen.
3. Nach 1–2 Minuten ist die App live.

### 5) Erstinstallation in der App

1. Die Vercel-URL öffnen (`https://trikotverwaltung-xyz.vercel.app`).
2. Beim ersten Aufruf erscheint der Setup-Bildschirm. Dort den ersten Admin-Account anlegen.
3. Nach dem Setup ist man direkt eingeloggt und kann loslegen.

### 6) Weitere Nutzer anlegen

Als Admin gibt es im Menü oben den Tab „Nutzer". Dort lassen sich beliebig viele weitere Konten anlegen — entweder mit Rolle „user" (Vollzugriff auf die App) oder „admin" (zusätzlich Nutzerverwaltung).

### 7) Eigene Domain (optional)

Wenn die App unter einer Adresse wie `trikot.fc-frohlinde.de` erreichbar sein soll:

1. Im Vercel-Dashboard → Projekt → Settings → Domains.
2. Wunschdomain eintragen, „Add" klicken.
3. Vercel zeigt dann zwei DNS-Einträge (A oder CNAME), die beim Domain-Anbieter (z. B. IONOS, Strato) eingetragen werden müssen.
4. Nach 5–60 Minuten ist die Domain aktiv (inkl. kostenlosem SSL-Zertifikat).

## Lokal testen (optional)

```bash
npm install
# .env.local mit KV-Credentials und JWT_SECRET anlegen (siehe .env.example)
npm run dev
```

## Updates einspielen

Jeder neue Commit auf GitHub wird automatisch von Vercel deployed — kein manueller Schritt nötig.

## Backup

In den App-Einstellungen gibt es „Backup exportieren" (JSON-Datei). Empfehlung: vor jedem Saisonwechsel.

## Kosten

- Vercel Hobby-Plan: kostenlos
- Vercel KV Free-Tier: 256 MB Speicher, 30.000 Befehle/Tag — reicht für mehrere hundert Spieler locker
- Domain: ca. 5–15 €/Jahr beim Anbieter

## Hilfe

Bei Problemen kannst Du im Vercel-Dashboard unter „Deployments" → ein Deployment anklicken → „Functions" die Server-Logs einsehen, dort steht in der Regel die Fehlerursache.
