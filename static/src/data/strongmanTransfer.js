import { validateStrongmanRecord } from './strongmanValidation';

const newId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : `copy-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const referenceKeys = new Set(['eventRef', 'hostRef', 'sourceRef', 'source', 'unresolvedHostRef', 'unresolvedEventRef']);
const containers = new Set(['inputs', 'events', 'phases', 'practices', 'capabilities', 'coverage', 'workouts', 'exercises',
  'blocks', 'session', 'eventBlocks', 'attempts', 'recipe', 'taperRecipe', 'parts', 'generated', 'event', 'overrides',
  'capabilitySnapshot', 'coverageEvidence', 'evidence', 'results', 'assessmentResults', ...referenceKeys]);
const identityFields = new Set(['id', 'eventId', 'practiceId', 'capabilityId', 'capabilityIds', 'prerequisites', 'routineId',
  'workoutId', 'exerciseId', 'sourceWorkoutId', 'partId', 'phaseId', 'blockId', 'sessionId', 'attemptId',
  'activeRoutineId', 'activeWorkoutRoutineId', 'activeStrongmanRoutineId', 'scheduledStrengthRoutineId']);

// Only references are rewritten. Unknown user fields and scalar values remain intact.
export const remapStrongmanReferences = (record, idMap, { externalUnresolved = false } = {}) => {
  const visit = (value, key = '') => {
    if (Array.isArray(value)) return value.map(item => visit(item, key));
    if (!value || typeof value !== 'object') {
      return typeof value === 'string' && identityFields.has(key) && idMap.has(value)
        ? idMap.get(value) : value;
    }
    const result = Object.fromEntries(Object.entries(value).map(([field, entry]) => [field,
      containers.has(field) || identityFields.has(field) ? visit(entry, field) : entry]));
    if (externalUnresolved && value.routineId && !idMap.has(value.routineId)) {
      result.unresolved = true;
    }
    return result;
  };
  return visit(record);
};

export const cloneStrongmanRoutine = (routine, {
  profileId = routine.profileId,
  name = routine.name,
  idFactory = newId,
  preserveHistory = false,
  idMap = new Map(),
} = {}) => {
  validateStrongmanRecord(routine);
  const collect = (value, key = '') => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(item => collect(item, key)); return; }
    if (referenceKeys.has(key) || (value.routineId && key !== '')) return;
    if (typeof value.id === 'string' && !idMap.has(value.id)) idMap.set(value.id, idFactory());
    Object.entries(value).forEach(([field, entry]) => { if (containers.has(field)) collect(entry, field); });
  };
  collect(routine);
  const copy = remapStrongmanReferences(routine, idMap, { externalUnresolved: !preserveHistory });
  copy.profileId = profileId;
  copy.name = name;
  if (preserveHistory) return copy;
  const reset = (value, key = '') => {
    if (Array.isArray(value)) return value.map(entry => reset(entry, key));
    if (!value || typeof value !== 'object') return value;
    const result = Object.fromEntries(Object.entries(value).map(([field, entry]) => {
      if (['evidence', 'results', 'assessmentResults', 'coverageEvidence'].includes(field)) return [field, []];
      if (['session', 'hostRef', 'eventRef', 'completedAt', 'skippedAt', 'startedAt', 'resolvedAt'].includes(field)) return [field, null];
      if (field === 'locked') return [field, false];
      return [field, containers.has(field) ? reset(entry, field) : entry];
    }));
    if (key === 'capabilities') result.status = 'unknown';
    return result;
  };
  const fresh = reset(copy);
  fresh.archived = false;
  fresh.status = 'saved';
  fresh.createdAt = new Date().toISOString();
  fresh.updatedAt = fresh.createdAt;
  return fresh;
};
