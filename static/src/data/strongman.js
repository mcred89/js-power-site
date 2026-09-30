const makeId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const metrics = ['weight', 'distance', 'reps', 'seconds'];
const blank = value => value === '' || value === null || value === undefined;
const numberOrBlank = (value, label) => {
  if (blank(value) || (typeof value === 'string' && !value.trim())) return '';
  const number = Number(value);
  if (!['number', 'string'].includes(typeof value) || !Number.isFinite(number) || number < 0 ||
      number > 1000000 || (label === 'reps' && !Number.isInteger(number))) {
    throw new Error(`Enter ${label === 'reps' ? 'whole-number reps' : `a valid ${label}`} of zero or more.`);
  }
  return number;
};

const normalizeMetrics = value => Object.fromEntries(metrics.map(key => [key, numberOrBlank(value[key], key)]));
const metricsForScope = (set, scope) => scope === 'medley'
  ? { ...set, weight: '', distance: '', reps: '' } : set;
const normalizeSetMetrics = (set, scope) => {
  const normalized = normalizeMetrics(metricsForScope(set, scope));
  if (scope === 'medley' && normalized.seconds === '') throw new Error('Enter a time for each full medley run.');
  return normalized;
};
const timeGoalFor = value => {
  const timeGoal = value.timeGoal || 'fastest';
  if (!['fastest', 'longest'].includes(timeGoal)) throw new Error('Choose fastest or longest time.');
  return timeGoal;
};

export const normalizeMovementName = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
  new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;

export const strongmanToday = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

// Competition details are reference information. Blank targets stay unknown, and
// no event configuration generates prescribed exercises or completed results.
export const normalizeStrongmanCompetition = value => {
  if (value === null || value === undefined) return null;
  if (!isObject(value) || !Array.isArray(value.events)) throw new Error('Enter competition events.');
  if (value.name !== undefined && typeof value.name !== 'string') throw new Error('Enter a text competition name.');
  const date = String(value.date || '');
  if (date && !validDate(date)) throw new Error('Enter a valid competition date.');
  const seen = new Set();
  const uniqueId = id => {
    const result = typeof id === 'string' && id ? id : makeId();
    if (seen.has(result)) throw new Error('Each event and implement must have its own ID.');
    seen.add(result);
    return result;
  };
  return {
    ...value,
    name: String(value.name || '').trim(),
    date,
    events: value.events.map(event => {
      if (!isObject(event) || typeof event.name !== 'string' || !event.name.trim()) {
        throw new Error('Name each competition event.');
      }
      const type = event.type || 'single';
      if (!['single', 'medley'].includes(type)) throw new Error('Choose a single event or a medley.');
      if (event.components !== undefined && !Array.isArray(event.components)) throw new Error('Enter the medley implements.');
      return {
        ...event,
        id: uniqueId(event.id),
        name: event.name.trim(),
        type,
        timeGoal: timeGoalFor(event),
        ...normalizeMetrics(event),
        components: (event.components || []).map(component => {
          if (!isObject(component) || (component.name !== undefined && typeof component.name !== 'string')) throw new Error('Enter a text name for each medley implement.');
          return { ...component, id: uniqueId(component.id), name: String(component.name || '').trim(),
            timeGoal: timeGoalFor(component), ...normalizeMetrics(component) };
        }),
      };
    }),
  };
};

export const cloneStrongmanCompetition = value => !isObject(value) ? value : {
  ...value,
  events: Array.isArray(value.events) ? value.events.map(event => ({
    ...event,
    components: Array.isArray(event.components) ? event.components.map(component => ({ ...component })) : event.components,
  })) : value.events,
};

const validateStoredCompetition = value => {
  normalizeStrongmanCompetition(value);
  // Drafts may allocate IDs, but imported IDs must already be safe for the
  // editor's update/remove operations. Validation never rewrites the backup.
  value.events.forEach(event => [event, ...(event.components || [])].forEach(item => {
    if (typeof item.id !== 'string' || !item.id.trim()) {
      throw new Error('Each saved event and implement must have a nonempty text ID.');
    }
  }));
};

// v17 only adds the new containers. Existing sessions, retired archives and
// unrecognized records remain untouched; historical prescriptions are not logs.
export const addStrongmanTracking = record => {
  if (!isObject(record) || record.kind === 'strongman' || !isObject(record.inputs)) return record;
  const needsCompetition = !has(record.inputs, 'strongmanCompetition');
  const needsLog = Array.isArray(record.workouts) && !has(record, 'strongmanLog');
  if (!needsCompetition && !needsLog) return record;
  return {
    ...record,
    ...(needsCompetition ? { inputs: { ...record.inputs, strongmanCompetition: null } } : {}),
    ...(needsLog ? { strongmanLog: [] } : {}),
  };
};

