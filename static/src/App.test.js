import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App, { canShareTransfer, ConfirmationModal, createTransferFile, initialProfileId, isInstalledApp, PlanSetup, RoutineCopyDialog, RoutineNameEditor, shareTransfer, TransferCreator, WorkoutCard } from './App';

describe('default profile selection', () => {
  const profiles = [{ id: 'wife' }, { id: 'husband' }];

  it('opens the saved default profile', () => {
    expect(initialProfileId(profiles, 'husband')).toBe('husband');
  });

  it('falls back to the first profile when the saved default no longer exists', () => {
    expect(initialProfileId(profiles, 'deleted')).toBe('wife');
  });
});

describe('native transfer sharing', () => {
  const transfer = {
    contents: '{"encrypted":true}',
    filename: 'routine.mcilroy-transfer',
    key: 'correct-key',
    expiresAt: '2026-08-18T18:00:00.000Z',
  };

  afterEach(() => {
    delete navigator.share;
    delete navigator.canShare;
  });

  it('creates a named transfer file for the phone share sheet', () => {
    const file = createTransferFile(transfer);

    expect(file.name).toBe('routine.mcilroy-transfer');
    expect(file.type).toBe('application/json');
  });

  it('shares the encrypted file and its key through the native share sheet', async () => {
    navigator.canShare = jest.fn().mockReturnValue(true);
    navigator.share = jest.fn().mockResolvedValue(undefined);

    expect(canShareTransfer(transfer)).toBe(true);
    await shareTransfer(transfer);

    expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({
      files: [expect.objectContaining({ name: 'routine.mcilroy-transfer' })],
      text: expect.stringContaining('correct-key'),
    }));
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

it('renders without crashing', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  act(() => root.render(<App />));
  act(() => root.unmount());
});

it('shows the calculator in a normal browser tab', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  act(() => root.render(<App />));

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
