import { commitProfilePatch, completeExpiredProfileCompetition, createRoutineForProfile, observeCompetitionCompletion } from './profilePersistence';
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

describe('automatic completion persistence', () => {
  const now = new Date(2026, 9, 2, 12);
  const expired = { ...profile, strongmanCompetition: { ...competition, status: 'active', date: '2026-10-01' } };
  it('stores completion once without changing other profile fields', async () => {
    get.mockResolvedValueOnce(expired);
    const ended = await completeExpiredProfileCompetition('p1', now);
    expect(ended).toEqual({ ...expired, strongmanCompetition: null, updatedAt: now.toISOString(),
      strongmanCompetitionHistory: [{ ...expired.strongmanCompetition, status: 'completed', endedAt: now.toISOString() }] });
    get.mockResolvedValue(ended);
    expect(await completeExpiredProfileCompetition('p1', now)).toBe(ended);
    expect(applyBatch).toHaveBeenCalledTimes(1);
  });
  it.each(['postponed', 'completed', 'replaced'])('rechecks a %s competition after a competing write', async action => {
    const fresh = { ...expired, name: 'Updated profile', strongmanCompetition: action === 'completed' ? null : {
      ...expired.strongmanCompetition, id: action === 'replaced' ? 'next-meet' : 'meet', date: '2026-11-01',
    }, strongmanCompetitionHistory: [{ id: 'prior', status: 'saved' }] };
    get.mockResolvedValueOnce(expired).mockResolvedValueOnce(fresh);
    applyBatch.mockRejectedValueOnce(conflict());
    expect(await completeExpiredProfileCompetition('p1', now)).toBe(fresh);
    expect(applyBatch).toHaveBeenCalledTimes(1);
  });
  it('continues checking other profiles when an expired profile was deleted in another window', async () => {
    get.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ ...expired, id: 'p2' });
    const publish = jest.fn();
    const reportError = jest.fn();
    const past = { ...expired, strongmanCompetition: { ...expired.strongmanCompetition, date: '2000-01-01' } };
    const stop = observeCompetitionCompletion([past, { ...past, id: 'p2' }], publish, reportError);
    await new Promise(resolve => setTimeout(resolve, 0));
    stop();
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining('no longer available'));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2' }), expect.any(Object));
  });
});

describe('creating a plan around competition completion', () => {
  const now = new Date(2026, 9, 2, 12);
  const inactive = { ...profile, strongmanCompetition: null };
  const inputs = { maxSquat: '315', maxPress: '185', maxDead: '405', duration: '3 weeks',
    mainLiftChoice: 'Low', includeStrongmanDay: true,
    strongmanCompetition: { name: 'New meet', date: '', events: [] } };
  it('rejects an unrelated competition change instead of silently discarding the typed meet', async () => {
    get.mockResolvedValue(profile);
    await expect(createRoutineForProfile(inactive, 'New plan', inputs, now)).rejects.toThrow('changed in another window');
    expect(applyBatch).not.toHaveBeenCalled();
  });
  it.each(['', '2026-10-01'])('preserves concurrent history when adding a competition dated %p', async date => {
    const imported = { id: 'imported', name: 'Imported meet', events: [], status: 'saved', createdAt: now.toISOString() };
    get.mockResolvedValueOnce(inactive).mockResolvedValue({ ...inactive, strongmanCompetitionHistory: [imported] });
    const result = await createRoutineForProfile(inactive, 'New plan', {
      ...inputs, strongmanCompetition: { ...inputs.strongmanCompetition, date },
    }, now);
    expect(result.profile.strongmanCompetitionHistory[0]).toBe(imported);
    expect(result.profile.strongmanCompetitionHistory).toHaveLength(date ? 2 : 1);
    expect(result.routine.inputs.strongmanCompetition).toEqual(result.profile.strongmanCompetition);
  });
  it('allows the expected automatic expiry without reusing the old saved identity as a draft', async () => {
    const expired = { ...inactive, strongmanCompetition: { ...competition, id: 'expired', status: 'active', date: '2026-10-01' } };
    let stored = expired;
    get.mockImplementation(async () => stored);
    applyBatch.mockImplementation(async batch => { stored = batch.puts.profiles[0]; });
    const result = await createRoutineForProfile(expired, 'After meet', {
      ...inputs, strongmanCompetition: expired.strongmanCompetition,
    }, now);
    expect(result.profile.strongmanCompetition).toBeNull();
    expect(result.profile.strongmanCompetitionHistory).toHaveLength(1);
    expect(result.routine.inputs.strongmanCompetition).toBeNull();
  });
});
