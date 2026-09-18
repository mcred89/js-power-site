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

const checkOptionHighlights = async (page, { touch = false } = {}) => {
  const radio = name => page.getByRole('radio', { name, exact: true });
  const appearance = input => input.evaluate(element => {
    const style = getComputedStyle(element.nextElementSibling);
    return {
      border: style.borderTopColor,
      background: style.backgroundColor,
      color: style.color,
      shadow: style.boxShadow,
    };
  });
  const select = input => input.locator('..')[touch ? 'tap' : 'click']();
  const accent = await page.locator(':root').evaluate(element => {
    const hex = getComputedStyle(element).getPropertyValue('--accent').trim();
    return `rgb(${hex.slice(1).match(/.{2}/g).map(channel => parseInt(channel, 16)).join(', ')})`;
  });
  const defaultChoice = radio('5 weeks');
  const high = radio('High');
  const glutes = radio('Glutes');
  await expect(defaultChoice).toBeChecked();
  await expect(defaultChoice.locator('..').locator('.option-text')).toHaveCSS('border-top-color', accent);
  const selectedStyle = await appearance(defaultChoice);
  const unselectedStyle = await appearance(high);
  expect(selectedStyle.border).toBe(accent);
  expect(selectedStyle.shadow).toContain(accent);
  expect(selectedStyle.shadow).not.toBe(unselectedStyle.shadow);

  await select(high);
  await expect(high).toBeChecked();
  await expect(high).toBeFocused();
  await expect.poll(() => appearance(high)).toEqual(selectedStyle);
  await select(glutes);
  await expect(glutes).toBeChecked();
  await expect(glutes).toBeFocused();
  await expect(high).not.toBeFocused();
  await expect.poll(() => appearance(glutes)).toEqual(selectedStyle);
  await expect.poll(() => appearance(high)).toEqual(selectedStyle);
  if (touch) {
    await expect(glutes.locator('..')).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');
  }

  await select(radio('Low'));
  await expect(high).not.toBeChecked();
  await expect.poll(() => appearance(high)).toEqual(unselectedStyle);
  await expect.poll(() => appearance(radio('Low'))).toEqual(selectedStyle);
  await expect.poll(() => appearance(glutes)).toEqual(selectedStyle);

  if (!touch) {
    await radio('Low').press('ArrowRight');
    await expect(high).toBeChecked();
    await expect(high).toBeFocused();
    await expect.poll(() => appearance(high)).toEqual(selectedStyle);
    const keyboardOutline = high.locator('..').locator('.option-text');
    await expect(keyboardOutline).toHaveCSS('outline-style', 'solid');
    await expect.poll(() => keyboardOutline.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThan(0);
  }
};

module.exports = { checkOptionHighlights, createProfile, createRoutine, fillMaxes, selectVolume, selectWeakPoints };
