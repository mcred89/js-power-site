import { addSetTimerPreference, addSetTimers } from './setTimerMigration';
import { BACKUP_VERSION, DATABASE_VERSION, backupMigrations, migrateBackup } from './storageMigrations';

describe('set timer compatibility', () => {
  const records = () => ({
    format: 'mcilroy-method-backup', version: 14, dataSchemaVersion: 14, unknown: { preserved: true },
    profiles: [{ id: 'default', unknown: true }, { id: 'chosen', setTimerIntervalMs: 90000 }],
    routines: [{ id: 'routine', unknown: true, workouts: [
      { id: 'active', session: { status: 'inProgress', exercises: [], unknown: 'keep' } },
      { id: 'paused', session: { status: 'paused', exercises: [] } },
      { id: 'completed', completedAt: '2026-09-18', session: { status: 'completed', exercises: [] } },
      { id: 'future', session: null },
      { id: 'unrecognized', session: { status: 'other', unknown: 'keep' } },
      { id: 'existing', session: { status: 'inProgress', exercises: [], setTimer: { unknown: true } } },
    ] }, { id: 'unknown-record', extension: { keep: true } }],
    templates: [{ id: 'template', unknown: true }],
    archives: [{ id: 'archive', store: 'routines', record: { unknown: true } }],
  });

  it('adds a default preference only when absent and retains unknown profile data', () => {
    const profile = { id: 'default', unknown: true };
    expect(addSetTimerPreference(profile)).toEqual({ ...profile, setTimerIntervalMs: 60000 });
    expect(profile).not.toHaveProperty('setTimerIntervalMs');
    const existing = { id: 'existing', setTimerIntervalMs: 90000 };
    expect(addSetTimerPreference(existing)).toBe(existing);
  });

  it('adds disabled timers to active and paused workouts without modifying snapshots or unknown records', () => {
    const original = records().routines[0];
    const migrated = addSetTimers(original);
    expect(migrated.workouts[0].session).toEqual({ ...original.workouts[0].session, setTimer: null });
    expect(migrated.workouts[1].session.setTimer).toBeNull();
    migrated.workouts.slice(2).forEach((workout, index) => expect(workout).toBe(original.workouts[index + 2]));
    expect(original.workouts[0].session).not.toHaveProperty('setTimer');
    expect(addSetTimers(migrated)).toBe(migrated);
  });

  it('purely upgrades v14 backups and preserves archives and all unrecognized content', () => {
    const original = records();
    const before = JSON.stringify(original);
    const migrated = migrateBackup(original);
    expect(migrated).toMatchObject({ version: BACKUP_VERSION, dataSchemaVersion: DATABASE_VERSION, unknown: { preserved: true } });
    expect(migrated.profiles).toEqual([
      { id: 'default', unknown: true, setTimerIntervalMs: 60000 },
      { id: 'chosen', setTimerIntervalMs: 90000 },
    ]);
    expect(migrated.routines[0].workouts[0].session.setTimer).toBeNull();
    expect(migrated.routines[1]).toBe(original.routines[1]);
    expect(migrated.routines[0].workouts[2]).toBe(original.routines[0].workouts[2]);
    expect(migrated.templates).toEqual(original.templates);
    expect(migrated.archives).toBe(original.archives);
    expect(JSON.stringify(original)).toBe(before);
    expect(backupMigrations[16](backupMigrations[15](original))).toEqual(migrated);
  });
});
