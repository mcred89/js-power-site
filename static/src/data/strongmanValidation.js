const invalid = path => { throw new Error(`The event plan has invalid ${path}.`); };
const object = (value, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path);
};
const optionalObject = (value, path, validate) => {
  if (value === undefined || value === null) return;
  object(value, path);
  if (validate) validate(value, path);
};
const strings = (value, path) => {
  if (value !== undefined && (!Array.isArray(value) || value.some(entry => typeof entry !== 'string'))) invalid(path);
};
const collection = (value, path, validate = () => {}) => {
  if (value === undefined) return;
  if (!Array.isArray(value)) invalid(path);
  const ids = new Set();
  value.forEach((entry, index) => {
    const location = `${path}[${index}]`;
    object(entry, location);
    if (entry.id !== undefined) {
      if (typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) invalid(`${location}.id`);
      ids.add(entry.id);
    }
    validate(entry, location);
  });
};
const fields = (value, path, names, type) => names.forEach(name => {
  if (value[name] !== undefined && value[name] !== null && typeof value[name] !== type) invalid(`${path}.${name}`);
});
const numbers = (value, path, names) => names.forEach(name => {
  const number = value[name];
  if (number !== undefined && number !== null && number !== '' &&
      (!['number', 'string'].includes(typeof number) || !Number.isFinite(Number(number)) || Number(number) < 0)) invalid(`${path}.${name}`);
});
const associations = (value, path) => {
  strings(value.capabilityIds, `${path}.capabilityIds`);
  strings(value.prerequisites, `${path}.prerequisites`);
  fields(value, path, ['eventId', 'practiceId', 'capabilityId', 'focus'], 'string');
};
const snapshot = (value, path) => {
  associations(value, path);
  collection(value.parts, `${path}.parts`, associations);
};
const measurements = (value, path) => {
  numbers(value, path, ['sets', 'weight', 'reps', 'distance', 'seconds', 'height']);
  fields(value, path, ['name', 'setup', 'notes', 'weightUnit', 'distanceUnit', 'heightUnit', 'loadMeaning', 'timeMode'], 'string');
};
const recipe = (value, path) => {
  measurements(value, path);
  associations(value, path);
  collection(value.parts, `${path}.parts`, (part, location) => { measurements(part, location); associations(part, location); });
};
const reference = (value, path) => {
  fields(value, path, ['routineId', 'workoutId', 'exerciseId', 'scope', 'sourceMovement'], 'string');
  associations(value, path);
  numbers(value, path, ['eventWeek']);
  optionalObject(value.sourcePrescription, `${path}.sourcePrescription`);
  optionalObject(value.sourceConditions, `${path}.sourceConditions`, measurements);
  optionalObject(value.capabilitySnapshot, `${path}.capabilitySnapshot`, snapshot);
};
const attempt = (value, path) => {
  measurements(value, path);
  associations(value, path);
  fields(value, path, ['status', 'outcome', 'partId', 'partName', 'completedAt'], 'string');
};
const evidence = (value, path) => {
  reference(value, path);
  collection(value.attempts, `${path}.attempts`, attempt);
};
const exercise = (value, path) => {
  associations(value, path);
  fields(value, path, ['reason'], 'string');
  optionalObject(value.capabilitySnapshot, `${path}.capabilitySnapshot`, snapshot);
  const prescription = (entry, location) => {
    fields(entry, location, ['movement', 'prescription'], 'string');
    numbers(entry, location, ['weight']);
    optionalObject(entry.event, `${location}.event`, recipe);
  };
  optionalObject(value.generated, `${path}.generated`, prescription);
  optionalObject(value.overrides, `${path}.overrides`, prescription);
};
const session = (value, path) => {
  fields(value, path, ['status', 'startedAt', 'completedAt', 'runningSince'], 'string');
  numbers(value, path, ['elapsedSeconds']);
  collection(value.eventBlocks, `${path}.eventBlocks`, (block, location) => {
    associations(block, location);
    fields(block, location, ['movement', 'reason', 'setup', 'status'], 'string');
    optionalObject(block.capabilitySnapshot, `${location}.capabilitySnapshot`, snapshot);
    optionalObject(block.recipe, `${location}.recipe`, recipe);
    optionalObject(block.draft, `${location}.draft`, measurements);
    collection(block.attempts, `${location}.attempts`, attempt);
  });
};

