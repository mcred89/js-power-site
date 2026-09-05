// Event planning is deliberately independent of strength percentages and normal-day
// prescriptions. The only numeric work generated here is work explicitly accepted
// by the athlete for a matching practice.
import {
  addEventWeekExposure, completedEventBlocks, coveredEventBlocks, eventExposureWeeks,
  exactWholeEventCoverage, performedEventAttempt, snapshotCoversCapability, snapshotPracticeCapabilities,
} from './strongmanEvidence';
import { recipeForPractice } from './strongmanPrescription';

export const EVENT_FAMILIES = ['clean-press', 'press', 'load', 'carry', 'pull', 'static', 'throw', 'medley', 'custom'];
export const EVENT_FAMILY_TEMPLATES = {
  'clean-press': ['Clean', 'Rack position', 'Press', 'Repeat under event rules'],
  press: ['Clean', 'Rack position', 'Press', 'Repeat under event rules'],
  load: ['Pick', 'Position', 'Load to height', 'Repeat or transition'],
  carry: ['Acquire', 'Support', 'Initiate movement', 'Travel and turn', 'Sustain distance'],
  pull: ['Initiate movement', 'Maintain traction', 'Sustain movement'],
  static: ['Complete under event rules'],
  throw: ['Complete under event rules'],
  medley: ['Individual legs', 'Transitions', 'Complete sequence'],
  custom: [],
};

const PHASES = ['base', 'development', 'specific', 'taper', 'recovery'];
const numericFields = ['sets', 'weight', 'reps', 'distance', 'seconds', 'height'];
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const makeId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const resolved = workout => Boolean(workout.completedAt || workout.skippedAt);
const frozen = workout => resolved(workout) || Boolean(workout.session || workout.locked);
const fieldPresent = value => value !== '' && value !== null && value !== undefined;
const priorityRank = priority => priority === 'main' ? 0 : priority === 'occasional' ? 2 : 1;
const exposuresFor = event => Number(event.frequency) || (event.priority === 'main' ? 3 : event.priority === 'occasional' ? 1 : 2);
const targetExposures = (event, length = 4) => Math.min(length, Math.max(exposuresFor(event), event.maxGap ? Math.ceil(length / Number(event.maxGap)) : 0));
const capacityOf = practice => fieldPresent(practice.capacity) ? Number(practice.capacity) : 1;
const availablePractices = event => (event.practices || []).filter(practice => practice.available !== false);
const practiceUnknown = (event, practice) => !practice.recipe || (event.capabilities || []).some(capability =>
  capability.status === 'unknown' && (!(practice.capabilityIds || []).length || practice.capabilityIds.includes(capability.id)));
const assessmentKey = (eventId, practiceId) => `${eventId}:${practiceId}`;
const performedAttempt = performedEventAttempt;
const completedBlocks = completedEventBlocks;
const coveredBlocks = coveredEventBlocks;

export const defaultPhases = (weeks, mode = 'competition') => {
  const length = Number(weeks);
  if (!Number.isInteger(length) || length < 1) return [];
  if (mode === 'general') return [{ id: 'phase-base-1', type: 'base', weeks: length }];
  if (length < 4) return [];
  const remaining = length - 1;
  const sizes = [0, 1, 2].map(index => Math.floor(remaining / 3) + (index < remaining % 3 ? 1 : 0));
  return ['base', 'development', 'specific', 'taper'].map((type, index) => ({
    id: `phase-${type}-1`, type, weeks: index === 3 ? 1 : sizes[index],
  }));
};

export const defaultStrongmanInputs = () => ({
  mode: 'competition', weeks: 12, competitionDate: '', phases: defaultPhases(12), events: [],
});

