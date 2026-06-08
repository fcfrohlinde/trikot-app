import { kv, requireAdmin } from '../_lib/auth.js';
import { auditDataSnapshot, auditKvKeys } from '../_lib/dataAudit.js';
import { logApiError, methodNotAllowed, requestId, serverError, setApiSecurityHeaders } from '../_lib/http.js';
import { DATA_KEYS } from '../_lib/security.js';

async function loadKnownData() {
  const data = {};
  for (const key of DATA_KEYS) {
    const value = await kv.get(`data:${key}`);
    data[key] = value !== null && value !== undefined ? value : (key === 'settings' ? {} : []);
  }
  return data;
}

async function loadUsersForAudit() {
  const usernames = (await kv.smembers('users:list')) || [];
  const users = await Promise.all(usernames.map(username => kv.get(`user:${username}`)));
  return users.filter(Boolean);
}

async function scanKvKeys() {
  if (typeof kv.scan !== 'function') {
    return { supported: false, keys: [], truncated: false };
  }

  const keys = [];
  let cursor = 0;
  let safety = 0;
  let truncated = false;

  do {
    const result = await kv.scan(cursor, { match: '*', count: 200 });
    let nextCursor;
    let batch;
    if (Array.isArray(result)) {
      [nextCursor, batch] = result;
    } else {
      nextCursor = result?.cursor ?? result?.[0] ?? 0;
      batch = result?.keys ?? result?.[1] ?? [];
    }
    keys.push(...(Array.isArray(batch) ? batch : []));
    cursor = nextCursor;
    safety += 1;
    if (keys.length >= 10000 || safety >= 100) {
      truncated = true;
      break;
    }
  } while (String(cursor) !== '0');

  return { supported: true, keys, truncated };
}

function mergeSummary(issues) {
  return issues.reduce((out, issue) => {
    out[issue.severity] = (out[issue.severity] || 0) + 1;
    return out;
  }, {});
}

export default async function handler(req, res) {
  const id = requestId();
  setApiSecurityHeaders(res);

  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    if (req.method !== 'GET') {
      return methodNotAllowed(res, ['GET']);
    }

    const [data, users, scan] = await Promise.all([
      loadKnownData(),
      loadUsersForAudit(),
      scanKvKeys(),
    ]);

    const dataAudit = auditDataSnapshot(data, { users });
    const keyAudit = auditKvKeys(scan.keys, dataAudit.reportIds);
    const issues = [...dataAudit.issues, ...keyAudit.issues]
      .sort((a, b) => {
        const order = { error: 0, warning: 1, info: 2 };
        return (order[a.severity] ?? 9) - (order[b.severity] ?? 9) || String(a.path).localeCompare(String(b.path));
      });

    return res.json({
      ok: issues.filter(issue => issue.severity === 'error').length === 0,
      auditedAt: new Date().toISOString(),
      dataCounts: dataAudit.counts,
      kvScan: {
        supported: scan.supported,
        truncated: scan.truncated,
        counts: keyAudit.counts,
      },
      issueSummary: mergeSummary(issues),
      issues,
    });
  } catch (e) {
    logApiError(id, 'Datenbank-Audit fehlgeschlagen', e, { method: req.method });
    return serverError(res, id, 'Datenbank-Audit konnte nicht ausgefuehrt werden. Bitte Vercel-Logs pruefen.');
  }
}
