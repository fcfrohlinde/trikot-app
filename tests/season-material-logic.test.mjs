import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const helperStart = appSource.indexOf('const DATA_INDEX_CACHE');
const helperEnd = appSource.indexOf('function compressRanges(numbers)');

assert.ok(helperStart > -1, 'helper start not found');
assert.ok(helperEnd > helperStart, 'helper end not found');

const helpers = vm.runInNewContext(`
function getPersonStandardSets(settings) {
  return settings?.standardSets || [];
}
${appSource.slice(helperStart, helperEnd)}
getPersonStandardSets = function(settings) {
  return settings?.standardSets || [];
};
({
  chooseMaterialSourceForNeed,
  inventoryIsInStock,
  inventoryIsIssued,
  inventoryEffectiveNumber,
  inventoryNumberForTarget,
  materialSourceNeedsReprint,
  returnedStockMatchesTarget,
  buildRestbedarfOrderCandidates,
  decideMaterialNeed,
});
`, {});

const data = {
  players: [
    {
      id: 'andy',
      firstName: 'Andy',
      lastName: 'Kleber',
      number: 29,
      team: 'ERSTE',
      size: 'M',
      seasonExit: true,
    },
    {
      id: 'other',
      firstName: 'Noah',
      lastName: 'Anders',
      number: 12,
      team: 'ERSTE',
      size: 'M',
      seasonEntry: true,
    },
    {
      id: 'jonah',
      firstName: 'Jonah',
      lastName: 'Ptok',
      number: 29,
      team: 'ERSTE',
      size: 'M',
      seasonEntry: true,
    },
  ],
  coaches: [],
  items: [
    {
      id: 'heim-trikot-new',
      articleNumber: '4224-414',
      name: 'HEIM - Trikot Iconic',
    },
  ],
  inventory: [
    {
      id: 'inv_29_returned',
      status: 'lager',
      itemType: 'heim-trikot-old',
      itemName: '[4224-414] HEIM - Trikot Iconic',
      size: 'M',
      team: ' ERSTE ',
      assignedTo: null,
      assignedNumber: null,
      assignedName: 'KLEBER',
      personKind: 'player',
    },
  ],
  settings: {
    standardSets: [
      {
        id: 'set_1',
        name: 'Saisonset',
        target: 'player',
        isDefault: true,
        items: [{ itemId: 'heim-trikot-new', qty: 1 }],
      },
    ],
  },
};

const other = { ...data.players[1], _kind: 'player' };
const otherSource = helpers.chooseMaterialSourceForNeed(data, 'heim-trikot-new', other, 'M', new Set());
assert.equal(otherSource, null, 'Ruecklauf #29 darf nicht vorher fuer eine andere Nummer verbraucht werden');

const jonah = { ...data.players[2], _kind: 'player' };
const source = helpers.chooseMaterialSourceForNeed(data, 'heim-trikot-new', jonah, 'M', new Set());

assert.equal(source?.id, 'inv_29_returned');
assert.equal(helpers.inventoryNumberForTarget(data, source, jonah, 'heim-trikot-new', 'M'), '29');
assert.equal(helpers.materialSourceNeedsReprint(data, source, jonah), false);

const staleBookedStock = {
  id: 'inv_stale_booked',
  status: 'ausgegeben',
  itemType: 'heim-trikot-new',
  itemName: 'HEIM - Trikot Iconic',
  size: 'M',
  team: 'ERSTE',
  assignedTo: null,
};

assert.equal(helpers.inventoryIsIssued(data, staleBookedStock), false);
assert.equal(helpers.inventoryIsInStock(data, staleBookedStock), true);

const staleReturnedNumberedStock = {
  id: 'inv_stale_returned_29',
  status: 'ausgegeben',
  itemType: 'heim-trikot-old',
  itemName: '[4224-414] HEIM - Trikot Iconic',
  size: 'M',
  team: 'ERSTE',
  assignedTo: null,
  assignedNumber: 29,
  assignedName: 'KLEBER',
  personKind: 'player',
};

