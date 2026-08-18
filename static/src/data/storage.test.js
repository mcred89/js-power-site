import { exportBackup, parseBackup } from './storage';

describe('portable backups', () => {
  it('round trips profiles and routines', () => {
    const profiles = [{ id: 'p1', name: 'Alex' }];
    const routines = [{ id: 'r1', profileId: 'p1', name: 'Plan' }];

    expect(parseBackup(exportBackup(profiles, routines))).toMatchObject({ profiles, routines, version: 1 });
  });

  it('rejects unrelated JSON files', () => {
    expect(() => parseBackup('{"profiles":[]}')).toThrow('not a supported');
  });
});
