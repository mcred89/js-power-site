// Import decisions are loaded with backup tooling, never with the Today shell.
const importConditions = items => items.flatMap(item => [
  { key: item.imported.id, expected: item.local },
  ...(item.result.id !== item.imported.id ? [{ key: item.result.id, expected: item.existingResult }] : []),
]);

export const importPlanBatch = plan => ({
  puts: {
    profiles: plan.profiles.filter(item => item.action !== 'skip').map(item => item.result),
    routines: plan.routines.filter(item => item.action !== 'skip').map(item => item.result),
    templates: (plan.templates || []).filter(item => item.action !== 'skip').map(item => item.result),
    ...(plan.archives ? { archives: plan.archives.filter(item => item.action !== 'skip').map(item => item.result) } : {}),
  },
  conditions: {
    profiles: plan.profiles.map(item => ({ key: item.imported.id, expected: item.local })),
    routines: importConditions(plan.routines),
    templates: (plan.templates || []).map(item => ({ key: item.imported.id, expected: item.local })),
    ...(plan.archives ? { archives: importConditions(plan.archives) } : {}),
  },
});

export const activateRoutineImport = (plan, destinationProfile, routineId, updatedAt = new Date().toISOString()) => {
  const sourceRoutineId = routineId;
  routineId = plan.routines.find(item => item.imported.id === sourceRoutineId)?.result.id || routineId;
  const updatedProfile = {
    ...destinationProfile,
    activeRoutineId: routineId,
    updatedAt,
  };
  const plannedProfile = plan.profiles.find(item => item.result.id === destinationProfile.id);
  if (!plannedProfile) {
    return {
      ...plan,
      routineActivation: { profileId: destinationProfile.id, routineId: sourceRoutineId },
      profiles: [...plan.profiles, {
        type: 'profile',
        status: 'conflict',
        action: 'merge',
        imported: updatedProfile,
        local: destinationProfile,
        result: updatedProfile,
      }],
    };
  }
  return {
    ...plan,
    routineActivation: { profileId: destinationProfile.id, routineId: sourceRoutineId },
    profiles: plan.profiles.map(item => item === plannedProfile ? {
      ...item,
      action: item.action === 'skip' ? 'merge' : item.action,
      imported: { ...item.imported, activeRoutineId: routineId, updatedAt },
      result: { ...item.result, activeRoutineId: routineId, updatedAt },
    } : item),
  };
};