const setupMetrics = value => metrics.map(key => blank(value?.[key]) ? null : Number(value[key]));

// Ignore IDs so the same course in a later meet can reuse records. Implement
// order and targets matter: a lighter or shorter medley cannot claim a course PR.
export const strongmanSetupKey = event => {
  if (!event) return '';
  return JSON.stringify([
    event.type || 'single',
    ...setupMetrics(event).slice(0, 3),
    (event.components || []).map(component => [normalizeMovementName(component.name), ...setupMetrics(component)]),
  ]);
};

export const isCompleteStrongmanSetup = event => Boolean(event) && (event.type !== 'medley' ||
  (Array.isArray(event.components) && event.components.length > 0 && event.components.every(component => (
    normalizeMovementName(component.name) && !blank(component.weight) &&
    ['distance', 'reps', 'seconds'].some(key => !blank(component[key]) && Number(component[key]) > 0)
  ))));

export const createStrongmanLogEntry = (values, timestamp = new Date().toISOString()) => {
  if (!isObject(values)) throw new Error('Enter the exercise you trained.');
  const movement = String(values.movement || '').trim();
  if (!movement) throw new Error('Enter an exercise name.');
  const date = values.date || strongmanToday();
  if (!validDate(date) || date > strongmanToday()) throw new Error('Choose today or a past training date.');
  const scope = values.scope || 'movement';
  if (!['movement', 'medley'].includes(scope)) throw new Error('Choose an exercise or full medley.');
  if (scope === 'medley' && (!isObject(values.eventSnapshot) || values.eventSnapshot.type !== 'medley')) {
    throw new Error('Select the full medley to record its result.');
  }
  if (!Array.isArray(values.sets) || !values.sets.length) throw new Error('Add at least one set.');
  const setIds = new Set();
  const sets = values.sets.map(set => {
    if (!isObject(set)) throw new Error('Enter the result for each set.');
    const normalized = normalizeSetMetrics(set, scope);
    if (!metrics.some(key => normalized[key] !== '')) throw new Error('Enter weight, reps, distance, or time for each set.');
    const id = set.id || makeId();
    if (setIds.has(id)) throw new Error('Each set must have its own ID.');
    setIds.add(id);
    return { ...set, ...normalized, id, successful: set.successful !== false };
  });
  return {
    ...values,
    id: values.id || makeId(),
    date,
    movement,
    workoutId: values.workoutId || null,
    eventId: values.eventId || null,
    componentId: values.componentId || null,
    scope,
    eventSnapshot: values.eventSnapshot ? normalizeStrongmanCompetition({ events: [{
      ...values.eventSnapshot, name: values.eventSnapshot.name?.trim() || movement,
    }] }).events[0] : null,
    sets,
    notes: String(values.notes || '').trim(),
    createdAt: values.createdAt || timestamp,
    updatedAt: timestamp,
  };
};

export const saveStrongmanLogEntry = (routine, values) => {
  const existing = (routine.strongmanLog || []).find(entry => entry.id === values.id);
  const entry = createStrongmanLogEntry({ ...existing, ...values });
  if (entry.workoutId && !routine.workouts?.some(workout => workout.id === entry.workoutId)) {
    throw new Error('This workout is no longer in the plan. Add the result as past training.');
  }
  return {
    ...routine,
    strongmanLog: existing
      ? routine.strongmanLog.map(item => item.id === entry.id ? entry : item)
      : [...(routine.strongmanLog || []), entry],
    updatedAt: new Date().toISOString(),
  };
};

export const removeStrongmanLogEntry = (routine, id) => ({
  ...routine,
  strongmanLog: (routine.strongmanLog || []).filter(entry => entry.id !== id),
  updatedAt: new Date().toISOString(),
});

