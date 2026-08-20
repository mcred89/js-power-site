import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App, { isInstalledApp } from './App';
import TrackerApp from './TrackerApp';
import { activateRoutineImport, canShareTransfer, commitRoutineLifecycle, completeWorkoutSetWithDraft, ConfirmationModal, createControllerChangeHandler, createSerializedRoutineWriter, createSharedTransferContents, createTransferFile, importPlanBatch, initialProfileId, loadInitialTrackerRecords, mergeRoutineRead, PlanSetup, profileAfterFinishedRoutine, RoutineNameEditor, sharedTransferContents, shareTransfer, skipWorkoutSetWithDraft, templateBuilderInputs, todayRoutineIds, trackerLoadPolicy, WorkoutCard } from './TrackerApp';
import { RoutineCopyDialog, TransferCreator } from './components/TrackerOverlays';
import { RoutineBuilderScreen as RoutineBuilder } from './components/RoutineBuilderScreen';

jest.mock('./data/dataWorkerFactory', () => ({
  createDataWorker: jest.fn(() => { throw new Error('Worker unavailable in Jest.'); }),
}));

describe('default profile selection', () => {
  const profiles = [{ id: 'wife' }, { id: 'husband' }];

  it('opens the saved default profile', () => {
    expect(initialProfileId(profiles, 'husband')).toBe('husband');
  });

  it('falls back to the first profile when the saved default no longer exists', () => {
    expect(initialProfileId(profiles, 'deleted')).toBe('wife');
  });
});