const staleSource = helpers.chooseMaterialSourceForNeed(
  { ...data, inventory: [staleReturnedNumberedStock] },
  'heim-trikot-new',
  jonah,
  'M',
  new Set()
);

assert.equal(staleSource?.id, 'inv_stale_returned_29');
assert.equal(helpers.returnedStockMatchesTarget({ ...data, inventory: [staleReturnedNumberedStock] }, staleSource, jonah, 'heim-trikot-new', 'M'), true);

const restbedarfRows = Array.from({ length: 10 }, (_, idx) => ({
  id: `missing_${idx}`,
  target: {
    id: idx < 5 ? 'coach_xl' : 'coach_l',
    firstName: idx < 5 ? 'Carsten' : 'Sebastian',
    lastName: idx < 5 ? 'Cwik' : 'Rothner',
    team: 'ERSTE',
    number: idx < 5 ? 'CC' : 'SR',
    _kind: 'coach',
  },
  item: {
    id: `missing_item_${idx % 5}`,
    name: `Artikel ${idx % 5}`,
  },
  size: idx < 5 ? 'XL' : 'L',
}));

const restbedarfCandidates = helpers.buildRestbedarfOrderCandidates(
  { players: [], coaches: [], inventory: [], items: [], orders: [], settings: {} },
  restbedarfRows
);

assert.equal(restbedarfCandidates.length, 10, 'Alle sichtbaren Restbedarfszeilen muessen in die Bestellung uebergehen');

const matrixBase = {
  players: [
    { id: 'active', firstName: 'Aktiv', lastName: 'Spieler', number: 7, team: 'ERSTE', size: 'M', _kind: 'player' },
    { id: 'entry', firstName: 'Neu', lastName: 'Spieler', number: 9, team: 'ERSTE', size: 'M', seasonEntry: true, _kind: 'player' },
    { id: 'leave', firstName: 'Alt', lastName: 'Spieler', number: 9, team: 'ERSTE', size: 'M', seasonExit: true, _kind: 'player' },
    { id: 'no_number', firstName: 'Ohne', lastName: 'Nummer', team: 'ERSTE', size: 'M', _kind: 'player' },
  ],
  coaches: [
    { id: 'coach', firstName: 'Co', lastName: 'Ach', number: 'CA', team: 'ERSTE', size: 'L', _kind: 'coach' },
  ],
  items: [{ id: 'shirt', articleNumber: '1000-01', name: 'Shirt' }],
  inventory: [],
  orders: [],
  settings: {},
};

assert.equal(
  helpers.decideMaterialNeed({
    ...matrixBase,
    inventory: [{ id: 'issued_active', status: 'ausgegeben', itemType: 'shirt', size: 'M', assignedTo: 'active', team: 'ERSTE' }],
  }, matrixBase.players[0], 'shirt', 'M').action,
  'covered_issued',
  'Aktive Person mit ausgegebenem Artikel darf keine Bestellung erzeugen'
);

assert.equal(
  helpers.decideMaterialNeed({
    ...matrixBase,
    inventory: [{ id: 'stock_active', status: 'lager', itemType: 'shirt', size: 'M', team: 'ERSTE' }],
  }, matrixBase.players[0], 'shirt', 'M').action,
  'reserve_or_issue',
  'Passender Lagerbestand wird vor Bestellung vorgeschlagen'
);

assert.equal(
  helpers.decideMaterialNeed({
    ...matrixBase,
    orders: [{ id: 'ord_active', status: 'angelegt', lines: [{ id: 'l1', itemType: 'shirt', size: 'M', qty: 1, playerId: 'active' }] }],
  }, matrixBase.players[0], 'shirt', 'M').action,
  'covered_ordered',
  'Offene Bestellung deckt den Bedarf'
);

assert.equal(
  helpers.decideMaterialNeed(matrixBase, matrixBase.players[1], 'shirt', 'M').action,
  'order',
  'Eintritt ohne Lager und ohne Bestellung erzeugt Restbedarf'
);

