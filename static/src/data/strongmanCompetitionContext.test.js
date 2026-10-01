import { competitionChoicesForTraining, competitionForPastTraining } from './strongmanCompetitionContext';

const old = { id: 'old', name: 'First meet', events: [] };
const active = { id: 'active', name: 'Next meet', events: [] };
const routine = { inputs: { strongmanCompetition: old }, strongmanLog: [] };

it('retains the old meet for a past-plan backfill and prefers current targets for the same meet', () => {
  expect(competitionForPastTraining(routine, active, [old])).toBe(old);
  const edited = { ...old, name: 'Updated first meet' };
  expect(competitionForPastTraining(routine, edited)).toBe(edited);
});

it('uses a completed day’s recorded competition even after a plan spans more than one meet', () => {
  const plan = { ...routine, strongmanLog: [{ workoutId: 'day', competitionId: active.id }] };
  expect(competitionForPastTraining(plan, active, [old], { id: 'day' })).toBe(active);
  expect(competitionForPastTraining({ ...plan, strongmanLog: [{ workoutId: 'day', competitionId: null }] }, active, [old], { id: 'day' })).toBeNull();
});

it('offers ended and current meets once each without reviving them as the active meet', () => {
  expect(competitionChoicesForTraining(null, [old], routine)).toEqual([old]);
  expect(competitionChoicesForTraining(active, [old], routine)).toEqual([active, old]);
});

it('does not attribute a past plan without a competition to the current meet', () => {
  expect(competitionForPastTraining({ inputs: { strongmanCompetition: null } }, active, [old])).toBeNull();
});
