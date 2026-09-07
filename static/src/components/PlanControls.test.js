import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { PlanSetup } from './PlanControls';

it('shows each lifting day Tabata setting alongside its Strongman event', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);

  act(() => root.render(<PlanSetup routine={{ inputs: {
    squatEventEnabled: true,
    squatEventMovement: 'Farmer carry',
    squatEventSets: '3',
    squatEventReps: '1',
    squatTabataEnabled: true,
    pressTabataEnabled: false,
    deadliftTabataEnabled: true,
  } }} />));

  const tabata = [...div.querySelectorAll('.setup-section')]
    .find(section => section.querySelector('h3').textContent === 'Tabata sprints');
  expect([...tabata.querySelectorAll('dl > div')].map(row => ({
    day: row.querySelector('dt').textContent,
    prescription: row.querySelector('dd').textContent,
  }))).toEqual([
    { day: 'Squat day', prescription: '8 rounds · 20 seconds sprint / 10 seconds rest' },
    { day: 'Press day', prescription: 'None' },
    { day: 'Deadlift day', prescription: '8 rounds · 20 seconds sprint / 10 seconds rest' },
  ]);
  expect(tabata.textContent).toContain('Always last, after accessories and Strongman work.');
  expect(div.textContent).toContain('Farmer carry · 3 sets × 1 reps');
  act(() => root.unmount());
});
