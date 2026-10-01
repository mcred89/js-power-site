import {
  activeStrongmanCompetition, changeProfileCompetition, migrateStrongmanCompetitions,
  validateProfileCompetitions, withStrongmanCompetitionDefaults,
  completePastCompetition, competitionDateHasPassed,
} from './strongmanCompetitions';

const timestamp = '2026-10-01T12:00:00.000Z';
const target = { name: 'Winter meet', date: '', events: [
  { id: 'yoke', name: 'Zercher yoke', weight: 600, distance: 100 },
] };
const plan = (id, profileId = 'p1', competition = target, updatedAt = timestamp) => ({
  id, profileId, inputs: { strongmanCompetition: competition }, updatedAt,
  workouts: [{ id: `${id}-completed`, completedAt: '2026-09-10', session: { custom: true } }],
  strongmanLog: [{ id: `${id}-attempt`, movement: 'Zercher yoke', sets: [{ weight: 580, distance: 50 }] }],
});

describe('profile competition lifecycle', () => {
  it('keeps one active competition identity across edits and preserves unknown fields', () => {
    const profile = { id: 'p1', custom: { preserved: true } };
    const first = changeProfileCompetition(profile, { ...target, custom: 'retained' }, timestamp);
    const updated = changeProfileCompetition(first, {
      ...first.strongmanCompetition, name: 'Meet details announced', events: [
        { ...first.strongmanCompetition.events[0], weight: 620 },
      ],
    }, '2026-10-02T12:00:00.000Z');
    expect(activeStrongmanCompetition(updated)).toMatchObject({
      id: first.strongmanCompetition.id, createdAt: timestamp, status: 'active',
      name: 'Meet details announced', custom: 'retained', events: [{ weight: 620 }],
    });
    expect(updated.custom).toBe(profile.custom);
    expect(profile).toEqual({ id: 'p1', custom: { preserved: true } });
    expect(first.strongmanCompetition.events[0].weight).toBe(600);
  });

  it.each(['completed', 'removed', null])('ends a competition with %p while keeping its targets and history', action => {
    const first = changeProfileCompetition({ id: 'p1' }, target, timestamp);
    const ended = changeProfileCompetition(first, action, '2026-11-01T12:00:00.000Z');
    expect(activeStrongmanCompetition(ended)).toBeNull();
    expect(ended.strongmanCompetition).toBeNull();
    expect(ended.strongmanCompetitionHistory).toEqual([{
      ...first.strongmanCompetition, status: action === 'completed' ? 'completed' : 'removed',
      endedAt: '2026-11-01T12:00:00.000Z',
    }]);
    expect(changeProfileCompetition(ended, action, timestamp).strongmanCompetitionHistory).toHaveLength(1);
    expect(activeStrongmanCompetition(first)).not.toBeNull();
    expect(() => validateProfileCompetitions(ended)).not.toThrow();
  });

  it('starts a later meet with a separate identity', () => {
    const first = changeProfileCompetition({ id: 'p1' }, { ...target, date: '2020-01-01' }, timestamp);
    expect(activeStrongmanCompetition(first)).not.toBeNull();
    const next = changeProfileCompetition(changeProfileCompetition(first, 'completed', timestamp), target, timestamp);
    expect(next.strongmanCompetition.id).not.toBe(first.strongmanCompetition.id);
    expect(next.strongmanCompetitionHistory).toHaveLength(1);
  });

  it('fills defaults without resurrecting an explicit null or dropping history', () => {
    expect(withStrongmanCompetitionDefaults({ id: 'p1' })).toEqual({
      id: 'p1', strongmanCompetition: null, strongmanCompetitionHistory: [],
    });
    const profile = { id: 'p1', strongmanCompetition: null, strongmanCompetitionHistory: [{ unknown: true }] };
    expect(withStrongmanCompetitionDefaults(profile)).toEqual(profile);
  });

  it('validates active and saved history snapshots and rejects malformed states and IDs', () => {
    const profile = changeProfileCompetition({ id: 'p1' }, target, timestamp);
    const active = profile.strongmanCompetition;
    expect(() => validateProfileCompetitions({ ...profile, strongmanCompetition: null,
      strongmanCompetitionHistory: [{ ...active, status: 'saved' }] })).not.toThrow();
    const invalid = [
      { ...profile, strongmanCompetition: { ...active, id: '' } },
      { ...profile, strongmanCompetition: { ...active, status: 'completed' } },
      { ...profile, strongmanCompetition: { ...active, createdAt: 'invalid' } },
      { ...profile, strongmanCompetitionHistory: {} },
      { ...profile, strongmanCompetitionHistory: [{ ...active, id: 'ended', status: 'completed' }] },
      { ...profile, strongmanCompetitionHistory: [{ ...active, id: 'saved', status: 'draft' }] },
      { ...profile, strongmanCompetitionHistory: [{ ...active, status: 'saved' }] },
      { ...profile, strongmanCompetition: { ...active, events: [{ id: 'yoke', name: 'Yoke', weight: -1 }] } },
    ];
    invalid.forEach(value => expect(() => validateProfileCompetitions(value)).toThrow());
  });
});

