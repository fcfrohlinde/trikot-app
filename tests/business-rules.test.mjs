import assert from 'node:assert/strict';
import { validateBusinessRules } from '../api/_lib/businessRules.js';

const baseData = {
  teams: ['ERSTE', 'ZWEITE'],
  players: [
    { id: 'active', firstName: 'Aktiv', lastName: 'Spieler', number: 7, team: 'ERSTE', size: 'M' },
    { id: 'entry', firstName: 'Neu', lastName: 'Spieler', number: 9, team: 'ERSTE', size: 'M', seasonEntry: true },
    { id: 'leave', firstName: 'Alt', lastName: 'Spieler', number: 11, team: 'ERSTE', size: 'M', seasonExit: true },
    { id: 'no_number', firstName: 'Ohne', lastName: 'Nummer', team: 'ERSTE', size: 'M' },
  ],
  coaches: [
    { id: 'coach', firstName: 'Train', lastName: 'Er', number: 'TE', team: 'ERSTE', size: 'L' },
  ],
  items: [
    { id: 'shirt', articleNumber: '1000-01', name: 'Shirt' },
    { id: 'sock', articleNumber: '2000-01', name: 'Stutzen', reprintExcluded: true },
  ],
  inventory: [],
  orders: [],
  deposits: [],
  transactions: [],
  reports: [],
  issueProtocols: [],
};

function validate(key, currentValue, nextValue, data = baseData) {
  return validateBusinessRules({ key, currentValue, nextValue, allData: data });
}

const duplicateOpenOrders = [
  {
    id: 'ord_1',
    status: 'angelegt',
    team: 'ERSTE',
    lines: [{ id: 'l1', itemType: 'shirt', size: 'M', qty: 1, playerId: 'active', number: 7 }],
  },
  {
    id: 'ord_2',
    status: 'angelegt',
    team: 'ERSTE',
    lines: [{ id: 'l2', itemType: 'shirt', size: 'M', qty: 1, playerId: 'active', number: 7 }],
  },
];
assert.equal(validate('orders', [], duplicateOpenOrders).ok, false, 'Doppelte offene Bestellungen fuer denselben Bedarf werden blockiert');
assert.equal(validate('orders', [], duplicateOpenOrders).code, 'duplicate_open_order_need');
assert.match(
  validate('orders', [], duplicateOpenOrders).error,
  /ord_1|Bestehende Bestellung/,
  'Fehlermeldung verweist auf die bestehende Bestellung'
);
assert.equal(
  validate('orders', [], duplicateOpenOrders).details.duplicateOrders.length,
  2,
  'Fehlerdetails enthalten die betroffenen offenen Bestellungen'
);

const duplicateOpenOrdersWithSpecialCase = [
  duplicateOpenOrders[0],
  {
    ...duplicateOpenOrders[1],
    lines: [{
      ...duplicateOpenOrders[1].lines[0],
      allowDuplicateOrder: true,
      duplicateReason: 'Sonderfall Ersatzsatz',
    }],
  },
];
assert.equal(
  validate('orders', [], duplicateOpenOrdersWithSpecialCase).ok,
  true,
  'Doppelbestellung ist mit markiertem Sonderfall und Begruendung erlaubt'
);

const legacyDuplicateOrders = [
  {
    id: 'ord_legacy_1',
    status: 'angelegt',
    team: 'ERSTE',
    articleSupplierId: 'old',
    lines: [{ id: 'l1', itemType: 'shirt', size: 'M', qty: 1, playerId: 'active', number: 7 }],
  },
  {
    id: 'ord_legacy_2',
    status: 'angelegt',
    team: 'ERSTE',
    lines: [{ id: 'l2', itemType: 'shirt', size: 'M', qty: 1, playerId: 'active', number: 7 }],
  },
];
const legacyDuplicateSupplierEdit = [
  { ...legacyDuplicateOrders[0], articleSupplierId: 'new' },
  legacyDuplicateOrders[1],
];
assert.equal(
  validate('orders', legacyDuplicateOrders, legacyDuplicateSupplierEdit).ok,
  true,
  'Bestehende Alt-Dubletten duerfen Lieferant/Sponsor/Metadaten weiter bearbeiten'
);

const newDuplicateAddedToLegacy = [
  ...legacyDuplicateOrders,
  {
    id: 'ord_legacy_3',
    status: 'angelegt',
    team: 'ERSTE',
    lines: [{ id: 'l3', itemType: 'shirt', size: 'M', qty: 1, playerId: 'active', number: 7 }],
  },
];
assert.equal(
  validate('orders', legacyDuplicateOrders, newDuplicateAddedToLegacy).code,
  'duplicate_open_order_need',
  'Neue zusaetzliche Dubletten bleiben blockiert'
);

const sameOrderMultiQty = [
  {
    id: 'ord_qty',
    status: 'angelegt',
    team: 'ERSTE',
    lines: [{ id: 'l1', itemType: 'sock', size: 'M', qty: 2, playerId: 'active', number: 7 }],
  },
];
assert.equal(validate('orders', [], sameOrderMultiQty).ok, true, 'Menge > 1 in einer Position bleibt fuer neutrale Artikel erlaubt');

