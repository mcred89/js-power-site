export const prescriptionScopeForPhase = phase => ['taper', 'recovery'].includes(phase) ? 'taper' : 'normal';

export const recipeForPractice = (practice, phase) => practice?.[prescriptionScopeForPhase(phase) === 'taper' ? 'taperRecipe' : 'recipe'] || null;

export const mergePracticePrescription = (accepted, block) => {
  const draft = Object.fromEntries(['sets', 'weight', 'reps', 'distance', 'seconds', 'weightUnit', 'distanceUnit', 'loadMeaning', 'notes']
    .filter(key => block.draft[key] !== undefined).map(key => [key, block.draft[key]]));
  if (block.recipe?.parts?.length) {
    if (!accepted?.parts?.some(part => part.id === block.draft.partId)) throw new Error('This component changed in the plan. Reopen the event day before saving its future prescription.');
    return { ...accepted, parts: accepted.parts.map(part => part.id === block.draft.partId ? { ...part, ...draft, setup: block.setup } : part) };
  }
  if (accepted?.parts?.length) throw new Error('This practice now has components. Reopen the event day before saving its future prescription.');
  return { ...accepted, ...draft, sets: draft.sets || block.attempts.length || 1, setup: block.setup };
};