describe('service worker controller changes', () => {
  it('learns the initial controller and reloads once for its replacement', () => {
    const reload = jest.fn();
    const controllerChanged = createControllerChangeHandler(false, reload);
    controllerChanged();
    expect(reload).not.toHaveBeenCalled();
    controllerChanged();
    controllerChanged();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads once on the first replacement when already controlled', () => {
    const reload = jest.fn();
    const controllerChanged = createControllerChangeHandler(true, reload);
    controllerChanged();
    controllerChanged();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('staged tracker loading', () => {
  it('reads only profiles, default metadata, and the selected Today routines at startup', async () => {
    const profiles = [
      { id: 'p1', activeRoutineId: 'r1', activeWorkoutRoutineId: 'r2' },
      { id: 'p2', activeRoutineId: 'unread' },
    ];
    const storage = {
      getAll: jest.fn().mockResolvedValue(profiles),
      get: jest.fn((store, key) => Promise.resolve(store === 'metadata'
        ? { key, value: 'p1' }
        : { id: key, profileId: 'p1' })),
    };
    const result = await loadInitialTrackerRecords(storage);
    expect(storage.getAll).toHaveBeenCalledTimes(1);
    expect(storage.getAll).toHaveBeenCalledWith('profiles');
    expect(storage.get.mock.calls).toEqual([
      ['metadata', 'defaultProfileId'], ['routines', 'r1'], ['routines', 'r2'],
    ]);
    expect(result.routines.map(item => item.id)).toEqual(['r1', 'r2']);
    expect(todayRoutineIds({ activeRoutineId: 'same', activeWorkoutRoutineId: 'same' })).toEqual(['same']);
  });

  it('recovers Today routines when the selected profile has no usable active pointer', async () => {
    const storedRoutine = { id: 'r1', profileId: 'p1' };
    const storage = {
      getAll: jest.fn().mockResolvedValue([{ id: 'p1', activeRoutineId: 'missing' }]),
      get: jest.fn((store, key) => Promise.resolve(store === 'metadata'
        ? { key, value: 'p1' }
        : undefined)),
      getAllByIndex: jest.fn().mockResolvedValue([storedRoutine]),
    };

    const result = await loadInitialTrackerRecords(storage);

    expect(storage.getAllByIndex).toHaveBeenCalledWith('routines', 'profileId', 'p1');
    expect(result.routines).toEqual([storedRoutine]);
  });

  it('rejects stale profile reads and preserves newer cached records', () => {
    const current = [{ id: 'r1', updatedAt: '2026-02-01' }];
    expect(mergeRoutineRead(current, [{ id: 'stale-profile' }], 1, 2)).toBe(current);
    expect(mergeRoutineRead(current, [{ id: 'r1', updatedAt: '2025-01-01' }, { id: 'r2' }], 2, 2))
      .toEqual([...current, { id: 'r2' }]);
  });

  it('defers secondary records and global reads to their owning operations', () => {
    expect(trackerLoadPolicy('today')).toEqual({ profileRoutines: false, templates: false, persistence: false });
    expect(trackerLoadPolicy('progress')).toEqual({ profileRoutines: true, templates: false, persistence: false });
    expect(trackerLoadPolicy('settings')).toEqual({ profileRoutines: false, templates: true, persistence: true });
  });

  it('turns an import decision into one multi-store batch without skipped records', () => {
    expect(importPlanBatch({
      profiles: [
        { action: 'copy', imported: { id: 'p1' }, result: { id: 'p1' } },
        { action: 'skip', imported: { id: 'p2' }, local: { id: 'p2' }, result: { id: 'p2' } },
      ],
      routines: [{ action: 'merge', imported: { id: 'r1' }, local: { id: 'r1', local: true }, result: { id: 'r1' } }],
      templates: [],
    })).toEqual({
      puts: {
        profiles: [{ id: 'p1' }],
        routines: [{ id: 'r1' }],
        templates: [],
      },
      conditions: {
        profiles: [{ key: 'p1', expected: undefined }, { key: 'p2', expected: { id: 'p2' } }],
        routines: [{ key: 'r1', expected: { id: 'r1', local: true } }],
        templates: [],
      },
    });
  });

  it('activates a transferred routine on an existing destination profile', () => {
    const profile = { id: 'p1', name: 'Alex', activeRoutineId: null, updatedAt: 'old' };
    const plan = activateRoutineImport({ profiles: [], routines: [{
      type: 'routine', action: 'copy', imported: { id: 'r1' }, result: { id: 'r1' },
    }], templates: [] }, profile, 'r1', 'new');

    expect(importPlanBatch(plan)).toMatchObject({
      puts: { profiles: [{ id: 'p1', name: 'Alex', activeRoutineId: 'r1', updatedAt: 'new' }] },
      conditions: { profiles: [{ key: 'p1', expected: profile }] },
    });
  });

  it('activates a transferred routine on its newly imported profile', () => {
    const profile = { id: 'p1', name: 'Alex' };
    const plan = activateRoutineImport({ profiles: [{
      type: 'profile', status: 'new', action: 'copy', imported: profile, result: profile,
    }], routines: [], templates: [] }, profile, 'r1', 'new');

    expect(plan.profiles[0]).toMatchObject({
      action: 'copy',
      imported: { activeRoutineId: 'r1', updatedAt: 'new' },
      result: { activeRoutineId: 'r1', updatedAt: 'new' },
    });
  });

  it('loads the overlay module independently of TrackerApp', async () => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    const overlays = await import('./components/TrackerOverlays');
    const div = document.createElement('div');
    const root = createRoot(div);
    await act(async () => root.render(<overlays.TrackerNotices message="Saved" updateRegistration={null} />));
    expect(div.textContent).toContain('Saved');
    act(() => root.unmount());
    global.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('activates the current waiting worker when the observed registration is stale', async () => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    const waiting = { postMessage: jest.fn() };
    const currentRegistration = {
      waiting, installing: null, addEventListener: jest.fn(), removeEventListener: jest.fn(),
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: {},
        getRegistration: jest.fn().mockResolvedValue(currentRegistration),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      },
    });
    const overlays = await import('./components/TrackerOverlays');
    const div = document.createElement('div');
    const root = createRoot(div);
    await act(async () => root.render(<overlays.TrackerNotices
      message=""
      updateRegistration={{ waiting: null }}
    />));

    await act(async () => div.querySelector('button').click());

    expect(navigator.serviceWorker.getRegistration).toHaveBeenCalledTimes(1);
    expect(waiting.postMessage).toHaveBeenCalledWith('skip-waiting');
    expect(div.querySelector('button').disabled).toBe(true);
    expect(div.querySelector('button').textContent).toBe('Updating…');
    act(() => root.unmount());
    global.IS_REACT_ACT_ENVIRONMENT = false;
  });
});

it('starts the first routine persistence synchronously and serializes later saves', async () => {
  const releases = [];
  const persisted = [];
  const persist = jest.fn((store, record) => {
    persisted.push([store, record.id]);
    return new Promise(resolve => releases.push(resolve));
  });
  const write = createSerializedRoutineWriter(persist);

  const first = write({ id: 'first' });
  const second = write({ id: 'second' });
  expect(persisted).toEqual([['routines', 'first']]);
  releases.shift()();
  await Promise.resolve();
  expect(persisted).toEqual([['routines', 'first'], ['routines', 'second']]);
  releases.shift()();
  await Promise.all([first, second]);
  expect(persist).toHaveBeenCalledTimes(2);
});

it('continues the routine persistence queue after a failed save', async () => {
  const persist = jest.fn()
    .mockRejectedValueOnce(new Error('write failed'))
    .mockResolvedValueOnce(undefined);
  const write = createSerializedRoutineWriter(persist);
  const first = write({ id: 'first' });
  const second = write({ id: 'second' });
  await expect(first).rejects.toThrow('write failed');
  await expect(second).resolves.toBeUndefined();
  expect(persist.mock.calls.map(call => call[1].id)).toEqual(['first', 'second']);
});

it('allows an ordered routine write to atomically persist its profile lifecycle update', async () => {
  const normalPersist = jest.fn();
  const atomicPersist = jest.fn().mockResolvedValue(undefined);
  const write = createSerializedRoutineWriter(normalPersist);
  const routine = { id: 'routine-1' };
  await write(routine, atomicPersist);
  expect(atomicPersist).toHaveBeenCalledWith(routine);
  expect(normalPersist).not.toHaveBeenCalled();
});

it('clears only the matching active workout reference when finishing', () => {
  const profile = { id: 'p1', activeWorkoutRoutineId: 'r2', unknown: true };
  expect(profileAfterFinishedRoutine(profile, 'r1')).toBe(profile);
  expect(profileAfterFinishedRoutine(profile, 'r2', 'now')).toEqual({
    id: 'p1', activeWorkoutRoutineId: null, unknown: true, updatedAt: 'now',
  });
});

it.each(['start', 'reopen', 'finish'])('%s lifecycle state publishes only after commit and recovers in queue order', async action => {
  const committed = [];
  const publish = jest.fn((routine, profile) => committed.push([routine.status, profile.activeWorkoutRoutineId]));
  const persist = jest.fn()
    .mockRejectedValueOnce(new Error(`${action} failed`))
    .mockResolvedValueOnce(undefined);
  const writer = createSerializedRoutineWriter(jest.fn());
  const failedRoutine = { id: 'r1', status: `${action}-failed` };
  const failedProfile = { id: 'p1', activeWorkoutRoutineId: action === 'finish' ? null : 'r1' };
  const recoveredRoutine = { id: 'r1', status: `${action}-recovered` };
  const recoveredProfile = { id: 'p1', activeWorkoutRoutineId: action === 'finish' ? null : 'r1' };

  const failed = commitRoutineLifecycle({
    writer, routine: failedRoutine, profile: failedProfile, persist, publish,
  });
  const recovered = commitRoutineLifecycle({
    writer, routine: recoveredRoutine, profile: recoveredProfile, persist, publish,
  });
  expect(publish).not.toHaveBeenCalled();
  await expect(failed).rejects.toThrow(`${action} failed`);
  expect(publish).not.toHaveBeenCalled();
  await expect(recovered).resolves.toBeUndefined();
  expect(committed).toEqual([[`${action}-recovered`, recoveredProfile.activeWorkoutRoutineId]]);
  expect(persist.mock.calls.map(call => call[0].status)).toEqual([
    `${action}-failed`, `${action}-recovered`,
  ]);
});

it.each([
  ['complete', completeWorkoutSetWithDraft, 'completed'],
  ['skip', skipWorkoutSetWithDraft, 'skipped'],
])('persists draft values and the %s transition in one TrackerApp write', async (label, transform, status) => {
  const persist = jest.fn().mockResolvedValue(undefined);
  const write = createSerializedRoutineWriter(persist);
  const routine = {
    id: 'routine-1',
    workouts: [{
      id: 'workout-1',
      session: {
        status: 'inProgress',
        runningSince: null,
        elapsedSeconds: 0,
        exercises: [{
          exerciseId: 'exercise-1',
          sets: [{ id: 'set-1', number: 1, actualWeight: '200', actualReps: '5', status: 'pending' }],
        }],
      },
    }],
  };
  const updated = transform(routine, 'workout-1', 'exercise-1', 'set-1', {
    actualWeight: '225',
    actualReps: '8',
  });
  await write(updated);

  expect(persist).toHaveBeenCalledTimes(1);
  expect(persist.mock.calls[0][1].workouts[0].session.exercises[0].sets[0])
    .toEqual(expect.objectContaining({ actualWeight: '225', actualReps: '8', status }));
});

it('keeps template setup choices but requests new maxes and increases', () => {
  const template = { inputs: {
    maxSquat: '315',
    maxPress: '185',
    maxDead: '405',
    mesoMode: true,
    microCycles: [{ duration: '3 weeks', volume: 'High' }],
    squatIncrement: '10',
    pressIncrement: '5',
    deadliftIncrement: '15',
    includeStrongmanDay: true,
  } };

  expect(templateBuilderInputs(template)).toEqual(expect.objectContaining({
    maxSquat: '',
    maxPress: '',
    maxDead: '',
    squatIncrement: '',
    pressIncrement: '',
    deadliftIncrement: '',
    mesoMode: true,
    microCycles: [{ duration: '3 weeks', volume: 'High' }],
    includeStrongmanDay: true,
  }));
  expect(template.inputs.microCycles).toEqual([{ duration: '3 weeks', volume: 'High' }]);
});

it('opens a template in the normal editable routine builder', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  act(() => root.render(
    <RoutineBuilder
      profile={{ name: 'Alex' }}
      count={2}
      template={{ name: 'Meet prep', inputs: { mainLiftChoice: 'High', duration: '3 weeks' } }}
      onCreate={() => {}}
      onCancel={() => {}}
    />,
  ));

  expect(div.querySelector('.routine-name-wrap input').value).toBe('Meet prep');
  expect(div.querySelector('[name="maxSquat"]').value).toBe('');
  expect(div.querySelector('[name="mainLiftChoice"]:checked').value).toBe('High');
  expect(div.querySelector('[name="duration"]:checked').value).toBe('3 weeks');
  act(() => root.unmount());
});

describe('native transfer sharing', () => {
  const transfer = {
    contents: '{"encrypted":true}',
    filename: 'routine.txt',
    key: 'correct-key',
    expiresAt: '2026-08-18T18:00:00.000Z',
  };

  afterEach(() => {
    delete navigator.share;
    delete navigator.canShare;
  });

  it('creates a named transfer file for the phone share sheet', () => {
    const file = createTransferFile(transfer);

    expect(file.name).toBe('routine.txt');
    expect(file.type).toBe('text/plain');
  });

  it('puts the key inside the encrypted share envelope for automatic receiving', async () => {
    const shared = sharedTransferContents(createSharedTransferContents(transfer));

    expect(shared.key).toBe('correct-key');
    expect(JSON.parse(shared.contents)).toEqual({ encrypted: true });
  });

  it('shares the encrypted JSON file through the native share sheet', async () => {
    navigator.canShare = jest.fn().mockReturnValue(true);
    navigator.share = jest.fn().mockResolvedValue(undefined);

    expect(canShareTransfer(transfer)).toBe(true);
    await shareTransfer(transfer);

    expect(navigator.share).toHaveBeenCalledWith({
      files: [expect.objectContaining({ name: 'routine.txt' })],
    });
  });

  it('offers file download when native file sharing is unavailable', () => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    const div = document.createElement('div');
    const root = createRoot(div);

    act(() => root.render(<TransferCreator transfer={transfer} onClose={() => {}} onShare={() => {}} />));

    expect(div.textContent).toContain('Download file instead');
    expect(div.textContent).not.toContain('Share with nearby phone');
    act(() => root.unmount());
  });
});

