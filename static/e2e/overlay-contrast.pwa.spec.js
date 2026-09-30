const { expect, test } = require('./fixtures');
const { createProfile, createRoutine } = require('./helpers');
const { assertReadable, assertReadableControls, readAppearance } = require('./control-contrast.helpers');

const themes = [
  { appearance: 'light', colorScheme: 'light' },
  { appearance: 'dark', colorScheme: 'dark' },
  { appearance: 'system', colorScheme: 'light' },
  { appearance: 'system', colorScheme: 'dark' },
];

test.beforeEach(async ({ request }) => {
  if (!process.env.SMOKE_BASE_URL) await request.get('/__smoke/release/reset');
});

const checkModal = async modal => {
  await expect(modal).toBeVisible();
  await assertReadableControls(modal);
  for (const label of await modal.locator('.field-label').all()) await assertReadable(label);
  for (const text of await modal.locator('h2, p').all()) await assertReadable(text);
  const primary = modal.locator('.primary-button');
  if (await primary.count()) {
    expect((await assertReadable(primary)).fontWeight).toBeGreaterThanOrEqual(700);
  }
};

const downloadBackup = async page => {
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const stream = await (await downloaded).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
};

for (const theme of themes) {
  test(`PWA dialogs, import notices, and selected progress controls remain readable in ${theme.appearance} (${theme.colorScheme})`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme.colorScheme });
    await page.addInitScript(appearance => localStorage.setItem('mcilroy-method-appearance', appearance), theme.appearance);
    await createProfile(page, 'Contrast Athlete');
    await createRoutine(page, { name: 'Contrast plan', duration: '3 weeks' });

    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    const copyDialog = page.getByRole('dialog', { name: 'Copy Contrast plan', exact: true });
    await checkModal(copyDialog);
    await copyDialog.getByLabel('Routine name', { exact: true }).fill('');
    await expect(copyDialog.getByRole('button', { name: 'Copy routine', exact: true })).toBeDisabled();
    await copyDialog.getByLabel('Routine name', { exact: true }).fill('Contrast plan copy');
    await expect(copyDialog.getByRole('button', { name: 'Copy routine', exact: true })).toBeEnabled();
    await copyDialog.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.getByRole('button', { name: 'Save as template', exact: true }).click();
    const templateDialog = page.getByRole('dialog', { name: 'Save routine setup', exact: true });
    await checkModal(templateDialog);
    await templateDialog.getByLabel('Template name', { exact: true }).fill('Contrast template');
    await templateDialog.getByRole('button', { name: 'Save template', exact: true }).click();
    const templateNotice = page.getByRole('status').filter({ hasText: 'Template saved on this phone.' });
    await expect(templateNotice).toBeVisible();
    await assertReadable(templateNotice);

    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    const liftTabs = page.getByRole('group', { name: 'Main lift', exact: true });
    for (const lift of ['Squat', 'Press', 'Deadlift']) {
      const selected = liftTabs.getByRole('button', { name: lift, exact: true });
      await selected.click();
      await expect(selected).toHaveAttribute('aria-pressed', 'true');
      const unselected = liftTabs.locator('button[aria-pressed="false"]').first();
      const selectedStyle = await assertReadable(selected);
      const unselectedStyle = await assertReadable(unselected);
      expect(selectedStyle.background).not.toBe(unselectedStyle.background);
      expect(selectedStyle.fontWeight).toBeGreaterThanOrEqual(700);
      expect(selectedStyle.opacity).toBe('1');
    }
    await assertReadableControls(page);

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await assertReadableControls(page);
    const backup = await downloadBackup(page);
    // Start with the app's own valid backup. Preserve duplicates, make one
    // conflicting routine, and add a template to exercise all three decisions.
    backup.routines[0].name = 'Incoming plan title';
    backup.templates.push({
      ...backup.templates[0],
      id: `${backup.templates[0].id}-new-copy`,
      name: 'Incoming template',
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: 'contrast-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    const importDialog = page.getByRole('dialog', { name: 'Preview import', exact: true });
    await checkModal(importDialog);
    for (const action of ['copy', 'skip', 'merge']) {
      const badges = importDialog.locator(`.import-action.${action}`);
      await expect(badges.first()).toBeVisible();
      for (const badge of await badges.all()) await assertReadable(badge);
    }

    // Reproduce another window changing a record after the preview. The app
    // rejects this import, keeps its real dialog open, and displays a toast.
    await page.evaluate(async routineId => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('mcilroy-method');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const transaction = database.transaction('routines', 'readwrite');
          const store = transaction.objectStore('routines');
          const request = store.get(routineId);
          request.onsuccess = () => store.put({ ...request.result, name: 'Changed in another window' });
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally {
        database.close();
      }
    }, backup.routines[0].id);
    await importDialog.getByRole('button', { name: 'Import backup', exact: true }).click();
    const conflictNotice = page.getByRole('status').filter({ hasText: 'Data changed. Review the updated import.' });
    await expect(conflictNotice).toBeVisible();
    await expect(importDialog).toBeVisible();
    expect((await assertReadable(conflictNotice)).fontWeight).toBeGreaterThanOrEqual(600);
    expect(await conflictNotice.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
    expect((await readAppearance(importDialog.getByRole('button', { name: 'Import backup', exact: true }))).opacity).toBe('1');
    await page.screenshot({ path: testInfo.outputPath('import-dialog-and-notice.png') });
  });
}
