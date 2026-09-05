import { IDBFactory } from 'fake-indexeddb';
import { get, save, applyBatch } from './storage';
import { patchRecord, saveCreatedRoutine } from './recordActions';

const originalClone = global.structuredClone;
beforeAll(() => {
  window.indexedDB = new IDBFactory();
  global.structuredClone = value => require('v8').deserialize(require('v8').serialize(value));
});
afterAll(() => { global.structuredClone = originalClone; });

test('patches only requested fields on the latest durable record', async () => {
  const session = { status: 'inProgress', eventBlocks: [{ attempts: [{ weight: 300 }] }] };
  await save('routines', { id: 'rename', name: 'Old name', workouts: [{ session }], custom: { retained: true } });
  const updated = await patchRecord('routines', 'rename', { name: 'New name' });
  expect(updated).toMatchObject({ name: 'New name', workouts: [{ session }], custom: { retained: true } });
  expect(await get('routines', 'rename')).toEqual(updated);
  await save('profiles', { id: 'profile', activeWorkoutRoutineId: 'events', activeStrongmanRoutineId: 'events' });
  await patchRecord('profiles', 'profile', { activeRoutineId: 'normal' });
  expect(await get('profiles', 'profile')).toMatchObject({ activeRoutineId: 'normal', activeWorkoutRoutineId: 'events', activeStrongmanRoutineId: 'events' });
});

test('does not recreate records deleted before a metadata edit', async () => {
  await expect(patchRecord('routines', 'deleted', { name: 'New name' })).rejects.toThrow(/no longer exists/i);
  expect(await get('routines', 'deleted')).toBeUndefined();
});

test('rejects creating a plan from a stale profile without clearing an active session', async () => {
  const profile = { id: 'creator', activeWorkoutRoutineId: null };
  await save('profiles', { ...profile, activeWorkoutRoutineId: 'events' });
  const routine = { id: 'new-normal', kind: 'strength', profileId: profile.id };
  await expect(saveCreatedRoutine(routine, profile)).rejects.toMatchObject({ name: 'BatchConflictError' });
  expect(await get('routines', routine.id)).toBeUndefined();
  expect((await get('profiles', profile.id)).activeWorkoutRoutineId).toBe('events');
});

test('copies an inactive event plan without selecting it as the normal routine', async () => {
  const profile = { id: 'copy-profile', activeRoutineId: 'normal', activeStrongmanRoutineId: 'current-event' };
  await save('profiles', profile);
  const routine = { id: 'event-copy', kind: 'strongman', profileId: profile.id, status: 'saved' };
  await saveCreatedRoutine(routine, profile);
  expect(await get('profiles', profile.id)).toMatchObject(profile);
  expect(await get('routines', routine.id)).toEqual(routine);
  await expect(applyBatch({ puts: { routines: [routine] }, conditions: { routines: [{ key: routine.id, expected: undefined }] } })).rejects.toMatchObject({ name: 'BatchConflictError' });
});