const duplicatedPersonalizedQty = [
  {
    id: 'ord_qty_personalized',
    status: 'angelegt',
    team: 'ERSTE',
    lines: [{ id: 'l1', itemType: 'shirt', size: 'M', qty: 2, playerId: 'active', number: 7 }],
  },
];
assert.equal(validate('orders', [], duplicatedPersonalizedQty).code, 'duplicate_personalized_quantity');

const duplicatedPersonalizedQtySpecial = [{
  ...duplicatedPersonalizedQty[0],
  lines: [{
    ...duplicatedPersonalizedQty[0].lines[0],
    allowDuplicateOrder: true,
    duplicateReason: 'Sonderfall Ersatzsatz',
  }],
}];
assert.equal(
  validate('orders', [], duplicatedPersonalizedQtySpecial).ok,
  true,
  'Mehrfachmenge fuer personalisierte Artikel ist nur mit Sonderfall erlaubt'
);

const issuedData = {
  ...baseData,
  inventory: [{ id: 'inv_issued', status: 'ausgegeben', itemType: 'shirt', size: 'M', team: 'ERSTE', assignedTo: 'active' }],
};
const orderForIssued = [{
  id: 'ord_issued',
  status: 'angelegt',
  team: 'ERSTE',
  lines: [{ id: 'l1', itemType: 'shirt', size: 'M', qty: 1, playerId: 'active', number: 7 }],
}];
assert.equal(validate('orders', [], orderForIssued, issuedData).code, 'already_issued_no_new_order');

const replacementForIssued = [{
  id: 'ord_replacement',
  status: 'angelegt',
  team: 'ERSTE',
  lines: [{ id: 'l1', itemType: 'shirt', size: 'M', qty: 1, playerId: 'active', number: 7, orderReason: 'Ersatz defekt' }],
}];
assert.equal(validate('orders', [], replacementForIssued, issuedData).ok, true, 'Expliziter Ersatzgrund darf trotz Ausgabe bestellt werden');

const currentEditableOrder = [{
  id: 'ord_edit',
  status: 'angelegt',
  team: 'ERSTE',
  articleSupplierId: 'old',
  lines: [{ id: 'l1', itemType: 'shirt', size: 'M', qty: 1, playerId: 'active', number: 7 }],
}];
const supplierChangedOnly = [{ ...currentEditableOrder[0], articleSupplierId: 'new' }];
assert.equal(validate('orders', currentEditableOrder, supplierChangedOnly, issuedData).ok, true, 'Bestehende Bestellung bleibt bei Lieferanten-/Sponsor-Aenderung editierbar');

const orderForLeaving = [{
  id: 'ord_leave',
  status: 'angelegt',
  team: 'ERSTE',
  lines: [{ id: 'l1', itemType: 'shirt', size: 'M', qty: 1, playerId: 'leave', number: 11 }],
}];
assert.equal(validate('orders', [], orderForLeaving).code, 'person_leaves_no_new_order');

const missingPlayerNumber = [{
  id: 'ord_no_number',
  status: 'angelegt',
  team: 'ERSTE',
  lines: [{ id: 'l1', itemType: 'shirt', size: 'M', qty: 1, playerId: 'no_number' }],
}];
assert.equal(validate('orders', [], missingPlayerNumber).code, 'missing_player_number');

const coachOrder = [{
  id: 'ord_coach',
  status: 'angelegt',
  team: 'ERSTE',
  lines: [{ id: 'l1', itemType: 'shirt', size: 'L', qty: 1, playerId: 'coach', personKind: 'coach', number: 'TE' }],
}];
assert.equal(validate('orders', [], coachOrder).ok, true, 'Trainer-Initialen werden serverseitig akzeptiert');

assert.equal(
  validate('inventory', [], [{ id: 'inv_bad', status: 'ausgegeben', itemType: 'shirt', size: 'M', team: 'ERSTE' }]).code,
  'issued_without_person',
  'Ausgegebenes Material ohne Person wird blockiert'
);

assert.equal(
  validate('inventory', [], [{ id: 'inv_reserved_bad', status: 'lager', itemType: 'shirt', size: 'M', team: 'ERSTE', reservedFor: 'missing' }]).code,
  'unknown_inventory_reservation',
  'Reservierung fuer unbekannte Person wird blockiert'
);

assert.equal(
  validate('inventory', [], [{ id: 'inv_lost', status: 'verloren', itemType: 'shirt', size: 'M', team: 'ERSTE', assignedTo: 'active' }]).code,
  'lost_material_assigned',
  'Verlorenes Material darf nicht weiter zugeordnet sein'
);

assert.equal(
  validate('inventory', [], [{ id: 'inv_issued_ok', status: 'ausgegeben', itemType: 'shirt', size: 'M', team: 'ERSTE', assignedTo: 'active', personKind: 'player' }]).ok,
  true,
  'Gueltige Ausgabe bleibt erlaubt'
);

assert.equal(
  validate('issueProtocols', [], [{ id: 'ip_bad', playerId: 'missing', team: 'ERSTE' }]).code,
  'unknown_issueProtocols_person',
  'Uebergabeprotokolle brauchen eine gueltige Person'
);

console.log('business rules ok');
