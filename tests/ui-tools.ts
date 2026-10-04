import { expect, type Page } from '@playwright/test';
/** Drive final controlled tool panels through public UI, retaining mode assertions. */
export async function chooseTool(page: Page, name: string) {
  if (['Pencil', 'Highlighter'].includes(name)) {
    const dialog = page.getByRole('dialog', {
      name: 'Pen options',
      exact: true,
    });
    if (!(await dialog.isVisible()))
      await page.getByRole('button', { name: 'Pen', exact: true }).click();
    await page
      .getByRole('button', { name: `${name} mode`, exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: `${name} mode`, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
  } else if (['Stroke eraser', 'Pixel eraser'].includes(name)) {
    const dialog = page.getByRole('dialog', {
      name: 'Eraser options',
      exact: true,
    });
    if (!(await dialog.isVisible()))
      await page.getByRole('button', { name: 'Eraser', exact: true }).click();
    const radio = page.getByRole('radio', {
      name: name === 'Stroke eraser' ? 'Whole stroke' : 'Partial erase',
      exact: true,
    });
    await radio.check();
    await expect(radio).toBeChecked();
  } else await page.getByRole('button', { name, exact: true }).click();
}
