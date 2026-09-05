import { prescriptionScopeForPhase, recipeForPractice } from './strongmanPrescription';

it('keeps taper and recovery prescriptions separate from development work', () => {
  const practice = { recipe: { weight: 300 }, taperRecipe: { weight: 120 } };
  ['base', 'development', 'specific'].forEach(phase => {
    expect(prescriptionScopeForPhase(phase)).toBe('normal');
    expect(recipeForPractice(practice, phase)).toBe(practice.recipe);
  });
  ['taper', 'recovery'].forEach(phase => {
    expect(prescriptionScopeForPhase(phase)).toBe('taper');
    expect(recipeForPractice(practice, phase)).toBe(practice.taperRecipe);
    expect(recipeForPractice({ recipe: practice.recipe }, phase)).toBeNull();
  });
});
