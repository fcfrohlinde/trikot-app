import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const helperStart = appSource.indexOf('function allPersons(data)');
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

console.log('season material matching ok');
