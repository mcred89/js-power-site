import { IDBFactory } from 'fake-indexeddb';
import { createRoutine } from './routines';
import { updateRoutinePlan } from './routineUpdates';
import { DATABASE_VERSION, runDatabaseMigrations } from './storageMigrations';
import { BACKUP_VERSION, backupMigrations, exportBackup, migrateBackup, parseBackup } from './storageBackup';

if (!global.structuredClone) global.structuredClone = value => JSON.parse(JSON.stringify(value));

const legacyPlan = (duration = '3 weeks', removedName = 'Press', sourceWeek = 3) => {
  const plan = createRoutine('profile', 'Before deletion tracking', {
    maxSquat: 315, maxPress: 185, maxDead: 405,
    mainLiftChoice: 'Low', duration, includeStrongmanDay: true,
  });
  delete plan.deletedWorkoutStages;
  plan.workouts = plan.workouts.filter(workout => workout.name !== removedName || workout.sourceWeek !== sourceWeek);
  plan.unknown = { keep: 'plan extension' };
  return plan;
};

const open = (factory, name, version) => new Promise((resolve, reject) => {
  const request = factory.open(name, version);
  request.onupgradeneeded = event => runDatabaseMigrations(request.result, request.transaction, event.oldVersion, event.newVersion);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const read = (database, store, id) => new Promise((resolve, reject) => {
  const request = database.transaction(store).objectStore(store).get(id);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const write = (database, records) => new Promise((resolve, reject) => {
  const transaction = database.transaction(Object.keys(records), 'readwrite');
  Object.entries(records).forEach(([store, values]) => values.forEach(value => transaction.objectStore(store).put(value)));
  transaction.oncomplete = resolve;
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error);
});

it('creates a version 24 database and retains explicit deletion tracking across reopen', async () => {
  const factory = new IDBFactory();
  let database = await open(factory, 'fresh-deletion-tracking', DATABASE_VERSION);
  expect(database.version).toBe(24);
  expect([...database.objectStoreNames]).toEqual(['archives', 'metadata', 'profiles', 'routines', 'templates']);
  expect(await read(database, 'metadata', 'dataSchemaVersion')).toEqual({ key: 'dataSchemaVersion', value: 24 });
  const plan = createRoutine('profile', 'New plan', {
    maxSquat: 315, maxPress: 185, maxDead: 405, mainLiftChoice: 'Low', duration: '5 weeks',
  });
  expect(plan.deletedWorkoutStages).toEqual([]);
  await write(database, { routines: [plan] });
  database.close();
  database = await open(factory, 'fresh-deletion-tracking', DATABASE_VERSION);
  expect(await read(database, 'routines', plan.id)).toEqual(plan);
  database.close();
});

it('upgrades version 23 plans, templates, and archives without treating compact schedule omissions as deletions', async () => {
  const factory = new IDBFactory();
  let database = await open(factory, 'deletion-upgrade', 23);
  const plan = legacyPlan();
  const template = { ...legacyPlan(), id: 'template' };
  const archive = { id: 'archived-strength', store: 'routines', record: legacyPlan('5 weeks', 'Deadlift', 1), unknown: true };
  const unknown = { id: 'unknown', kind: 'future-kind', extension: ['retain'] };
  const unknownArchive = { id: 'unknown-archive', store: 'future-store', record: { opaque: true }, extension: true };
  const existing = { ...legacyPlan(), id: 'already-tracked', deletedWorkoutStages: ['0:Deadlift:1', 'future:opaque'] };
  await write(database, { routines: [plan, unknown, existing], templates: [template], archives: [archive, unknownArchive] });
  database.close();

  database = await open(factory, 'deletion-upgrade', DATABASE_VERSION);
  const migrated = await read(database, 'routines', plan.id);
  expect(migrated).toEqual({ ...plan, deletedWorkoutStages: ['0:Press:3'] });
  expect(await read(database, 'templates', template.id)).toEqual({ ...template, deletedWorkoutStages: ['0:Press:3'] });
  expect(await read(database, 'archives', archive.id)).toEqual({
    ...archive, record: { ...archive.record, deletedWorkoutStages: ['0:Deadlift:1'] },
  });
  expect(await read(database, 'routines', unknown.id)).toEqual(unknown);
  expect(await read(database, 'routines', existing.id)).toEqual(existing);
  expect(await read(database, 'archives', unknownArchive.id)).toEqual(unknownArchive);
  expect(await read(database, 'metadata', 'dataSchemaVersion')).toEqual({ key: 'dataSchemaVersion', value: DATABASE_VERSION });
  database.close();

  const expanded = updateRoutinePlan(migrated, { duration: '5 weeks' });
  expect(expanded.workouts.some(workout => workout.name === 'Press' && workout.sourceWeek === 3)).toBe(false);
  expect(expanded.workouts.some(workout => workout.name === 'Deadlift' && workout.sourceWeek === 1)).toBe(true);
  expect(expanded.workouts.some(workout => workout.name === 'Strongman' && workout.sourceWeek === 0)).toBe(true);
});

it('purely migrates version 23 backups and keeps inferred manual deletions through duration changes and backup round trips', () => {
  const plan = legacyPlan('5 weeks', 'Deadlift', 1);
  const template = { ...legacyPlan(), id: 'template' };
  const archive = { id: 'archive', store: 'routines', record: legacyPlan(), extra: true };
  const unknown = { id: 'unknown', extension: ['keep'] };
  const original = {
    format: 'mcilroy-method-backup', version: 23, dataSchemaVersion: 23,
    profiles: [{ id: 'profile' }], routines: [plan, unknown], templates: [template], archives: [archive],
    extension: { retained: true },
  };
  const snapshot = JSON.stringify(original);
  const migrated = migrateBackup(original);
  expect(migrated).toEqual(backupMigrations[24](original));
  expect(migrated).toMatchObject({ version: BACKUP_VERSION, dataSchemaVersion: DATABASE_VERSION, extension: original.extension });
  expect(migrated.routines[0]).toEqual({ ...plan, deletedWorkoutStages: ['0:Deadlift:1'] });
  expect(migrated.routines[1]).toBe(unknown);
  expect(migrated.templates[0]).toEqual({ ...template, deletedWorkoutStages: ['0:Press:3'] });
  expect(migrated.archives[0]).toEqual({ ...archive, record: { ...archive.record, deletedWorkoutStages: ['0:Press:3'] } });
  expect(JSON.stringify(original)).toBe(snapshot);

  const short = updateRoutinePlan(migrated.routines[0], { duration: '3 weeks' });
  const restored = parseBackup(exportBackup(migrated.profiles, [short], migrated.templates, migrated.archives));
  const expanded = updateRoutinePlan(restored.routines[0], { duration: '5 weeks' });
  expect(expanded.deletedWorkoutStages).toEqual(['0:Deadlift:1']);
  expect(expanded.workouts.some(workout => workout.name === 'Deadlift' && workout.sourceWeek === 1)).toBe(false);
  expect(expanded.workouts.some(workout => workout.name === 'Strongman' && workout.sourceWeek === 0)).toBe(true);
  expect(restored.templates).toEqual(migrated.templates);
  expect(restored.archives).toEqual(migrated.archives);
});

it('retains existing deletion markers and unknown backup records without rewriting a current backup', () => {
  const plan = { ...legacyPlan(), deletedWorkoutStages: ['0:Deadlift:1', 'unknown-stage'] };
  const opaque = { id: 'opaque', custom: true };
  const original = { version: 23, routines: [plan, opaque], templates: [opaque], archives: [{ id: 'archive', record: opaque }] };
  const migrated = migrateBackup(original);
  expect(migrated.routines[0]).toBe(plan);
  expect(migrated.routines[1]).toBe(opaque);
  expect(migrated.templates[0]).toBe(opaque);
  expect(migrated.archives).toBe(original.archives);
  expect(migrateBackup(migrated)).toBe(migrated);
});

it('preserves archived legacy workouts without stage identities instead of marking their days deleted', () => {
  const plan = legacyPlan('5 weeks');
  plan.workouts.forEach(workout => { delete workout.sourceWeek; });
  const archive = { id: 'legacy-archive', record: plan };
  const original = { version: 23, routines: [], templates: [], archives: [archive] };
  const snapshot = JSON.stringify(original);
  const migrated = migrateBackup(original);
  expect(migrated.archives[0]).toBe(archive);
  expect(migrated.archives[0].record.deletedWorkoutStages).toBeUndefined();
  expect(JSON.stringify(original)).toBe(snapshot);
});
