import { commitProfilePatch } from './profilePersistence';
import { applyBatch, get } from './storage';

jest.mock('./storage', () => ({ applyBatch: jest.fn(), get: jest.fn() }));

const competition = { id: 'meet', name: 'Fall show', events: [] };
const profile = { id: 'p1', name: 'Alex', activeRoutineId: 'old', strongmanCompetition: competition,
  strongmanCompetitionHistory: [], unknown: { retained: true } };
const conflict = () => Object.assign(new Error('changed'), { name: 'BatchConflictError' });

beforeEach(() => {
  jest.clearAllMocks();
  get.mockResolvedValue(profile);
  applyBatch.mockResolvedValue(undefined);
});

it('patches only requested fields and atomically guards the fresh profile and caller batch', async () => {
  const ended = { ...profile, strongmanCompetition: null,
    strongmanCompetitionHistory: [{ ...competition, status: 'completed' }] };
  get.mockResolvedValue(ended);
  const routine = { id: 'r2', profileId: 'p1' };
  const condition = { key: 'old', expected: { id: 'old' } };
  const batch = { puts: { routines: [routine] }, deletes: { routines: ['old'] },
    conditions: { routines: [condition] } };
  const updated = await commitProfilePatch('p1', { activeRoutineId: 'r2' }, batch);
  expect(updated).toEqual({ ...ended, activeRoutineId: 'r2' });
  expect(applyBatch).toHaveBeenCalledWith({ ...batch,
    puts: { routines: [routine], profiles: [updated] },
    conditions: { routines: [condition], profiles: [{ key: 'p1', expected: ended }] },
  });
  expect(batch.puts).toEqual({ routines: [routine] });
});

it('recomputes history changes against a fresh profile after an unrelated concurrent update', async () => {
  const imported = { id: 'prior', status: 'saved' };
  const concurrent = { ...profile, name: 'New name', strongmanCompetitionHistory: [imported] };
  get.mockResolvedValueOnce(profile).mockResolvedValueOnce(concurrent);
  applyBatch.mockRejectedValueOnce(conflict());
  const updated = await commitProfilePatch('p1', latest => ({
    strongmanCompetition: null,
    strongmanCompetitionHistory: [...latest.strongmanCompetitionHistory, { ...competition, status: 'completed' }],
  }), {}, { expectedCompetition: competition });
  expect(updated).toMatchObject({ name: 'New name', strongmanCompetition: null,
    strongmanCompetitionHistory: [imported, { ...competition, status: 'completed' }] });
  expect(applyBatch).toHaveBeenCalledTimes(2);
  expect(profile.strongmanCompetitionHistory).toEqual([]);
});

it('rejects a lifecycle change when the competition changed before or during the commit', async () => {
  get.mockResolvedValue({ ...profile, strongmanCompetition: null });
  await expect(commitProfilePatch('p1', { strongmanCompetition: competition }, {},
    { expectedCompetition: competition })).rejects.toThrow('changed in another window');
  expect(applyBatch).not.toHaveBeenCalled();
  get.mockResolvedValueOnce(profile).mockResolvedValueOnce({ ...profile, strongmanCompetition: null });
  applyBatch.mockRejectedValueOnce(conflict());
  await expect(commitProfilePatch('p1', { strongmanCompetition: null }, {},
    { expectedCompetition: competition })).rejects.toThrow('changed in another window');
  expect(applyBatch).toHaveBeenCalledTimes(1);
});

it('guards an explicitly absent competition and does not recreate deleted profiles', async () => {
  await expect(commitProfilePatch('p1', {}, {}, { expectedCompetition: undefined }))
    .rejects.toThrow('changed in another window');
  get.mockResolvedValue(undefined);
  await expect(commitProfilePatch('p1', { name: 'Alex' })).rejects.toThrow('no longer available');
  expect(applyBatch).not.toHaveBeenCalled();
});

it('treats an omitted competition field as inactive when adding a first competition', async () => {
  const legacy = { id: 'p1', name: 'Alex', activeRoutineId: 'old' };
  get.mockResolvedValue(legacy);
  const updated = await commitProfilePatch('p1', { strongmanCompetition: competition }, {},
    { expectedCompetition: null });
  expect(updated).toEqual({ ...legacy, strongmanCompetition: competition });
  expect(applyBatch).toHaveBeenCalledWith(expect.objectContaining({
    conditions: { profiles: [{ key: 'p1', expected: legacy }] },
  }));
});

it('limits conflict retries and passes other storage failures through without publishing', async () => {
  applyBatch.mockRejectedValue(conflict());
  await expect(commitProfilePatch('p1', { activeRoutineId: 'r2' })).rejects.toThrow('changed in another window');
  expect(applyBatch).toHaveBeenCalledTimes(3);
  applyBatch.mockRejectedValueOnce(new Error('Storage is full'));
  await expect(commitProfilePatch('p1', { activeRoutineId: 'r2' })).rejects.toThrow('Storage is full');
  expect(applyBatch).toHaveBeenCalledTimes(4);
});