it('shows every generator setting for a plan', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const routine = { inputs: {
    maxSquat: '315',
    maxPress: '185',
    maxDead: '405',
    mesoMode: true,
    microCycles: [{ duration: '3 weeks', volume: 'High' }, { duration: '5 weeks', volume: 'Low' }],
    squatIncrement: '10',
    pressIncrement: '5',
    deadliftIncrement: '15',
    includeBackoffSets: true,
    includeStrongmanDay: false,
    squatEventEnabled: true,
    squatEventMovement: "Farmer's carry",
    squatEventSets: '4',
    squatEventReps: '40',
    pressEventEnabled: false,
    deadliftEventEnabled: false,
  } };

  act(() => root.render(<PlanSetup routine={routine} />));

  expect(div.textContent).toContain('315 lb');
  expect(div.textContent).toContain('Cycle 1: 3 weeks, High volume');
  expect(div.textContent).toContain('Deadlift increase15 lb');
  expect(div.textContent).toContain('Back-off setsYes');
  expect(div.textContent).toContain("Farmer's carry · 4 sets × 40 reps");
  expect(div.textContent).toContain('Press dayNone');
  act(() => root.unmount());
});

it('shows the completion date on a completed workout card', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);

  act(() => root.render(<WorkoutCard workout={{
    weekLabel: 'Week 1',
    name: 'Squat',
    completedAt: '2026-08-18T12:00:00.000Z',
  }} onOpen={() => {}} />));

  expect(div.textContent).toContain('Completed August 18, 2026');
  act(() => root.unmount());
});

