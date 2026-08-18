import { exportBackup, parseBackup } from './storage';

describe('portable backups', () => {
  it('round trips profiles and routines', () => {
    const profiles = [{ id: 'p1', name: 'Alex' }];
    const routines = [{ id: 'r1', profileId: 'p1', name: 'Plan' }];

    expect(parseBackup(exportBackup(profiles, routines))).toMatchObject({
      profiles,
      routines,
      version: 4,
      dataSchemaVersion: 4,
    });
  });

  it('upgrades version 1 backups without changing their records', () => {
    const oldBackup = {
      format: 'mcilroy-method-backup',
      version: 1,
      profiles: [{ id: 'p1', name: 'Alex' }],
      routines: [{ id: 'r1', profileId: 'p1', name: 'Plan' }],
    };

    expect(parseBackup(JSON.stringify(oldBackup))).toEqual({
      ...oldBackup,
      version: 4,
      dataSchemaVersion: 4,
    });
    expect(oldBackup.version).toBe(1);
  });

  it('rejects backups made by a newer, incompatible app', () => {
    expect(() => parseBackup(JSON.stringify({
      format: 'mcilroy-method-backup',
      version: 99,
      profiles: [],
      routines: [],
    }))).toThrow('not a supported');
  });

  it('rejects unrelated JSON files', () => {
    expect(() => parseBackup('{"profiles":[]}')).toThrow('not a supported');
  });
});
