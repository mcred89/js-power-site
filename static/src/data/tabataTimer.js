export const TABATA_WARMUP_MS = 60000;
export const TABATA_SPRINT_MS = 20000;
export const TABATA_REST_MS = 10000;

const validRoundCount = roundCount => (
  Number.isInteger(roundCount) && roundCount > 0 && roundCount <= 100
    ? roundCount
    : 0
);

const nonnegativeElapsed = elapsedMs => (
  Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
);

// Rest belongs to the sprint just completed. There is no rest after the last
// sprint, so eight sprints including the warmup take 4 minutes 50 seconds.
export const getTabataSchedule = roundCount => {
  const count = validRoundCount(roundCount);
  const phases = [];
  let elapsedMs = 0;
  const addPhase = (phase, sprintNumber, durationMs) => {
    phases.push({ phase, sprintNumber, startMs: elapsedMs, endMs: elapsedMs + durationMs });
    elapsedMs += durationMs;
  };

  if (count) addPhase('warmup', 1, TABATA_WARMUP_MS);
  for (let sprintNumber = 1; sprintNumber <= count; sprintNumber += 1) {
    addPhase('sprint', sprintNumber, TABATA_SPRINT_MS);
    if (sprintNumber < count) addPhase('rest', sprintNumber, TABATA_REST_MS);
  }
  addPhase('complete', count, 0);
  return phases;
};

export const getTabataTiming = (roundCount, elapsedMs = 0) => {
  const schedule = getTabataSchedule(roundCount);
  const completion = schedule[schedule.length - 1];
  const totalDurationMs = completion.startMs;
  const totalElapsedMs = Math.min(totalDurationMs, nonnegativeElapsed(elapsedMs));
  const current = schedule.find(item => totalElapsedMs < item.endMs) || completion;

  return {
    phase: current.phase,
    sprintNumber: current.sprintNumber,
    phaseRemainingMs: current.endMs - totalElapsedMs,
    totalElapsedMs,
    totalDurationMs,
  };
};

// Store elapsed time only when starting or pausing. Derive the running clock
// from its timestamp so delayed renders and background throttling cannot drift.
export const getTabataElapsedMs = (timer, now = Date.now()) => {
  if (!timer) return 0;
  const elapsedMs = nonnegativeElapsed(timer.elapsedMs);
  const runningSince = typeof timer.runningSince === 'string'
    ? Date.parse(timer.runningSince)
    : NaN;
  if (!Number.isFinite(runningSince) || !Number.isFinite(now)) return elapsedMs;
  return elapsedMs + Math.max(0, now - runningSince);
};
