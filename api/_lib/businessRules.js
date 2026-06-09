const CLOSED_ORDER_STATUSES = new Set([
  'geliefert',
  'storniert',
  'cancelled',
  'canceled',
  'abgeschlossen',
  'closed',
  'erledigt',
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isNonEmpty(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeSizeKey(value) {
  const size = String(value || '').trim().toUpperCase();
  return size === '3XL' ? 'XXXL' : size;
}

function normalizePersonKind(value) {
  const raw = normalize(value);
  if (raw === 'spieler' || raw === 'player') return 'player';
  if (raw === 'trainer' || raw === 'coach') return 'coach';
  return raw;
}

function articleCodesFrom(...values) {
  const codes = new Set();
  values.forEach(value => {
    String(value || '').replace(/\b\d{3,5}[-/]\d{2,5}\b/g, match => {
      codes.add(match.replace('/', '-').toLowerCase());
      return match;
    });
  });
  return [...codes].sort();
}

function normalizeArticleText(value) {
  return normalize(value)
    .replace(/\u00e4/g, 'ae')
    .replace(/\u00f6/g, 'oe')
    .replace(/\u00fc/g, 'ue')
    .replace(/\u00df/g, 'ss')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function sameRecord(a, b) {
  return stableStringify(a) === stableStringify(b);
}

function reject(status, code, path, error) {
  return { ok: false, status, code, path, error };
}

function ok() {
  return { ok: true };
}

function currentRecordMap(records) {
  return new Map(asArray(records).map(record => [record?.id, record]).filter(([id]) => id));
}

function duplicateIdResult(key, records) {
  const seen = new Set();
  for (let index = 0; index < asArray(records).length; index += 1) {
    const record = records[index];
    if (!record?.id) return reject(400, 'missing_id', `${key}[${index}]`, 'Listeneintraege benoetigen eine ID.');
    if (seen.has(record.id)) return reject(409, 'duplicate_id', `${key}.${record.id}`, 'Doppelte ID im Datenbereich.');
    seen.add(record.id);
  }
  return ok();
}

function buildIndexes(data) {
  const players = asArray(data.players).map(person => ({ ...person, _kind: 'player' }));
  const coaches = asArray(data.coaches).map(person => ({ ...person, _kind: 'coach' }));
  const persons = [...players, ...coaches];
  return {
    players,
    coaches,
    persons,
    personById: new Map(persons.map(person => [person.id, person]).filter(([id]) => id)),
    itemById: new Map(asArray(data.items).map(item => [item.id, item]).filter(([id]) => id)),
    teamSet: new Set(asArray(data.teams)),
  };
}

function seasonFlag(value) {
  return value === true || value === 1 || value === 'true' || value === '1' || value === 'ja' || value === 'yes';
}

function shouldReceiveSeasonEquipment(person) {
  return !seasonFlag(person?.seasonExit) || seasonFlag(person?.seasonEntry);
}

function personNumberValue(person) {
  if (!person) return '';
  const raw = person.number ?? person.initials ?? person.trainerInitials ?? person.shortName ?? '';
  if (raw === undefined || raw === null || raw === '') return '';
  return person._kind === 'coach' ? String(raw).trim().toUpperCase() : String(raw).trim();
}

function catalogArticleKey(data, itemId) {
  const item = buildIndexes(data).itemById.get(itemId);
  if (!item) return normalize(itemId);
  const codes = articleCodesFrom(item.articleNumber, item.name, item.id);
  if (codes.length > 0) return `code:${codes.join('|')}`;
  return `name:${normalizeArticleText(item.name || item.articleNumber || item.id) || normalize(item.id)}`;
}

function inventoryMatchesItem(data, inv, itemId) {
  if (!inv || !itemId) return false;
  if (inv.itemType === itemId) return true;
  const target = buildIndexes(data).itemById.get(itemId);
  if (!target) return false;
  const invCodes = articleCodesFrom(inv.articleNumber, inv.itemName, inv.itemType);
  const targetCodes = articleCodesFrom(target.articleNumber, target.name, target.id);
  if (invCodes.length && targetCodes.length && invCodes.some(code => targetCodes.includes(code))) return true;
  const invName = normalizeArticleText(inv.itemName || inv.articleNumber || inv.itemType);
  const targetName = normalizeArticleText(target.name || target.articleNumber || target.id);
  return !!invName && !!targetName && (invName === targetName || invName.includes(targetName) || targetName.includes(invName));
}

function inventoryIsLost(inv) {
  return ['verloren', 'lost', 'missing', 'fehlt'].includes(normalize(inv?.status));
}

function inventoryIsIssued(data, inv) {
  if (normalize(inv?.status || 'lager') !== 'ausgegeben') return false;
  return isNonEmpty(inv?.assignedTo) && buildIndexes(data).personById.has(inv.assignedTo);
}

function issuedQtyForPersonItem(data, person, itemId, size) {
  return asArray(data.inventory).filter(inv =>
    inventoryIsIssued(data, inv) &&
    inv.assignedTo === person?.id &&
    inventoryMatchesItem(data, inv, itemId) &&
    (!size || !inv.size || normalizeSizeKey(inv.size) === normalizeSizeKey(size))
  ).length;
}

function orderCoversNeed(order) {
  return !CLOSED_ORDER_STATUSES.has(normalize(order?.status || 'angelegt'));
}

function explicitReplacement(line) {
  const text = [
    line?.orderReason,
    line?.reason,
    line?.notes,
    line?.comment,
  ].filter(Boolean).join(' ').toLowerCase();
  return /(ersatz|replacement|override|manuell|manual|nachbestellung|sonder|verlust|defekt|beschaedigt|beschadigt)/i.test(text);
}

function materialNeedKey(data, order, line, person) {
  const kind = normalizePersonKind(line?.personKind || person?._kind);
  const team = normalize(line?.team || person?.team || order?.team || '');
  const number = normalize(line?.number || personNumberValue(person));
  return [
    person?.id || normalize(line?.playerId || ''),
    team,
    kind,
    catalogArticleKey(data, line?.itemType),
    normalizeSizeKey(line?.size || ''),
    number,
  ].join('|');
}

function lineSignature(data, order, line, person) {
  return stableStringify({
    need: materialNeedKey(data, order, line, person),
    qty: Number(line?.qty) || 1,
    status: normalize(order?.status || 'angelegt'),
    orderReason: normalize(line?.orderReason || line?.reason || ''),
  });
}

function currentLineSignatures(data, currentOrders) {
  const { personById } = buildIndexes(data);
  const signatures = new Map();
  asArray(currentOrders).forEach(order => {
    asArray(order.lines).forEach((line, index) => {
      const key = `${order.id || 'order'}:${line?.id || index}`;
      signatures.set(key, lineSignature(data, order, line, personById.get(line?.playerId)));
    });
  });
  return signatures;
}

function validateInventory(currentValue, nextValue, data) {
  const duplicate = duplicateIdResult('inventory', nextValue);
  if (!duplicate.ok) return duplicate;

  const currentById = currentRecordMap(currentValue);
  const { personById, itemById, teamSet } = buildIndexes(data);

  for (const inv of asArray(nextValue)) {
    const current = currentById.get(inv.id);
    if (current && sameRecord(current, inv)) continue;

    const status = normalize(inv.status || 'lager');
    if (inv.itemType && !itemById.has(inv.itemType)) {
      return reject(400, 'unknown_inventory_item', `inventory.${inv.id}.itemType`, 'Material verweist auf einen unbekannten Artikel.');
    }
    if (inv.team && teamSet.size > 0 && !teamSet.has(inv.team)) {
      return reject(400, 'unknown_inventory_team', `inventory.${inv.id}.team`, 'Material verweist auf eine unbekannte Mannschaft.');
    }
    if (isNonEmpty(inv.assignedTo) && !personById.has(inv.assignedTo)) {
      return reject(400, 'unknown_inventory_person', `inventory.${inv.id}.assignedTo`, 'Material ist einer unbekannten Person zugeordnet.');
    }
    if (isNonEmpty(inv.reservedFor) && !personById.has(inv.reservedFor)) {
      return reject(400, 'unknown_inventory_reservation', `inventory.${inv.id}.reservedFor`, 'Material ist fuer eine unbekannte Person reserviert.');
    }
    if (status === 'ausgegeben' && !isNonEmpty(inv.assignedTo)) {
      return reject(409, 'issued_without_person', `inventory.${inv.id}.assignedTo`, 'Ausgegebenes Material benoetigt eine Personenzuordnung.');
    }
    if (status === 'ausgegeben' && isNonEmpty(inv.reservedFor)) {
      return reject(409, 'issued_and_reserved', `inventory.${inv.id}.reservedFor`, 'Ausgegebenes Material darf nicht gleichzeitig reserviert sein.');
    }
    if (inventoryIsLost(inv) && (isNonEmpty(inv.assignedTo) || isNonEmpty(inv.reservedFor))) {
      return reject(409, 'lost_material_assigned', `inventory.${inv.id}.status`, 'Verlorenes Material darf nicht ausgegeben oder reserviert sein.');
    }
    const assignedPerson = personById.get(inv.assignedTo);
    const invKind = normalizePersonKind(inv.personKind);
    if (assignedPerson && invKind && invKind !== assignedPerson._kind) {
      return reject(409, 'inventory_person_kind_mismatch', `inventory.${inv.id}.personKind`, 'Personenart am Material passt nicht zur zugeordneten Person.');
    }
  }

  return ok();
}

function validateOrders(currentValue, nextValue, data) {
  const duplicate = duplicateIdResult('orders', nextValue);
  if (!duplicate.ok) return duplicate;

  const { personById, itemById, teamSet } = buildIndexes(data);
  const currentSignatures = currentLineSignatures(data, currentValue);
  const openOwnersByNeed = new Map();
  const changedNeedKeys = new Set();

  for (const order of asArray(nextValue)) {
    if (order.team && order.team !== 'mehrere' && teamSet.size > 0 && !teamSet.has(order.team)) {
      return reject(400, 'unknown_order_team', `orders.${order.id}.team`, 'Bestellung verweist auf eine unbekannte Mannschaft.');
    }

    for (let index = 0; index < asArray(order.lines).length; index += 1) {
      const line = order.lines[index];
      const path = `orders.${order.id}.lines[${index}]`;
      const lineKey = `${order.id || 'order'}:${line?.id || index}`;
      const person = personById.get(line?.playerId);
      const changed = currentSignatures.get(lineKey) !== lineSignature(data, order, line, person);
      const qty = Number(line?.qty) || 0;

      if (!changed) continue;
      if (!line?.id) return reject(400, 'missing_order_line_id', `${path}.id`, 'Bestellpositionen benoetigen eine ID.');
      if (!line.itemType || !itemById.has(line.itemType)) {
        return reject(400, 'unknown_order_item', `${path}.itemType`, 'Bestellposition verweist auf einen unbekannten Artikel.');
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        return reject(400, 'invalid_order_quantity', `${path}.qty`, 'Bestellmenge muss groesser als 0 sein.');
      }
      if (line.playerId && !person) {
        return reject(400, 'unknown_order_person', `${path}.playerId`, 'Bestellposition verweist auf eine unbekannte Person.');
      }
      if (!person) continue;

      const expectedKind = normalizePersonKind(person._kind);
      const lineKind = normalizePersonKind(line.personKind || expectedKind);
      if (lineKind && lineKind !== expectedKind) {
        return reject(409, 'order_person_kind_mismatch', `${path}.personKind`, 'Spieler-/Trainerart passt nicht zur Bestellposition.');
      }

      const item = itemById.get(line.itemType);
      const needsPersonalId = !item?.reprintExcluded;
      if (needsPersonalId && qty > 1 && !explicitReplacement(line)) {
        return reject(409, 'duplicate_personalized_quantity', `${path}.qty`, 'Personalisierte Artikel duerfen fuer dieselbe Person nicht mehrfach in einer Bestellposition stehen.');
      }
      const number = isNonEmpty(line.number) ? String(line.number).trim() : personNumberValue(person);
      if (needsPersonalId && !number) {
        return reject(
          409,
          expectedKind === 'coach' ? 'missing_trainer_initials' : 'missing_player_number',
          `${path}.number`,
          expectedKind === 'coach'
            ? 'Trainer-Bestellungen fuer personalisierte Artikel benoetigen Initialen.'
            : 'Spieler-Bestellungen fuer personalisierte Artikel benoetigen eine Nummer.'
        );
      }

      if (!shouldReceiveSeasonEquipment(person) && !explicitReplacement(line)) {
        return reject(409, 'person_leaves_no_new_order', `${path}.playerId`, 'Ausscheidende Personen duerfen keinen neuen Bestellbedarf ausloesen.');
      }
      if (issuedQtyForPersonItem(data, person, line.itemType, line.size) > 0 && !explicitReplacement(line)) {
        return reject(409, 'already_issued_no_new_order', `${path}.playerId`, 'Artikel ist dieser Person bereits ausgegeben; keine Doppelbestellung ohne Ersatzgrund.');
      }

      if (orderCoversNeed(order)) {
        const needKey = materialNeedKey(data, order, line, person);
        changedNeedKeys.add(needKey);
      }
    }
  }

  for (const order of asArray(nextValue)) {
    if (!orderCoversNeed(order)) continue;
    for (let index = 0; index < asArray(order.lines).length; index += 1) {
      const line = order.lines[index];
      const person = personById.get(line?.playerId);
      if (!person) continue;
      const needKey = materialNeedKey(data, order, line, person);
      const owners = openOwnersByNeed.get(needKey) || new Set();
      owners.add(order.id || `${order.id || 'order'}:${line?.id || index}`);
      openOwnersByNeed.set(needKey, owners);
    }
  }

  for (const [needKey, owners] of openOwnersByNeed.entries()) {
    if (changedNeedKeys.has(needKey) && owners.size > 1) {
      return reject(409, 'duplicate_open_order_need', 'orders', 'Zu Person, Mannschaft, Artikel, Groesse und Nummer/Initialen existiert bereits eine offene Bestellung.');
    }
  }

  return ok();
}

function validatePersonScopedList(key, currentValue, nextValue, data) {
  const duplicate = duplicateIdResult(key, nextValue);
  if (!duplicate.ok) return duplicate;

  const currentById = currentRecordMap(currentValue);
  const { personById, itemById, teamSet } = buildIndexes(data);

  for (const record of asArray(nextValue)) {
    const current = currentById.get(record.id);
    if (current && sameRecord(current, record)) continue;
    if (record.playerId && !personById.has(record.playerId)) {
      return reject(400, `unknown_${key}_person`, `${key}.${record.id}.playerId`, 'Eintrag verweist auf eine unbekannte Person.');
    }
    if (record.team && teamSet.size > 0 && !teamSet.has(record.team)) {
      return reject(400, `unknown_${key}_team`, `${key}.${record.id}.team`, 'Eintrag verweist auf eine unbekannte Mannschaft.');
    }
    if (record.item && !itemById.has(record.item)) {
      return reject(400, `unknown_${key}_item`, `${key}.${record.id}.item`, 'Eintrag verweist auf einen unbekannten Artikel.');
    }
  }

  return ok();
}

export function validateBusinessRules({ key, currentValue, nextValue, allData }) {
  const nextData = { ...(allData || {}), [key]: nextValue };

  if (Array.isArray(nextValue)) {
    const duplicate = duplicateIdResult(key, nextValue);
    if (!duplicate.ok) return duplicate;
  }

  if (key === 'inventory') return validateInventory(currentValue, nextValue, nextData);
  if (key === 'orders') return validateOrders(currentValue, nextValue, nextData);
  if (['reports', 'deposits', 'transactions', 'issueProtocols'].includes(key)) {
    return validatePersonScopedList(key, currentValue, nextValue, nextData);
  }

  return ok();
}
