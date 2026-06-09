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
  materialSourceIsRedistribution,
  returnedStockMatchesTarget,
  buildRestbedarfOrderCandidates,
  buildSeasonMaterialProposalRows,
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
assert.equal(helpers.materialSourceIsRedistribution(data, source, jonah, 'heim-trikot-new', 'M'), false);
assert.equal(helpers.decideMaterialNeed(data, jonah, 'heim-trikot-new', 'M').action, 'reserve_or_issue', 'Ruecklauf Lager zaehlt als Lagerausgabe, nicht als Umverteilung');

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

const restbedarfFiveRows = Array.from({ length: 5 }, (_, idx) => ({
  id: `rest_${idx}`,
  target: { id: 'target_kt', firstName: 'Konstantinos', lastName: 'Tsakiridis', team: 'ERSTE', number: 'KT', _kind: 'coach', size: 'L' },
  item: { id: `rest_item_${idx}`, name: `Rest Artikel ${idx}` },
  size: 'L',
}));
const restbedarfFiveData = {
  players: [],
  coaches: [{ id: 'target_kt', firstName: 'Konstantinos', lastName: 'Tsakiridis', team: 'ERSTE', number: 'KT', _kind: 'coach', size: 'L' }],
  items: restbedarfFiveRows.map(row => row.item),
  inventory: [{ id: 'already_planned_source', status: 'lager', itemType: 'rest_item_0', size: 'L', team: 'ERSTE' }],
  orders: [],
  settings: {},
};
assert.equal(
  helpers.buildRestbedarfOrderCandidates(restbedarfFiveData, restbedarfFiveRows).length,
  4,
  'Ohne reservierte Vorschlagsquelle wuerde der Recheck eine sichtbare Restposition herausfiltern'
);
assert.equal(
  helpers.buildRestbedarfOrderCandidates(restbedarfFiveData, restbedarfFiveRows, { reservedSourceIds: ['already_planned_source'] }).length,
  5,
  'Bereits anderweitig verplante Quellen duerfen sichtbaren Restbedarf nicht aus der Bestellung entfernen'
);

