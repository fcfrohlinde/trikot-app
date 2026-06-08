export const DATA_KEYS = ['players', 'coaches', 'inventory', 'items', 'teams', 'deposits', 'orders', 'transactions', 'reports', 'issueProtocols', 'suppliers', 'settings'];

export const DEFAULT_USER_PERMISSIONS = {
  canDeletePeople: false,
  canCreateOrders: true,
  canEditInventory: true,
  canManageReports: true,
  canManageDeposits: true,
};

const ADMIN_ONLY_DATA_KEYS = new Set(['items', 'teams', 'suppliers', 'settings']);

const WRITE_PERMISSION_BY_KEY = {
  inventory: 'canEditInventory',
  orders: 'canCreateOrders',
  reports: 'canManageReports',
  issueProtocols: 'canManageDeposits',
  deposits: 'canManageDeposits',
  transactions: 'canManageDeposits',
};

function isAdmin(user) {
  return user?.role === 'admin';
}

export function userCanApi(user, action) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const permissions = { ...DEFAULT_USER_PERMISSIONS, ...(user.permissions || {}) };
  return permissions[action] === true;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function sameRecord(a, b) {
  return stableStringify(a) === stableStringify(b);
}

function personIdSet(data, teams) {
  const teamSet = new Set(teams);
  const players = (data.players || []).filter(p => teamSet.has(p.team)).map(p => p.id);
  const coaches = (data.coaches || []).filter(c => teamSet.has(c.team)).map(c => c.id);
  return new Set([...players, ...coaches].filter(Boolean));
}

export function scopeForUser(data, user) {
  const teams = Array.isArray(user?.teams) ? user.teams.filter(Boolean) : [];
  return {
    teams: new Set(teams),
    personIds: personIdSet(data || {}, teams),
  };
}

function isVisibleByKey(key, record, scope) {
  if (!record) return false;
  if (key === 'players' || key === 'coaches' || key === 'reports') return scope.teams.has(record.team);
  if (key === 'deposits' || key === 'transactions' || key === 'issueProtocols') return scope.personIds.has(record.playerId);
  if (key === 'inventory') {
    if (record.status === 'ausgegeben') return record.assignedTo && scope.personIds.has(record.assignedTo);
    return !record.team || scope.teams.has(record.team);
  }
  if (key === 'orders') {
    if (record.team && record.team !== 'mehrere') return scope.teams.has(record.team);
    const lines = Array.isArray(record.lines) ? record.lines : [];
    return lines.length > 0 && lines.some(line => line.playerId && scope.personIds.has(line.playerId));
  }
  return false;
}

function isWritableByKey(key, record, scope) {
  if (!record) return false;
  if (key === 'players' || key === 'coaches' || key === 'reports') return scope.teams.has(record.team);
  if (key === 'deposits' || key === 'transactions' || key === 'issueProtocols') return scope.personIds.has(record.playerId);
  if (key === 'inventory') {
    if (record.status === 'ausgegeben') return record.assignedTo && scope.personIds.has(record.assignedTo);
    return !record.team || scope.teams.has(record.team);
  }
  if (key === 'orders') {
    if (record.team && record.team !== 'mehrere' && !scope.teams.has(record.team)) return false;
    const lines = Array.isArray(record.lines) ? record.lines : [];
    const personLines = lines.filter(line => line.playerId);
    return personLines.length === 0 || personLines.every(line => scope.personIds.has(line.playerId));
  }
  return false;
}

function redactSettingsForUser(settings = {}) {
  const { weeklyReportEmail, ...safeSettings } = settings || {};
  return safeSettings;
}

export function filterDataForUser(data, user) {
  if (isAdmin(user)) return data;
  const scope = scopeForUser(data, user);
  return {
    ...data,
    teams: (data.teams || []).filter(t => scope.teams.has(t)),
    players: (data.players || []).filter(p => isVisibleByKey('players', p, scope)),
    coaches: (data.coaches || []).filter(c => isVisibleByKey('coaches', c, scope)),
    deposits: (data.deposits || []).filter(d => isVisibleByKey('deposits', d, scope)),
    transactions: (data.transactions || []).filter(t => isVisibleByKey('transactions', t, scope)),
    issueProtocols: (data.issueProtocols || []).filter(p => isVisibleByKey('issueProtocols', p, scope)),
    reports: (data.reports || []).filter(r => isVisibleByKey('reports', r, scope)),
    orders: (data.orders || []).filter(o => isVisibleByKey('orders', o, scope)),
    inventory: (data.inventory || []).filter(i => isVisibleByKey('inventory', i, scope)),
    settings: redactSettingsForUser(data.settings || {}),
  };
}

export function authorizeDataWrite({ user, key, currentValue, nextValue, allData }) {
  if (!DATA_KEYS.includes(key)) return { ok: false, status: 400, error: 'Ungültiger Schlüssel' };
  if (isAdmin(user)) return { ok: true };
  if (ADMIN_ONLY_DATA_KEYS.has(key)) return { ok: false, status: 403, error: 'Keine Berechtigung für diesen Datenbereich' };

  const neededPermission = WRITE_PERMISSION_BY_KEY[key];
  if (neededPermission && !userCanApi(user, neededPermission)) {
    return { ok: false, status: 403, error: 'Keine Berechtigung für diese Änderung' };
  }

  if (!Array.isArray(currentValue) || !Array.isArray(nextValue)) {
    return { ok: false, status: 400, error: 'Dieser Datenbereich muss als Liste gespeichert werden' };
  }

  const scope = scopeForUser(allData || {}, user);
  const currentById = new Map(currentValue.map(entry => [entry?.id, entry]).filter(([entryId]) => entryId));
  const nextById = new Map(nextValue.map(entry => [entry?.id, entry]).filter(([entryId]) => entryId));

  for (const current of currentValue) {
    if (!current?.id) continue;
    if (!isVisibleByKey(key, current, scope)) {
      const next = nextById.get(current.id);
      if (!next || !sameRecord(current, next)) {
        return { ok: false, status: 403, error: 'Änderung außerhalb der zugeordneten Mannschaften blockiert' };
      }
    }
  }

  for (const next of nextValue) {
    if (!next?.id) return { ok: false, status: 400, error: 'Listeneinträge benötigen eine ID' };
    const current = currentById.get(next.id);
    const isNewOrChanged = !current || !sameRecord(current, next);
    if (isNewOrChanged && !isWritableByKey(key, next, scope)) {
      return { ok: false, status: 403, error: 'Eintrag liegt außerhalb der zugeordneten Mannschaften' };
    }
  }

  return { ok: true };
}

export function mergeScopedWriteValue({ user, key, currentValue, nextValue, allData }) {
  if (isAdmin(user) || !Array.isArray(currentValue) || !Array.isArray(nextValue)) return nextValue;
  const scope = scopeForUser(allData || {}, user);
  const nextIds = new Set(nextValue.map(entry => entry?.id).filter(Boolean));
  const preserved = currentValue.filter(entry =>
    entry?.id &&
    !nextIds.has(entry.id) &&
    !isVisibleByKey(key, entry, scope)
  );
  return [...preserved, ...nextValue];
}

export function canAccessReport(user, report, data) {
  if (!report) return false;
  if (isAdmin(user)) return true;
  return scopeForUser(data || {}, user).teams.has(report.team);
}
