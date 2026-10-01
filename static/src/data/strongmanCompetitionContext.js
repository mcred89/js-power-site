// Competition choices are references only. Existing results retain their own
// competition ID and event snapshot when a meet is edited or ended.
export const competitionChoicesForTraining = (competition, history = [], routine) => {
  const choices = new Map();
  [competition, ...history, routine?.inputs?.strongmanCompetition].filter(Boolean).forEach(item => {
    if (item.id && !choices.has(item.id)) choices.set(item.id, item);
  });
  return [...choices.values()];
};

export const competitionForPastTraining = (routine, competition, history = [], workout) => {
  const stored = routine?.inputs?.strongmanCompetition;
  if (competition === undefined) return stored;
  const choices = competitionChoicesForTraining(competition, history, routine);
  if (workout) {
    const entries = (routine?.strongmanLog || []).filter(entry => entry.workoutId === workout.id);
    const logged = entries[entries.length - 1];
    if (logged && Object.prototype.hasOwnProperty.call(logged, 'competitionId')) {
      return choices.find(item => item.id === logged.competitionId) || null;
    }
  }
  if (stored?.id) return choices.find(item => item.id === stored.id) || stored;
  return Object.prototype.hasOwnProperty.call(routine?.inputs || {}, 'strongmanCompetition') ? stored || null : competition;
};
