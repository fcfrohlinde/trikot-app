import assert from 'node:assert/strict';
import { authorizeDataWrite, filterDataForUser, mergeScopedWriteValue, userCanApi } from '../api/_lib/security.js';

const user = {
  role: 'user',
  username: 'team-a',
  teams: ['A'],
  permissions: {
    canCreateOrders: true,
    canEditInventory: true,
    canManageReports: true,
    canManageDeposits: true,
  },
};

const baseData = {
  teams: ['A', 'B'],
  players: [
    { id: 'p1', team: 'A', firstName: 'A', lastName: 'One' },
    { id: 'p2', team: 'B', firstName: 'B', lastName: 'Two' },
  ],
  coaches: [],
  inventory: [
    { id: 'i1', team: 'A', status: 'lager' },
    { id: 'i2', team: 'B', status: 'lager' },
    { id: 'i3', status: 'lager' },
  ],
  deposits: [],
  transactions: [],
  reports: [
    { id: 'r1', team: 'A' },
    { id: 'r2', team: 'B' },
  ],
  orders: [
    { id: 'o1', team: 'A', lines: [] },
    { id: 'o2', team: 'B', lines: [] },
  ],
  items: [{ id: 'shirt', name: 'Shirt' }],
  suppliers: [{ id: 's1', name: 'Supplier' }],
  settings: { weeklyReportEmail: 'secret@example.org', clubName: 'Club' },
};

const filtered = filterDataForUser(baseData, user);
assert.deepEqual(filtered.teams, ['A']);
assert.deepEqual(filtered.players.map(p => p.id), ['p1']);
assert.deepEqual(filtered.reports.map(r => r.id), ['r1']);
assert.deepEqual(filtered.orders.map(o => o.id), ['o1']);
assert.deepEqual(filtered.inventory.map(i => i.id), ['i1', 'i3']);
assert.equal(filtered.settings.weeklyReportEmail, undefined);

assert.equal(userCanApi(user, 'canEditInventory'), true);
assert.equal(userCanApi({ ...user, permissions: { canEditInventory: false } }, 'canEditInventory'), false);

const blockedForeignInventoryChange = authorizeDataWrite({
  user,
  key: 'inventory',
  currentValue: baseData.inventory,
  nextValue: [
    { id: 'i1', team: 'A', status: 'lager' },
    { id: 'i2', team: 'B', status: 'ausgegeben', assignedTo: 'p2' },
    { id: 'i3', status: 'lager' },
  ],
  allData: baseData,
});
assert.equal(blockedForeignInventoryChange.ok, false);
assert.equal(blockedForeignInventoryChange.status, 403);

const allowedOwnInventoryChange = authorizeDataWrite({
  user,
  key: 'inventory',
  currentValue: baseData.inventory,
  nextValue: [
    { id: 'i1', team: 'A', status: 'ausgegeben', assignedTo: 'p1' },
    { id: 'i2', team: 'B', status: 'lager' },
    { id: 'i3', status: 'lager' },
  ],
  allData: baseData,
});
assert.equal(allowedOwnInventoryChange.ok, true);

const mergedScopedInventory = mergeScopedWriteValue({
  user,
  key: 'inventory',
  currentValue: baseData.inventory,
  nextValue: [
    { id: 'i1', team: 'A', status: 'ausgegeben', assignedTo: 'p1' },
    { id: 'i3', status: 'lager' },
  ],
  allData: baseData,
});
assert.deepEqual(mergedScopedInventory.map(i => i.id), ['i2', 'i1', 'i3']);

const blockedAdminOnlyKey = authorizeDataWrite({
  user,
  key: 'settings',
  currentValue: baseData.settings,
  nextValue: { clubName: 'Changed' },
  allData: baseData,
});
assert.equal(blockedAdminOnlyKey.ok, false);
assert.equal(blockedAdminOnlyKey.status, 403);

console.log('security helpers ok');
