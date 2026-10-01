import { normalizeStrongmanCompetition, validateStrongmanRecord } from './strongman';
import { serializedRecordsEqual } from './recordComparison';

const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const textId = value => typeof value === 'string' && Boolean(value.trim());
const validTimestamp = value => typeof value === 'string' && Boolean(value.trim()) && Number.isFinite(Date.parse(value));
const makeId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const lifecycleKeys = new Set(['id', 'status', 'createdAt', 'updatedAt', 'endedAt']);
const configuration = value => Object.fromEntries(Object.entries(value).filter(([key]) => !lifecycleKeys.has(key)));
const sameConfiguration = (left, right) => serializedRecordsEqual(configuration(left), configuration(right));

// Null is a deliberate lifecycle choice. Never infer a new active competition
// from a plan after migration has populated this profile field.
export const activeStrongmanCompetition = profile => isObject(profile?.strongmanCompetition)
  && profile.strongmanCompetition.status === 'active' ? profile.strongmanCompetition : null;

export const withStrongmanCompetitionDefaults = profile => ({
  ...profile,
  ...(!has(profile, 'strongmanCompetition') ? { strongmanCompetition: null } : {}),
  ...(!has(profile, 'strongmanCompetitionHistory') ? { strongmanCompetitionHistory: [] } : {}),
});

export const changeProfileCompetition = (profile, value, timestamp = new Date().toISOString()) => {
  const current = withStrongmanCompetitionDefaults(profile);
  const active = activeStrongmanCompetition(current);
  if (!validTimestamp(timestamp)) throw new Error('Enter a valid competition update time.');
  if (value === null || value === 'completed' || value === 'removed') {
    if (!active) return current;
    return {
      ...current,
      strongmanCompetition: null,
      strongmanCompetitionHistory: [...current.strongmanCompetitionHistory, {
        ...active, status: value === 'completed' ? 'completed' : 'removed', endedAt: timestamp,
      }],
      updatedAt: timestamp,
    };
  }
  if (!isObject(value)) throw new Error('Choose a competition to save, complete, or remove.');
  const normalized = normalizeStrongmanCompetition(value);
  const details = { ...normalized };
  delete details.endedAt;
  const updated = {
    ...current,
    strongmanCompetition: {
      ...details,
      id: active?.id || (textId(value.id) ? value.id : makeId()),
      createdAt: active?.createdAt || (validTimestamp(value.createdAt) ? value.createdAt : timestamp),
      status: 'active',
    },
    updatedAt: timestamp,
  };
  validateProfileCompetitions(updated);
  return updated;
};

export const validateProfileCompetitions = profile => {
  if (!isObject(profile)) return;
  const ids = new Set();
  const validate = (competition, active) => {
    if (!isObject(competition) || !textId(competition.id)) throw new Error('Each saved competition needs a nonempty text ID.');
    if (ids.has(competition.id)) throw new Error('Each saved competition must have its own ID.');
    ids.add(competition.id);
    if (!validTimestamp(competition.createdAt)) throw new Error('Each saved competition needs a valid creation time.');
    if (active ? competition.status !== 'active' : !['saved', 'completed', 'removed'].includes(competition.status)) {
      throw new Error('Choose a valid competition status.');
    }
    if ((!active && competition.status !== 'saved' && !validTimestamp(competition.endedAt)) ||
        (competition.endedAt !== undefined && !validTimestamp(competition.endedAt))) {
      throw new Error('Each ended competition needs a valid completion or removal time.');
    }
    validateStrongmanRecord({ inputs: { strongmanCompetition: competition } });
  };
  if (profile.strongmanCompetition !== undefined && profile.strongmanCompetition !== null) {
    validate(profile.strongmanCompetition, true);
  }
  if (profile.strongmanCompetitionHistory !== undefined) {
    if (!Array.isArray(profile.strongmanCompetitionHistory)) throw new Error('Competition history must be a list.');
    profile.strongmanCompetitionHistory.forEach(competition => validate(competition, false));
  }
};

