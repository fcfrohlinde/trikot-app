import { DATA_KEYS } from './security.js';

const MOJIBAKE_PATTERN = /(Ã|Â|â€|â€“|â†|ï¿½|�)/;
const SENSITIVE_FIELD_NAMES = new Set([
  'password',
  'passwordHash',
  'token',
  'authorization',
  'session',
  'photo',
  'signature',
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isNonEmpty(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function personLabel(person) {
  if (!person) return '';
  return `${person.firstName || ''} ${person.lastName || ''}`.trim() || person.id || '';
}

function addIssue(issues, severity, code, path, message, meta = {}) {
  issues.push({
    severity,
    code,
    path,
    message,
    ...meta,
  });
}

function duplicateIdIssues(issues, key, records) {
  const seen = new Set();
  asArray(records).forEach((record, index) => {
    if (!record?.id) {
      addIssue(issues, 'error', 'missing_id', `${key}[${index}]`, 'Eintrag hat keine ID.');
      return;
    }
    if (seen.has(record.id)) {
      addIssue(issues, 'error', 'duplicate_id', `${key}.${record.id}`, 'Doppelte ID im Datenbereich.');
    }
    seen.add(record.id);
  });
}

function scanStrings(value, path, issues, limit) {
  if (issues.length >= limit) return;
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (MOJIBAKE_PATTERN.test(value)) {
      addIssue(issues, 'warning', 'mojibake_text', path, 'Text enthaelt alte/fehlerhafte Zeichensatz-Artefakte.');
    }
    return;
  }
  if (typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanStrings(entry, `${path}[${index}]`, issues, limit));
    return;
  }
  Object.entries(value).forEach(([key, entry]) => {
    if (SENSITIVE_FIELD_NAMES.has(key)) return;
    scanStrings(entry, `${path}.${key}`, issues, limit);
  });
}

function summarizeBySeverity(issues) {
  return issues.reduce((out, issue) => {
    out[issue.severity] = (out[issue.severity] || 0) + 1;
    return out;
  }, {});
}

function knownDataKeySet() {
  return new Set(DATA_KEYS.map(key => `data:${key}`));
}

export function auditKvKeys(keys = [], reportIds = new Set()) {
  const issues = [];
  const known = knownDataKeySet();
  const counts = {
    totalKeys: keys.length,
    dataKeys: 0,
    users: 0,
    photos: 0,
    meta: 0,
    auditLog: 0,
    unknown: 0,
  };

  keys.forEach(key => {
    if (known.has(key)) {
      counts.dataKeys++;
      return;
    }
    if (key.startsWith('user:')) {
      counts.users++;
      return;
    }
    if (key.startsWith('photo:')) {
      counts.photos++;
      const reportId = key.slice('photo:'.length);
      if (reportId && !reportIds.has(reportId)) {
        addIssue(issues, 'warning', 'orphan_photo', key, 'Foto-Key ohne passende Bedarfsmeldung gefunden.');
      }
      return;
    }
    if (key.startsWith('meta:')) {
      counts.meta++;
      return;
    }
    if (key === 'audit:log') {
      counts.auditLog++;
      return;
    }
    if (key.startsWith('data:')) {
      counts.unknown++;
      addIssue(issues, 'warning', 'unknown_data_key', key, 'Unbekannter data:-Key aus alter Version gefunden.');
      return;
    }
    counts.unknown++;
    addIssue(issues, 'info', 'unknown_kv_key', key, 'KV-Key gehoert nicht zum aktuellen bekannten Schema.');
  });

  return { counts, issues };
}

export function auditDataSnapshot(data = {}, options = {}) {
  const issues = [];
  const users = asArray(options.users);
  const maxStringIssues = options.maxStringIssues || 120;

  const players = asArray(data.players);
  const coaches = asArray(data.coaches);
  const persons = [...players.map(p => ({ ...p, _kind: 'player' })), ...coaches.map(c => ({ ...c, _kind: 'coach' }))];
  const personById = new Map(persons.map(person => [person.id, person]).filter(([id]) => id));
  const itemById = new Map(asArray(data.items).map(item => [item.id, item]).filter(([id]) => id));
  const teamSet = new Set(asArray(data.teams));
  const reportIds = new Set(asArray(data.reports).map(report => report.id).filter(Boolean));
  const sponsorNames = new Set(asArray(data.settings?.sponsors).map(sponsor => normalize(sponsor.name)).filter(Boolean));

  const counts = {};
  DATA_KEYS.forEach(key => {
    const value = data[key];
    counts[key] = Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0;
  });
  counts.users = users.length;

  DATA_KEYS.forEach(key => {
    const value = data[key];
    if (Array.isArray(value)) duplicateIdIssues(issues, key, value);
  });

  players.forEach(player => {
    if (player.team && !teamSet.has(player.team)) addIssue(issues, 'warning', 'unknown_team', `players.${player.id}.team`, `Spieler ${personLabel(player)} hat eine unbekannte Mannschaft.`);
  });
  coaches.forEach(coach => {
    if (coach.team && !teamSet.has(coach.team)) addIssue(issues, 'warning', 'unknown_team', `coaches.${coach.id}.team`, `Trainer ${personLabel(coach)} hat eine unbekannte Mannschaft.`);
  });

  asArray(data.inventory).forEach(inv => {
    if (inv.itemType && !itemById.has(inv.itemType)) addIssue(issues, 'warning', 'unknown_item', `inventory.${inv.id}.itemType`, 'Material verweist auf einen nicht mehr vorhandenen Artikel.', { recordId: inv.id });
    if (inv.team && !teamSet.has(inv.team)) addIssue(issues, 'warning', 'unknown_team', `inventory.${inv.id}.team`, 'Material hat eine unbekannte Mannschaft.', { recordId: inv.id });
    if (isNonEmpty(inv.sponsorKey)) addIssue(issues, 'warning', 'legacy_inventory_sponsor_key', `inventory.${inv.id}.sponsorKey`, 'Alter Sponsor-Key am Material gefunden. Sponsoren sollen aus settings.sponsors kommen.', { recordId: inv.id });
    if (isNonEmpty(inv.assignedTo) && !personById.has(inv.assignedTo)) addIssue(issues, 'error', 'orphan_inventory_assignment', `inventory.${inv.id}.assignedTo`, 'Material ist einer nicht vorhandenen Person zugeordnet.', { recordId: inv.id });
    if (isNonEmpty(inv.reservedFor) && !personById.has(inv.reservedFor)) addIssue(issues, 'warning', 'orphan_inventory_reservation', `inventory.${inv.id}.reservedFor`, 'Material ist fuer eine nicht vorhandene Person reserviert.', { recordId: inv.id });
    if (normalize(inv.status) === 'ausgegeben' && !isNonEmpty(inv.assignedTo)) addIssue(issues, 'warning', 'stale_issued_without_person', `inventory.${inv.id}.status`, 'Material steht auf ausgegeben, hat aber keine Person; wird fachlich als Lager/Altbestand behandelt.', { recordId: inv.id });
    if (normalize(inv.status) !== 'ausgegeben' && isNonEmpty(inv.assignedTo)) addIssue(issues, 'warning', 'stock_with_assignment', `inventory.${inv.id}.assignedTo`, 'Nicht ausgegebenes Material hat noch eine assignedTo-Zuordnung.', { recordId: inv.id });
  });

  asArray(data.deposits).forEach(dep => {
    if (isNonEmpty(dep.playerId) && !personById.has(dep.playerId)) addIssue(issues, 'error', 'orphan_deposit', `deposits.${dep.id}.playerId`, 'Pfand verweist auf eine nicht vorhandene Person.', { recordId: dep.id });
  });

  asArray(data.transactions).forEach(tx => {
    if (isNonEmpty(tx.playerId) && !personById.has(tx.playerId)) addIssue(issues, 'warning', 'orphan_transaction_person', `transactions.${tx.id}.playerId`, 'Transaktion verweist auf eine nicht vorhandene Person.', { recordId: tx.id });
  });

  asArray(data.reports).forEach(report => {
    if (report.team && !teamSet.has(report.team)) addIssue(issues, 'warning', 'unknown_report_team', `reports.${report.id}.team`, 'Bedarfsmeldung hat eine unbekannte Mannschaft.', { recordId: report.id });
    if (report.item && !itemById.has(report.item)) addIssue(issues, 'warning', 'unknown_report_item', `reports.${report.id}.item`, 'Bedarfsmeldung verweist auf einen nicht vorhandenen Artikel.', { recordId: report.id });
  });

  asArray(data.orders).forEach(order => {
    if (isNonEmpty(order.sponsorKey)) {
      const known = sponsorNames.has(normalize(order.sponsorKey));
      addIssue(issues, known ? 'info' : 'warning', 'legacy_order_sponsor_key', `orders.${order.id}.sponsorKey`, 'Alter Sponsor-Key an Bestellung gefunden. Fuer Stammdaten-Auswertung bitte settings.sponsors nutzen.', { recordId: order.id });
    }
    const orderSponsors = order.sponsors || {};
    ['brust', 'ruecken', 'aermel'].forEach(field => {
      if (isNonEmpty(orderSponsors[field]) && !sponsorNames.has(normalize(orderSponsors[field]))) {
        addIssue(issues, 'warning', 'legacy_order_sponsor_value', `orders.${order.id}.sponsors.${field}`, 'Bestellung enthaelt Sponsorwert ohne passenden Sponsor-Stammdatensatz.', { recordId: order.id });
      }
    });
    asArray(order.lines).forEach((line, index) => {
      if (line.itemType && !itemById.has(line.itemType)) addIssue(issues, 'warning', 'unknown_order_item', `orders.${order.id}.lines[${index}].itemType`, 'Bestellzeile verweist auf einen nicht vorhandenen Artikel.', { recordId: order.id });
      if (line.playerId && !personById.has(line.playerId)) addIssue(issues, 'warning', 'unknown_order_person', `orders.${order.id}.lines[${index}].playerId`, 'Bestellzeile verweist auf eine nicht vorhandene Person.', { recordId: order.id });
    });
  });

  asArray(data.issueProtocols).forEach(protocol => {
    if (isNonEmpty(protocol.playerId) && !personById.has(protocol.playerId)) addIssue(issues, 'warning', 'orphan_issue_protocol', `issueProtocols.${protocol.id}.playerId`, 'Uebergabeprotokoll verweist auf eine nicht vorhandene Person.', { recordId: protocol.id });
  });

  asArray(data.settings?.sponsors).forEach((sponsor, index) => {
    if (!isNonEmpty(sponsor.name)) addIssue(issues, 'warning', 'sponsor_without_name', `settings.sponsors[${index}].name`, 'Sponsor-Stammdatensatz ohne Name gefunden.');
    asArray(sponsor.itemIds).forEach(itemId => {
      if (!itemById.has(itemId)) addIssue(issues, 'warning', 'sponsor_unknown_item', `settings.sponsors[${index}].itemIds`, 'Sponsor verweist auf einen nicht vorhandenen Artikel.', { recordId: sponsor.id });
    });
    asArray(sponsor.teams).forEach(team => {
      if (!teamSet.has(team)) addIssue(issues, 'warning', 'sponsor_unknown_team', `settings.sponsors[${index}].teams`, 'Sponsor verweist auf eine unbekannte Mannschaft.', { recordId: sponsor.id });
    });
  });

  const sponsorFingerprints = new Set();
  asArray(data.settings?.sponsors).forEach((sponsor, index) => {
    const key = [
      normalize(sponsor.name),
      normalize(sponsor.placement || 'satz'),
      asArray(sponsor.teams).map(normalize).sort().join('|'),
      asArray(sponsor.itemIds).map(normalize).sort().join('|'),
    ].join('__');
    if (sponsorFingerprints.has(key)) addIssue(issues, 'warning', 'duplicate_sponsor_mapping', `settings.sponsors[${index}]`, 'Doppelte Sponsor-Zuordnung gefunden.', { recordId: sponsor.id });
    sponsorFingerprints.add(key);
  });

  users.forEach(user => {
    if (!user?.username) addIssue(issues, 'error', 'user_without_username', 'users', 'User-Datensatz ohne username gefunden.');
    if (isNonEmpty(user?.password)) addIssue(issues, 'error', 'legacy_plain_password', `users.${user?.username || 'unknown'}.password`, 'Alter Klartext-Passwort-Feldname gefunden. Wert wird nicht ausgegeben.');
    if (!isNonEmpty(user?.passwordHash)) addIssue(issues, 'error', 'user_without_password_hash', `users.${user?.username || 'unknown'}.passwordHash`, 'User hat keinen passwordHash.');
  });

  DATA_KEYS.forEach(key => scanStrings(data[key], key, issues, maxStringIssues));

  return {
    ok: issues.filter(issue => issue.severity === 'error').length === 0,
    counts,
    issueSummary: summarizeBySeverity(issues),
    issues,
    reportIds,
  };
}
