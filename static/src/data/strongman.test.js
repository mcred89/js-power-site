import {
  acceptPracticeRecipe, adaptStrongmanRoutine, confirmCapability,
  createStrongmanRoutine, defaultPhases, defaultStrongmanInputs,
  nextStrongmanWorkout, strongmanCoverage, updateStrongmanInputs,
  validateStrongmanInputs, matchingCapabilityEvidence, capabilityProgress,
} from './strongman';

const recipe = { sets: 4, weight: 180, reps: 1, distance: 40, seconds: null, weightUnit: 'lb', distanceUnit: 'ft', loadMeaning: 'total', notes: 'Repeatable work' };
const event = (id, extra = {}) => ({
  id, name: id, family: 'carry', priority: 'maintenance',
  practices: [{ id: `${id}-practice`, name: `${id} carry`, available: true, capacity: 1, recipe }],
  capabilities: [], coverage: [], ...extra,
});
const inputs = events => ({ ...defaultStrongmanInputs(), events });
const routine = events => createStrongmanRoutine('profile', 'Event block', inputs(events));

describe('strongman phases and boundaries', () => {
  it('uses independent competition and general phase presets', () => {
    expect(defaultPhases(12, 'competition').map(phase => phase.weeks)).toEqual([4, 4, 3, 1]);
    expect(defaultPhases(10, 'competition').map(phase => phase.weeks)).toEqual([3, 3, 3, 1]);
    expect(defaultPhases(4, 'general')).toEqual([{ id: 'phase-base-1', type: 'base', weeks: 4 }]);
    expect(defaultPhases(3, 'competition')).toEqual([]);
  });

  it('generates twelve independent event weeks and phase boundaries without strength inputs', () => {
    const plan = routine([event('sandbag')]);
    expect(plan).toMatchObject({ kind: 'strongman', profileId: 'profile', status: 'active' });
    expect(plan.workouts).toHaveLength(12);
    expect(plan.workouts.map(workout => workout.phase)).toEqual([
      'base', 'base', 'base', 'base', 'development', 'development', 'development', 'development', 'specific', 'specific', 'specific', 'taper',
    ]);
    expect(plan.workouts[11].exercises[0].generated.prescription).toBe('Set up taper work');
  });

  it('rejects impossible phases, invalid values, duplicate IDs, and circular prerequisites', () => {
    const bad = inputs([event('bag', {
      target: { weight: -1 },
      capabilities: [
        { id: 'pick', status: 'working', prerequisites: ['carry'] },
        { id: 'carry', status: 'unknown', prerequisites: ['pick'] },
      ],
    }), event('bag')]);
    bad.phases[0].weeks = 8;
    const messages = validateStrongmanInputs(bad).join(' ');
    expect(messages).toMatch(/phase.*length/i);
    expect(messages).toMatch(/weight/i);
    expect(messages).toMatch(/unique/i);
    expect(messages).toMatch(/cycle/i);
    expect(() => createStrongmanRoutine('p', 'invalid', bad)).toThrow();
  });

  it('returns validation messages for malformed imported shapes instead of throwing', () => {
    expect(validateStrongmanInputs({ ...defaultStrongmanInputs(), phases: {}, events: [null] }).length).toBeGreaterThan(0);
    expect(validateStrongmanInputs(inputs([event('bad', { practices: 'not an array' })])).length).toBeGreaterThan(0);
    expect(validateStrongmanInputs(inputs([event('bad', { practices: [{ id: 'bad', name: 'Bad', capacity: 0 }] })])).join(' ')).toMatch(/capacity/);
  });

  it('advances past resolved event weeks while ignoring the date and paused plans', () => {
    const plan = routine([event('bag')]);
    plan.workouts[0].skippedAt = '2026-01-01';
    plan.workouts[1].completedAt = '2026-01-02';
    expect(nextStrongmanWorkout(plan).eventWeek).toBe(3);
    expect(nextStrongmanWorkout({ ...plan, status: 'paused' })).toBeNull();
  });
});