it('shows effective maxes on a single-cycle workout card', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);

  act(() => root.render(<WorkoutCard workout={{
    cycleLabel: null,
    weekLabel: 'Week 1',
    name: 'Squat',
    effectiveMaxes: { maxSquat: 315, maxPress: 185, maxDead: 405 },
  }} onOpen={() => {}} />));

  expect(div.querySelector('.workout-maxes').textContent).toBe(
    'Maxes: Squat 315 · Press 185 · Deadlift 405 lb',
  );
  act(() => root.unmount());
});

it('shows compact adaptive status on future workout cards', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const workout = {
    cycleIndex: 1,
    cycleLabel: 'Cycle 2',
    weekLabel: 'Week 1',
    name: 'Squat',
    effectiveMaxes: { maxSquat: 315, maxPress: 185, maxDead: 405 },
  };
  const routine = {
    inputs: {
      mesoMode: true,
      maxProgressionMode: 'adaptive',
      maxSquat: '315', maxPress: '185', maxDead: '405',
      microCycles: [{}, {}],
    },
    workouts: [{ cycleIndex: 0, completedAt: null }, workout],
  };

  act(() => root.render(<WorkoutCard routine={routine} workout={workout} onOpen={() => {}} />));

  expect(div.querySelector('.adaptive-max-status').textContent).toBe('Adaptive · projected from Cycle 1');
  act(() => root.unmount());
});

