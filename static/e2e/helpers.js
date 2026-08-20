const { expect } = require('./fixtures');

const fillMaxes = async (page, values = {}) => {
  await page.getByLabel('Squat max').fill(values.squat || '315');
  await page.getByLabel('Press max').fill(values.press || '185');
  await page.getByLabel('Deadlift max').fill(values.deadlift || '405');
};

const selectVolume = async (page, volume = 'Low') => {
  await page.getByLabel(volume, { exact: true }).check();
};

const selectWeakPoints = async (page, options = {}) => {
  await page.getByLabel(options.pressWeakPoint || 'Shoulders', { exact: true }).check();
  await page.getByLabel(options.deadliftWeakPoint || 'Back', { exact: true }).check();
};

const createProfile = async (page, name = 'Smoke Athlete') => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Who is training?' })).toBeVisible();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create profile' }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}` })).toBeVisible();
};

const createRoutine = async (page, options = {}) => {
  await page.getByRole('button', { name: 'Build a routine' }).click();
  await page.getByLabel('Routine name').fill(options.name || 'Smoke Plan');
  await fillMaxes(page, options);
  await selectVolume(page, options.volume || 'Low');
  await selectWeakPoints(page, options);
  if (options.duration === '3 weeks') await page.getByLabel('3 weeks', { exact: true }).check();
  await page.getByRole('button', { name: /Generate plan/ }).click();
  await expect(page.getByText('Routine created on this phone.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your next workout' })).toBeVisible();
};

module.exports = { createProfile, createRoutine, fillMaxes, selectVolume, selectWeakPoints };
