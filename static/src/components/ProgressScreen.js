import React, { memo } from 'react';
import { ProgressDashboard } from './ProgressDashboard';

// Shell-only notifications must not repeat the history aggregation and chart render.
export const ProgressScreen = memo(({ profile, routines, onScreenRender }) => {
  onScreenRender?.();
  return <ProgressDashboard profile={profile} routines={routines} />;
});

