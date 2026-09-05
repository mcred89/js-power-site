// These projections keep a performed attempt and its event-week exposure separate:
// several component attempts can provide distinct evidence in one training day.
export const performedEventAttempt = attempt => attempt.status !== 'skipped' && (
  ['successful', 'unsuccessful', 'partial'].includes(attempt.outcome) || typeof attempt.success === 'boolean'
);

export const completedEventBlocks = workout => {
  if (!workout.completedAt || workout.skippedAt) return [];
  if (Array.isArray(workout.session?.eventBlocks)) {
    return workout.session.eventBlocks.filter(block => (block.attempts || []).some(performedEventAttempt));
  }
  return workout.exercises || [];
};

export const coveredEventBlocks = workout => workout.completedAt ? completedEventBlocks(workout)
  : workout.skippedAt ? [] : workout.exercises || [];

export const exactWholeEventCoverage = (event, evidence) => evidence.scope === 'exact'
  && !evidence.unresolved && !evidence.needsReview
  && (evidence.planned !== false || Boolean(evidence.completedAt))
  && (evidence.wholeEvent === true || ((event.capabilities || []).length > 0
    && event.capabilities.every(capability => (evidence.capabilityIds || []).includes(capability.id))));

export const addEventWeekExposure = (exposures, eventId, week) => {
  if (!exposures.has(eventId)) exposures.set(eventId, new Set());
  exposures.get(eventId).add(week);
  return exposures.get(eventId).size;
};

export const eventExposureWeeks = (routine, coverageEvidence = routine.coverageEvidence || []) => {
  const exposures = new Map();
  routine.workouts.forEach(workout => coveredEventBlocks(workout).forEach(block => {
    addEventWeekExposure(exposures, block.eventId, workout.eventWeek || workout.sequence);
  }));
  routine.inputs.events.forEach(event => coverageEvidence.filter(evidence => evidence.eventId === event.id
    && exactWholeEventCoverage(event, evidence)).forEach(evidence => {
    if (Number.isInteger(Number(evidence.eventWeek))) addEventWeekExposure(exposures, event.id, Number(evidence.eventWeek));
  }));
  return exposures;
};

const capabilityIdsFor = (event, source) => [...new Set([
  ...(source.capabilityIds || []),
  ...(event.capabilities || []).filter(capability => source.focus === capability.id || source.focus === capability.name).map(capability => capability.id),
])];

// Capture the association now. Future edits to a practice must not relabel a
// historical clean as a press or an individual leg as a complete medley.
export const snapshotPracticeCapabilities = (event, practice, recipe = practice?.recipe) => {
  if (!event || !practice) return null;
  return {
    eventId: event.id,
    practiceId: practice.id,
    capabilityIds: capabilityIdsFor(event, practice),
    focus: practice.focus || '',
    parts: (recipe?.parts || []).map(part => {
      const source = part.practiceId ? event.practices?.find(item => item.id === part.practiceId) || part : part;
      return { id: part.id, capabilityIds: capabilityIdsFor(event, source), focus: source.focus || '' };
    }),
  };
};

export const snapshotCoversCapability = (snapshot, capabilityId, partId) => {
  if (!snapshot) return false;
  const source = partId ? snapshot.parts?.find(part => part.id === partId) : snapshot;
  return Boolean(source?.capabilityIds?.includes(capabilityId));
};