// Stable legacy IDs make database upgrades and repeated backup imports agree.
// Exact configurations (including event IDs and unknown extensions) may share
// an identity only within their owner profile. Names alone are never enough.
export const migrateStrongmanCompetitions = records => {
  const profiles = Array.isArray(records.profiles) ? records.profiles : [];
  const routines = Array.isArray(records.routines) ? records.routines : [];
  const groups = new Map();
  const reserved = new Set();
  const reserve = competition => {
    if (isObject(competition) && textId(competition.id)) reserved.add(competition.id);
  };
  profiles.forEach(profile => {
    reserve(profile?.strongmanCompetition);
    if (Array.isArray(profile?.strongmanCompetitionHistory)) profile.strongmanCompetitionHistory.forEach(reserve);
  });
  routines.forEach(routine => reserve(routine?.inputs?.strongmanCompetition));
  const allocate = seed => {
    let id = seed;
    let suffix = 2;
    while (reserved.has(id)) { id = `${seed}:${suffix}`; suffix += 1; }
    reserved.add(id);
    return id;
  };
  const group = profileId => {
    if (!groups.has(profileId)) groups.set(profileId, []);
    return groups.get(profileId);
  };
  const stamp = (competition, profileId, sourceId, timestamp) => {
    if (!isObject(competition)) return competition;
    const known = group(profileId);
    const match = textId(competition.id) ? null : known.find(item => sameConfiguration(item, competition));
    const updated = {
      ...competition,
      id: textId(competition.id) ? competition.id : match?.id || allocate(`competition:${profileId || 'unowned'}:${sourceId}`),
      createdAt: validTimestamp(competition.createdAt) ? competition.createdAt : match?.createdAt ||
        (validTimestamp(timestamp) ? timestamp : '1970-01-01T00:00:00.000Z'),
      status: competition.status || 'active',
    };
    known.push(updated);
    return updated;
  };
  const seededProfiles = profiles.map(profile => {
    if (!isObject(profile) || !textId(profile.id)) return profile;
    return {
      ...profile,
      ...(isObject(profile.strongmanCompetition) ? {
        strongmanCompetition: stamp(profile.strongmanCompetition, profile.id, 'profile', profile.createdAt || profile.updatedAt),
      } : {}),
      ...(Array.isArray(profile.strongmanCompetitionHistory) ? {
        strongmanCompetitionHistory: profile.strongmanCompetitionHistory.map((competition, index) => (
          stamp(competition, profile.id, `history:${index}`, profile.createdAt || profile.updatedAt)
        )),
      } : {}),
    };
  });
  const activeIds = new Set(profiles.map(profile => profile?.activeRoutineId).filter(Boolean));
  const sorted = routines.filter(routine => isObject(routine) && routine.kind !== 'strongman' &&
    isObject(routine.inputs?.strongmanCompetition)).sort((left, right) => (
    Number(activeIds.has(right.id)) - Number(activeIds.has(left.id)) ||
    String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')) ||
    String(left.id || '').localeCompare(String(right.id || ''))
  ));
  const migratedByRecord = new Map();
  // Identity allocation must not change when a user selects a different plan.
  // Candidate priority above chooses the active meet; stable ID order groups
  // matching snapshots independently of that selection.
  [...sorted].sort((left, right) => String(left.id || '').localeCompare(String(right.id || ''))).forEach(routine => {
    const competition = stamp(routine.inputs.strongmanCompetition, routine.profileId, routine.id, routine.createdAt || routine.updatedAt);
    migratedByRecord.set(routine, {
      ...routine,
      inputs: { ...routine.inputs, strongmanCompetition: competition },
      ...(Array.isArray(routine.strongmanLog) ? {
        strongmanLog: routine.strongmanLog.map(entry => isObject(entry) && !has(entry, 'competitionId')
          ? { ...entry, competitionId: competition.id } : entry),
      } : {}),
    });
  });
  const migratedRoutines = routines.map(routine => migratedByRecord.get(routine) || routine);
  return {
    ...records,
    ...(Array.isArray(records.routines) ? { routines: migratedRoutines } : {}),
    ...(Array.isArray(records.profiles) ? { profiles: seededProfiles.map(profile => {
      if (!isObject(profile) || !textId(profile.id)) return profile;
      const candidate = sorted.find(routine => routine.profileId === profile.id && !routine.archived);
      return withStrongmanCompetitionDefaults({
        ...profile,
        ...(!has(profile, 'strongmanCompetition') && candidate ? {
          strongmanCompetition: migratedByRecord.get(candidate).inputs.strongmanCompetition,
        } : {}),
      });
    }) } : {}),
  };
};