// Validate the fields this release understands without rewriting a user's
// backup. Unknown properties and archived planner records are preserved.
export const validateStrongmanRecord = record => {
  if (!isObject(record) || record.kind === 'strongman') return;
  try {
    if (record.inputs?.strongmanCompetition != null) validateStoredCompetition(record.inputs.strongmanCompetition);
    if (record.strongmanLog === undefined) return;
    if (!Array.isArray(record.strongmanLog)) throw new Error('Training history must be a list.');
    const ids = new Set();
    record.strongmanLog.forEach(entry => {
      if (!isObject(entry) || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) ||
          typeof entry.movement !== 'string' || !entry.movement.trim() || !validDate(entry.date) ||
          !Array.isArray(entry.sets) || !entry.sets.length ||
          (entry.scope !== undefined && !['movement', 'medley'].includes(entry.scope))) {
        throw new Error('Check each dated exercise and its sets.');
      }
      ids.add(entry.id);
      if (entry.notes !== undefined && typeof entry.notes !== 'string') throw new Error('Training notes must be text.');
      if (entry.scope === 'medley' && entry.eventSnapshot?.type !== 'medley') throw new Error('A full medley needs its recorded setup.');
      if (entry.eventSnapshot) validateStoredCompetition({ events: [entry.eventSnapshot] });
      const setIds = new Set();
      entry.sets.forEach(set => {
        if (!isObject(set) || typeof set.id !== 'string' || !set.id || setIds.has(set.id) ||
            (set.successful !== undefined && typeof set.successful !== 'boolean')) throw new Error('Check each training set.');
        setIds.add(set.id);
        // Older versions could save a medley with only hidden movement fields.
        // Keep that history importable; new saves require an actual run time.
        const normalized = normalizeMetrics(set);
        if (!metrics.some(key => normalized[key] !== '')) throw new Error('Each set needs an actual result.');
      });
    });
  } catch (error) {
    throw new Error(`This backup contains invalid strongman data. ${error.message}`);
  }
};

export const strongmanResults = routines => (routines || []).flatMap(routine => (
  (Array.isArray(routine.strongmanLog) ? routine.strongmanLog : []).flatMap(entry => (
    (Array.isArray(entry.sets) ? entry.sets : []).map((set, setIndex) => {
      // Older entries could retain hidden movement fields after choosing a
      // medley. Interpret these runs by their time without rewriting history.
      const result = metricsForScope(set, entry.scope);
      return {
        ...entry,
        ...result,
        id: `${entry.id}:${set.id}`,
        entryId: entry.id,
        setId: set.id,
        setIndex,
        set: result,
        routineId: routine.id,
        routineName: routine.name,
        profileId: routine.profileId,
      };
    })
  ))
));

const positive = value => !blank(value) && Number.isFinite(Number(value)) && Number(value) > 0;
const successful = result => result.successful !== false && (result.scope === 'medley'
  ? positive(result.seconds)
  : metrics.some(key => positive(result[key])) &&
    !['reps', 'distance', 'seconds'].some(key => !blank(result[key]) && Number(result[key]) === 0));
const valueOrZero = value => blank(value) || !Number.isFinite(Number(value)) ? 0 : Number(value);

export const summarizeStrongmanResults = (results, { routineId, profileId, movement, scope, eventSnapshot } = {}) => {
  const records = (results || []).filter(result => (
    (!routineId || routineId === 'all' || result.routineId === routineId) &&
    (!profileId || result.profileId === profileId) &&
    (!movement || normalizeMovementName(result.movement) === normalizeMovementName(movement)) &&
    (!scope || (result.scope || 'movement') === scope)
  )).sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')) ||
    String(right.createdAt || '').localeCompare(String(left.createdAt || '')) || right.setIndex - left.setIndex);
  const completed = records.filter(successful);
  const ranked = [...completed].sort((left, right) => valueOrZero(right.weight) - valueOrZero(left.weight) ||
    valueOrZero(right.distance) - valueOrZero(left.distance) || valueOrZero(right.reps) - valueOrZero(left.reps));
  const timed = completed.filter(result => positive(result.seconds) && Boolean(eventSnapshot) &&
    ((result.scope || 'movement') === 'medley'
      ? strongmanSetupKey(result.eventSnapshot) === strongmanSetupKey(eventSnapshot)
      : ['weight', 'distance', 'reps'].every(key => blank(eventSnapshot[key])
        ? blank(result[key]) : !blank(result[key]) && Number(result[key]) === Number(eventSnapshot[key]))));
  // Without a selected course, medley times must not be compared against each
  // other. Progress can still list each historical run with its saved setup.
  const comparableTimed = timed.filter(result => result.scope !== 'medley' ||
    (Boolean(eventSnapshot) && isCompleteStrongmanSetup(eventSnapshot)));
  return {
    best: ranked[0] || null,
    latest: records[0] || null,
    fastest: [...comparableTimed].sort((left, right) => Number(left.seconds) - Number(right.seconds))[0] || null,
    longest: [...comparableTimed].sort((left, right) => Number(right.seconds) - Number(left.seconds))[0] || null,
    records,
  };
};
