import { activateRoutineImport, importPlanBatch } from './TrackerApp';

it('imports archived records atomically without overwriting a conflicting local archive', () => {
  const local = { id: 'routines:event', record: { id: 'event', name: 'Local block' } };
  const imported = { id: local.id, record: { id: 'event', name: 'Backup block' } };
  const copied = { ...imported, id: 'routines:event:copy' };
  const batch = importPlanBatch({
    profiles: [], routines: [], templates: [],
    archives: [{ action: 'copy', imported, local, result: copied }],
  });
  expect(batch.puts.archives).toEqual([copied]);
  expect(batch.conditions.archives).toEqual([
    { key: local.id, expected: local },
    { key: copied.id, expected: undefined },
  ]);
});

it('keeps duplicate archive records untouched', () => {
  const local = { id: 'routines:event', record: { id: 'event' } };
  const batch = importPlanBatch({
    profiles: [], routines: [], templates: [],
    archives: [{ action: 'skip', imported: local, local, result: local }],
  });
  expect(batch.puts.archives).toEqual([]);
  expect(batch.conditions.archives).toEqual([{ key: local.id, expected: local }]);
});

it('checks an existing archive copy before skipping a repeated import', () => {
  const local = { id: 'routines:event', record: { name: 'Local block' } };
  const imported = { id: local.id, record: { name: 'Backup block' } };
  const copy = { ...imported, id: `${local.id}:imported-copy` };
  const batch = importPlanBatch({
    profiles: [], routines: [], templates: [],
    archives: [{ action: 'skip', imported, local, result: copy, existingResult: copy }],
  });
  expect(batch.puts.archives).toEqual([]);
  expect(batch.conditions.archives).toEqual([
    { key: local.id, expected: local },
    { key: copy.id, expected: copy },
  ]);
});

it('activates the preserved routine copy and checks its new ID before import', () => {
  const local = { id: 'routine', profileId: 'first' };
  const imported = { id: local.id, profileId: 'second' };
  const copy = { ...imported, id: 'routine:imported-copy' };
  const plan = activateRoutineImport({
    profiles: [], templates: [],
    routines: [{ action: 'copy', local, imported, result: copy }],
  }, { id: 'second' }, imported.id, 'now');
  expect(plan.profiles[0].result.activeRoutineId).toBe(copy.id);
  expect(importPlanBatch(plan).conditions.routines).toEqual([
    { key: local.id, expected: local },
    { key: copy.id, expected: undefined },
  ]);
});
