import assert from 'node:assert/strict';
import { auditDataSnapshot, auditKvKeys } from '../api/_lib/dataAudit.js';

const data = {
  teams: ['ERSTE'],
  players: [{ id: 'p1', firstName: 'Max', lastName: 'Muster', team: 'ERSTE' }],
  coaches: [],
  items: [{ id: 'shirt', name: 'HEIM - Trikot' }],
  inventory: [
    {
      id: 'inv1',
      itemType: 'shirt',
      status: 'ausgegeben',
      assignedTo: null,
      sponsorKey: 'Alter Sponsor',
      assignedName: 'MÃ¼ller',
    },
    {
      id: 'inv2',
      itemType: 'missing_item',
      status: 'lager',
      assignedTo: 'ghost',
    },
  ],
  deposits: [{ id: 'dep1', playerId: 'ghost', amount: 70 }],
  transactions: [],
  reports: [{ id: 'rep1', team: 'ERSTE', item: 'missing_item' }],
  orders: [
    {
      id: 'ord1',
      sponsorKey: 'Heimtrikot KAFFEEWERK, Auswaerts Care Performance',
      sponsors: { brust: 'Nicht angelegt', ruecken: '', aermel: '' },
      lines: [{ id: 'l1', itemType: 'missing_item', playerId: 'ghost' }],
    },
  ],
  issueProtocols: [{ id: 'issue1', playerId: 'ghost' }],
  suppliers: [],
  settings: {
    sponsors: [
      { id: 'sp1', name: 'KAFFEEWERK', itemIds: ['shirt'], teams: ['ERSTE'] },
      { id: 'sp2', name: 'KAFFEEWERK', itemIds: ['shirt'], teams: ['ERSTE'] },
    ],
  },
};

const audit = auditDataSnapshot(data, {
  users: [
    { username: 'legacy', password: 'secret' },
  ],
});
const codes = new Set(audit.issues.map(issue => issue.code));

assert.equal(audit.ok, false);
assert.equal(audit.counts.issueProtocols, 1);
assert.equal(codes.has('legacy_inventory_sponsor_key'), true);
assert.equal(codes.has('legacy_order_sponsor_key'), true);
assert.equal(codes.has('legacy_order_sponsor_value'), true);
assert.equal(codes.has('stale_issued_without_person'), true);
assert.equal(codes.has('unknown_item'), true);
assert.equal(codes.has('orphan_deposit'), true);
assert.equal(codes.has('orphan_issue_protocol'), true);
assert.equal(codes.has('duplicate_sponsor_mapping'), true);
assert.equal(codes.has('legacy_plain_password'), true);
assert.equal(codes.has('mojibake_text'), true);

const keyAudit = auditKvKeys(
  ['data:players', 'data:oldSponsors', 'photo:missing_report', 'user:admin', 'meta:userCount', 'custom:key'],
  new Set(['rep1'])
);
const keyCodes = new Set(keyAudit.issues.map(issue => issue.code));

assert.equal(keyAudit.counts.unknown, 2);
assert.equal(keyCodes.has('unknown_data_key'), true);
assert.equal(keyCodes.has('orphan_photo'), true);

console.log('data audit helpers ok');