describe('automatic competition completion', () => {
  const now = new Date(2026, 9, 2, 0, 1);
  it.each(['2026-10-02', '2026-10-03', '', undefined, 'invalid', '2026-02-30', '2026-10-01T00:00:00Z'])(
    'keeps competition date %p active', date => {
      const profile = { strongmanCompetition: { status: 'active', date } };
      expect(completePastCompetition(profile, now)).toBe(profile);
    },
  );
  it('completes after the local day, preserving the entire snapshot and existing history only once', () => {
    const first = changeProfileCompetition({ id: 'p1', custom: { retained: true } },
      { ...target, date: '2026-10-01', unknown: true }, timestamp);
    const before = JSON.stringify(first);
    expect(completePastCompetition(first, new Date(2026, 9, 1, 23, 59))).toBe(first);
    const ended = completePastCompetition(first, now);
    expect(ended.strongmanCompetition).toBeNull();
    expect(ended.strongmanCompetitionHistory).toEqual([{ ...first.strongmanCompetition,
      status: 'completed', endedAt: now.toISOString() }]);
    expect(ended.custom).toBe(first.custom);
    expect(completePastCompetition(ended, now)).toBe(ended);
    expect(JSON.stringify(first)).toBe(before);
  });
  it('does not act on inactive competitions or invalid clocks', () => {
    expect(competitionDateHasPassed({ status: 'removed', date: '2020-01-01' }, now)).toBe(false);
    expect(competitionDateHasPassed({ status: 'active', date: '2020-01-01' }, new Date('invalid'))).toBe(false);
  });
});

describe('competition carryover migration', () => {
  it('chooses the active plan and joins exact matches across plans without altering saved attempts', () => {
    const first = plan('older', 'p1', target, '2026-09-01T00:00:00.000Z');
    const newest = plan('newer', 'p1', { ...target, name: 'Another meet' });
    const continuing = plan('continuing');
    const records = { profiles: [{ id: 'p1', activeRoutineId: 'older' }], routines: [newest, continuing, first],
      templates: [{ id: 'template', inputs: { strongmanCompetition: target } }], unknown: { retained: true } };
    const before = JSON.stringify(records);
    const migrated = migrateStrongmanCompetitions(records);
    const competition = migrated.profiles[0].strongmanCompetition;
    expect(competition.name).toBe('Winter meet');
    expect(competition.id).toBe(migrated.routines[1].inputs.strongmanCompetition.id);
    expect(competition.id).toBe(migrated.routines[2].inputs.strongmanCompetition.id);
    expect(competition.id).not.toBe(migrated.routines[0].inputs.strongmanCompetition.id);
    expect(migrated.routines[2].strongmanLog[0]).toEqual({ ...first.strongmanLog[0], competitionId: competition.id });
    expect(migrated.routines[2].workouts).toBe(first.workouts);
    expect(migrated.routines[2].inputs.strongmanCompetition.events).toBe(target.events);
    expect(migrated.templates).toBe(records.templates);
    expect(migrated.unknown).toBe(records.unknown);
    expect(JSON.stringify(records)).toBe(before);
    expect(migrateStrongmanCompetitions(migrated)).toEqual(migrated);
    expect(migrateStrongmanCompetitions({ ...records, profiles: [{ id: 'p1', activeRoutineId: 'continuing' }] })
      .profiles[0].strongmanCompetition.id).toBe(competition.id);
  });

  it('falls back to the newest non-archived competition, independent of input order', () => {
    const first = plan('first', 'p1', target, '2026-09-01T00:00:00.000Z');
    const newest = plan('newest', 'p1', { ...target, name: 'Newest meet' });
    const archived = { ...plan('archived', 'p1', { ...target, name: 'Archived meet' }, '2026-12-01'), archived: true };
    const records = { profiles: [{ id: 'p1', activeRoutineId: 'absent' }], routines: [first, archived, newest] };
    const migrated = migrateStrongmanCompetitions(records);
    expect(migrated.profiles[0].strongmanCompetition.name).toBe('Newest meet');
    expect(migrateStrongmanCompetitions({ ...records, routines: [newest, archived, first] }).profiles).toEqual(migrated.profiles);
    expect(migrateStrongmanCompetitions({ ...records, routines: [archived] }).profiles[0].strongmanCompetition).toBeNull();
  });

  it('does not merge similarly named targets or leak another profile competition', () => {
    const altered = { ...target, events: [{ ...target.events[0], weight: 620 }] };
    const records = { profiles: [{ id: 'p1' }, { id: 'p2' }], routines: [
      plan('r1'), plan('r2', 'p1', altered), plan('r3', 'p2'),
    ] };
    const migrated = migrateStrongmanCompetitions(records);
    const ids = migrated.routines.map(routine => routine.inputs.strongmanCompetition.id);
    expect(new Set(ids).size).toBe(3);
    expect(migrated.profiles[1].strongmanCompetition.id).toBe(ids[2]);
  });

  it('preserves explicit null, existing identities, assigned logs, and unknown records', () => {
    const existing = { ...target, id: 'stable', createdAt: timestamp, status: 'active' };
    const routine = { ...plan('r1', 'p1', existing), strongmanLog: [
      { id: 'unrelated', competitionId: 'another' }, { id: 'explicit-none', competitionId: null },
    ] };
    const unknown = { id: 'unknown', opaque: { preserved: true } };
    const records = { profiles: [{ id: 'p1', strongmanCompetition: null }], routines: [routine, unknown], archives: [unknown] };
    const migrated = migrateStrongmanCompetitions(records);
    expect(migrated.profiles[0].strongmanCompetition).toBeNull();
    expect(migrated.routines[0]).toEqual(routine);
    expect(migrated.routines[1]).toBe(unknown);
    expect(migrated.archives).toBe(records.archives);
  });
});
