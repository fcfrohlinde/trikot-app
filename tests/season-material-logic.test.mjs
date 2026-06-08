import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const helperStart = appSource.indexOf('function allPersons(data)');
const helperEnd = appSource.indexOf('function personHasIssuedEquipment(data, personId)');

assert.ok(helperStart > -1, 'helper start not found');
assert.ok(helperEnd > helperStart, 'helper end not found');

const helpers = vm.runInNewContext(`
${appSource.slice(helperStart, helperEnd)}
({
  chooseMaterialSourceForNeed,
  inventoryEffectiveNumber,
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
};

const jonah = { ...data.players[1], _kind: 'player' };
const source = helpers.chooseMaterialSourceForNeed(data, 'heim-trikot-new', jonah, 'M', new Set());

assert.equal(source?.id, 'inv_29_returned');
assert.equal(helpers.inventoryEffectiveNumber(data, source), '29');
assert.equal(helpers.materialSourceNeedsReprint(data, source, jonah), false);

console.log('season material matching ok');
