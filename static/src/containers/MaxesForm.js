import React, { forwardRef } from 'react';
import { RoutineForm } from '../components/RoutineForm';
import Routine from '../components/RoutineGenerator';

// The installed tracker imports RoutineForm directly. Keep calculator result
// presentation behind this website-only wrapper so it cannot leak into the eager shell.
export const MaxesForm = forwardRef((props, ref) => (
  <RoutineForm
    {...props}
    ref={ref}
    renderResult={(inputs, onReset) => <Routine {...inputs} onReset={onReset} />}
  />
));
