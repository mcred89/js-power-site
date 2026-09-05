import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import CalculatorPlanning from './CalculatorPlanning';
import { MaxesForm } from './MaxesForm';
import { applyBatch, getAll, getAllByIndex } from '../data/storage';
import { createStrongmanRoutine, defaultStrongmanInputs } from '../data/strongman';

jest.mock('../data/storage', () => ({ getAll: jest.fn(), getAllByIndex: jest.fn(), applyBatch: jest.fn() }));
jest.mock('../components/StrongmanBuilder', () => ({ __esModule: true, default: ({ onSave, onCancel, submitLabel }) => <div>
  <button type="button" onClick={() => onSave('Nationals block', { ...require('../data/strongman').defaultStrongmanInputs(), events: [{
    id: 'bag', name: 'Sandbag carry', family: 'carry', priority: 'main', practices: [{ id: 'pick', name: 'Bag baseline', recipe: null }], capabilities: [],
  }] })}>{submitLabel || 'Save strongman block'}</button><button type="button" onClick={onCancel}>Cancel</button>
</div> }));
jest.mock('../components/RoutineGenerator', () => ({ __esModule: true, default: props => <div>Strength result: {String(props.includeStrongmanDay)}; normal press practice: {props.pressEventMovement}</div> }));

const profile = { id: 'profile', name: 'Sean', activeStrongmanRoutineId: 'active-events' };
const eventInputs = { ...defaultStrongmanInputs(), events: [{ id: 'bag', name: 'Sandbag', practices: [{ id: 'pick', name: 'Pick', recipe: null }], capabilities: [] }] };
const active = { ...createStrongmanRoutine(profile.id, 'Current event block', eventInputs), id: 'active-events' };
let div;
let root;
const click = async label => {
  const button = [...div.querySelectorAll('button')].find(item => item.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button.click());
};
const selectProfile = async value => {
  await act(async () => {
    const select = div.querySelector('[aria-label="Local training profile"]');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  getAll.mockResolvedValue([profile]);
  getAllByIndex.mockResolvedValue([active]);
  applyBatch.mockResolvedValue();
  div = document.createElement('div');
  root = createRoot(div);
});
afterEach(() => act(() => root.unmount()));

it('previews an independent block without reading local profiles or writing any records', async () => {
  act(() => root.render(<CalculatorPlanning mode="strongman" />));
  await click('Preview strongman block');
  expect(div.textContent).toContain('Nationals block');
  expect(div.textContent).toContain('12 event weeks');
  expect(div.textContent).toContain('Baseline assessment');
  expect(div.textContent).toContain('Unsaved preview');
  expect(getAll).not.toHaveBeenCalled();
  expect(applyBatch).not.toHaveBeenCalled();
});

it('connects only the explicitly selected profile and retains its active block', async () => {
  const onContextChange = jest.fn();
  act(() => root.render(<CalculatorPlanning mode="strength" onContextChange={onContextChange} />));
  await click('Use a local profile');
  expect(onContextChange).not.toHaveBeenCalledWith(expect.objectContaining({ profile }));
  await selectProfile(profile.id);
  expect(getAllByIndex).toHaveBeenCalledWith('routines', 'profileId', profile.id);
  expect(onContextChange).toHaveBeenLastCalledWith(expect.objectContaining({ profile, activeStrongman: active }));
  expect(div.textContent).toContain('Current event block');
  expect(div.textContent).toContain('Baseline assessment');
  expect(applyBatch).not.toHaveBeenCalled();
  await selectProfile('');
  expect(onContextChange).toHaveBeenLastCalledWith({ profile: null, activeStrongman: null, routines: [] });
});

it('ignores a slow earlier profile response after the user changes their selection', async () => {
  const other = { id: 'other', name: 'Other', activeStrongmanRoutineId: null };
  getAll.mockResolvedValue([profile, other]);
  let resolveFirst;
  getAllByIndex.mockImplementation((store, index, id) => id === profile.id ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve([]));
  const onContextChange = jest.fn();
  act(() => root.render(<CalculatorPlanning mode="strength" onContextChange={onContextChange} />));
  await click('Use a local profile');
  await selectProfile(profile.id);
  await selectProfile(other.id);
  await act(async () => resolveFirst([active]));
  expect(onContextChange).toHaveBeenLastCalledWith({ profile: other, activeStrongman: null, routines: [] });
  expect(div.textContent).not.toContain('Current event block');
});

it('saves a new inactive block only after an explicit save and keeps enrollment unchanged', async () => {
  act(() => root.render(<CalculatorPlanning mode="strongman" />));
  await click('Use a local profile');
  await selectProfile(profile.id);
  await click('Preview strongman block');
  expect(applyBatch).not.toHaveBeenCalled();
  await click('Save to Sean');
  const batch = applyBatch.mock.calls[0][0];
  expect(batch.puts.profiles).toBeUndefined();
  expect(batch.puts.routines[0]).toMatchObject({ kind: 'strongman', profileId: profile.id, status: 'saved' });
  expect(batch.puts.routines[0].id).not.toBe(active.id);
  expect(batch.conditions.profiles).toEqual([{ key: profile.id, expected: profile }]);
  expect(div.textContent).toContain('Saved to Sean');
});

it('retains the preview and reports a failed save without claiming success', async () => {
  applyBatch.mockRejectedValueOnce(new Error('Data changed. Review the updated import.'));
  act(() => root.render(<CalculatorPlanning mode="strongman" />));
  await click('Use a local profile');
  await selectProfile(profile.id);
  await click('Preview strongman block');
  await click('Save to Sean');
  expect(div.querySelector('[role="alert"]').textContent).toContain('Data changed');
  expect(div.textContent).toContain('Unsaved preview');
});

it('forces dedicated event slots for the selected active block while preserving normal-day events', async () => {
  const form = createRef();
  act(() => root.render(<MaxesForm ref={form} initialInputs={{ pressEventEnabled: true, pressEventMovement: 'Axle clean', pressEventSets: '4', pressEventReps: '2' }} />));
  await click('Use a local profile');
  await selectProfile(profile.id);
  expect(div.querySelector('[name="includeStrongmanDay"]').checked).toBe(true);
  expect(div.querySelector('[name="includeStrongmanDay"]').disabled).toBe(true);
  expect(div.querySelector('[name="pressEventMovement"]').value).toBe('Axle clean');
  act(() => form.current.setState({ maxSquat: '315', maxPress: '185', maxDead: '405', mainLiftChoice: 'Low' }));
  act(() => div.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(div.textContent).toContain('Strength result: true; normal press practice: Axle clean');
});
