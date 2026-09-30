const { expect, test } = require('./fixtures');
const { createProfile, createRoutine } = require('./helpers');
const { assertReadable, assertReadableControls } = require('./control-contrast.helpers');

for (const appearance of ['light', 'dark', 'system']) {
  test(`plan and template actions stay readable in ${appearance} appearance`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(value => localStorage.setItem('mcilroy-method-appearance', value), appearance);
    await createProfile(page, 'Contrast Athlete');
    await createRoutine(page);
    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await assertReadableControls(page);
    await page.getByRole('button', { name: 'Save as template', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Save routine setup' });
    await expect(dialog).toBeVisible();
    await assertReadableControls(dialog);
    await dialog.getByRole('button', { name: 'Save template', exact: true }).click();
    await expect(page.locator('.template-card')).toBeVisible();
    await assertReadableControls(page.locator('.template-card'));

    // Exercise the completed-plan badge through real stored records and rendering.
    await page.evaluate(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('mcilroy-method');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const transaction = database.transaction('routines', 'readwrite');
          const store = transaction.objectStore('routines');
          const request = store.getAll();
          request.onsuccess = () => {
            request.result.forEach(routine => {
              routine.workouts.forEach(workout => { workout.completedAt = '2026-09-20T12:00:00.000Z'; });
              store.put(routine);
            });
          };
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally {
        database.close();
      }
    });
    await page.reload();
    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    const completedBadge = page.locator('.plan-status.completed');
    await expect(completedBadge).toHaveText('Completed');
    await assertReadable(completedBadge);
    await assertReadableControls(page);
    await page.locator('.completed-plan-details > summary').click();
    await assertReadableControls(page.locator('.completed-plan-details'));
    await page.locator('.template-card').getByRole('button', { name: 'Delete', exact: true }).click();
    const deleteDialog = page.getByRole('dialog', { name: 'Delete template?' });
    await expect(deleteDialog).toBeVisible();
    await assertReadableControls(deleteDialog);
    await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
}