it('renders without crashing', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => root.render(<App />));
  act(() => root.unmount());
});

it('shows a waiting update while the tracker is onboarding', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const registration = { waiting: { postMessage: jest.fn() } };
  await act(async () => root.render(<TrackerApp appearance="system" onAppearanceChange={() => {}} />));
  expect(div.textContent).toContain('Who is training?');

  await act(async () => {
    window.dispatchEvent(new CustomEvent('app-update-available', { detail: registration }));
    await Promise.resolve();
  });

  expect(div.textContent).toContain('A new version is ready.');
  expect([...div.querySelectorAll('button')].map(button => button.textContent)).toContain('Update now');
  act(() => root.unmount());
});

it('shows the calculator in a normal browser tab', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => root.render(<App />));

  expect(div.textContent).toContain('Build your routine');
  expect(div.textContent).not.toContain('Who is training?');
  act(() => root.unmount());
});

it('detects an installed standalone app', () => {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = jest.fn().mockReturnValue({ matches: true });

  expect(isInstalledApp()).toBe(true);

  window.matchMedia = originalMatchMedia;
});

it('edits and trims a routine name', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const onSave = jest.fn();
  act(() => root.render(<RoutineNameEditor routine={{ name: 'Old plan' }} onSave={onSave} />));

  act(() => div.querySelector('button').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const input = div.querySelector('input');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '  New plan  ');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => div.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

  expect(onSave).toHaveBeenCalledWith('New plan');
  expect(div.textContent).toContain('Rename');
  act(() => root.unmount());
});

it('confirms or cancels a destructive action in a modal', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const onCancel = jest.fn();
  const onConfirm = jest.fn();
  act(() => root.render(
    <ConfirmationModal title="Delete future workout?" confirmLabel="Delete workout" onCancel={onCancel} onConfirm={onConfirm}>
      This workout will not appear in history.
    </ConfirmationModal>,
  ));

  expect(div.querySelector('[role="dialog"]')).not.toBeNull();
  expect(div.textContent).toContain('This workout will not appear in history.');
  const buttons = div.querySelectorAll('button');
  act(() => buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));
  act(() => buttons[1].dispatchEvent(new MouseEvent('click', { bubbles: true })));

  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});

it('trims a copied routine name and selects its destination profile', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const onConfirm = jest.fn();
  act(() => root.render(
    <RoutineCopyDialog
      title="Copy Meet prep"
      eyebrow="Copy routine"
      defaultName="Meet prep copy"
      profiles={[{ id: 'p1', name: 'Alex' }, { id: 'p2', name: 'Sam' }]}
      selectedProfileId="p1"
      confirmLabel="Copy routine"
      onCancel={() => {}}
      onConfirm={onConfirm}
    />,
  ));

  const nameInput = div.querySelector('input');
  const profileSelect = div.querySelector('select');
  act(() => {
    const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    inputSetter.call(nameInput, '  Shared plan  ');
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    const selectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    selectSetter.call(profileSelect, 'p2');
    profileSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });
  act(() => div.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

  expect(onConfirm).toHaveBeenCalledWith('p2', 'Shared plan');
  act(() => root.unmount());
});