assert.equal(
  helpers.decideMaterialNeed({
    ...matrixBase,
    inventory: [{ id: 'issued_leave', status: 'ausgegeben', itemType: 'shirt', size: 'M', assignedTo: 'leave', team: 'ERSTE' }],
  }, matrixBase.players[2], 'shirt', 'M').action,
  'not_needed_leaving',
  'Austritt erzeugt keinen neuen Bestellbedarf'
);

assert.equal(
  helpers.decideMaterialNeed({
    ...matrixBase,
    inventory: [{ id: 'transfer_from_leave', status: 'ausgegeben', itemType: 'shirt', size: 'M', assignedTo: 'leave', team: 'ERSTE' }],
  }, matrixBase.players[1], 'shirt', 'M').action,
  'redistribute',
  'Eintritt uebernimmt gleichen Artikel gleicher Groesse und Nummer vom Austritt'
);

assert.equal(
  helpers.decideMaterialNeed({
    ...matrixBase,
    inventory: [{
      id: 'transfer_from_legacy_assignment',
      status: 'ausgegeben',
      itemType: 'shirt',
      size: 'M',
      assignedTo: 'Alt Spieler',
      assignedName: 'Spieler',
      assignedNumber: 9,
      personKind: 'player',
      team: 'ERSTE',
    }],
  }, matrixBase.players[1], 'shirt', 'M').action,
  'redistribute',
  'Ausgegebenes Altbestandsteil wird ueber Mannschaft, Nummer und Name dem Austritt zugeordnet'
);

const coachSeasonData = {
  ...matrixBase,
  players: [],
  coaches: [
    { id: 'coach_leave', firstName: 'Alt', lastName: 'Trainer', number: 'AT', team: 'ERSTE', size: 'L', seasonExit: true, _kind: 'coach' },
    { id: 'coach_entry', firstName: 'Neu', lastName: 'Coach', number: 'AT', team: 'ERSTE', size: 'L', seasonEntry: true, _kind: 'coach' },
  ],
  inventory: [{ id: 'coach_transfer', status: 'ausgegeben', itemType: 'shirt', size: 'L', assignedTo: 'coach_leave', team: 'ERSTE', personKind: 'coach' }],
};
assert.equal(
  helpers.decideMaterialNeed(coachSeasonData, coachSeasonData.coaches[1], 'shirt', 'L').action,
  'redistribute',
  'Trainer mit gleichen Initialen und Saisonstatus werden ebenfalls umverteilt'
);

assert.equal(
  helpers.decideMaterialNeed({
    ...matrixBase,
    inventory: [{ id: 'reprint_from_leave', status: 'ausgegeben', itemType: 'shirt', size: 'M', assignedTo: 'leave', team: 'ERSTE', assignedNumber: 9 }],
    players: matrixBase.players.map(p => p.id === 'entry' ? { ...p, number: 10 } : p),
  }, { ...matrixBase.players[1], number: 10 }, 'shirt', 'M').action,
  'redistribute_reprint',
  'Abweichende Nummer gleicher Groesse wird als Umflockung/Umverteilung erkannt'
);

assert.equal(
  helpers.decideMaterialNeed({
    ...matrixBase,
    inventory: [{ id: 'coach_stock', status: 'lager', itemType: 'shirt', size: 'L', team: 'ERSTE' }],
  }, matrixBase.coaches[0], 'shirt', 'L').action,
  'reserve_or_issue',
  'Trainer werden mit Initialen statt Spielernummer verarbeitet'
);

assert.equal(
  helpers.decideMaterialNeed(matrixBase, matrixBase.players[3], 'shirt', 'M').reason,
  'missing_player_number',
  'Personalisierter Spielerartikel ohne Nummer ist ungueltig'
);

assert.equal(
  helpers.decideMaterialNeed({
    ...matrixBase,
    inventory: [{ id: 'reserved_other', status: 'lager', itemType: 'shirt', size: 'M', team: 'ERSTE', reservedFor: 'other_person' }],
  }, matrixBase.players[0], 'shirt', 'M').action,
  'order',
  'Fuer andere reservierter Bestand wird nicht erneut verplant'
);

console.log('season material matching ok');