describe('rolling allocation and baselines', () => {
  it('schedules unknown competition movements in the first available base rotation', () => {
    const events = Array.from({ length: 7 }, (_, index) => event(`unknown-${index}`, {
      priority: index < 2 ? 'main' : 'occasional',
      practices: [{ id: `p${index}`, name: 'Baseline', available: true, recipe: null }],
    }));
    const plan = routine(events);
    const assessments = plan.workouts.slice(0, 4).flatMap(workout => workout.exercises).filter(exercise => exercise.assessment);
    expect(new Set(assessments.map(exercise => exercise.eventId)).size).toBe(7);
    expect(plan.workouts.every(workout => workout.exercises.reduce((sum, exercise) => sum + exercise.capacity, 0) <= 4)).toBe(true);
    expect(assessments.every(exercise => exercise.generated.weight === '' && exercise.generated.event === null)).toBe(true);
  });

  it('reserves repeatable weak-point practice while avoiding starvation for many events', () => {
    const plan = routine([
      event('sandbag', { priority: 'main' }), event('axle', { priority: 'main', family: 'clean-press' }),
      event('stone'), event('keg'), event('farmer'), event('truck', { priority: 'occasional' }),
    ]);
    const summary = strongmanCoverage(plan);
    expect(summary.events.find(item => item.eventId === 'sandbag').planned).toBeGreaterThanOrEqual(3);
    expect(summary.events.every(item => item.planned > 0)).toBe(true);
    expect(summary.deficits).toEqual([]);
  });

  it('reports impossible coverage rather than silently adding a fifth block', () => {
    const plan = routine(Array.from({ length: 8 }, (_, index) => event(`main-${index}`, { priority: 'main' })));
    expect(plan.workouts.every(workout => workout.exercises.length <= 4)).toBe(true);
    expect(strongmanCoverage(plan).deficits.length).toBeGreaterThan(0);
    expect(new Set(plan.workouts.slice(0, 4).flatMap(workout => workout.exercises.map(exercise => exercise.eventId))).size).toBe(8);
  });

  it('keeps A/B variation stable through adaptation and preview', () => {
    const plan = routine([event('carry', { priority: 'main', practices: [
      { id: 'a', name: 'Farmers', rotation: 'A', available: true, recipe },
      { id: 'b', name: 'Front carry', rotation: 'B', available: true, recipe },
    ] })]);
    expect(plan.workouts[0].exercises[0].practiceId).toBe('a');
    expect(plan.workouts[1].exercises[0].practiceId).toBe('b');
    expect(adaptStrongmanRoutine(plan).workouts).toEqual(plan.workouts);
  });

  it('assesses unknown A/B movements independently within the same event', () => {
    const plan = routine([event('loading', { practices: [
      { id: 'sandbag', name: 'Sandbag load', rotation: 'A', recipe: null },
      { id: 'keg', name: 'Keg load', rotation: 'B', recipe: null },
    ] })]);
    const assessed = plan.workouts.slice(0, 4).flatMap(workout => workout.exercises.filter(exercise => exercise.assessment).map(exercise => exercise.practiceId));
    expect(assessed.sort()).toEqual(['keg', 'sandbag']);
    plan.workouts[0].completedAt = '2026-01-01';
    plan.workouts[0].session = { eventBlocks: [{ eventId: 'loading', practiceId: 'sandbag', assessment: true, attempts: [{ outcome: 'successful', weight: 100, reps: 1 }] }] };
    const updated = adaptStrongmanRoutine(plan);
    expect(updated.workouts.slice(1).flatMap(workout => workout.exercises.filter(exercise => exercise.assessment).map(exercise => exercise.practiceId))).toEqual(['keg']);
    expect(strongmanCoverage(updated).events[0].assessmentPending).toBe(true);
  });

  it('assesses a newly added unknown variation even when its event has an accepted known prescription', () => {
    const plan = routine([event('carry')]);
    const updated = updateStrongmanInputs(plan, { ...plan.inputs, events: [event('carry', { practices: [
      ...plan.inputs.events[0].practices, { id: 'zercher', name: 'Zercher carry', rotation: 'B', recipe: null },
    ] })] });
    expect(updated.workouts.slice(0, 4).flatMap(workout => workout.exercises).some(exercise => exercise.practiceId === 'zercher' && exercise.assessment)).toBe(true);
  });

  it('keeps unavailable exact events unassessed and reports the missing equipment', () => {
    const plan = routine([event('truck', { practices: [{ id: 'truck', name: 'Truck', available: false, recipe: null }] })]);
    expect(plan.workouts.every(workout => workout.exercises.length === 0)).toBe(true);
    expect(strongmanCoverage(plan).events[0].assessmentPending).toBe(true);
    expect(strongmanCoverage(plan).warnings.join(' ')).toMatch(/equipment/i);
  });

  it('returns one pending assessment when the original assessment was skipped', () => {
    const plan = routine([event('bag', { practices: [{ id: 'bag', name: 'Bag', recipe: null }] })]);
    plan.workouts[0].skippedAt = '2026-01-01';
    const updated = adaptStrongmanRoutine(plan);
    expect(updated.workouts.slice(1).flatMap(workout => workout.exercises).filter(exercise => exercise.assessment)).toHaveLength(1);
  });

  it('does not count a finished session containing only skipped blocks as assessment or exposure', () => {
    const plan = routine([event('bag', { practices: [{ id: 'bag', name: 'Bag', recipe: null }] })]);
    plan.workouts[0].completedAt = '2026-01-01';
    plan.workouts[0].session = { eventBlocks: [{ id: plan.workouts[0].exercises[0].id, eventId: 'bag', practiceId: 'bag', assessment: true, status: 'skipped', attempts: [] }] };
    const updated = adaptStrongmanRoutine(plan);
    expect(updated.workouts[1].exercises[0].assessment).toBe(true);
    expect(strongmanCoverage(updated).events[0]).toMatchObject({ completed: 0, assessmentPending: true });
  });

  it('uses an unsuccessful performed assessment as baseline information without confirming capability', () => {
    const plan = routine([event('bag', {
      capabilities: [{ id: 'pick', name: 'Pick', status: 'unknown', criterion: { weight: 300, reps: 1, setup: 'floor' } }],
      practices: [{ id: 'bag', name: 'Bag', capabilityIds: ['pick'], recipe: null }],
    })]);
    plan.workouts[0].completedAt = '2026-01-01';
    plan.workouts[0].session = { eventBlocks: [{ eventId: 'bag', practiceId: 'bag', assessment: true, status: 'completed', attempts: [
      { outcome: 'unsuccessful', status: 'completed', weight: 300, reps: 0, setup: 'floor' },
    ] }] };
    const updated = adaptStrongmanRoutine(plan);
    expect(updated.workouts.slice(1).flatMap(workout => workout.exercises).some(exercise => exercise.assessment)).toBe(false);
    expect(strongmanCoverage(updated).events[0]).toMatchObject({ completed: 1, assessmentPending: false });
    expect(capabilityProgress(updated)[0]).toMatchObject({ capabilityId: 'pick', status: 'unknown', matched: false });
  });

  it('counts exact whole-event normal-day coverage without changing any normal-day prescriptions', () => {
    const plan = routine([event('deadlift', { priority: 'main' }), event('bag')]);
    const updated = adaptStrongmanRoutine(plan, [1, 2, 3].map(eventWeek => ({ eventId: 'deadlift', eventWeek, scope: 'exact', wholeEvent: true })));
    expect(strongmanCoverage(updated).events.find(item => item.eventId === 'deadlift')).toMatchObject({ target: 3, deficit: 0, normalDayPlanned: 3 });
    expect(updated.workouts.slice(0, 4).flatMap(workout => workout.exercises).some(exercise => exercise.eventId === 'deadlift')).toBe(false);
  });

  it('restores event coverage when a normal-day source was skipped, changed, or removed', () => {
    const plan = routine([event('deadlift', { priority: 'main' }), event('bag')]);
    const updated = adaptStrongmanRoutine(plan, [1, 2, 3].map(eventWeek => ({
      eventId: 'deadlift', eventWeek, scope: 'exact', wholeEvent: true,
      needsReview: true, planned: false, completedAt: null,
    })));
    const deadlift = strongmanCoverage(updated).events.find(item => item.eventId === 'deadlift');
    expect(deadlift).toMatchObject({ normalDayPlanned: 0 });
    expect(deadlift.planned).toBeGreaterThanOrEqual(3);
  });

  it('respects an explicit maximum gap even when the frequency preference is lower', () => {
    const plan = routine([event('sandbag', { frequency: 1, maxGap: 1 }), event('axle'), event('keg'), event('carry')]);
    expect(plan.workouts.slice(0, 11).every(workout => workout.exercises.some(exercise => exercise.eventId === 'sandbag'))).toBe(true);
    expect(strongmanCoverage(plan).events.find(item => item.eventId === 'sandbag').target).toBe(4);
  });

  it('schedules late-added unknowns in the earliest suitable future session', () => {
    const plan = routine([event('bag')]);
    plan.workouts.slice(0, 5).forEach(workout => { workout.completedAt = '2026-01-01'; });
    const updated = updateStrongmanInputs(plan, { ...plan.inputs, events: [...plan.inputs.events, event('stone', { practices: [{ id: 'stone', name: 'Stone', recipe: null }] })] });
    expect(updated.workouts[5].exercises.some(exercise => exercise.eventId === 'stone' && exercise.assessment)).toBe(true);
    expect(updated.workouts.slice(0, 5)).toEqual(plan.workouts.slice(0, 5));
  });

  it('counts a full medley against its accepted capacity and does not pretend legs are full rehearsals', () => {
    const plan = routine([event('medley', { priority: 'main', family: 'medley', practices: [{ id: 'full', name: 'Full medley', capacity: 3, recipe }] }), event('axle'), event('bag')]);
    expect(plan.workouts.every(workout => workout.exercises.reduce((sum, exercise) => sum + exercise.capacity, 0) <= 4)).toBe(true);
  });
});