const benHeikeData = {
  players: [
    { id: 'other_entry', firstName: 'Andere', lastName: 'Nummer', number: 6, team: 'ERSTE', size: 'L', seasonEntry: true, _kind: 'player' },
    { id: 'ben', firstName: 'Ben', lastName: 'Heike', number: 5, team: 'ERSTE', size: 'L', seasonEntry: true, _kind: 'player' },
  ],
  coaches: [],
  items: [
    { id: 'aufwaermshirt', articleNumber: '6124-403', name: 'Aufwaermshirt Iconic' },
    { id: 'heim_short', articleNumber: '4400-04', name: 'HEIM - Short' },
    { id: 'zip_shirt', articleNumber: '8824-403', name: 'ZIP Shirt Iconic' },
    { id: 'jacke', articleNumber: '9324-403', name: 'Jacke Iconic' },
    { id: 'hose_poly', articleNumber: '9223-900', name: 'Trainingshose Polyester' },
    { id: 'hose_power', articleNumber: '8423-900', name: 'Trainingshose Power' },
  ],
  inventory: [
    { id: 'inv_aufwaerm', status: 'lager', itemType: 'legacy_a', itemName: 'Aufwärmshirt Iconic', size: 'L', team: 'ERSTE', assignedNumber: 5, personKind: 'player' },
    { id: 'inv_short', status: 'lager', itemType: 'legacy_b', itemName: 'HEIM - ShortHEIM - Short', size: 'L', team: 'ERSTE', assignedNumber: 5, personKind: 'player' },
    { id: 'inv_zip', status: 'lager', itemType: 'legacy_c', itemName: 'ZIP Shirt IconicZIP Shirt Iconic', size: 'L', team: 'ERSTE', assignedNumber: 5, personKind: 'player' },
    { id: 'inv_jacke', status: 'lager', itemType: 'legacy_d', itemName: 'Jacke IconicJacke Iconic', size: 'L', team: 'ERSTE', assignedNumber: 5, personKind: 'player' },
    { id: 'inv_poly', status: 'lager', itemType: 'legacy_e', itemName: 'Trainingshose PolyesterTrainingshose Polyester', size: 'L', team: 'ERSTE', assignedNumber: 5, personKind: 'player' },
    { id: 'inv_power', status: 'lager', itemType: 'legacy_f', itemName: 'Trainingshose Power', size: 'L', team: 'ERSTE', assignedNumber: 5, personKind: 'player' },
  ],
  orders: [],
  settings: {},
};
const otherEntry = benHeikeData.players[0];
assert.equal(
  helpers.decideMaterialNeed(benHeikeData, otherEntry, 'aufwaermshirt', 'L').action,
  'order',
  'Nummerierter Lagerbestand #5 darf nicht vorher fuer andere Eintrittsnummern als Umbeflockung verbraucht werden'
);
assert.equal(
  helpers.chooseMaterialSourceForNeed(benHeikeData, 'aufwaermshirt', otherEntry, 'L', new Set()),
  null,
  'Nr.-5-Lagerquelle wird fuer andere Eintrittsnummern bereits in der Quellenauswahl gesperrt'
);
const benTarget = benHeikeData.players[1];
const benActions = benHeikeData.items.map(item => helpers.decideMaterialNeed(benHeikeData, benTarget, item.id, 'L').action);
assert.deepEqual(
  benActions,
  ['reserve_or_issue', 'reserve_or_issue', 'reserve_or_issue', 'reserve_or_issue', 'reserve_or_issue', 'reserve_or_issue'],
  'Alle sechs Lagerteile mit Nr. 5 muessen fuer Ben Heike als Ausgabe aus Lager erkannt werden'
);
const benProposalRows = helpers.buildSeasonMaterialProposalRows({
  ...benHeikeData,
  settings: {
    standardSets: [{
      id: 'set_ben',
      name: 'Ben Set',
      target: 'player',
      isDefault: true,
      items: benHeikeData.items.map(item => ({ itemId: item.id, qty: 1 })),
    }],
  },
});
const benIssueRows = benProposalRows.filter(row => row.target.id === 'ben' && row.category === 'ausgabe');
assert.equal(benIssueRows.length, 6, 'Die komplette Vorschlagsliste muss alle sechs Ben-Heike-Lagerausgaben enthalten');
assert.equal(benProposalRows.some(row => row.target.id === 'other_entry' && row.source?.assignedNumber === 5), false, 'Die komplette Vorschlagsliste darf Nr.-5-Quellen nicht an andere Eintrittsnummern vergeben');

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

const sameNumberEntryProtectedData = {
  players: [
    { id: 'meikel', firstName: 'Meikel', lastName: 'Wagner', number: 1, team: 'ERSTE', size: 'XL', seasonExit: true },
    { id: 'pascal', firstName: 'Pascal', lastName: 'Eiba', number: 1, team: 'ERSTE', size: 'XL', seasonEntry: true },
    { id: 'kyell', firstName: 'Kyell', lastName: 'Gardemann', number: 6, team: 'ERSTE', size: 'XL', seasonEntry: true },
  ],
  coaches: [],
  items: [{ id: 'shirt', articleNumber: '1000-01', name: 'Shirt' }],
  inventory: [{ id: 'meikel_shirt', status: 'ausgegeben', itemType: 'shirt', size: 'XL', assignedTo: 'meikel', team: 'ERSTE' }],
  orders: [],
  settings: {
    standardSets: [{
      id: 'set_player',
      name: 'Spieler-Set',
      target: 'player',
      isDefault: true,
      items: [{ itemId: 'shirt', qty: 1 }],
    }],
  },
};
assert.equal(
  helpers.decideMaterialNeed(sameNumberEntryProtectedData, { ...sameNumberEntryProtectedData.players[1], _kind: 'player' }, 'shirt', 'XL').action,
  'redistribute',
  'Austritt Nr. 1 wird fuer Eintritt Nr. 1 gleicher Mannschaft und Groesse umverteilt'
);
assert.equal(
  helpers.decideMaterialNeed(sameNumberEntryProtectedData, { ...sameNumberEntryProtectedData.players[2], _kind: 'player' }, 'shirt', 'XL').action,
  'order',
  'Austritt Nr. 1 darf nicht als Umbeflockung fuer Eintritt Nr. 6 verbraucht werden'
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
