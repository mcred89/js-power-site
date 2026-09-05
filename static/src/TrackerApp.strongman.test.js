import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { todayRoutineIds, trackerRouteFromHistory, trackerHistoryState, trackerLoadPolicy } from './TrackerApp';
import { RoutineForm } from './components/RoutineForm';

test('cold startup includes enrolled event and strength plans independent of the viewed plan', () => {
  expect(todayRoutineIds({ activeRoutineId: 'viewed', scheduledStrengthRoutineId: 'strength', activeStrongmanRoutineId: 'events', activeWorkoutRoutineId: 'events' }))
    .toEqual(['viewed', 'events', 'strength']);
  expect(trackerRouteFromHistory(trackerHistoryState({ view: 'strongman', workoutId: null, addingProfile: false }))).toMatchObject({ view: 'strongman' });
  expect(trackerLoadPolicy('strongman').profileRoutines).toBe(true);
});

test('active event block forces only the dedicated checkbox and retains normal-day event fields', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  act(() => root.render(<RoutineForm activeStrongman={{ id: 'events', name: 'Nationals', status: 'active' }} initialInputs={{ pressEventEnabled: true, pressEventMovement: 'Axle clean', pressEventSets: '4', pressEventReps: '2', includeStrongmanDay: false }} />));
  const checkbox = div.querySelector('[name="includeStrongmanDay"]');
  expect(checkbox.checked).toBe(true);
  expect(checkbox.disabled).toBe(true);
  expect(div.querySelector('[name="pressEventEnabled"]').checked).toBe(true);
  expect(div.querySelector('[name="pressEventMovement"]').value).toBe('Axle clean');
  expect(div.querySelector('[name="pressEventSets"]').value).toBe('4');
  expect(div.textContent).toContain('Nationals');
  act(() => root.unmount());
});
