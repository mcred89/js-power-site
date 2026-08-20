import React, { memo } from 'react';
import { ActiveWorkoutSession } from './WorkoutSession';

// Overlay-only shell updates recreate handler closures. The workout object is the durable
// render boundary: any workout transition replaces it, while a modal/toast/update prompt
// must leave the running session (including its isolated clock) untouched.
export const ActiveWorkoutScreen = memo(({ onScreenRender, ...props }) => {
  onScreenRender?.();
  return <ActiveWorkoutSession {...props} />;
}, (previous, next) => previous.workout === next.workout);
