import { normalizeMovementName, strongmanToday } from './strongman';

const makeId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const dayNumber = date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return NaN;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date
    ? timestamp / 86400000 : NaN;
};

const ageLabel = days => {
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? 'Last week' : `${weeks} weeks ago`;
};

// Actual dates, rather than plan week numbers or edit timestamps, identify the
// training to reuse. The current routine wins if it also appears in the cache.
export const previousStrongmanWorkouts = (routine, routines = [], workout, todayDate = strongmanToday()) => {
  const today = dayNumber(todayDate);
  if (!Number.isFinite(today)) return [];
  const plans = new Map();
  [routine, ...routines].filter(Boolean).forEach(plan => {
    if (plan.profileId === routine?.profileId && !plans.has(plan.id)) plans.set(plan.id, plan);
  });
  const groups = new Map();
  plans.forEach(plan => {
    (plan.strongmanLog || []).forEach(entry => {
      const days = today - dayNumber(entry.date);
      if (!(days > 0) || !entry.sets?.length || !entry.movement?.trim() ||
          (plan.id === routine?.id && entry.workoutId === workout?.id)) return;
      const id = JSON.stringify([plan.id, entry.workoutId || null, entry.date]);
      if (!groups.has(id)) groups.set(id, {
        id, date: entry.date, routineName: plan.name || 'Training plan', entries: [], label: ageLabel(days),
      });
      groups.get(id).entries.push(entry);
    });
  });
  return [...groups.values()].map(group => {
    const names = new Map();
    group.entries.forEach(entry => {
      const key = normalizeMovementName(entry.movement);
      if (!names.has(key)) names.set(key, entry.movement.trim());
    });
    const movements = [...names.values()];
    return { ...group, preview: `${movements.slice(0, 3).join(', ')}${movements.length > 3 ? ` +${movements.length - 3}` : ''}` };
  }).sort((left, right) => right.date.localeCompare(left.date) || left.id.localeCompare(right.id));
};

// These entries are pending prefills, never results. Logging an effort moves
// just that set into strongmanLog in the same write that removes it here.
export const copyStrongmanWorkout = (source, workoutId, date = strongmanToday(), competition = null) => {
  if (!workoutId || !Number.isFinite(dayNumber(date))) throw new Error('Choose a workout and valid training date.');
  if (!Array.isArray(source?.entries) || !source.entries.length) throw new Error('Choose a past workout with recorded sets.');
  return source.entries.map(entry => {
    const copied = JSON.parse(JSON.stringify(entry));
    const sameCompetition = Boolean(competition?.id) && entry.competitionId === competition.id;
    delete copied.createdAt;
    delete copied.updatedAt;
    return {
      ...copied,
      id: makeId(),
      date,
      workoutId,
      competitionId: competition?.id || null,
      eventId: sameCompetition ? entry.eventId || null : null,
      componentId: sameCompetition ? entry.componentId || null : null,
      notes: '',
      sets: copied.sets.map(set => ({ ...set, id: makeId(), successful: true })),
    };
  });
};