describe('prescriptions, evidence, and snapshots', () => {
  it('repeats accepted prescriptions exactly and makes no numeric progression on its own', () => {
    const plan = routine([event('bag')]);
    plan.workouts.slice(0, 11).forEach(workout => {
      workout.exercises.forEach(exercise => expect(exercise.generated.event).toMatchObject(recipe));
    });
    const progressed = acceptPracticeRecipe(plan, 'bag', 'bag-practice', { ...recipe, weight: 200 });
    expect(progressed.workouts[0].exercises[0].generated.event.weight).toBe(200);
    expect(plan.inputs.events[0].practices[0].recipe.weight).toBe(180);
  });

  it('preserves started, completed and locked workouts and field overrides', () => {
    const plan = routine([event('bag', { priority: 'main' }), event('axle')]);
    plan.workouts[0].completedAt = '2026-01-01';
    plan.workouts[1].session = { startedAt: '2026-01-02' };
    plan.workouts[2].locked = true;
    plan.workouts[3].exercises[0].overrides = { movement: 'My variation', weight: 125 };
    const updated = acceptPracticeRecipe(plan, 'bag', 'bag-practice', { ...recipe, weight: 200 });
    expect(updated.workouts.slice(0, 3)).toEqual(plan.workouts.slice(0, 3));
    expect(updated.workouts[3].exercises.find(exercise => exercise.id === plan.workouts[3].exercises[0].id).overrides).toEqual({ movement: 'My variation', weight: 125 });
  });

  it('validates paired work explicitly rather than copying the full prescription into every component', () => {
    const paired = event('bag', { practices: [{ id: 'pair', name: 'Picks and lighter carries', recipe: {
      parts: [{ id: 'pick', name: 'Pick', sets: 3, reps: 1, weight: 250 }, { id: 'carry', name: 'Carry', sets: 2, distance: 40, weight: 180 }],
    } }] });
    const plan = routine([paired]);
    expect(plan.workouts[0].exercises[0].generated.event.parts).toEqual(paired.practices[0].recipe.parts);
    const invalid = inputs([{ ...paired, practices: [{ ...paired.practices[0], recipe: { parts: [{ id: 'pick', name: 'Pick', weight: -1 }] } }] }]);
    expect(validateStrongmanInputs(invalid).join(' ')).toMatch(/weight/);
    expect(validateStrongmanInputs(invalid).join(' ')).toMatch(/sets|work/i);
  });

  it('accepts a changed setup for future prescriptions without mutating historical comparisons', () => {
    const plan = routine([event('bag', { practices: [{ id: 'bag', name: 'Bag', setup: 'floor', recipe }] })]);
    plan.workouts[0].completedAt = '2026-01-01';
    const updated = acceptPracticeRecipe(plan, 'bag', 'bag', { ...recipe, setup: 'blocks' });
    expect(updated.workouts[0].exercises[0].generated.event.setup).toBe('floor');
    expect(updated.workouts[1].exercises[0].generated.event.setup).toBe('blocks');
  });

  it('rejects phase shortening that would discard historical or locked event weeks', () => {
    const plan = routine([event('bag')]);
    plan.workouts[11].completedAt = '2026-01-01';
    expect(() => updateStrongmanInputs(plan, { ...plan.inputs, weeks: 10, phases: defaultPhases(10, 'competition') })).toThrow(/historical|started|locked/i);
  });

  it('requires exact capability conditions and explicit confirmation', () => {
    const capability = { id: 'pick', name: 'Pick', status: 'working', criterion: { weight: 300, reps: 1, setup: 'floor' } };
    const plan = routine([event('bag', { capabilities: [capability] })]);
    expect(matchingCapabilityEvidence(capability, { weight: 200, reps: 1, setup: 'floor', success: true })).toBe(false);
    expect(matchingCapabilityEvidence(capability, { weight: 300, reps: 1, setup: 'blocks', success: true })).toBe(false);
    expect(matchingCapabilityEvidence(capability, { weight: 300, reps: 1, setup: 'floor', success: false })).toBe(false);
    expect(matchingCapabilityEvidence(capability, { weight: 300, reps: 1, setup: 'floor', success: true })).toBe(true);
    expect(adaptStrongmanRoutine(plan).inputs.events[0].capabilities[0].status).toBe('working');
    expect(confirmCapability(plan, 'bag', 'pick', 'confirmed').inputs.events[0].capabilities[0].status).toBe('confirmed');
  });

  it('distinguishes a hold duration from a time limit and does not compare incompatible loads or units', () => {
    const hold = { criterion: { seconds: 30, timeMode: 'hold', weight: 200, weightUnit: 'lb' } };
    expect(matchingCapabilityEvidence(hold, { seconds: 35, weight: 200, weightUnit: 'lb', outcome: 'successful' })).toBe(true);
    expect(matchingCapabilityEvidence(hold, { seconds: 25, weight: 200, weightUnit: 'lb', outcome: 'successful' })).toBe(false);
    expect(matchingCapabilityEvidence(hold, { seconds: 35, weight: 200, weightUnit: 'kg', outcome: 'successful' })).toBe(false);
    expect(matchingCapabilityEvidence(hold, { seconds: 35, weight: 205, weightUnit: 'lb', outcome: 'successful' })).toBe(false);
    const timed = { criterion: { seconds: 30, timeMode: 'limit', distance: 40, distanceUnit: 'ft' } };
    expect(matchingCapabilityEvidence(timed, { seconds: 25, distance: 40, distanceUnit: 'ft', outcome: 'successful' })).toBe(true);
    expect(matchingCapabilityEvidence({ criterion: {} }, { outcome: 'successful' })).toBe(false);
    expect(matchingCapabilityEvidence({ criterion: { weight: 200, reps: 1 } }, { weight: 200, reps: 1, weightUnit: 'kg', outcome: 'successful' })).toBe(false);
    expect(matchingCapabilityEvidence({ criterion: { weight: 200, reps: 1, setup: 'floor' } }, { weight: 200, reps: 1, outcome: 'successful' })).toBe(false);
  });

  it('suggests only capabilities explicitly practiced and preserves confirmation as an athlete action', () => {
    const plan = routine([event('bag', {
      capabilities: [
        { id: 'pick', name: 'Pick', status: 'working', criterion: { weight: 300, reps: 1, setup: 'floor' } },
        { id: 'carry', name: 'Carry', status: 'working', criterion: { weight: 300, distance: 40, setup: 'floor' } },
      ], practices: [{ id: 'pick-only', name: 'Pick practice', capabilityIds: ['pick'], recipe: null }],
    })]);
    plan.workouts[0].completedAt = '2026-01-01';
    plan.workouts[0].session = { eventBlocks: [{ eventId: 'bag', practiceId: 'pick-only', capabilitySnapshot: plan.workouts[0].exercises[0].capabilitySnapshot, attempts: [
      { outcome: 'successful', weight: 300, reps: 1, distance: 40, setup: 'floor' },
    ] }] };
    expect(capabilityProgress(plan).map(item => item.matched)).toEqual([true, false]);
    expect(plan.inputs.events[0].capabilities[0].status).toBe('working');
  });

  it('keeps medley component attempts distinct from whole-sequence evidence', () => {
    const plan = routine([event('medley', {
      family: 'medley', capabilities: [{ id: 'full', name: 'Complete sequence', status: 'working', criterion: { seconds: 60, timeMode: 'limit' } }],
      practices: [{ id: 'full', name: 'Complete medley', wholeEvent: true, capabilityIds: ['full'], recipe: { parts: [
        { id: 'bag', name: 'Bag', sets: 1, distance: 20 }, { id: 'keg', name: 'Keg', sets: 1, distance: 20 },
      ] } }],
    })]);
    plan.workouts[0].completedAt = '2026-01-01';
    plan.workouts[0].session = { eventBlocks: [{ eventId: 'medley', practiceId: 'full', recipe: plan.inputs.events[0].practices[0].recipe, attempts: [
      { partId: 'bag', seconds: 25, outcome: 'successful' },
    ] }] };
    expect(capabilityProgress(plan)[0].matched).toBe(false);
    expect(strongmanCoverage(plan).events[0].practices[0]).toMatchObject({ completed: 1, rehearsalsCompleted: 0 });
    plan.workouts[0].session.eventBlocks[0].attempts.push({ partId: 'keg', seconds: 20, outcome: 'successful', status: 'skipped' });
    expect(strongmanCoverage(plan).events[0].practices[0].rehearsalsCompleted).toBe(0);
    plan.workouts[0].session.eventBlocks[0].attempts[1] = { partId: 'keg', seconds: 20, outcome: 'partial' };
    expect(strongmanCoverage(plan).events[0].practices[0].rehearsalsCompleted).toBe(0);
    plan.workouts[0].session.eventBlocks[0].attempts[1] = { partId: 'keg', seconds: 20, outcome: 'successful' };
    expect(strongmanCoverage(plan).events[0].practices[0].rehearsalsCompleted).toBe(1);
    plan.workouts[0].session.eventBlocks[0].attempts.reverse();
    expect(strongmanCoverage(plan).events[0].practices[0].rehearsalsCompleted).toBe(0);
  });

  it('keeps completed, skipped, and started phase snapshots when future phases are redesigned', () => {
    const plan = routine([event('bag')]);
    plan.workouts[0].completedAt = '2026-01-01';
    plan.workouts[1].skippedAt = '2026-01-02';
    plan.workouts[2].session = { startedAt: '2026-01-03' };
    const updated = updateStrongmanInputs(plan, { ...plan.inputs, phases: [{ id: 'development-only', type: 'development', weeks: 12 }] });
    expect(updated.workouts.slice(0, 3)).toEqual(plan.workouts.slice(0, 3));
    expect(updated.workouts.slice(3).every(workout => workout.phase === 'development')).toBe(true);
    expect(updated.status).toBe(plan.status);
    expect(nextStrongmanWorkout({ ...updated, status: 'complete' })).toBeNull();
  });

  it('preserves capability distinctions and never mutates normal-day coverage source records', () => {
    const plan = routine([event('axle', { priority: 'main', capabilities: [
      { id: 'clean', name: 'Clean', status: 'working' }, { id: 'press', name: 'Press', status: 'confirmed' },
    ] })]);
    const evidence = [{ eventId: 'axle', scope: 'exact', capabilityIds: ['press'], eventWeek: 1, completedAt: '2026-01-01' }];
    const before = JSON.stringify(evidence);
    const updated = adaptStrongmanRoutine(plan, evidence);
    expect(strongmanCoverage(updated).events[0].planned).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(evidence)).toBe(before);
    expect(updated.inputs.events[0].capabilities[0].status).toBe('working');
  });
});