// Validate known structure without projecting or stripping extension fields.
// Optional fields remain optional so early event exports can still be restored.
export const validateStrongmanRecord = (record, { complete = false, template = false } = {}) => {
  object(record, 'record');
  if (record.kind !== 'strongman') return;
  fields(record, 'record', ['id', 'profileId', 'name', 'status'], 'string');
  optionalObject(record.inputs, 'inputs', (inputs, path) => {
    numbers(inputs, path, ['weeks']);
    collection(inputs.phases, `${path}.phases`, (phase, location) => {
      fields(phase, location, ['type', 'name'], 'string');
      numbers(phase, location, ['weeks']);
    });
    collection(inputs.events, `${path}.events`, (event, location) => {
      fields(event, location, ['name', 'family', 'priority', 'focus'], 'string');
      numbers(event, location, ['frequency', 'maxGap']);
      optionalObject(event.target, `${location}.target`, measurements);
      collection(event.practices, `${location}.practices`, (practice, practicePath) => {
        associations(practice, practicePath);
        strings(practice.phases, `${practicePath}.phases`);
        numbers(practice, practicePath, ['capacity']);
        fields(practice, practicePath, ['name', 'family', 'setup', 'rotation'], 'string');
        optionalObject(practice.recipe, `${practicePath}.recipe`, recipe);
        optionalObject(practice.taperRecipe, `${practicePath}.taperRecipe`, recipe);
      });
      collection(event.capabilities, `${location}.capabilities`, (capability, capabilityPath) => {
        associations(capability, capabilityPath);
        fields(capability, capabilityPath, ['name', 'status'], 'string');
        optionalObject(capability.criterion, `${capabilityPath}.criterion`, measurements);
        collection(capability.evidence, `${capabilityPath}.evidence`, evidence);
      });
      collection(event.coverage, `${location}.coverage`, reference);
    });
  });
  collection(record.coverageEvidence, 'coverageEvidence', evidence);
  collection(record.workouts, 'workouts', (workout, path) => {
    fields(workout, path, ['name', 'phase', 'weekLabel', 'completedAt', 'skippedAt'], 'string');
    numbers(workout, path, ['sequence', 'eventWeek']);
    collection(workout.exercises, `${path}.exercises`, exercise);
    optionalObject(workout.session, `${path}.session`, session);
    optionalObject(workout.hostRef, `${path}.hostRef`, reference);
    optionalObject(workout.eventRef, `${path}.eventRef`, reference);
  });
  if (complete) {
    const requiredCollection = (value, path) => { if (!Array.isArray(value)) invalid(path); };
    const requiredId = (value, path) => { if (typeof value !== 'string' || !value) invalid(path); };
    requiredId(record.id, 'id');
    object(record.inputs, 'inputs');
    requiredCollection(record.inputs.events, 'inputs.events');
    requiredCollection(record.inputs.phases, 'inputs.phases');
    if (!Number.isInteger(Number(record.inputs.weeks)) || Number(record.inputs.weeks) < 1) invalid('inputs.weeks');
    record.inputs.events.forEach((event, index) => {
      requiredId(event.id, `inputs.events[${index}].id`);
      requiredCollection(event.practices, `inputs.events[${index}].practices`);
      event.practices.forEach((practice, practiceIndex) => requiredId(practice.id, `inputs.events[${index}].practices[${practiceIndex}].id`));
    });
    if (!template) requiredCollection(record.workouts, 'workouts');
    (record.workouts || []).forEach((workout, index) => {
      requiredId(workout.id, `workouts[${index}].id`);
      requiredCollection(workout.exercises, `workouts[${index}].exercises`);
    });
  }
};