const validateMeasurements = (value, label, errors) => {
  if (!value) return;
  if (typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label}: measurements must be an object.`);
    return;
  }
  numericFields.forEach(field => {
    if (!fieldPresent(value[field])) return;
    const number = Number(value[field]);
    if (!Number.isFinite(number) || number < 0 || (field === 'sets' && (!Number.isInteger(number) || number < 1))) {
      errors.push(`${label}: ${field} must be ${field === 'sets' ? 'a positive whole number' : 'a nonnegative number'}.`);
    }
  });
  if (value.weightUnit && !['lb', 'kg'].includes(value.weightUnit)) errors.push(`${label}: choose lb or kg.`);
  if (value.distanceUnit && !['ft', 'm', 'yd'].includes(value.distanceUnit)) errors.push(`${label}: choose ft, m, or yd.`);
  if (value.loadMeaning && !['total', 'per-hand', 'perHand', 'per hand'].includes(value.loadMeaning)) errors.push(`${label}: specify total or per-hand load.`);
  if (value.timeMode && !['hold', 'limit'].includes(value.timeMode)) errors.push(`${label}: choose a hold duration or time limit.`);
  if (value.parts !== undefined) {
    if (!Array.isArray(value.parts) || value.parts.length < 1 || value.parts.length > 12) {
      errors.push(`${label}: paired or medley work needs 1–12 explicit parts.`);
    } else {
      const ids = value.parts.map(part => part?.id);
      if (ids.some(id => !id) || new Set(ids).size !== ids.length) errors.push(`${label}: each part needs a unique identifier.`);
      value.parts.forEach(part => {
        if (!part || typeof part !== 'object') { errors.push(`${label}: each part must describe its work.`); return; }
        if (typeof part.name !== 'string' || !part.name.trim()) errors.push(`${label}: name each part.`);
        if (!fieldPresent(part.sets)) errors.push(`${label}: allocate sets explicitly for each part of the work.`);
        if (part.parts) errors.push(`${label}: nested prescription parts are not supported.`);
        validateMeasurements({ ...part, parts: undefined }, `${label}, ${part.name || 'part'}`, errors);
      });
    }
  }
};

export const validateStrongmanInputs = inputs => {
  const errors = [];
  if (!inputs || !['competition', 'general'].includes(inputs.mode)) errors.push('Choose general or competition training.');
  const weeks = Number(inputs?.weeks);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 104) errors.push('Block length must be 1–104 whole weeks.');
  const phases = inputs?.phases || [];
  if (!Array.isArray(phases) || !phases.length || phases.some(phase => !phase || !PHASES.includes(phase.type)
    || !Number.isInteger(Number(phase.weeks)) || Number(phase.weeks) < 1)
    || phases.reduce((sum, phase) => sum + Number(phase.weeks), 0) !== weeks) {
    errors.push('Phase weeks must be positive whole numbers and total the block length.');
  }
  if (inputs?.competitionDate && (!/^\d{4}-\d{2}-\d{2}$/.test(inputs.competitionDate)
    || !Number.isFinite(Date.parse(inputs.competitionDate)))) errors.push('Enter a valid competition date.');
  const events = inputs?.events;
  if (!Array.isArray(events) || !events.length) errors.push('Add at least one event or movement.');
  const unique = (items, label) => {
    const ids = items.map(item => item?.id);
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) errors.push(`${label} need unique identifiers.`);
  };
  if (Array.isArray(phases)) unique(phases, 'Phases');
  if (!Array.isArray(events)) return errors;
  unique(events, 'Events');
  events.forEach(event => {
    if (!event || typeof event !== 'object') { errors.push('Each event must describe its practices.'); return; }
    if (typeof event.name !== 'string' || !event.name.trim()) errors.push('Each event needs a name.');
    if (fieldPresent(event.frequency) && (!Number.isInteger(Number(event.frequency)) || Number(event.frequency) < 1 || Number(event.frequency) > 4)) errors.push(`${event.name}: frequency must be 1–4 exposures per four event days.`);
    if (fieldPresent(event.maxGap) && (!Number.isInteger(Number(event.maxGap)) || Number(event.maxGap) < 1)) errors.push(`${event.name}: maximum gap must be a positive whole number.`);
    validateMeasurements(event.target, event.name, errors);
    const practices = event.practices || [];
    if (!Array.isArray(practices)) { errors.push(`${event.name}: practices must be a list.`); return; }
    if (!practices.length) errors.push(`${event.name}: add a practice or baseline assessment.`);
    unique(practices, `${event.name} practices`);
    practices.forEach(practice => {
      if (!practice || typeof practice !== 'object') { errors.push(`${event.name}: each practice must describe its work.`); return; }
      if (typeof practice.name !== 'string' || !practice.name.trim()) errors.push(`${event.name}: each practice needs a name.`);
      if (!Number.isInteger(capacityOf(practice)) || capacityOf(practice) < 1 || capacityOf(practice) > 4) errors.push(`${event.name}: practice capacity must be 1–4 blocks.`);
      validateMeasurements(practice.recipe, `${event.name} practice`, errors);
      validateMeasurements(practice.taperRecipe, `${event.name} taper practice`, errors);
    });
    const capabilities = event.capabilities || [];
    if (!Array.isArray(capabilities) || capabilities.some(capability => !capability || typeof capability !== 'object'
      || (capability.prerequisites !== undefined && !Array.isArray(capability.prerequisites)))) {
      errors.push(`${event.name}: capabilities and their prerequisites must be lists.`);
      return;
    }
    unique(capabilities, `${event.name} capabilities`);
    const byId = new Map(capabilities.map(capability => [capability.id, capability]));
    const validateReferences = (source, field, label) => {
      if (source[field] === undefined) return;
      if (!Array.isArray(source[field])) { errors.push(`${label}: ${field === 'prerequisites' ? 'prerequisites' : 'capability links'} must be a list.`); return; }
      source[field].forEach(id => {
        if (typeof id !== 'string' || !byId.has(id)) errors.push(`${label}: ${field === 'prerequisites' ? 'prerequisite' : 'capability'} ${String(id)} is missing. Restore it or update this practice before saving.`);
      });
    };
    practices.filter(practice => practice && typeof practice === 'object').forEach(practice => {
      validateReferences(practice, 'prerequisites', `${event.name}, ${practice.name}`);
      validateReferences(practice, 'capabilityIds', `${event.name}, ${practice.name}`);
      [practice.recipe, practice.taperRecipe].forEach(recipe => {
        if (!Array.isArray(recipe?.parts)) return;
        recipe.parts.filter(part => part && typeof part === 'object').forEach(part => {
          validateReferences(part, 'capabilityIds', `${event.name}, ${practice.name}, ${part.name}`);
          if (part.practiceId && !practices.some(item => item?.id === part.practiceId)) errors.push(`${event.name}, ${practice.name}: component practice ${part.practiceId} is missing.`);
        });
      });
    });
    capabilities.forEach(capability => {
      if (!['unknown', 'working', 'confirmed'].includes(capability.status)) errors.push(`${event.name}: invalid capability status.`);
      validateMeasurements(capability.criterion, `${event.name} checkpoint`, errors);
      (capability.prerequisites || []).forEach(id => {
        if (!byId.has(id)) errors.push(`${event.name}: a capability prerequisite is missing.`);
      });
    });
    const finished = new Set();
    const visiting = new Set();
    const visit = id => {
      if (visiting.has(id)) return true;
      if (finished.has(id) || !byId.has(id)) return false;
      visiting.add(id);
      if ((byId.get(id).prerequisites || []).some(visit)) return true;
      visiting.delete(id);
      finished.add(id);
      return false;
    };
    if (capabilities.some(capability => visit(capability.id))) errors.push(`${event.name}: capability prerequisites contain a cycle.`);
  });
  return errors;
};

const assertInputs = inputs => {
  const errors = validateStrongmanInputs(inputs);
  if (errors.length) throw new Error(errors.join(' '));
};

const phaseAt = (inputs, week) => {
  let boundary = 0;
  return inputs.phases.find(phase => {
    boundary += Number(phase.weeks);
    return week <= boundary;
  })?.type || 'base';
};

const prescriptionText = recipe => {
  if (!recipe) return 'Set up today';
  if (recipe.parts?.length) return recipe.parts.map(part => `${part.name}: ${prescriptionText(part)}`).join('; ');
  const work = [];
  if (fieldPresent(recipe.sets)) work.push(`${recipe.sets} ${Number(recipe.sets) === 1 ? 'set' : 'sets'}`);
  if (fieldPresent(recipe.reps)) work.push(`${recipe.reps} ${Number(recipe.reps) === 1 ? 'rep' : 'reps'}`);
  if (fieldPresent(recipe.distance)) work.push(`${recipe.distance} ${recipe.distanceUnit || 'ft'}`);
  if (fieldPresent(recipe.seconds)) work.push(`${recipe.seconds} sec`);
  return work.join(' × ') || 'Accepted practice';
};

const selectPractice = (event, week, phase, assessment, assessed = new Set()) => {
  const available = availablePractices(event).filter(practice => !(practice.prerequisites || []).some(id =>
    !event.capabilities?.some(capability => capability.id === id && capability.status === 'confirmed')));
  if (!available.length) return null;
  const eligible = assessment ? available.filter(practice => practiceUnknown(event, practice)
    && !assessed.has(assessmentKey(event.id, practice.id))) : available;
  if (!eligible.length) return null;
  const preferredPhase = eligible.filter(practice => !practice.phases?.length || practice.phases.includes(phase));
  const pool = preferredPhase.length ? preferredPhase : eligible;
  const rotation = week % 2 ? 'A' : 'B';
  const rotating = pool.filter(practice => !practice.rotation || practice.rotation === 'both' || practice.rotation === rotation);
  const choices = rotating.length ? rotating : pool;
  if (assessment) return choices.find(practice => !practice.recipe) || choices[0];
  return choices[(Math.ceil(week / 2) - 1) % choices.length];
};

const exerciseFor = (routine, event, practice, week, phase, assessment, previous) => {
  const taper = phase === 'taper' || phase === 'recovery';
  const recipe = recipeForPractice(practice, phase);
  const reason = assessment ? 'Establish an early baseline'
    : event.priority === 'main' ? `Priority practice${event.focus ? `: ${event.focus}` : ''}`
      : event.priority === 'occasional' ? 'Occasional practice due this rotation' : 'Maintain event coverage';
  return {
    ...previous,
    id: previous?.id || `${routine.id}:event:${week}:${event.id}:${practice.id}`,
    eventId: event.id, practiceId: practice.id, focus: practice.focus || event.focus || '',
    assessment, reason, capacity: capacityOf(practice),
    capabilitySnapshot: snapshotPracticeCapabilities(event, practice, recipe),
    generated: {
      movement: practice.name, weight: recipe && fieldPresent(recipe.weight) ? recipe.weight : '',
      prescription: taper && !recipe ? 'Set up taper work' : prescriptionText(recipe),
      event: recipe ? { ...clone(recipe), setup: taper ? recipe.setup ?? practice.setup ?? '' : practice.setup ?? recipe.setup ?? '', weightUnit: recipe.weightUnit || 'lb', distanceUnit: recipe.distanceUnit || 'ft', loadMeaning: recipe.loadMeaning || 'total' } : null,
    },
    overrides: previous?.overrides ? { ...previous.overrides } : {},
  };
};

const exactWholeCoverage = exactWholeEventCoverage;

// Pure deterministic forecast: no timestamps, randomness, or writes. Historic,
// started and locked snapshots participate in coverage without being rewritten.
export const adaptStrongmanRoutine = (routine, coverageEvidence = routine.coverageEvidence || []) => {
  if (routine.kind !== 'strongman') return routine;
  const events = routine.inputs.events;
  const totalWeeks = Number(routine.inputs.weeks);
  const existing = new Map(routine.workouts.map(workout => [workout.eventWeek || workout.sequence, workout]));
  const assessmentReserved = new Set();
  routine.workouts.filter(workout => frozen(workout) && !workout.skippedAt).forEach(workout => {
    coveredBlocks(workout).filter(exercise => exercise.assessment).forEach(exercise => assessmentReserved.add(assessmentKey(exercise.eventId, exercise.practiceId)));
  });
  const lastExposure = new Map();
  const forecast = [];
  let windowCounts = new Map();
  let normalWindowCounts = new Map();
  let windowExposureWeeks = new Map();
  for (let week = 1; week <= totalWeeks; week += 1) {
    if ((week - 1) % 4 === 0) {
      // Reserve known normal-day coverage across this forecast window before
      // filling event slots; otherwise the planner duplicates work scheduled later.
      windowExposureWeeks = new Map(events.map(event => [event.id, new Set(coverageEvidence.filter(evidence =>
        evidence.eventId === event.id && Number(evidence.eventWeek) >= week && Number(evidence.eventWeek) < week + 4
        && exactWholeCoverage(event, evidence)).map(evidence => Number(evidence.eventWeek)))]));
      normalWindowCounts = new Map([...windowExposureWeeks].map(([id, weeks]) => [id, weeks.size]));
      windowCounts = new Map(normalWindowCounts);
    }
    const counts = windowCounts;
    const normalCounts = normalWindowCounts;
    const exposures = windowExposureWeeks;
    const current = existing.get(week);
    const phase = phaseAt(routine.inputs, week);
    const remaining = Math.min(4 - ((week - 1) % 4), totalWeeks - week + 1);
    events.forEach(event => {
      if (coverageEvidence.some(evidence => evidence.eventId === event.id && Number(evidence.eventWeek) === week && exactWholeCoverage(event, evidence))) {
        lastExposure.set(event.id, week);
      }
    });
    if (current && frozen(current)) {
      forecast.push(current);
      coveredBlocks(current).forEach(exercise => {
        counts.set(exercise.eventId, addEventWeekExposure(exposures, exercise.eventId, week));
        lastExposure.set(exercise.eventId, week);
      });
      continue;
    }
    const exercises = (current?.exercises || []).filter(exercise => exercise.locked || exercise.pinned
      || Object.keys(exercise.overrides || {}).length > 0).map(exercise => clone(exercise));
    const chosen = new Set(exercises.map(exercise => exercise.eventId));
    let capacity = exercises.reduce((sum, exercise) => sum + (exercise.capacity || 1), 0);
    exercises.forEach(exercise => {
      if (exercise.assessment) assessmentReserved.add(assessmentKey(exercise.eventId, exercise.practiceId));
      counts.set(exercise.eventId, addEventWeekExposure(exposures, exercise.eventId, week));
      lastExposure.set(exercise.eventId, week);
    });
    const windowLength = Math.min(4, totalWeeks - Math.floor((week - 1) / 4) * 4);
    const target = event => targetExposures(event, windowLength);
    const pendingWork = events.reduce((sum, event) => sum + Math.max(0, target(event) - (counts.get(event.id) || 0)), 0);
    const blockLimit = pendingWork > remaining * 3 ? 4 : 3;
    while (capacity < 4) {
      const occupiedCapacity = capacity;
      const families = new Set(exercises.map(exercise => {
        const configured = events.find(event => event.id === exercise.eventId);
        const family = configured?.practices.find(practice => practice.id === exercise.practiceId)?.family || configured?.family;
        return family === 'press' ? 'clean-press' : family;
      }));
      const candidates = events.map((event, index) => {
        if (chosen.has(event.id)) return null;
        const assessmentPractice = selectPractice(event, week, phase, true, assessmentReserved);
        const assessment = Boolean(assessmentPractice);
        const practice = assessmentPractice || selectPractice(event, week, phase, false);
        if (!practice || capacityOf(practice) + occupiedCapacity > 4) return null;
        const count = counts.get(event.id) || 0;
        const deficit = Math.max(0, target(event) - count);
        const gap = lastExposure.has(event.id) ? week - lastExposure.get(event.id) : week + 4;
         const maxGap = Number(event.maxGap) || Math.ceil(4 / exposuresFor(event));
         const overdue = gap >= maxGap;
         const deadlineDue = Boolean(event.maxGap) && (lastExposure.has(event.id) ? overdue : week >= maxGap);
        const family = practice.family || event.family;
        const baseVariety = phase === 'base' && ['press', 'clean-press', 'load', 'carry'].includes(family)
          && !families.has(family === 'press' ? 'clean-press' : family);
        const score = (assessment ? 100000 : 0) + (deadlineDue ? 10000 : 0) + (overdue ? 1000 + gap * 50 : 0)
          + deficit * 100 + (2 - priorityRank(event.priority)) * 10 + (baseVariety ? 5 : 0) - count;
        const coveredOnNormalDays = (normalCounts.get(event.id) || 0) >= target(event);
         return { event, practice, assessment, score, index, deficit, coveredOnNormalDays, deadlineDue };
      }).filter(Boolean).sort((a, b) => b.score - a.score || a.index - b.index);
      if (!candidates.length) break;
      // Once coverage is satisfied, leave capacity unused rather than expanding
      // every session merely because an implement is available. A single-event
      // plan still offers a usable weekly practice outline.
      const candidate = candidates.find(item => item.assessment || item.deficit > 0 || item.deadlineDue)
        || (exercises.length === 0 ? candidates.find(item => !item.coveredOnNormalDays) : null);
      if (!candidate) break;
      // A real deadline or an unresolved baseline may need the fourth block
      // even when the fixed-window frequency total initially suggested three.
      if (capacity >= blockLimit && !candidate.deadlineDue && !candidate.assessment) break;
      const { event, practice, assessment } = candidate;
      const previous = current?.exercises.find(exercise => exercise.eventId === event.id && exercise.practiceId === practice.id);
      exercises.push(exerciseFor(routine, event, practice, week, phase, assessment, previous));
      capacity += capacityOf(practice);
      chosen.add(event.id);
      counts.set(event.id, addEventWeekExposure(exposures, event.id, week));
      lastExposure.set(event.id, week);
      if (assessment) assessmentReserved.add(assessmentKey(event.id, practice.id));
    }
    forecast.push({
      ...current,
      id: current?.id || `${routine.id}:week:${week}`,
      sequence: week, eventWeek: week, weekIndex: week - 1,
      cycleIndex: 0, cycleLabel: 'Strongman', weekLabel: `Week ${week} of ${totalWeeks}`,
      name: 'Strongman day', phase,
      completedAt: null, skippedAt: null, session: null, locked: false, exercises,
    });
  }
  return { ...routine, workouts: forecast, coverageEvidence: clone(coverageEvidence) };
};

export const createStrongmanRoutine = (profileId, name, inputs) => {
  assertInputs(inputs);
  const timestamp = new Date().toISOString();
  return adaptStrongmanRoutine({
    id: makeId(), profileId, name: name.trim() || 'Strongman block', kind: 'strongman', status: 'active',
    inputs: clone(inputs), workouts: [], archived: false, createdAt: timestamp, updatedAt: timestamp,
  });
};

export const nextStrongmanWorkout = routine => routine?.kind === 'strongman' && routine.status === 'active' && !routine.archived
  ? routine.workouts.find(workout => !resolved(workout) && !workout.session) || null : null;

export const updateStrongmanInputs = (routine, inputs) => {
  assertInputs(inputs);
  if (routine.workouts.some(workout => workout.eventWeek > Number(inputs.weeks) && frozen(workout))) {
    throw new Error('The new length would remove historical, started, or locked event weeks.');
  }
  return adaptStrongmanRoutine({ ...routine, inputs: clone(inputs), updatedAt: new Date().toISOString() });
};

export const acceptPracticeRecipe = (routine, eventId, practiceId, recipe, scope = 'normal') => {
  if (!['normal', 'taper'].includes(scope)) throw new Error('Choose a normal or taper prescription.');
  if (!routine.inputs.events.some(event => event.id === eventId && event.practices.some(practice => practice.id === practiceId))) throw new Error('Practice was not found.');
  const errors = [];
  validateMeasurements(recipe, 'Prescription', errors);
  if (errors.length) throw new Error(errors.join(' '));
  return updateStrongmanInputs(routine, {
    ...routine.inputs,
    events: routine.inputs.events.map(event => event.id !== eventId ? event : {
      ...event, practices: event.practices.map(practice => practice.id !== practiceId ? practice : {
        ...practice,
        ...(scope === 'taper' ? { taperRecipe: clone(recipe) } : {
          recipe: clone(recipe), ...(recipe && Object.prototype.hasOwnProperty.call(recipe, 'setup') ? { setup: clone(recipe.setup) } : {}),
        }),
      }),
    }),
  });
};

export const confirmCapability = (routine, eventId, capabilityId, status = 'confirmed') => {
  if (!['unknown', 'working', 'confirmed'].includes(status)) throw new Error('Choose a valid capability status.');
  const event = routine.inputs.events.find(item => item.id === eventId);
  const capability = event?.capabilities.find(item => item.id === capabilityId);
  if (!capability) throw new Error('Capability was not found.');
  if (status === 'confirmed' && (capability.prerequisites || []).some(id => !event.capabilities.some(item => item.id === id && item.status === 'confirmed'))) throw new Error('Confirm the prerequisite capabilities first.');
  return updateStrongmanInputs(routine, {
    ...routine.inputs,
    events: routine.inputs.events.map(item => item.id !== eventId ? item : {
      ...item, capabilities: item.capabilities.map(value => value.id !== capabilityId ? value : { ...value, status }),
    }),
  });
};

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.keys(value).sort().reduce((result, key) => ({ ...result, [key]: canonical(value[key]) }), {}) : value;

export const matchingCapabilityEvidence = (capability, evidence) => {
  if (!(evidence.success === true || evidence.outcome === 'successful') || evidence.status === 'skipped' || !capability.criterion) return false;
  if (!numericFields.some(field => fieldPresent(capability.criterion[field]))) return false;
  if (fieldPresent(capability.criterion.weight)
    && ((capability.criterion.weightUnit || 'lb') !== (evidence.weightUnit || 'lb')
      || (capability.criterion.loadMeaning || 'total') !== (evidence.loadMeaning || 'total'))) return false;
  if (fieldPresent(capability.criterion.distance)
    && (capability.criterion.distanceUnit || 'ft') !== (evidence.distanceUnit || 'ft')) return false;
  return Object.entries(capability.criterion).every(([field, expected]) => {
    if (!fieldPresent(expected) || field === 'timeMode' || field === 'comparisons') return true;
    if (!fieldPresent(evidence[field])) return false;
    if (numericFields.includes(field)) {
      const comparison = capability.criterion.comparisons?.[field]
        || (field === 'weight' ? 'equal' : field === 'seconds' && capability.criterion.timeMode !== 'hold' ? 'atMost' : 'atLeast');
      if (comparison === 'equal') return Number(evidence[field]) === Number(expected);
      return comparison === 'atMost' ? Number(evidence[field]) <= Number(expected) : Number(evidence[field]) >= Number(expected);
    }
    return JSON.stringify(canonical(expected)) === JSON.stringify(canonical(evidence[field]));
  });
};

// Suggestions carry evidence; only confirmCapability changes checkpoint status.
// An explicit practice-to-capability relationship prevents a pick, press or
// individual medley leg from certifying a different component accidentally.
export const capabilityProgress = routine => routine.inputs.events.flatMap(event =>
  (event.capabilities || []).map(capability => {
    const eventEvidence = routine.workouts.filter(workout => workout.completedAt && !workout.skippedAt).flatMap(workout =>
      (workout.session?.eventBlocks || []).filter(block => block.eventId === event.id).flatMap(block => {
        return (block.attempts || []).filter(attempt => block.capabilitySnapshot?.eventId === event.id
          && snapshotCoversCapability(block.capabilitySnapshot, capability.id, attempt.partId)
          && performedAttempt(attempt) && matchingCapabilityEvidence(capability, attempt))
          .map(attempt => ({ workoutId: workout.id, practiceId: block.practiceId, ...clone(attempt) }));
      }));
    const normalEvidence = (routine.coverageEvidence || []).filter(source => source.eventId === event.id
      && source.scope === 'exact' && source.completedAt && !source.needsReview && !source.unresolved
      && source.capabilitySnapshot?.eventId === event.id).flatMap(source => (source.attempts || [])
      .filter(attempt => snapshotCoversCapability(source.capabilitySnapshot, capability.id, attempt.partId)
        && performedAttempt(attempt) && matchingCapabilityEvidence(capability, attempt))
      .map(attempt => ({
        workoutId: source.sourceWorkoutId, routineId: source.routineId, practiceId: source.exerciseId,
        source: 'normal-day', ...clone(attempt),
      })));
    const evidence = [...eventEvidence, ...normalEvidence].filter((item, index, items) => !item.id
      || items.findIndex(other => other.id === item.id && other.workoutId === item.workoutId && other.routineId === item.routineId) === index);
    return { eventId: event.id, capabilityId: capability.id, name: capability.name, status: capability.status, matched: evidence.length > 0, evidence };
  }));

const completedRehearsal = block => {
  const attempts = block.attempts || [];
  const parts = block.recipe?.parts;
  if (!parts?.length) return attempts.some(attempt => !attempt.partId && performedAttempt(attempt)
    && (attempt.outcome === 'successful' || attempt.success === true));
  let partIndex = 0;
  let repetitions = 0;
  for (const attempt of attempts) {
    const success = performedAttempt(attempt) && (attempt.outcome === 'successful' || attempt.success === true);
    if (!success) { partIndex = 0; repetitions = 0; continue; }
    if (attempt.partId !== parts[partIndex].id) {
      partIndex = 0;
      repetitions = 0;
      if (attempt.partId !== parts[0].id) continue;
    }
    repetitions += 1;
    if (repetitions >= Number(parts[partIndex].sets || 1)) {
      repetitions = 0;
      partIndex += 1;
      if (partIndex === parts.length) return true;
    }
  }
  return false;
};

export const strongmanCoverage = routine => {
  const pending = routine.workouts.filter(workout => !resolved(workout));
  const window = pending.slice(0, 4);
  const warnings = [];
  const projectedWeeks = eventExposureWeeks(routine);
  const events = routine.inputs.events.map(event => {
    const target = targetExposures(event, window.length);
    const planned = window.filter(workout => workout.exercises.some(exercise => exercise.eventId === event.id)).length;
    const normalDayWeeks = new Set((routine.coverageEvidence || []).filter(evidence => evidence.eventId === event.id
      && window.some(workout => workout.eventWeek === Number(evidence.eventWeek)) && exactWholeCoverage(event, evidence)).map(evidence => Number(evidence.eventWeek)));
    const coveredWeeks = new Set([...(projectedWeeks.get(event.id) || [])].filter(week => window.some(workout => workout.eventWeek === week)));
    const normalDayPlanned = normalDayWeeks.size;
    const completed = routine.workouts.filter(workout => completedBlocks(workout).some(exercise => exercise.eventId === event.id)).length;
    const assessedPractices = new Set(routine.workouts.flatMap(workout => completedBlocks(workout)
      .filter(exercise => exercise.eventId === event.id && exercise.assessment).map(exercise => exercise.practiceId)));
    const assessmentPending = event.practices.some(practice => practiceUnknown(event, practice) && !assessedPractices.has(practice.id));
    if (!availablePractices(event).length) warnings.push(`${event.name}: equipment is unavailable; exact practice remains unassessed or uncovered.`);
    if (event.maxGap) {
      const exposures = projectedWeeks.get(event.id) || new Set();
      const missedDeadline = window.find(workout => {
        if (exposures.has(workout.eventWeek)) return false;
        const previous = Math.max(0, ...[...exposures].filter(week => week < workout.eventWeek));
        return workout.eventWeek - previous >= Number(event.maxGap);
      });
      if (missedDeadline) warnings.push(`${event.name}: maximum gap of ${event.maxGap} event weeks needs practice by event week ${missedDeadline.eventWeek}. Review locks, equipment, or competing work.`);
    }
    const practices = event.practices.map(practice => ({
      practiceId: practice.id, name: practice.name,
      planned: window.filter(workout => workout.exercises.some(exercise => exercise.eventId === event.id && exercise.practiceId === practice.id)).length,
      completed: routine.workouts.filter(workout => completedBlocks(workout).some(exercise => exercise.eventId === event.id && exercise.practiceId === practice.id)).length,
      rehearsal: practice.wholeEvent === true || practice.focus === 'Complete sequence',
      assessmentPending: practiceUnknown(event, practice) && !assessedPractices.has(practice.id),
      rehearsalsCompleted: practice.wholeEvent === true || practice.focus === 'Complete sequence'
        ? routine.workouts.filter(workout => workout.completedAt && !workout.skippedAt
          && (workout.session?.eventBlocks || []).some(block => {
            if (block.eventId !== event.id || block.practiceId !== practice.id) return false;
            return completedRehearsal(block);
          })).length : 0,
    }));
    return { eventId: event.id, name: event.name, target, planned, completed, normalDayPlanned, practices, assessmentPending, deficit: Math.max(0, target - coveredWeeks.size) };
  });
  const deficits = events.filter(event => event.deficit > 0).map(event => ({ eventId: event.eventId, name: event.name, missing: event.deficit, message: `${event.name}: ${event.deficit} planned exposure${event.deficit === 1 ? '' : 's'} cannot fit this rotation.` }));
  window.forEach(workout => {
    if (workout.exercises.reduce((sum, exercise) => sum + (exercise.capacity || 1), 0) > 4) warnings.push(`${workout.weekLabel}: manually locked work exceeds four blocks.`);
  });
  return { window, events, deficits, warnings, phase: pending[0]?.phase || null, currentWeek: pending[0]?.eventWeek || null, remainingWeeks: pending.length };
};
