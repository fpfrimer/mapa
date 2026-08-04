const { test, expect } = require('@playwright/test');

async function login(page) {
  await page.goto('/');
  await expect(page.locator('#login-modal')).toBeVisible();
  await page.locator('#login-username').fill('editor');
  await page.locator('#login-password').fill('correct-password');
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator('#login-modal')).toBeHidden();
}

async function createSemester(page, name) {
  await page.locator('#project-create').click();
  await expect(page.locator('#app-dialog')).toBeVisible();
  await page.locator('#app-dialog-input').fill(name);
  await page.locator('#app-dialog-confirm').click();
  await expect(page.locator('body')).not.toHaveClass(/hub-visible/);
}

test('login, edição, concorrência e visualização de impressão', async ({ page }) => {
  await login(page);
  await createSemester(page, '2026.1');
  await expect(page.locator('#dark-mode-toggle use')).toHaveAttribute('href', /#icon-moon$/);
  await page.locator('#dark-mode-toggle').click();
  await expect(page.locator('#dark-mode-toggle use')).toHaveAttribute('href', /#icon-sun$/);
  await page.locator('#dark-mode-toggle').click();

  await page.evaluate(() => {
    const input = document.querySelector('#period-name');
    input.value = '1º Período <teste>';
    document.querySelector('#period-form').requestSubmit();
  });
  await expect(page.locator('#workspace-save-status')).toHaveAttribute('data-status', 'dirty');
  await page.locator('#project-save-button').click();
  await expect(page.locator('#workspace-save-status')).toHaveAttribute('data-status', 'saved');

  await page.evaluate(async () => {
    const { token } = JSON.parse(globalThis.sessionStorage.getItem('planner.auth'));
    const project = JSON.parse(globalThis.localStorage.getItem('planner.currentProject'));
    const response = await fetch(`/api/configurations/${encodeURIComponent(project.id)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'If-Match': `"${project.revision}"`
      },
      body: JSON.stringify({
        name: '2026.1 — edição concorrente',
        state: JSON.parse(globalThis.localStorage.getItem('academic-planner-state-v1')),
        counters: JSON.parse(globalThis.localStorage.getItem('academic-planner-counters-v1'))
      })
    });
    if (!response.ok) throw new Error(`Falha ao preparar conflito: ${response.status}`);
  });

  await page.evaluate(() => {
    const input = document.querySelector('#room-name');
    input.value = 'Sala local';
    document.querySelector('#room-form').requestSubmit();
  });
  await page.locator('#project-save-button').click();
  await expect(page.locator('#workspace-save-status')).toHaveAttribute('data-status', 'conflict');
  await expect(page.locator('#app-dialog-title')).toHaveText('Conflito de edição');
  await page.locator('#app-dialog-secondary').click();
  await expect(page.locator('#workspace-save-status')).toHaveAttribute('data-status', 'saved');

  await page.locator('#entity-selector').selectOption({ label: '1º Período <teste>' });
  await page.locator('#print-toggle').click();
  const popupPromise = page.waitForEvent('popup');
  await page.locator('#preview-print').click();
  const preview = await popupPromise;
  await preview.waitForLoadState('domcontentloaded');
  await expect(preview.locator('.print-brand img')).toBeVisible();
  await expect(preview.locator('h2')).toHaveText('Período: 1º Período <teste>');
  await expect(preview.locator('.schedule-table')).toHaveCount(1);
  expect(await preview.content()).toContain('&lt;teste&gt;');
});

test('marca UTFPR e links institucionais permanecem visíveis nos temas e larguras previstas', async ({ page }, testInfo) => {
  const spriteRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/assets/icons/')) spriteRequests.push(request.url());
  });
  await login(page);
  await expect(page.locator('#hub-login-button use')).toHaveAttribute('href', /#icon-logout$/);
  await expect(page.locator('#project-create .icon')).toHaveCSS('stroke-width', '2px');
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.institutional-brand--hub img')).toBeVisible();
    await expect(page.getByText('Campus Toledo', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.institutional-footer')).not.toContainText('Felipe Walter');
    await expect(page.locator('.institutional-footer a')).toHaveCount(2);
    const actionSizes = await page.locator('.project-hub__action').evaluateAll((actions) =>
      actions.map((action) => ({ width: action.getBoundingClientRect().width, height: action.getBoundingClientRect().height }))
    );
    expect(actionSizes.every(({ width: actionWidth, height }) => actionWidth >= 40 && height >= 40)).toBe(true);
  }
  expect(spriteRequests.some((url) => url.includes('/lucide-icons.svg'))).toBe(true);
  expect(spriteRequests.every((url) => !url.includes('/ui-icons.svg'))).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('utfpr-home.png'), fullPage: true });
  await page.evaluate(() => document.body.classList.add('theme-dark'));
  await expect(page.locator('.institutional-brand__logo').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#hub-login-button').click();
  await expect(page.locator('#hub-login-button use')).toHaveAttribute('href', /#icon-login$/);
});
