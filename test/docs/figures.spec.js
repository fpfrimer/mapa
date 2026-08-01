const fs = require('node:fs/promises');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const figuresDir = path.resolve(__dirname, '..', '..', 'docs', 'manual', 'figures', 'generated');

const fixtureState = {
  periods: [
    { id: 'period-1', name: '1º Período' },
    { id: 'period-2', name: '3º Período' }
  ],
  professors: [
    { id: 'professor-1', name: 'Ana Souza', disciplineIds: ['discipline-1'], isCourseArea: true },
    { id: 'professor-2', name: 'Bruno Lima', disciplineIds: ['discipline-2', 'discipline-3'], isCourseArea: true }
  ],
  rooms: [
    { id: 'room-1', name: 'A-101' },
    { id: 'room-2', name: 'E-204' }
  ],
  disciplines: [
    { id: 'discipline-1', name: 'Algoritmos', code: 'EL66A', hours: 4, color: '#f9c74f', periodId: 'period-1' },
    { id: 'discipline-2', name: 'Circuitos Elétricos', code: 'EL67C', hours: 4, color: '#43aa8b', periodId: 'period-2' },
    { id: 'discipline-3', name: 'Sistemas Digitais', code: 'EL67D', hours: 3, color: '#577590', periodId: 'period-2' }
  ],
  schedule: {
    'period-1': {
      'monday|M1': { disciplineId: 'discipline-1', professorId: 'professor-1', roomId: 'room-1' },
      'monday|M2': { disciplineId: 'discipline-1', professorId: 'professor-1', roomId: 'room-1' },
      'wednesday|M1': { disciplineId: 'discipline-1', professorId: 'professor-1', roomId: 'room-2' }
    },
    'period-2': {
      'tuesday|M1': { disciplineId: 'discipline-2', professorId: 'professor-2', roomId: 'room-2' },
      'tuesday|M2': { disciplineId: 'discipline-2', professorId: 'professor-2', roomId: 'room-2' },
      'thursday|M1': { disciplineId: 'discipline-3', professorId: 'professor-2', roomId: 'room-1' }
    }
  },
  view: 'period',
  selectedEntity: 'period-1',
  freeTimeProfessorIds: [],
  assignmentEditing: null,
  entityEditing: null,
  multiSelectMode: false,
  selectedSlots: []
};

async function capture(page, filename, locator = null) {
  const target = locator || page;
  await target.screenshot({ path: path.join(figuresDir, filename), animations: 'disabled' });
}

async function login(page) {
  await page.locator('#login-username').fill('editor');
  await page.locator('#login-password').fill('correct-password');
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator('#login-modal')).toBeHidden();
}

test('gera o conjunto de figuras dos manuais com dados sintéticos', async ({ page }) => {
  await fs.mkdir(figuresDir, { recursive: true });
  await page.goto('/');
  await expect(page.locator('#login-modal')).toBeVisible();
  await capture(page, '01-login.png');
  await login(page);

  const created = await page.evaluate(async (state) => {
    const auth = JSON.parse(sessionStorage.getItem('planner.auth'));
    const response = await fetch('/api/configurations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Engenharia Eletrônica — 2026.1',
        state,
        counters: { period: 3, professor: 3, room: 3, discipline: 4 }
      })
    });
    if (!response.ok) throw new Error(`Falha ao criar cenário documental: ${response.status}`);
    return response.json();
  }, fixtureState);

  await page.locator('#project-refresh').click();
  await expect(page.locator('.project-card')).toHaveCount(1);
  await page.locator('.project-card__meta').evaluate((node) => {
    node.textContent = 'Atualizado em 01/08/2026 10:00 por editor';
  });
  await capture(page, '02-hub.png', page.locator('.project-hub__card--hero'));

  await page.locator('#project-create').click();
  await expect(page.locator('#app-dialog')).toBeVisible();
  await page.locator('#app-dialog-input').fill('Engenharia Eletrônica — 2026.2');
  await capture(page, '03-novo-semestre.png');
  await page.locator('#app-dialog-cancel').click();

  await page.locator(`button[data-project-action="open"][data-project-id="${created.id}"]`).click();
  await expect(page.locator('body')).not.toHaveClass(/hub-visible/);
  await expect(page.locator('#schedule-container .schedule-table')).toBeVisible();
  await capture(page, '04-editor.png');

  await page.locator('button[data-panel="disciplines"]').click();
  await expect(page.locator('#management-panel')).not.toHaveClass(/hidden/);
  await capture(page, '05-cadastros.png');
  await page.locator('#management-panel .panel-close').click();

  await capture(page, '06-grade.png');

  await page.locator('#toggle-multi-select').click();
  await page.locator('.slot-cell[data-day="friday"][data-slot="M1"]').click();
  await page.locator('.slot-cell[data-day="friday"][data-slot="M2"]').click();
  await expect(page.locator('#selection-count')).toContainText('2');
  await capture(page, '07-selecao-multipla.png');
  await page.locator('#toggle-multi-select').click();

  await page.locator('#view-type').selectOption('free');
  await page.locator('#free-time-professor-selector').selectOption('professor-1');
  await expect(page.locator('.slot-cell--free-view').first()).toBeVisible();
  await capture(page, '08-horarios-livres.png');

  await page.locator('button[data-panel="rooms"]').click();
  await page.locator('#room-name').fill('Sala de Projetos');
  await page.locator('#room-form').evaluate((form) => form.requestSubmit());
  await expect(page.locator('#workspace-save-status')).toHaveAttribute('data-status', 'dirty');
  await capture(page, '09-estado-salvamento.png', page.locator('.top-bar'));
  await page.locator('#management-panel .panel-close').click();

  await page.evaluate(async ({ projectId, revision, state }) => {
    const auth = JSON.parse(sessionStorage.getItem('planner.auth'));
    const response = await fetch(`/api/configurations/${encodeURIComponent(projectId)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
        'If-Match': `"${revision}"`
      },
      body: JSON.stringify({
        name: 'Engenharia Eletrônica — 2026.1',
        state,
        counters: { period: 3, professor: 3, room: 3, discipline: 4 }
      })
    });
    if (!response.ok) throw new Error(`Falha ao preparar conflito documental: ${response.status}`);
  }, { projectId: created.id, revision: created.revision, state: fixtureState });
  await page.locator('#project-save-button').click();
  await expect(page.locator('#app-dialog-title')).toHaveText('Conflito de edição');
  await capture(page, '10-conflito.png');
  await page.locator('#app-dialog-close').click();

  await page.locator('#print-toggle').click();
  await expect(page.locator('#print-modal')).toBeVisible();
  await page.locator('#print-all-periods').check();
  await page.locator('#print-layout-compact').check();
  await capture(page, '11-impressao.png');
});
