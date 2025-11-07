const state = {
  periods: [],
  professors: [],
  rooms: [],
  disciplines: [],
  schedule: {}, // periodId -> { slotKey: { disciplineId, professorId, roomId } }
  view: 'period',
  selectedEntity: '',
  assignmentEditing: null,
  entityEditing: null,
  multiSelectMode: false,
  selectedSlots: new Set()
};

let counters = {
  period: 1,
  professor: 1,
  room: 1,
  discipline: 1
};

let savedConfigurations = [];

const searchQueries = {
  period: '',
  professor: '',
  room: '',
  discipline: ''
};

let activePanelKey = null;

const disciplineColorPalette = [
  '#f94144',
  '#f3722c',
  '#f8961e',
  '#f9c74f',
  '#90be6d',
  '#43aa8b',
  '#577590',
  '#277da1',
  '#9b5de5',
  '#f15bb5',
  '#00bbf9',
  '#00f5d4'
];

function normalizeColorValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pickDisciplineColor(usedColors = new Set()) {
  for (const candidate of disciplineColorPalette) {
    if (!usedColors.has(candidate)) {
      return candidate;
    }
  }
  if (!disciplineColorPalette.length) return '';
  const index = usedColors.size % disciplineColorPalette.length;
  return disciplineColorPalette[index];
}

function assignColorToDiscipline(discipline) {
  if (!discipline || normalizeColorValue(discipline.color)) return;
  const usedColors = new Set(
    state.disciplines
      .filter((item) => item && item !== discipline && normalizeColorValue(item.color))
      .map((item) => normalizeColorValue(item.color))
  );
  const color = pickDisciplineColor(usedColors);
  if (color) {
    discipline.color = color;
  }
}

function ensureDisciplineColors() {
  const used = new Set();
  state.disciplines.forEach((discipline) => {
    const value = normalizeColorValue(discipline?.color);
    if (value) {
      discipline.color = value;
      used.add(value);
    }
  });
  state.disciplines.forEach((discipline) => {
    if (!discipline) return;
    const value = normalizeColorValue(discipline.color);
    if (value) return;
    const color = pickDisciplineColor(used);
    if (color) {
      discipline.color = color;
      used.add(color);
    }
  });
}

function colorWithAlpha(color, alpha = 0.18) {
  const value = normalizeColorValue(color);
  if (!value) return '';
  if (!value.startsWith('#')) return '';
  let hex = value.slice(1);
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((char) => char + char)
      .join('');
  }
  if (hex.length !== 6) return '';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some((component) => Number.isNaN(component))) {
    return '';
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const STORAGE_KEY = 'academic-planner-state-v1';
const COUNTERS_KEY = 'academic-planner-counters-v1';
const CONFIG_API_URL = '/api/configurations';

const professorFormDisciplineIds = new Set();

function sanitizeDisciplineIdList(list) {
  const seen = new Set();
  const result = [];
  (Array.isArray(list) ? list : [])
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .forEach((value) => {
      if (!value || seen.has(value)) return;
      seen.add(value);
      result.push(value);
    });
  return result;
}

function normalizeProfessorRecord(professor) {
  if (!professor || typeof professor !== 'object') return null;
  const legacyDiscipline =
    typeof professor.disciplineId === 'string' && professor.disciplineId
      ? [professor.disciplineId]
      : [];
  const disciplineIds = sanitizeDisciplineIdList(
    Array.isArray(professor.disciplineIds) ? professor.disciplineIds : legacyDiscipline
  );
  const base = { ...professor };
  delete base.disciplineId;
  delete base.disciplineIds;
  delete base.isCourseArea;
  return {
    ...base,
    disciplineIds,
    isCourseArea: Boolean(professor.isCourseArea)
  };
}

function getProfessorDisciplineIds(professor) {
  if (!professor) return [];
  const ids = sanitizeDisciplineIdList(professor.disciplineIds);
  return ids.filter((id) => state.disciplines.some((discipline) => discipline.id === id));
}

function getProfessorDisciplineLabels(professor) {
  return getProfessorDisciplineIds(professor)
    .map((id) => getDisciplineById(id))
    .filter(Boolean)
    .map((discipline) => formatDisciplineLabel(discipline));
}

function professorHasDiscipline(professor, disciplineId) {
  if (!disciplineId) return false;
  return getProfessorDisciplineIds(professor).includes(disciplineId);
}

function getProfessorDetailParts(professor) {
  const details = [];
  const labels = getProfessorDisciplineLabels(professor);
  if (labels.length) {
    details.push(labels.join(', '));
  }
  if (professor?.isCourseArea) {
    details.push('Área do curso');
  }
  return details;
}

function formatProfessorOptionLabel(professor) {
  if (!professor) return '';
  const details = getProfessorDetailParts(professor);
  return details.length ? `${professor.name} — ${details.join(' • ')}` : professor.name;
}

const days = [
  { key: 'monday', label: 'Segunda' },
  { key: 'tuesday', label: 'Terça' },
  { key: 'wednesday', label: 'Quarta' },
  { key: 'thursday', label: 'Quinta' },
  { key: 'friday', label: 'Sexta' },
  { key: 'saturday', label: 'Sábado' }
];

const dayOrder = days.reduce((acc, day, index) => {
  acc[day.key] = index;
  return acc;
}, {});

const sessions = [
  {
    name: 'Manhã',
    key: 'manha',
    slots: [
      { code: 'M1', time: '07:30 - 08:20' },
      { code: 'M2', time: '08:20 - 09:10' },
      { code: 'M3', time: '09:10 - 10:00' },
      { code: 'M4', time: '10:20 - 11:10' },
      { code: 'M5', time: '11:10 - 12:00' },
      { code: 'M6', time: '12:00 - 12:50' }
    ]
  },
  {
    name: 'Tarde',
    key: 'tarde',
    slots: [
      { code: 'T1', time: '13:30 - 14:20' },
      { code: 'T2', time: '14:20 - 15:10' },
      { code: 'T3', time: '15:10 - 16:00' },
      { code: 'T4', time: '16:20 - 17:10' },
      { code: 'T5', time: '17:10 - 18:00' },
      { code: 'T6', time: '18:00 - 18:50' }
    ]
  },
  {
    name: 'Noite',
    key: 'noite',
    slots: [
      { code: 'N1', time: '18:50 - 19:40' },
      { code: 'N2', time: '19:40 - 20:30' },
      { code: 'N3', time: '20:30 - 21:20' },
      { code: 'N4', time: '21:30 - 22:20' },
      { code: 'N5', time: '22:20 - 23:10' },
      { code: 'N6', time: '23:10 - 00:00' }
    ]
  }
];

const slotDictionary = sessions.reduce((acc, session, sessionIndex) => {
  session.slots.forEach((slot, slotIndex) => {
    acc[slot.code] = {
      ...slot,
      sessionName: session.name,
      order: sessionIndex * 10 + slotIndex
    };
  });
  return acc;
}, {});

const entityCollections = {
  period: 'periods',
  professor: 'professors',
  room: 'rooms',
  discipline: 'disciplines'
};

const elements = {
  periodForm: document.getElementById('period-form'),
  professorForm: document.getElementById('professor-form'),
  roomForm: document.getElementById('room-form'),
  disciplineForm: document.getElementById('discipline-form'),
  disciplineCodeInput: document.getElementById('discipline-code'),
  periodList: document.getElementById('period-list'),
  professorList: document.getElementById('professor-list'),
  roomList: document.getElementById('room-list'),
  disciplineList: document.getElementById('discipline-list'),
  professorDisciplineSelect: document.getElementById('professor-discipline'),
  professorDisciplineAdd: document.getElementById('professor-discipline-add'),
  professorDisciplineList: document.getElementById('professor-discipline-list'),
  professorAreaCheckbox: document.getElementById('professor-area'),
  entityMenu: document.querySelector('.entity-menu'),
  menuButtons: document.querySelectorAll('.menu-button'),
  managementPanel: document.getElementById('management-panel'),
  panelTitle: document.getElementById('panel-title'),
  panelClose: document.querySelector('.panel-close'),
  panelSections: document.querySelectorAll('#management-panel .panel-section'),
  periodSearch: document.getElementById('period-search'),
  professorSearch: document.getElementById('professor-search'),
  roomSearch: document.getElementById('room-search'),
  disciplineSearch: document.getElementById('discipline-search'),
  disciplinePeriodSelect: document.getElementById('discipline-period'),
  viewTypeSelect: document.getElementById('view-type'),
  entitySelector: document.getElementById('entity-selector'),
  scheduleContainer: document.getElementById('schedule-container'),
  toggleMultiSelect: document.getElementById('toggle-multi-select'),
  selectionSummary: document.getElementById('selection-summary'),
  editSelection: document.getElementById('edit-selection'),
  clearSelection: document.getElementById('clear-selection'),
  modal: document.getElementById('assignment-modal'),
  modalClose: document.querySelector('.modal-close'),
  assignmentForm: document.getElementById('assignment-form'),
  assignmentDay: document.getElementById('assignment-day'),
  assignmentSlot: document.getElementById('assignment-slot'),
  assignmentDiscipline: document.getElementById('assignment-discipline'),
  assignmentPeriod: document.getElementById('assignment-period'),
  assignmentProfessor: document.getElementById('assignment-professor'),
  assignmentRoom: document.getElementById('assignment-room'),
  suggestions: document.getElementById('suggestions'),
  removeAssignment: document.getElementById('remove-assignment'),
  configSaveForm: document.getElementById('config-save-form'),
  configNameInput: document.getElementById('config-name'),
  savedConfigList: document.getElementById('saved-config-list'),
  refreshConfigsButton: document.getElementById('refresh-configs'),
  saveBrowserButton: document.getElementById('save-browser'),
  restoreBrowserButton: document.getElementById('restore-browser'),
  exportButton: document.getElementById('export-config'),
  importInput: document.getElementById('import-config'),
  clearBrowserButton: document.getElementById('clear-browser'),
  storageFeedback: document.getElementById('storage-feedback')
};

const menuButtons = Array.from(elements.menuButtons || []);
const panelSections = Array.from(elements.panelSections || []);

function normalizeText(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

function matchesSearchQuery(item, type, query) {
  if (!query) return true;
  const name = normalizeText(item?.name || '');
  if (name.includes(query)) return true;
  if (type === 'professor') {
    const labels = getProfessorDisciplineLabels(item || {});
    if (labels.some((label) => normalizeText(label).includes(query))) {
      return true;
    }
  }
  if (type === 'discipline') {
    const code = normalizeText(item?.code || '');
    if (code && code.includes(query)) return true;
  }
  if (type === 'discipline') {
    const period = getPeriodById(item?.periodId);
    if (period && normalizeText(period.name).includes(query)) {
      return true;
    }
  }
  return false;
}

function normalizeCode(value) {
  return normalizeText(value || '');
}

function getEntitySortKey(entity, type) {
  const nameKey = normalizeText(entity?.name || '');
  const codeKey = type === 'discipline' ? normalizeText(entity?.code || '') : '';
  const idKey = (entity?.id || '').toString();
  return { nameKey, codeKey, idKey };
}

function compareEntities(type, a, b) {
  const aKey = getEntitySortKey(a, type);
  const bKey = getEntitySortKey(b, type);

  if (aKey.nameKey !== bKey.nameKey) {
    return aKey.nameKey.localeCompare(bKey.nameKey);
  }

  if (type === 'discipline' && aKey.codeKey !== bKey.codeKey) {
    return aKey.codeKey.localeCompare(bKey.codeKey);
  }

  return aKey.idKey.localeCompare(bKey.idKey);
}

function sortStateCollection(type) {
  const collectionKey = entityCollections[type];
  if (!collectionKey || !Array.isArray(state[collectionKey])) return;
  state[collectionKey].sort((a, b) => compareEntities(type, a, b));
}

function sortAllCollections() {
  sortStateCollection('period');
  sortStateCollection('professor');
  sortStateCollection('room');
  sortStateCollection('discipline');
}

function isDuplicateDisciplineCode(code, ignoreId = null) {
  const normalized = normalizeCode(code);
  if (!normalized) return false;
  return state.disciplines.some((discipline) => {
    if (!discipline) return false;
    if (ignoreId && discipline.id === ignoreId) return false;
    return normalizeCode(discipline.code) === normalized;
  });
}

function isDuplicateDisciplineName(name, ignoreId = null) {
  const normalized = normalizeText(name);
  if (!normalized) return false;
  return state.disciplines.some((discipline) => {
    if (!discipline) return false;
    if (ignoreId && discipline.id === ignoreId) return false;
    return normalizeText(discipline.name) === normalized;
  });
}

function formatDisciplineLabel(discipline) {
  if (!discipline) return '';
  const code = discipline.code ? discipline.code.trim() : '';
  const name = discipline.name || '';
  return code ? `${code} · ${name}` : name;
}

function generateId(type) {
  return `${type}-${counters[type]++}`;
}

function renderEntityList(list, container, type) {
  container.innerHTML = '';
  const query = normalizeText(searchQueries[type] || '');
  const filtered = list
    .map((item) => {
      const isEditing =
        state.entityEditing && state.entityEditing.type === type && state.entityEditing.id === item.id;
      return { item, isEditing };
    })
    .filter(({ item, isEditing }) => {
      if (!query) return true;
      if (isEditing) return true;
      return matchesSearchQuery(item, type, query);
    });

  if (!filtered.length) {
    const empty = document.createElement('li');
    empty.className = 'entity-empty';
    empty.textContent = list.length ? 'Nenhum item encontrado.' : 'Nenhum item cadastrado.';
    container.appendChild(empty);
    return;
  }

  filtered.forEach(({ item, isEditing }) => {
    const li = document.createElement('li');
    li.className = 'entity-item';

    if (isEditing) {
      const form = document.createElement('form');
      form.className = 'entity-edit-form';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.required = true;
      nameInput.value = item.name;
      nameInput.placeholder = 'Nome';
      form.appendChild(nameInput);

      let professorDisciplineEditor = null;
      let areaCheckbox = null;
      let codeInput = null;
      let periodSelect = null;
      if (type === 'discipline') {
        codeInput = document.createElement('input');
        codeInput.type = 'text';
        codeInput.placeholder = 'Código (opcional)';
        codeInput.value = item.code || '';
        form.appendChild(codeInput);

        periodSelect = document.createElement('select');
        periodSelect.required = true;
        periodSelect.className = 'inline-select';

        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Período';
        periodSelect.appendChild(defaultOption);

        state.periods.forEach((period) => {
          const option = document.createElement('option');
          option.value = period.id;
          option.textContent = period.name;
          periodSelect.appendChild(option);
        });

        periodSelect.value = item.periodId || '';
        form.appendChild(periodSelect);
      } else if (type === 'professor') {
        professorDisciplineEditor = createProfessorDisciplineEditor(item.disciplineIds);
        form.appendChild(professorDisciplineEditor.container);

        const checkboxLabel = document.createElement('label');
        checkboxLabel.className = 'checkbox-field';
        areaCheckbox = document.createElement('input');
        areaCheckbox.type = 'checkbox';
        areaCheckbox.checked = Boolean(item.isCourseArea);
        checkboxLabel.appendChild(areaCheckbox);
        const checkboxText = document.createElement('span');
        checkboxText.textContent = 'Professor da área do curso';
        checkboxLabel.appendChild(checkboxText);
        form.appendChild(checkboxLabel);
      }

      const actions = document.createElement('div');
      actions.className = 'entity-edit-actions';

      const saveButton = document.createElement('button');
      saveButton.type = 'submit';
      saveButton.className = 'primary';
      saveButton.textContent = 'Salvar';
      actions.appendChild(saveButton);

      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.textContent = 'Cancelar';
      cancelButton.addEventListener('click', cancelEntityEditing);
      actions.appendChild(cancelButton);

      form.appendChild(actions);

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const name = nameInput.value.trim();
        if (!name) return;

        const updates = { name };
        if (type === 'discipline') {
          if (isDuplicateDisciplineName(name, item.id)) {
            alert('Já existe uma disciplina com este nome.');
            return;
          }
          const codeValue = codeInput?.value.trim() || '';
          if (codeValue && isDuplicateDisciplineCode(codeValue, item.id)) {
            alert('Já existe uma disciplina com este código.');
            return;
          }
          updates.code = codeValue;
          const selectedPeriod = periodSelect?.value || '';
          if (!selectedPeriod) {
            alert('Selecione um período para a disciplina.');
            return;
          }
          updates.periodId = selectedPeriod;
        } else if (type === 'professor') {
          const selectedIds = professorDisciplineEditor
            ? professorDisciplineEditor.getSelectedIds()
            : [];
          updates.disciplineIds = sanitizeDisciplineIdList(selectedIds);
          updates.isCourseArea = Boolean(areaCheckbox?.checked);
        }

        saveEntityEdit(type, item.id, updates);
      });

      li.appendChild(form);
    } else {
      const info = document.createElement('div');
      info.className = 'entity-info';

      const heading = document.createElement('div');
      heading.className = 'entity-heading';

      if (type === 'discipline') {
        const color = getDisciplineColor(item);
        if (color) {
          const swatch = document.createElement('span');
          swatch.className = 'entity-color-swatch';
          swatch.style.setProperty('--discipline-color', color);
          heading.appendChild(swatch);
        }
      }

      if (type === 'discipline' && item.code) {
        const codeBadge = document.createElement('span');
        codeBadge.className = 'entity-code';
        codeBadge.textContent = item.code;
        heading.appendChild(codeBadge);
      }

      const name = document.createElement('span');
      name.className = 'entity-name';
      name.textContent = item.name;
      heading.appendChild(name);

      info.appendChild(heading);

      if (type === 'discipline') {
        const period = getPeriodById(item.periodId);
        const meta = document.createElement('span');
        meta.className = 'entity-meta';
        meta.textContent = period ? period.name : 'Sem período';
        info.appendChild(meta);
      }

      if (type === 'professor') {
        if (item.isCourseArea) {
          const badge = document.createElement('span');
          badge.className = 'entity-badge area';
          badge.textContent = 'Área do curso';
          info.appendChild(badge);
        }
        const labels = getProfessorDisciplineLabels(item);
        const meta = document.createElement('span');
        meta.className = 'entity-meta';
        meta.textContent = labels.length
          ? `Disciplinas vinculadas: ${labels.join(', ')}`
          : 'Sem disciplinas vinculadas';
        info.appendChild(meta);
      }

      li.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'entity-actions';

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'icon-button';
      editButton.innerHTML =
        '<span aria-hidden="true">✏️</span><span class="visually-hidden">Editar</span>';
      editButton.title = 'Editar';
      editButton.addEventListener('click', () => startEntityEditing(type, item.id));
      actions.appendChild(editButton);

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'icon-button danger';
      removeButton.innerHTML =
        '<span aria-hidden="true">🗑️</span><span class="visually-hidden">Remover</span>';
      removeButton.title = 'Remover';
      removeButton.addEventListener('click', () => confirmRemoval(type, item));
      actions.appendChild(removeButton);

      li.appendChild(actions);
    }

    container.appendChild(li);
  });
}

function createProfessorDisciplineEditor(initialIds = []) {
  const wrapper = document.createElement('div');
  wrapper.className = 'multi-select-field';

  const control = document.createElement('div');
  control.className = 'discipline-picker-control';

  const select = document.createElement('select');
  select.className = 'inline-select';

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'icon-button small';
  addButton.title = 'Adicionar disciplina';
  addButton.setAttribute('aria-label', 'Adicionar disciplina');
  addButton.innerHTML = '<span aria-hidden="true">➕</span><span class="visually-hidden">Adicionar</span>';

  control.appendChild(select);
  control.appendChild(addButton);

  const list = document.createElement('ul');
  list.className = 'chip-list';

  wrapper.appendChild(control);
  wrapper.appendChild(list);

  const selected = new Set(sanitizeDisciplineIdList(initialIds));

  function capturePendingSelection() {
    const value = select.value;
    if (!value) return false;
    if (selected.has(value)) {
      select.value = '';
      return false;
    }
    const exists = state.disciplines.some((discipline) => discipline.id === value);
    if (!exists) {
      select.value = '';
      return false;
    }
    selected.add(value);
    select.value = '';
    refreshList();
    return true;
  }

  function refreshOptions() {
    const current = select.value;
    select.innerHTML = '<option value="">Adicionar disciplina (opcional)</option>';
    state.disciplines.forEach((discipline) => {
      const option = document.createElement('option');
      option.value = discipline.id;
      option.textContent = formatDisciplineLabel(discipline);
      select.appendChild(option);
    });
    const hasCurrent = state.disciplines.some((discipline) => discipline.id === current);
    select.value = hasCurrent ? current : '';
  }

  function refreshList() {
    list.innerHTML = '';
    const items = [];
    Array.from(selected).forEach((id) => {
      const discipline = getDisciplineById(id);
      if (!discipline) {
        selected.delete(id);
        return;
      }
      items.push({ id, label: formatDisciplineLabel(discipline) });
    });
    items
      .sort((a, b) => normalizeText(a.label).localeCompare(normalizeText(b.label)))
      .forEach(({ id, label }) => {
        const li = document.createElement('li');
        li.className = 'chip-item';
        const text = document.createElement('span');
        text.textContent = label;
        li.appendChild(text);
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'icon-button small danger chip-remove';
        removeButton.dataset.id = id;
        removeButton.title = 'Remover disciplina';
        removeButton.setAttribute('aria-label', 'Remover disciplina');
        removeButton.innerHTML =
          '<span aria-hidden="true">➖</span><span class="visually-hidden">Remover</span>';
        li.appendChild(removeButton);
        list.appendChild(li);
      });
  }

  addButton.addEventListener('click', () => {
    capturePendingSelection();
  });

  list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-id]');
    if (!button) return;
    const { id } = button.dataset;
    selected.delete(id);
    refreshList();
  });

  refreshOptions();
  refreshList();

  return {
    container: wrapper,
    getSelectedIds: () => {
      capturePendingSelection();
      return Array.from(selected);
    }
  };
}

function renderProfessorFormDisciplineChips() {
  const { professorDisciplineList } = elements;
  if (!professorDisciplineList) return;
  const items = [];
  Array.from(professorFormDisciplineIds).forEach((id) => {
    const discipline = getDisciplineById(id);
    if (!discipline) {
      professorFormDisciplineIds.delete(id);
      return;
    }
    items.push({ id, label: formatDisciplineLabel(discipline) });
  });
  professorDisciplineList.innerHTML = '';
  items
    .sort((a, b) => normalizeText(a.label).localeCompare(normalizeText(b.label)))
    .forEach(({ id, label }) => {
      const li = document.createElement('li');
      li.className = 'chip-item';
      const text = document.createElement('span');
      text.textContent = label;
      li.appendChild(text);
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'icon-button small danger chip-remove';
      removeButton.dataset.id = id;
      removeButton.title = 'Remover disciplina';
      removeButton.setAttribute('aria-label', 'Remover disciplina');
      removeButton.innerHTML =
        '<span aria-hidden="true">➖</span><span class="visually-hidden">Remover</span>';
      li.appendChild(removeButton);
      professorDisciplineList.appendChild(li);
    });
}

function setupProfessorFormControls() {
  const { professorDisciplineSelect, professorDisciplineAdd, professorDisciplineList } = elements;
  if (!professorDisciplineSelect || !professorDisciplineAdd || !professorDisciplineList) return;

  professorDisciplineAdd.addEventListener('click', () => {
    const value = professorDisciplineSelect.value;
    if (!value) return;
    const exists = state.disciplines.some((discipline) => discipline.id === value);
    if (!exists) {
      professorDisciplineSelect.value = '';
      return;
    }
    professorFormDisciplineIds.add(value);
    professorDisciplineSelect.value = '';
    renderProfessorFormDisciplineChips();
  });

  professorDisciplineList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-id]');
    if (!button) return;
    const { id } = button.dataset;
    professorFormDisciplineIds.delete(id);
    renderProfessorFormDisciplineChips();
  });

  renderProfessorFormDisciplineChips();
}

function openManagementPanel(panelKey) {
  const { managementPanel, panelTitle } = elements;
  if (!managementPanel) return;
  activePanelKey = panelKey;
  managementPanel.classList.remove('hidden');
  managementPanel.setAttribute('aria-hidden', 'false');

  let currentTitle = 'Gerenciar';
  panelSections.forEach((section) => {
    const matches = section.dataset.panel === panelKey;
    section.hidden = !matches;
    if (matches) {
      currentTitle = section.dataset.title || currentTitle;
      section.scrollTop = 0;
      const scrollable = section.querySelector('.list-container');
      if (scrollable) {
        scrollable.scrollTop = 0;
      }
    }
  });

  if (panelTitle) {
    panelTitle.textContent = currentTitle;
  }

  menuButtons.forEach((button) => {
    const isActive = button.dataset.panel === panelKey;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-expanded', String(isActive));
  });

  managementPanel.focus();
}

function closeManagementPanel() {
  const { managementPanel, panelTitle } = elements;
  if (!managementPanel) return;
  managementPanel.classList.add('hidden');
  managementPanel.setAttribute('aria-hidden', 'true');
  activePanelKey = null;
  panelSections.forEach((section) => {
    section.hidden = true;
  });
  menuButtons.forEach((button) => {
    button.classList.remove('active');
    button.setAttribute('aria-expanded', 'false');
  });
  if (panelTitle) {
    panelTitle.textContent = 'Gerenciar';
  }
}

function toggleManagementPanel(panelKey) {
  const { managementPanel } = elements;
  if (!managementPanel) return;
  const isOpen = !managementPanel.classList.contains('hidden');
  if (isOpen && activePanelKey === panelKey) {
    closeManagementPanel();
  } else {
    openManagementPanel(panelKey);
  }
}

function refreshLists() {
  ensureDisciplineColors();
  sortAllCollections();
  renderEntityList(state.periods, elements.periodList, 'period');
  renderEntityList(state.professors, elements.professorList, 'professor');
  renderEntityList(state.rooms, elements.roomList, 'room');
  renderEntityList(state.disciplines, elements.disciplineList, 'discipline');
  updateDisciplinePeriodOptions();
  updateProfessorDisciplineOptions();
}

function startEntityEditing(type, id) {
  state.entityEditing = { type, id };
  refreshLists();
}

function cancelEntityEditing() {
  state.entityEditing = null;
  refreshLists();
}

function saveEntityEdit(type, id, updates) {
  const collectionKey = entityCollections[type];
  if (!collectionKey) return;
  const list = state[collectionKey];
  const entity = list.find((item) => item.id === id);
  if (!entity) return;

  if (type === 'discipline') {
    if (isDuplicateDisciplineName(updates.name, id)) {
      alert('Já existe uma disciplina com este nome.');
      return;
    }
    if (updates.code && isDuplicateDisciplineCode(updates.code, id)) {
      alert('Já existe uma disciplina com este código.');
      return;
    }
  }

  entity.name = updates.name;

  if (type === 'discipline') {
    const previousPeriod = entity.periodId;
    const newPeriod = updates.periodId || previousPeriod;
    if (previousPeriod && newPeriod && previousPeriod !== newPeriod) {
      const conflicts = describeDisciplinePeriodChangeConflicts(id, previousPeriod, newPeriod);
      if (conflicts.length) {
        const fromPeriod = getPeriodById(previousPeriod);
        const fromName = fromPeriod ? fromPeriod.name : previousPeriod;
        const toPeriod = getPeriodById(newPeriod);
        const toName = toPeriod ? toPeriod.name : newPeriod;
        const messageLines = [
          `Esta disciplina possui ${conflicts.length} horário(s) configurado(s) no período ${fromName}.`,
          '',
          conflicts.join('\n'),
          '',
          `Alterar o período tentará mover esses horários para ${toName} quando possível.`
        ];
        const proceed = confirm(`${messageLines.join('\n')}`);
        if (!proceed) {
          return;
        }
      }
    }
    entity.code = updates.code || '';
    entity.periodId = newPeriod;
    if (previousPeriod && newPeriod && previousPeriod !== newPeriod) {
      moveDisciplineAssignments(id, previousPeriod, newPeriod);
    }
  } else if (type === 'professor') {
    const sanitized = sanitizeDisciplineIdList(updates.disciplineIds || []);
    entity.disciplineIds = sanitized.filter((value) =>
      state.disciplines.some((discipline) => discipline.id === value)
    );
    entity.isCourseArea = Boolean(updates.isCourseArea);
  }

  sortStateCollection(type);
  state.entityEditing = null;
  refreshLists();
  updateEntitySelector();
  persistState();
}

function confirmRemoval(type, item) {
  let message = `Deseja remover "${item.name}"?`;
  if (type === 'period') {
    const relatedDisciplines = state.disciplines.filter((discipline) => discipline.periodId === item.id);
    if (relatedDisciplines.length) {
      message =
        `Remover o período "${item.name}" também apagará ${relatedDisciplines.length} disciplina(s) vinculada(s). Continuar?`;
    }
  }
  const proceed = confirm(message);
  if (!proceed) return;
  deleteEntity(type, item.id);
}

function purgeSchedule(matchFn) {
  Object.entries(state.schedule).forEach(([periodId, slots]) => {
    Object.entries(slots).forEach(([key, entry]) => {
      if (matchFn(periodId, entry, key)) {
        delete slots[key];
      }
    });
    if (!Object.keys(slots).length) {
      delete state.schedule[periodId];
    }
  });
}

function moveDisciplineAssignments(disciplineId, fromPeriod, toPeriod) {
  const origin = state.schedule[fromPeriod];
  if (!origin) return;
  Object.entries({ ...origin }).forEach(([key, entry]) => {
    if (entry.disciplineId !== disciplineId) return;
    if (!state.schedule[toPeriod]) {
      state.schedule[toPeriod] = {};
    }
    if (!state.schedule[toPeriod][key]) {
      state.schedule[toPeriod][key] = entry;
    }
    delete origin[key];
  });
  if (!Object.keys(origin).length) {
    delete state.schedule[fromPeriod];
  }
}

function getDisciplineAssignmentsInPeriod(disciplineId, periodId) {
  const schedule = state.schedule[periodId];
  if (!schedule) return [];
  return Object.entries(schedule)
    .filter(([, entry]) => entry?.disciplineId === disciplineId)
    .map(([key, entry]) => {
      const { dayKey, slotCode } = parseSlotKey(key);
      return { key, dayKey, slotCode, entry };
    });
}

function describeDisciplinePeriodChangeConflicts(disciplineId, fromPeriodId, toPeriodId) {
  if (!fromPeriodId) return [];
  const assignments = getDisciplineAssignmentsInPeriod(disciplineId, fromPeriodId);
  if (!assignments.length) return [];
  return assignments.map(({ key, dayKey, slotCode }) => {
    const label = `• ${formatSlotLabel(dayKey, slotCode)}`;
    if (toPeriodId && toPeriodId !== fromPeriodId) {
      const destinationEntry = state.schedule[toPeriodId]?.[key];
      if (destinationEntry && destinationEntry.disciplineId !== disciplineId) {
        const conflictDiscipline = getDisciplineById(destinationEntry.disciplineId);
        const conflictLabel = conflictDiscipline
          ? formatDisciplineLabel(conflictDiscipline)
          : 'outro compromisso';
        return `${label} — conflito no período destino com ${conflictLabel}.`;
      }
    }
    return label;
  });
}

function deleteEntity(type, id) {
  const collectionKey = entityCollections[type];
  if (!collectionKey) return;
  const list = state[collectionKey];
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) return;

  list.splice(index, 1);

  if (type === 'period') {
    delete state.schedule[id];
    const removedDisciplineIds = state.disciplines
      .filter((discipline) => discipline.periodId === id)
      .map((discipline) => discipline.id);
    if (removedDisciplineIds.length) {
      state.disciplines = state.disciplines.filter((discipline) => discipline.periodId !== id);
      purgeSchedule((periodId, entry) => removedDisciplineIds.includes(entry.disciplineId));
      state.professors.forEach((professor) => {
        const sanitized = sanitizeDisciplineIdList(professor.disciplineIds);
        const filtered = sanitized.filter((value) => !removedDisciplineIds.includes(value));
        professor.disciplineIds = filtered;
      });
    }
  } else if (type === 'discipline') {
    purgeSchedule((periodId, entry) => entry.disciplineId === id);
    state.professors.forEach((professor) => {
      const sanitized = sanitizeDisciplineIdList(professor.disciplineIds);
      const filtered = sanitized.filter((value) => value !== id);
      professor.disciplineIds = filtered;
    });
  } else if (type === 'professor') {
    purgeSchedule((periodId, entry) => entry.professorId === id);
  } else if (type === 'room') {
    purgeSchedule((periodId, entry) => entry.roomId === id);
  }

  if (state.entityEditing && state.entityEditing.type === type && state.entityEditing.id === id) {
    state.entityEditing = null;
  }
  if (state.view === type && state.selectedEntity === id) {
    state.selectedEntity = '';
  }

  if (state.entityEditing) {
    const editingCollection = entityCollections[state.entityEditing.type];
    const editingList = editingCollection ? state[editingCollection] : [];
    if (!editingList || !editingList.some((entity) => entity.id === state.entityEditing.id)) {
      state.entityEditing = null;
    }
  }

  refreshLists();
  updateEntitySelector();
  persistState();
}

function updateDisciplinePeriodOptions() {
  const { disciplinePeriodSelect } = elements;
  disciplinePeriodSelect.innerHTML = '<option value="">Período</option>';
  state.periods.forEach((period) => {
    const option = document.createElement('option');
    option.value = period.id;
    option.textContent = period.name;
    disciplinePeriodSelect.appendChild(option);
  });
}

function updateProfessorDisciplineOptions() {
  const { professorDisciplineSelect } = elements;
  if (professorDisciplineSelect) {
    const currentValue = professorDisciplineSelect.value;
    professorDisciplineSelect.innerHTML =
      '<option value="">Adicionar disciplina (opcional)</option>';
    state.disciplines.forEach((discipline) => {
      const option = document.createElement('option');
      option.value = discipline.id;
      option.textContent = formatDisciplineLabel(discipline);
      professorDisciplineSelect.appendChild(option);
    });
    const hasCurrent = state.disciplines.some((discipline) => discipline.id === currentValue);
    professorDisciplineSelect.value = hasCurrent ? currentValue : '';
  }
  renderProfessorFormDisciplineChips();
}

function updateEntitySelector() {
  const { entitySelector } = elements;
  entitySelector.innerHTML = '<option value="">Escolha um item</option>';
  let source = [];
  if (state.view === 'period') source = state.periods;
  if (state.view === 'professor') source = state.professors;
  if (state.view === 'room') source = state.rooms;
  source.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    let label = item.name;
    if (state.view === 'professor') {
      const disciplineLabels = getProfessorDisciplineLabels(item);
      if (disciplineLabels.length) {
        label = `${item.name} • ${disciplineLabels.join(', ')}`;
      }
      if (item.isCourseArea) {
        label = `${label} • Área do curso`;
      }
    }
    option.textContent = label;
    entitySelector.appendChild(option);
  });
  if (!source.some((item) => item.id === state.selectedEntity)) {
    state.selectedEntity = '';
  }
  if (!state.selectedEntity) {
    clearSelectedSlots();
  }
  if (state.selectedEntity) {
    entitySelector.value = state.selectedEntity;
  }
  renderSchedule();
}

function getDisciplineById(id) {
  return state.disciplines.find((d) => d.id === id) || null;
}

function getDisciplineColor(discipline) {
  return normalizeColorValue(discipline?.color);
}

function getPeriodById(id) {
  return state.periods.find((p) => p.id === id) || null;
}

function getProfessorById(id) {
  return state.professors.find((p) => p.id === id) || null;
}

function getRoomById(id) {
  return state.rooms.find((r) => r.id === id) || null;
}

function slotKey(dayKey, slotCode) {
  return `${dayKey}|${slotCode}`;
}

function parseSlotKey(key) {
  const [dayKey, slotCode] = (key || '').split('|');
  return { dayKey, slotCode };
}

function formatSlotLabel(dayKey, slotCode) {
  const day = days.find((d) => d.key === dayKey);
  const slotInfo = slotDictionary[slotCode];
  if (!slotInfo) {
    return `${day ? day.label : dayKey} • ${slotCode}`;
  }
  return `${day ? day.label : dayKey} • ${slotInfo.code} (${slotInfo.time})`;
}

function updateSelectionUI() {
  const { toggleMultiSelect, selectionSummary, editSelection, clearSelection } = elements;
  if (toggleMultiSelect) {
    toggleMultiSelect.setAttribute('aria-pressed', state.multiSelectMode ? 'true' : 'false');
    toggleMultiSelect.textContent = state.multiSelectMode
      ? 'Desativar seleção múltipla'
      : 'Ativar seleção múltipla';
  }
  const count = state.selectedSlots.size;
  if (selectionSummary) {
    const baseText = count
      ? `${count} horário${count > 1 ? 's' : ''} selecionado${count > 1 ? 's' : ''}.`
      : 'Nenhum horário selecionado.';
    selectionSummary.textContent = state.multiSelectMode
      ? `Seleção múltipla ativa — ${baseText}`
      : baseText;
  }
  if (editSelection) {
    editSelection.disabled = !count;
  }
  if (clearSelection) {
    clearSelection.disabled = !count;
  }
}

function clearSelectedSlots(options = {}) {
  const { preserveMode = false } = options;
  state.selectedSlots.clear();
  if (!preserveMode) {
    state.multiSelectMode = false;
  }
  updateSelectionUI();
}

function toggleSlotSelection(dayKey, slotCode, button) {
  const key = slotKey(dayKey, slotCode);
  if (state.selectedSlots.has(key)) {
    state.selectedSlots.delete(key);
    if (button) {
      button.classList.remove('selected');
      button.setAttribute('aria-pressed', 'false');
    }
  } else {
    state.selectedSlots.add(key);
    if (button) {
      button.classList.add('selected');
      button.setAttribute('aria-pressed', 'true');
    }
  }
  updateSelectionUI();
}

function handleSlotClick(button, dayKey, slotCode) {
  if (state.multiSelectMode) {
    toggleSlotSelection(dayKey, slotCode, button);
    return;
  }
  openAssignmentModalForSlots([{ dayKey, slotCode }]);
}

function ensureSchedule(periodId) {
  if (!state.schedule[periodId]) {
    state.schedule[periodId] = {};
  }
  return state.schedule[periodId];
}

function getAssignmentForPeriod(periodId, key) {
  return state.schedule[periodId]?.[key] || null;
}

function getAssignmentsForSlot(key) {
  const results = [];
  Object.entries(state.schedule).forEach(([periodId, slots]) => {
    if (slots[key]) {
      results.push({ periodId, data: slots[key] });
    }
  });
  return results;
}

function findAssignmentByProfessor(professorId, key) {
  for (const [periodId, slots] of Object.entries(state.schedule)) {
    const data = slots[key];
    if (data && data.professorId === professorId) {
      return { periodId, data };
    }
  }
  return null;
}

function findAssignmentByRoom(roomId, key) {
  for (const [periodId, slots] of Object.entries(state.schedule)) {
    const data = slots[key];
    if (data && data.roomId === roomId) {
      return { periodId, data };
    }
  }
  return null;
}

function collectAssignmentErrors(periodId, data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    errors.push('Horário configurado de forma incompleta.');
    return errors;
  }
  const discipline = getDisciplineById(data?.disciplineId);
  const professor = getProfessorById(data?.professorId);
  const room = getRoomById(data?.roomId);
  const period = getPeriodById(periodId);

  if (!discipline) {
    errors.push('Disciplina removida do cadastro.');
  }

  if (discipline && periodId && discipline.periodId && discipline.periodId !== periodId) {
    const expectedPeriod = getPeriodById(discipline.periodId);
    const expectedName = expectedPeriod ? expectedPeriod.name : discipline.periodId;
    const currentName = period ? period.name : periodId || 'período atual';
    errors.push(`Disciplina vinculada ao período ${expectedName}, mas configurada em ${currentName}.`);
  }

  if (!professor) {
    errors.push('Professor removido do cadastro.');
  } else if (discipline && !professorHasDiscipline(professor, discipline.id)) {
    const disciplineName = discipline?.name || 'esta disciplina';
    errors.push(`Professor ${professor.name} não está vinculado a ${disciplineName}.`);
  }

  if (!room) {
    errors.push('Sala removida do cadastro.');
  }

  return [...new Set(errors)];
}

function buildCellContent(assignments) {
  if (!assignments.length) {
    return { html: '<span class="slot-empty">Disponível</span>', errors: [] };
  }

  const errorSet = new Set();

  const parts = assignments.map(({ periodId, data }) => {
    const discipline = getDisciplineById(data.disciplineId);
    const professor = getProfessorById(data.professorId);
    const room = getRoomById(data.roomId);
    const period = getPeriodById(periodId);
    const lines = [];
    if (discipline) lines.push(`<strong>${formatDisciplineLabel(discipline)}</strong>`);
    if (period) lines.push(`<span class="badge period">${period.name}</span>`);
    if (professor) {
      lines.push(`<span class="badge professor">${professor.name}</span>`);
      if (professor.isCourseArea) {
        lines.push('<span class="badge area">Área do curso</span>');
      }
    }
    if (room) lines.push(`<span class="badge room">Sala ${room.name}</span>`);
    const classes = ['slot-content'];
    const styleParts = [];
    const baseColor = getDisciplineColor(discipline);
    if (baseColor) {
      classes.push('with-discipline-color');
      styleParts.push(`--discipline-color: ${baseColor}`);
      const fill = colorWithAlpha(baseColor);
      if (fill) {
        styleParts.push(`--discipline-fill: ${fill}`);
      }
    }

    collectAssignmentErrors(periodId, data).forEach((error) => errorSet.add(error));

    const styleAttr = styleParts.length ? ` style="${styleParts.join('; ')}"` : '';
    return `<div class="${classes.join(' ')}"${styleAttr}>${lines.join('')}</div>`;
  });

  const errors = [...errorSet];
  if (errors.length) {
    const indicatorLabel = errors.length === 1 ? 'Erro' : 'Erros';
    const indicator = [
      `<span class="slot-error-indicator" aria-hidden="true">⚠️ ${indicatorLabel}</span>`,
      `<span class="visually-hidden">${indicatorLabel}: ${errors.join('; ')}</span>`
    ];
    parts.push(indicator.join(''));
  }

  return { html: parts.join(''), errors };
}

function getCellAssignments(view, entityId, dayKey, slotCode) {
  const key = slotKey(dayKey, slotCode);
  if (!entityId) return [];
  if (view === 'period') {
    const assignment = getAssignmentForPeriod(entityId, key);
    return assignment ? [{ periodId: entityId, data: assignment }] : [];
  }
  if (view === 'professor') {
    return getAssignmentsForSlot(key).filter(({ data }) => data.professorId === entityId);
  }
  if (view === 'room') {
    return getAssignmentsForSlot(key).filter(({ data }) => data.roomId === entityId);
  }
  return [];
}

function renderSchedule() {
  const { scheduleContainer } = elements;
  scheduleContainer.innerHTML = '';
  if (!state.selectedEntity) {
    scheduleContainer.innerHTML = '<p class="placeholder">Cadastre e selecione um item para visualizar o mapa de horários.</p>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'schedule-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.appendChild(document.createElement('th'));
  days.forEach((day) => {
    const th = document.createElement('th');
    th.textContent = day.label;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  sessions.forEach((session) => {
    const labelRow = document.createElement('tr');
    labelRow.className = 'session-row';
    const labelCell = document.createElement('th');
    labelCell.colSpan = days.length + 1;
    labelCell.innerHTML = `<span class="session-label">${session.name}</span>`;
    labelRow.appendChild(labelCell);
    tbody.appendChild(labelRow);

    session.slots.forEach((slot) => {
      const row = document.createElement('tr');
      row.className = `session-${session.key}`;
      const timeCell = document.createElement('td');
      timeCell.className = 'slot-label';
      timeCell.textContent = `${slot.code} • ${slot.time}`;
      row.appendChild(timeCell);

      days.forEach((day) => {
        const cell = document.createElement('td');
        const button = document.importNode(document.getElementById('cell-template').content, true).querySelector('.slot-cell');
        button.dataset.day = day.key;
        button.dataset.slot = slot.code;
        const assignments = getCellAssignments(state.view, state.selectedEntity, day.key, slot.code);
        const cellContent = buildCellContent(assignments);
        button.innerHTML = cellContent.html;
        if (cellContent.errors.length) {
          button.classList.add('has-error');
          button.title = cellContent.errors.map((error) => `• ${error}`).join('\n');
        } else {
          button.classList.remove('has-error');
          button.removeAttribute('title');
        }
        const key = slotKey(day.key, slot.code);
        if (state.selectedSlots.has(key)) {
          button.classList.add('selected');
          button.setAttribute('aria-pressed', 'true');
        } else {
          button.setAttribute('aria-pressed', 'false');
        }
        button.addEventListener('click', (event) => {
          handleSlotClick(event.currentTarget, day.key, slot.code);
        });
        cell.appendChild(button);
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    });
  });

  table.appendChild(tbody);
  scheduleContainer.appendChild(table);
  updateSelectionUI();
}

function openAssignmentModalForSlots(slotsInput) {
  if (!state.selectedEntity) {
    alert('Selecione um item para editar o horário.');
    return;
  }
  const normalizedSlots = (Array.isArray(slotsInput) ? slotsInput : [])
    .map(({ dayKey, slotCode }) => ({ dayKey, slotCode }))
    .filter((slot) => slot.dayKey && slot.slotCode);
  if (!normalizedSlots.length) return;

  normalizedSlots.sort((a, b) => {
    const dayDiff = (dayOrder[a.dayKey] ?? 0) - (dayOrder[b.dayKey] ?? 0);
    if (dayDiff !== 0) return dayDiff;
    const slotOrderA = slotDictionary[a.slotCode]?.order ?? 0;
    const slotOrderB = slotDictionary[b.slotCode]?.order ?? 0;
    return slotOrderA - slotOrderB;
  });

  populateModalSelects();

  const details = normalizedSlots.map((slot) => {
    const key = slotKey(slot.dayKey, slot.slotCode);
    let originalPeriodId = null;
    let originalEntry = null;
    if (state.view === 'period') {
      originalPeriodId = state.selectedEntity;
      originalEntry = getAssignmentForPeriod(state.selectedEntity, key);
    } else if (state.view === 'professor') {
      const result = findAssignmentByProfessor(state.selectedEntity, key);
      if (result) {
        originalPeriodId = result.periodId;
        originalEntry = result.data;
      }
    } else if (state.view === 'room') {
      const result = findAssignmentByRoom(state.selectedEntity, key);
      if (result) {
        originalPeriodId = result.periodId;
        originalEntry = result.data;
      }
    }
    return { ...slot, key, originalPeriodId, originalEntry };
  });

  state.assignmentEditing = {
    slots: normalizedSlots,
    details,
    multi: normalizedSlots.length > 1
  };

  const firstDetail = details[0];
  if (state.assignmentEditing.multi) {
    elements.assignmentDay.value = `${details.length} horários selecionados`;
    elements.assignmentSlot.value = 'Múltiplos blocos';
  } else if (firstDetail) {
    elements.assignmentDay.value = days.find((d) => d.key === firstDetail.dayKey)?.label || '';
    elements.assignmentSlot.value = `${firstDetail.slotCode}`;
  }

  const disciplineValues = new Set();
  const professorValues = new Set();
  const roomValues = new Set();
  const periodValues = new Set();

  details.forEach((detail) => {
    if (detail.originalEntry) {
      if (detail.originalEntry.disciplineId) {
        disciplineValues.add(detail.originalEntry.disciplineId);
      }
      if (detail.originalEntry.professorId) {
        professorValues.add(detail.originalEntry.professorId);
      }
      if (detail.originalEntry.roomId) {
        roomValues.add(detail.originalEntry.roomId);
      }
    }
    if (detail.originalPeriodId) {
      periodValues.add(detail.originalPeriodId);
    }
  });

  elements.assignmentDiscipline.value = disciplineValues.size === 1 ? [...disciplineValues][0] : '';

  if (state.view === 'period') {
    elements.assignmentPeriod.value = state.selectedEntity;
  } else if (periodValues.size === 1) {
    elements.assignmentPeriod.value = [...periodValues][0];
  } else {
    elements.assignmentPeriod.value = '';
  }

  if (state.view === 'professor') {
    elements.assignmentProfessor.value = state.selectedEntity;
  } else if (professorValues.size === 1) {
    elements.assignmentProfessor.value = [...professorValues][0];
  } else {
    elements.assignmentProfessor.value = '';
  }

  if (state.view === 'room') {
    elements.assignmentRoom.value = state.selectedEntity;
  } else if (roomValues.size === 1) {
    elements.assignmentRoom.value = [...roomValues][0];
  } else {
    elements.assignmentRoom.value = '';
  }

  prioritizeAssignmentDisciplines();

  if (state.view === 'period') {
    elements.assignmentPeriod.disabled = true;
    elements.assignmentPeriod.value = state.selectedEntity;
  } else {
    elements.assignmentPeriod.disabled = false;
  }

  if (state.view === 'professor') {
    elements.assignmentProfessor.disabled = true;
    elements.assignmentProfessor.value = state.selectedEntity;
  } else {
    elements.assignmentProfessor.disabled = false;
  }

  if (state.view === 'room') {
    elements.assignmentRoom.disabled = true;
    elements.assignmentRoom.value = state.selectedEntity;
  } else {
    elements.assignmentRoom.disabled = false;
  }

  elements.removeAssignment.textContent = state.assignmentEditing.multi
    ? 'Limpar horários'
    : 'Remover horário';

  updatePeriodByDiscipline();
  updateSuggestions();
  elements.modal.classList.remove('hidden');
}

function closeModal() {
  elements.modal.classList.add('hidden');
  state.assignmentEditing = null;
}

elements.modalClose.addEventListener('click', closeModal);
elements.modal.addEventListener('click', (event) => {
  if (event.target === elements.modal) {
    closeModal();
  }
});

elements.assignmentDiscipline.addEventListener('change', () => {
  updatePeriodByDiscipline();
  updateSuggestions();
});

elements.assignmentProfessor.addEventListener('change', () => {
  prioritizeAssignmentDisciplines();
  updateSuggestions();
});
elements.assignmentRoom.addEventListener('change', updateSuggestions);
elements.assignmentPeriod.addEventListener('change', updateSuggestions);

elements.assignmentForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state.assignmentEditing || !Array.isArray(state.assignmentEditing.details)) return;

  const details = state.assignmentEditing.details;
  if (!details.length) return;

  const disciplineId = elements.assignmentDiscipline.value;
  const periodId = elements.assignmentPeriod.value;
  const professorId = elements.assignmentProfessor.value;
  const roomId = elements.assignmentRoom.value;

  if (!disciplineId || !periodId || !professorId || !roomId) {
    alert('Preencha todos os campos.');
    return;
  }

  const discipline = getDisciplineById(disciplineId);
  if (discipline && discipline.periodId !== periodId) {
    const proceed = confirm(
      'A disciplina selecionada pertence a outro período. Deseja atribuí-la mesmo assim?'
    );
    if (!proceed) {
      return;
    }
  }

  const conflictMessages = [];
  details.forEach((detail) => {
    const conflicts = findConflicts({
      periodId,
      professorId,
      roomId,
      key: detail.key,
      originalPeriodId: detail.originalPeriodId,
      originalEntry: detail.originalEntry
    });
    conflicts.forEach((message) => {
      conflictMessages.push(`${formatSlotLabel(detail.dayKey, detail.slotCode)}: ${message}`);
    });
  });

  if (conflictMessages.length) {
    const proceed = confirm(
      `Existem conflitos nestes horários:\n\n${conflictMessages.join('\n')}\n\nDeseja substituir mesmo assim?`
    );
    if (!proceed) {
      return;
    }
  }

  details.forEach((detail) => {
    const schedule = ensureSchedule(periodId);
    schedule[detail.key] = { disciplineId, professorId, roomId };

    if (detail.originalPeriodId && detail.originalPeriodId !== periodId) {
      const previous = ensureSchedule(detail.originalPeriodId);
      if (!detail.originalEntry || previous[detail.key] === detail.originalEntry) {
        delete previous[detail.key];
      }
    }
  });

  persistState();
  closeModal();
  renderSchedule();
});

elements.removeAssignment.addEventListener('click', () => {
  if (!state.assignmentEditing || !Array.isArray(state.assignmentEditing.details)) return;
  const details = state.assignmentEditing.details;
  if (!details.length) return;
  let removed = false;

  details.forEach((detail) => {
    if (state.view === 'period') {
      const schedule = ensureSchedule(state.selectedEntity);
      if (schedule[detail.key]) {
        delete schedule[detail.key];
        removed = true;
      }
    } else if (detail.originalPeriodId) {
      const schedule = ensureSchedule(detail.originalPeriodId);
      if (schedule[detail.key]) {
        delete schedule[detail.key];
        removed = true;
      }
    }
  });

  if (removed) {
    persistState();
    closeModal();
    renderSchedule();
  }
});

function findConflicts({ periodId, professorId, roomId, key, originalPeriodId, originalEntry }) {
  const conflicts = [];

  // check same period slot already filled
  const existingPeriod = state.schedule[periodId]?.[key];
  const isSameOriginal =
    originalEntry && periodId === originalPeriodId && existingPeriod === originalEntry;
  if (existingPeriod && !isSameOriginal) {
    const discipline = getDisciplineById(existingPeriod.disciplineId);
    conflicts.push(
      `Período já ocupado por ${
        discipline ? formatDisciplineLabel(discipline) : 'outra disciplina'
      }.`
    );
  }

  Object.entries(state.schedule).forEach(([pId, slots]) => {
    const entry = slots[key];
    if (!entry) return;
    const sameRecord = originalEntry && entry === originalEntry && pId === originalPeriodId;
    if (sameRecord) return;

    if (entry.professorId === professorId) {
      const period = getPeriodById(pId);
      conflicts.push(
        `Professor indisponível (compromisso no período ${period ? period.name : pId}).`
      );
    }
    if (entry.roomId === roomId) {
      const period = getPeriodById(pId);
      conflicts.push(`Sala ocupada pelo período ${period ? period.name : pId}.`);
    }
  });

  return [...new Set(conflicts)];
}

function updateSuggestions() {
  if (!state.assignmentEditing || !Array.isArray(state.assignmentEditing.details)) return;
  const details = state.assignmentEditing.details;
  if (!details.length) return;

  if (state.assignmentEditing.multi) {
    elements.suggestions.innerHTML =
      '<span>Seleção múltipla ativa. Conflitos são verificados ao salvar.</span>';
    return;
  }

  const detail = details[0];
  const key = detail.key;
  const periodId = elements.assignmentPeriod.value;
  const professorId = elements.assignmentProfessor.value;
  const roomId = elements.assignmentRoom.value;
  const disciplineId = elements.assignmentDiscipline.value;

  const availableRooms = state.rooms.filter((room) => {
    if (!room.id) return false;
    return !Object.entries(state.schedule).some(([pId, slots]) => {
      const entry = slots[key];
      if (!entry) return false;
      const isSameRecord = detail.originalEntry && entry === detail.originalEntry && pId === detail.originalPeriodId;
      if (isSameRecord) return false;
      return entry.roomId === room.id;
    });
  });

  const availableProfessors = state.professors.filter((professor) => {
    if (!professor.id) return false;
    return !Object.entries(state.schedule).some(([pId, slots]) => {
      const entry = slots[key];
      if (!entry) return false;
      const isSameRecord = detail.originalEntry && entry === detail.originalEntry && pId === detail.originalPeriodId;
      if (isSameRecord) return false;
      return entry.professorId === professor.id;
    });
  });

  const availableProfessorNames = availableProfessors.map((professor) => {
    const details = getProfessorDetailParts(professor);
    return details.length ? `${professor.name} (${details.join(' • ')})` : professor.name;
  });

  const periodConflicts = [];
  if (periodId) {
    const entry = state.schedule[periodId]?.[key];
    if (entry) {
      const disciplineExisting = getDisciplineById(entry.disciplineId);
      periodConflicts.push(
        `Período já possui ${
          disciplineExisting ? formatDisciplineLabel(disciplineExisting) : 'outra disciplina'
        } neste horário.`
      );
    }
  }

  const suggestions = [];
  const disciplineInfo = disciplineId ? getDisciplineById(disciplineId) : null;
  let disciplinePeriodHint = '';
  if (disciplineInfo) {
    const period = getPeriodById(disciplineInfo.periodId);
    disciplinePeriodHint = period
      ? `${formatDisciplineLabel(disciplineInfo)} vinculada ao período ${period.name}.`
      : '';
    if (!periodId) {
      elements.assignmentPeriod.value = disciplineInfo.periodId;
    }
    if (periodId && periodId !== disciplineInfo.periodId) {
      const selectedPeriod = getPeriodById(periodId);
      suggestions.push(
        `<span class="suggestion-warning">Disciplina cadastrada para ${
          period ? period.name : 'outro período'
        }, mas você selecionou ${selectedPeriod ? selectedPeriod.name : 'um período diferente'}.</span>`
      );
    }
  }

  if (disciplinePeriodHint) {
    suggestions.push(`<span>${disciplinePeriodHint}</span>`);
  }
  suggestions.push(
    `<span><strong>Salas disponíveis:</strong> ${
      availableRooms.length ? availableRooms.map((r) => r.name).join(', ') : 'Nenhuma sala livre'
    }</span>`
  );
  suggestions.push(
    `<span><strong>Professores disponíveis:</strong> ${
      availableProfessors.length
        ? availableProfessorNames.join(', ')
        : 'Nenhum professor livre'
    }</span>`
  );

  if (disciplineId) {
    const recommendedProfessors = availableProfessors.filter((professor) =>
      professorHasDiscipline(professor, disciplineId)
    );
    if (recommendedProfessors.length) {
      suggestions.push(
        `<span><strong>Professores vinculados à disciplina:</strong> ${recommendedProfessors
          .map((professor) => {
            const details = getProfessorDetailParts(professor);
            return details.length
              ? `${professor.name} (${details.join(' • ')})`
              : professor.name;
          })
          .join(', ')}</span>`
      );
    }
  }

  if (disciplineId && professorId) {
    const selectedProfessor = getProfessorById(professorId);
    if (selectedProfessor && !professorHasDiscipline(selectedProfessor, disciplineId)) {
      suggestions.push(
        '<span class="suggestion-warning">Professor selecionado não está vinculado a esta disciplina.</span>'
      );
    }
  }

  periodConflicts.forEach((conflict) => {
    suggestions.push(`<span class="suggestion-warning">${conflict}</span>`);
  });

  elements.suggestions.innerHTML = suggestions.join('');
}

function getDisciplinesOrderedForProfessor(professorId) {
  const linkedIds = new Set();
  if (professorId) {
    const professor = getProfessorById(professorId);
    if (professor) {
      getProfessorDisciplineIds(professor).forEach((id) => linkedIds.add(id));
    }
  }
  const prioritized = [];
  const others = [];
  state.disciplines.forEach((discipline) => {
    const option = {
      id: discipline.id,
      label: formatDisciplineLabel(discipline),
      linked: linkedIds.has(discipline.id)
    };
    if (option.linked) {
      prioritized.push(option);
    } else {
      others.push(option);
    }
  });
  return [...prioritized, ...others];
}

function fillAssignmentDisciplineOptions(professorId) {
  if (!elements.assignmentDiscipline) return;
  const currentValue = elements.assignmentDiscipline.value;
  const options = getDisciplinesOrderedForProfessor(professorId);
  elements.assignmentDiscipline.innerHTML = '<option value="">Selecione</option>';
  options.forEach(({ id, label, linked }) => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    if (linked) {
      option.dataset.group = 'linked';
    }
    elements.assignmentDiscipline.appendChild(option);
  });
  const stillExists = options.some((option) => option.id === currentValue);
  elements.assignmentDiscipline.value = stillExists ? currentValue : '';
}

function populateModalSelects() {
  sortAllCollections();
  fillAssignmentDisciplineOptions(state.view === 'professor' ? state.selectedEntity : '');

  elements.assignmentPeriod.innerHTML = '<option value="">Selecione</option>';
  state.periods.forEach((period) => {
    const option = document.createElement('option');
    option.value = period.id;
    option.textContent = period.name;
    elements.assignmentPeriod.appendChild(option);
  });

  elements.assignmentProfessor.innerHTML = '<option value="">Selecione</option>';
  state.professors.forEach((professor) => {
    const option = document.createElement('option');
    option.value = professor.id;
    option.textContent = formatProfessorOptionLabel(professor);
    elements.assignmentProfessor.appendChild(option);
  });

  elements.assignmentRoom.innerHTML = '<option value="">Selecione</option>';
  state.rooms.forEach((room) => {
    const option = document.createElement('option');
    option.value = room.id;
    option.textContent = room.name;
    elements.assignmentRoom.appendChild(option);
  });
}

function prioritizeAssignmentDisciplines() {
  if (!elements.assignmentDiscipline) return;
  const professorId = elements.assignmentProfessor.value;
  fillAssignmentDisciplineOptions(professorId);
}

function updatePeriodByDiscipline() {
  const disciplineId = elements.assignmentDiscipline.value;
  if (!disciplineId) return;
  const discipline = getDisciplineById(disciplineId);
  if (!discipline) return;
  const periodId = discipline.periodId;
  elements.assignmentPeriod.value = periodId;
  if (state.view === 'period') {
    elements.assignmentPeriod.value = state.selectedEntity;
  }
}

function setStorageFeedback(message, variant = 'info') {
  const { storageFeedback } = elements;
  if (!storageFeedback) return;
  storageFeedback.textContent = message;
  storageFeedback.classList.remove('success', 'error', 'warning');
  if (variant && variant !== 'info' && message) {
    storageFeedback.classList.add(variant);
  }
}

function safeClone(value) {
  if (value === undefined || value === null) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    console.error('Erro ao clonar dados.', error);
    return value;
  }
}

function createConfigurationPackage(customState = null, customCounters = null) {
  const baseState = customState && typeof customState === 'object' ? customState : getPersistableSnapshot();
  const baseCounters = customCounters && typeof customCounters === 'object' ? customCounters : counters;
  return {
    state: safeClone(baseState),
    counters: safeClone(baseCounters)
  };
}

function normalizeConfigName(value) {
  return normalizeText(value || '');
}

function sortSavedConfigurations() {
  savedConfigurations.sort((a, b) => {
    const nameA = normalizeConfigName(a?.name);
    const nameB = normalizeConfigName(b?.name);
    if (nameA !== nameB) {
      return nameA.localeCompare(nameB);
    }
    const dateA = a?.savedAt || '';
    const dateB = b?.savedAt || '';
    return dateB.localeCompare(dateA);
  });
}

function sanitizeServerConfiguration(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = typeof entry.id === 'string' ? entry.id : '';
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  const savedAt = typeof entry.savedAt === 'string' && entry.savedAt ? entry.savedAt : new Date().toISOString();
  if (!id || !name) return null;
  const statePayload = entry.state && typeof entry.state === 'object' ? safeClone(entry.state) : null;
  if (!statePayload) return null;
  const countersPayload =
    entry.counters && typeof entry.counters === 'object' ? safeClone(entry.counters) : null;
  return {
    id,
    name,
    savedAt,
    state: statePayload,
    counters: countersPayload
  };
}

async function loadSavedConfigurationsFromServer(options = {}) {
  const { notify = false } = options;
  try {
    const response = await fetch(CONFIG_API_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    });
    if (!response.ok) {
      throw new Error(`Falha ao buscar configurações: ${response.status}`);
    }
    const data = await response.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    savedConfigurations = items.map(sanitizeServerConfiguration).filter(Boolean);
    sortSavedConfigurations();
    renderSavedConfigurations();
    if (notify) {
      setStorageFeedback('Lista de configurações carregada do servidor.', 'info');
    }
  } catch (error) {
    console.error('Erro ao carregar configurações do servidor.', error);
    savedConfigurations = [];
    renderSavedConfigurations();
    setStorageFeedback('Não foi possível carregar as configurações do servidor.', 'error');
  }
}

async function sendConfigurationRequest(method, suffix = '', body = null) {
  const url = suffix ? `${CONFIG_API_URL}/${encodeURIComponent(suffix)}` : CONFIG_API_URL;
  const options = {
    method,
    headers: {
      Accept: 'application/json'
    }
  };
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    const error = new Error(message || `Falha na requisição: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) {
    return null;
  }
  const data = await response.json();
  return data;
}

async function createServerConfigurationEntry(name, configuration) {
  const payload = {
    name,
    state: safeClone(configuration.state),
    counters:
      configuration.counters && typeof configuration.counters === 'object'
        ? safeClone(configuration.counters)
        : null
  };
  const data = await sendConfigurationRequest('POST', '', payload);
  return sanitizeServerConfiguration(data);
}

async function updateServerConfigurationEntry(id, name, configuration) {
  const payload = {
    name,
    state: safeClone(configuration.state),
    counters:
      configuration.counters && typeof configuration.counters === 'object'
        ? safeClone(configuration.counters)
        : null
  };
  const data = await sendConfigurationRequest('PUT', id, payload);
  return sanitizeServerConfiguration(data);
}

async function deleteServerConfigurationEntry(id) {
  await sendConfigurationRequest('DELETE', id);
}

function formatSavedConfigDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(date);
  } catch (error) {
    return date.toLocaleString('pt-BR');
  }
}

function renderSavedConfigurations() {
  const list = elements.savedConfigList;
  if (!list) return;
  list.innerHTML = '';

  if (!savedConfigurations.length) {
    const emptyItem = document.createElement('li');
    emptyItem.className = 'saved-config-empty';
    emptyItem.textContent = 'Nenhuma configuração salva no servidor.';
    list.appendChild(emptyItem);
    return;
  }

  savedConfigurations.forEach((config) => {
    const item = document.createElement('li');
    item.className = 'saved-config-item';

    const info = document.createElement('div');
    info.className = 'saved-config-info';

    const name = document.createElement('span');
    name.className = 'saved-config-name';
    name.textContent = config.name;
    info.appendChild(name);

    const metaText = formatSavedConfigDate(config.savedAt);
    if (metaText) {
      const meta = document.createElement('span');
      meta.className = 'saved-config-meta';
      meta.textContent = `Salvo em ${metaText}`;
      info.appendChild(meta);
    }

    const actions = document.createElement('div');
    actions.className = 'saved-config-actions';

    const loadButton = document.createElement('button');
    loadButton.type = 'button';
    loadButton.textContent = 'Carregar';
    loadButton.dataset.configAction = 'load';
    loadButton.dataset.configId = config.id;
    actions.appendChild(loadButton);

    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.textContent = 'Exportar';
    exportButton.dataset.configAction = 'export';
    exportButton.dataset.configId = config.id;
    actions.appendChild(exportButton);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Excluir';
    deleteButton.className = 'danger-outline';
    deleteButton.dataset.configAction = 'delete';
    deleteButton.dataset.configId = config.id;
    actions.appendChild(deleteButton);

    item.appendChild(info);
    item.appendChild(actions);
    list.appendChild(item);
  });
}

async function upsertSavedConfiguration(name, configuration, options = {}) {
  const { skipConfirmation = false, notify = true } = options;
  const trimmedName = (name || '').trim();
  if (!trimmedName) {
    if (notify) {
      setStorageFeedback('Informe um nome para salvar a configuração.', 'warning');
    }
    return 'cancelled';
  }

  const payload = configuration && typeof configuration === 'object' ? configuration : createConfigurationPackage();
  if (!payload?.state) {
    console.error('Tentativa de salvar configuração sem dados válidos.');
    if (notify) {
      setStorageFeedback('Não foi possível salvar a configuração informada.', 'error');
    }
    return 'error';
  }

  const normalized = normalizeConfigName(trimmedName);
  const existingIndex = savedConfigurations.findIndex(
    (entry) => normalizeConfigName(entry?.name) === normalized
  );

  if (existingIndex >= 0) {
    if (!skipConfirmation) {
      const confirmed = confirm(
        `Já existe uma configuração chamada "${trimmedName}". Deseja substituir o conteúdo salvo?`
      );
      if (!confirmed) {
        if (notify) {
          setStorageFeedback('Salvamento cancelado.', 'warning');
        }
        return 'cancelled';
      }
    }
    try {
      const updated = await updateServerConfigurationEntry(
        savedConfigurations[existingIndex].id,
        trimmedName,
        payload
      );
      if (!updated) {
        throw new Error('Resposta inválida do servidor.');
      }
      savedConfigurations[existingIndex] = updated;
    } catch (error) {
      console.error('Erro ao atualizar configuração no servidor.', error);
      if (notify) {
        setStorageFeedback('Não foi possível atualizar a configuração no servidor.', 'error');
      }
      return 'error';
    }
  } else {
    try {
      const created = await createServerConfigurationEntry(trimmedName, payload);
      if (!created) {
        throw new Error('Resposta inválida do servidor.');
      }
      savedConfigurations.push(created);
    } catch (error) {
      console.error('Erro ao criar configuração no servidor.', error);
      if (notify) {
        setStorageFeedback('Não foi possível salvar a configuração no servidor.', 'error');
      }
      return 'error';
    }
  }

  sortSavedConfigurations();
  renderSavedConfigurations();
  if (notify) {
    setStorageFeedback(`Configuração "${trimmedName}" salva no servidor.`, 'success');
  }
  return 'success';
}

async function handleSavedConfigurationsClick(event) {
  const target = event.target.closest('button[data-config-action]');
  if (!target) return;

  const action = target.dataset.configAction;
  const configId = target.dataset.configId;
  if (!action || !configId) return;

  const config = savedConfigurations.find((entry) => entry.id === configId);
  if (!config) {
    setStorageFeedback('Não foi possível localizar a configuração selecionada.', 'error');
    return;
  }

  if (action === 'load') {
    applyStateFromData(safeClone(config.state));
    if (config.counters && typeof config.counters === 'object') {
      counters = { ...counters, ...safeClone(config.counters) };
    } else {
      rebuildCounters();
    }
    persistState();
    setStorageFeedback(`Configuração "${config.name}" carregada com sucesso.`, 'success');
    return;
  }

  if (action === 'export') {
    exportConfiguration({ configuration: config });
    return;
  }

  if (action === 'delete') {
    const confirmed = confirm(`Deseja remover a configuração "${config.name}" do servidor?`);
    if (!confirmed) return;
    try {
      await deleteServerConfigurationEntry(configId);
      savedConfigurations = savedConfigurations.filter((entry) => entry.id !== configId);
      renderSavedConfigurations();
      setStorageFeedback(`Configuração "${config.name}" removida do servidor.`, 'warning');
    } catch (error) {
      console.error('Erro ao remover configuração do servidor.', error);
      setStorageFeedback('Não foi possível remover a configuração do servidor.', 'error');
    }
  }
}

async function handleConfigSaveSubmit(event) {
  event.preventDefault();
  const input = elements.configNameInput;
  const value = input ? input.value.trim() : '';
  const result = await upsertSavedConfiguration(value);
  if (result === 'success' && input) {
    input.value = '';
    input.focus();
  } else if (input) {
    input.focus();
  }
}

function getPersistableSnapshot() {
  return {
    periods: state.periods,
    professors: state.professors,
    rooms: state.rooms,
    disciplines: state.disciplines,
    schedule: state.schedule,
    view: state.view,
    selectedEntity: state.selectedEntity
  };
}

function persistState(options = {}) {
  const { notify = false } = options;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getPersistableSnapshot()));
    localStorage.setItem(COUNTERS_KEY, JSON.stringify(counters));
    if (notify) {
      setStorageFeedback('Configuração salva no navegador.', 'success');
    }
  } catch (error) {
    console.error('Erro ao salvar dados no navegador.', error);
    setStorageFeedback('Não foi possível salvar os dados localmente.', 'error');
  }
}

function nextCounterValue(list, prefix) {
  const base = `${prefix}-`;
  return (
    list.reduce((max, item) => {
      if (!item || typeof item.id !== 'string') return max;
      if (!item.id.startsWith(base)) return max;
      const numeric = parseInt(item.id.slice(base.length), 10);
      return Number.isFinite(numeric) && numeric > max ? numeric : max;
    }, 0) + 1
  );
}

function rebuildCounters() {
  counters = {
    period: nextCounterValue(state.periods, 'period'),
    professor: nextCounterValue(state.professors, 'professor'),
    room: nextCounterValue(state.rooms, 'room'),
    discipline: nextCounterValue(state.disciplines, 'discipline')
  };
}

function applyStateFromData(data) {
  if (!data || typeof data !== 'object') return;
  state.periods = Array.isArray(data.periods) ? data.periods : [];
  state.disciplines = Array.isArray(data.disciplines)
    ? data.disciplines.map((discipline) => ({
        ...discipline,
        code: typeof discipline?.code === 'string' ? discipline.code : '',
        color: typeof discipline?.color === 'string' ? discipline.color : ''
      }))
    : [];
  state.professors = Array.isArray(data.professors)
    ? data.professors
        .map((professor) => normalizeProfessorRecord(professor))
        .filter(Boolean)
        .map((professor) => ({
          ...professor,
          disciplineIds: getProfessorDisciplineIds(professor)
        }))
    : [];
  state.rooms = Array.isArray(data.rooms) ? data.rooms : [];
  state.schedule = data.schedule && typeof data.schedule === 'object' ? data.schedule : {};
  state.view = data.view || 'period';
  state.selectedEntity = data.selectedEntity || '';
  state.assignmentEditing = null;
  state.entityEditing = null;
  state.selectedSlots = new Set();
  state.multiSelectMode = false;
  elements.viewTypeSelect.value = state.view;
  professorFormDisciplineIds.clear();
  if (elements.professorDisciplineSelect) {
    elements.professorDisciplineSelect.value = '';
  }
  if (elements.professorAreaCheckbox) {
    elements.professorAreaCheckbox.checked = false;
  }
  renderProfessorFormDisciplineChips();
  ensureDisciplineColors();
  sortAllCollections();
  refreshLists();
  updateEntitySelector();
  updateSelectionUI();
}

function restoreStateFromStorage(options = {}) {
  const { notify = false } = options;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      if (notify) {
        setStorageFeedback('Nenhuma configuração salva encontrada.', 'warning');
      }
      return false;
    }
    const parsed = JSON.parse(stored);
    applyStateFromData(parsed);
    const counterRaw = localStorage.getItem(COUNTERS_KEY);
    if (counterRaw) {
      const parsedCounters = JSON.parse(counterRaw);
      counters = { ...counters, ...parsedCounters };
    } else {
      rebuildCounters();
    }
    persistState();
    if (notify) {
      setStorageFeedback('Configuração carregada do navegador.', 'success');
    }
    return true;
  } catch (error) {
    console.error('Erro ao carregar dados salvos.', error);
    setStorageFeedback('Não foi possível carregar os dados salvos.', 'error');
    return false;
  }
}

function exportConfiguration(options = {}) {
  const { configuration = null, suggestedName = '' } = options;
  try {
    const packageData = configuration
      ? {
          state: safeClone(configuration.state),
          counters:
            configuration.counters && typeof configuration.counters === 'object'
              ? safeClone(configuration.counters)
              : null
        }
      : createConfigurationPackage();

    const payload = {
      generatedAt: new Date().toISOString(),
      name: configuration?.name || suggestedName || '',
      savedAt: configuration?.savedAt || null,
      state: packageData.state,
      counters: packageData.counters
    };

    if (!payload.name) {
      delete payload.name;
    }
    if (!payload.savedAt) {
      delete payload.savedAt;
    }
    if (!payload.counters) {
      delete payload.counters;
    }

    const baseName = configuration?.name || suggestedName || 'cronograma';
    const normalized = normalizeConfigName(baseName);
    const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cronograma';
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const fileName = `${slug}-${timestamp}.json`;

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);

    if (configuration?.name) {
      setStorageFeedback(`Arquivo da configuração "${configuration.name}" exportado com sucesso.`, 'success');
    } else {
      setStorageFeedback('Arquivo JSON exportado com sucesso.', 'success');
    }
  } catch (error) {
    console.error('Erro ao exportar configuração.', error);
    setStorageFeedback('Não foi possível exportar os dados.', 'error');
  }
}

function handleImportFile(event) {
  const [file] = event.target.files;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (loadEvent) => {
    try {
      const text = loadEvent.target?.result;
      const parsed = JSON.parse(text);
      const payload = parsed.state && typeof parsed.state === 'object' ? parsed.state : parsed;
      const sanitizedState = payload && typeof payload === 'object' ? safeClone(payload) : {};
      applyStateFromData(sanitizedState);
      const importedCounters =
        parsed.counters && typeof parsed.counters === 'object' ? safeClone(parsed.counters) : null;
      if (importedCounters) {
        counters = { ...counters, ...importedCounters };
      } else {
        rebuildCounters();
      }
      persistState();

      const rawName =
        typeof parsed.name === 'string'
          ? parsed.name
          : typeof payload?.name === 'string'
          ? payload.name
          : '';
      const trimmedName = (rawName || '').trim();
      const fallbackName = trimmedName
        ? trimmedName
        : `Importado em ${formatSavedConfigDate(new Date().toISOString())}`;
      const result = await upsertSavedConfiguration(
        fallbackName,
        { state: sanitizedState, counters: importedCounters },
        { skipConfirmation: !trimmedName, notify: false }
      );

      if (result === 'success') {
        setStorageFeedback(`Configuração importada e salva como "${fallbackName}".`, 'success');
      } else if (result === 'cancelled') {
        setStorageFeedback('Configuração importada para edição atual.', 'success');
      } else {
        setStorageFeedback(
          'Configuração importada, mas não foi possível atualizar as configurações no servidor.',
          'warning'
        );
      }
    } catch (error) {
      console.error('Erro ao importar arquivo de configuração.', error);
      setStorageFeedback('Arquivo inválido. Verifique o conteúdo JSON.', 'error');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

function clearAllData() {
  const confirmed = confirm(
    'Tem certeza de que deseja limpar o cronograma atual? As configurações nomeadas permanecerão salvas no servidor.'
  );
  if (!confirmed) return;
  state.periods = [];
  state.professors = [];
  state.rooms = [];
  state.disciplines = [];
  state.schedule = {};
  state.view = 'period';
  state.selectedEntity = '';
  state.assignmentEditing = null;
  state.entityEditing = null;
  clearSelectedSlots();
  counters = { period: 1, professor: 1, room: 1, discipline: 1 };
  elements.viewTypeSelect.value = state.view;
  professorFormDisciplineIds.clear();
  if (elements.professorDisciplineSelect) {
    elements.professorDisciplineSelect.value = '';
  }
  if (elements.professorAreaCheckbox) {
    elements.professorAreaCheckbox.checked = false;
  }
  renderProfessorFormDisciplineChips();
  resetSearchFilters();
  refreshLists();
  updateEntitySelector();
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(COUNTERS_KEY);
  setStorageFeedback('Cronograma atual limpo. As configurações nomeadas continuam disponíveis no servidor.', 'warning');
}

function bindStorageControls() {
  if (elements.configSaveForm) {
    elements.configSaveForm.addEventListener('submit', handleConfigSaveSubmit);
  }
  if (elements.savedConfigList) {
    elements.savedConfigList.addEventListener('click', handleSavedConfigurationsClick);
  }
  if (elements.refreshConfigsButton) {
    elements.refreshConfigsButton.addEventListener('click', () => {
      loadSavedConfigurationsFromServer({ notify: true });
    });
  }
  if (elements.saveBrowserButton) {
    elements.saveBrowserButton.addEventListener('click', () => persistState({ notify: true }));
  }
  if (elements.restoreBrowserButton) {
    elements.restoreBrowserButton.addEventListener('click', () => restoreStateFromStorage({ notify: true }));
  }
  if (elements.exportButton) {
    elements.exportButton.addEventListener('click', () =>
      exportConfiguration({ suggestedName: elements.configNameInput?.value || '' })
    );
  }
  if (elements.importInput) {
    elements.importInput.addEventListener('change', handleImportFile);
  }
  if (elements.clearBrowserButton) {
    elements.clearBrowserButton.addEventListener('click', clearAllData);
  }
}

function bindManagementPanel() {
  if (!elements.managementPanel) return;

  menuButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const panelKey = button.dataset.panel;
      if (panelKey) {
        toggleManagementPanel(panelKey);
      }
    });
  });

  if (elements.panelClose) {
    elements.panelClose.addEventListener('click', () => {
      closeManagementPanel();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.managementPanel.classList.contains('hidden')) {
      closeManagementPanel();
    }
  });

  document.addEventListener('click', (event) => {
    const { managementPanel, entityMenu } = elements;
    if (!managementPanel || managementPanel.classList.contains('hidden')) return;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
    if (path && path.includes(managementPanel)) return;
    if (path && entityMenu && path.includes(entityMenu)) return;
    if (!path) {
      if (managementPanel.contains(event.target)) return;
      if (entityMenu && entityMenu.contains(event.target)) return;
    }
    closeManagementPanel();
  });
}

function bindSelectionControls() {
  const { toggleMultiSelect, editSelection, clearSelection } = elements;

  if (toggleMultiSelect) {
    toggleMultiSelect.addEventListener('click', () => {
      state.multiSelectMode = !state.multiSelectMode;
      updateSelectionUI();
    });
  }

  if (editSelection) {
    editSelection.addEventListener('click', () => {
      if (!state.selectedEntity) {
        alert('Selecione um item para editar o horário.');
        return;
      }
      if (!state.selectedSlots.size) {
        alert('Selecione ao menos um horário para editar.');
        return;
      }
      const slots = Array.from(state.selectedSlots).map(parseSlotKey);
      openAssignmentModalForSlots(slots);
    });
  }

  if (clearSelection) {
    clearSelection.addEventListener('click', () => {
      if (!state.selectedSlots.size) return;
      clearSelectedSlots({ preserveMode: true });
      renderSchedule();
    });
  }
}

function bindSearchFilters() {
  const mappings = [
    ['period', elements.periodSearch],
    ['professor', elements.professorSearch],
    ['room', elements.roomSearch],
    ['discipline', elements.disciplineSearch]
  ];

  mappings.forEach(([type, input]) => {
    if (!input) return;
    input.addEventListener('input', (event) => {
      searchQueries[type] = event.target.value;
      refreshLists();
    });
  });
}

function resetSearchFilters() {
  searchQueries.period = '';
  searchQueries.professor = '';
  searchQueries.room = '';
  searchQueries.discipline = '';

  if (elements.periodSearch) elements.periodSearch.value = '';
  if (elements.professorSearch) elements.professorSearch.value = '';
  if (elements.roomSearch) elements.roomSearch.value = '';
  if (elements.disciplineSearch) elements.disciplineSearch.value = '';
}

function bindForms() {
  elements.periodForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.getElementById('period-name');
    const name = input.value.trim();
    if (!name) return;
    state.periods.push({ id: generateId('period'), name });
    input.value = '';
    refreshLists();
    updateEntitySelector();
    persistState();
  });

  elements.professorForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.getElementById('professor-name');
    const name = input.value.trim();
    if (!name) return;
    const pendingSelection = elements.professorDisciplineSelect?.value;
    if (pendingSelection) {
      const exists = state.disciplines.some((discipline) => discipline.id === pendingSelection);
      if (exists) {
        professorFormDisciplineIds.add(pendingSelection);
        elements.professorDisciplineSelect.value = '';
        renderProfessorFormDisciplineChips();
      }
    }
    const selectedIds = sanitizeDisciplineIdList(Array.from(professorFormDisciplineIds));
    const validIds = selectedIds.filter((id) =>
      state.disciplines.some((discipline) => discipline.id === id)
    );
    const areaCheckbox = elements.professorAreaCheckbox;
    state.professors.push({
      id: generateId('professor'),
      name,
      disciplineIds: validIds,
      isCourseArea: Boolean(areaCheckbox?.checked)
    });
    input.value = '';
    professorFormDisciplineIds.clear();
    if (elements.professorDisciplineSelect) {
      elements.professorDisciplineSelect.value = '';
    }
    renderProfessorFormDisciplineChips();
    if (areaCheckbox) {
      areaCheckbox.checked = false;
    }
    refreshLists();
    updateEntitySelector();
    persistState();
  });

  elements.roomForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.getElementById('room-name');
    const name = input.value.trim();
    if (!name) return;
    state.rooms.push({ id: generateId('room'), name });
    input.value = '';
    refreshLists();
    updateEntitySelector();
    persistState();
  });

  elements.disciplineForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const nameInput = document.getElementById('discipline-name');
    const name = nameInput.value.trim();
    const period = elements.disciplinePeriodSelect.value;
    const codeValue = elements.disciplineCodeInput?.value.trim() || '';
    if (!name || !period) {
      alert('Informe o nome e selecione um período.');
      return;
    }
    if (isDuplicateDisciplineName(name)) {
      alert('Já existe uma disciplina com este nome.');
      return;
    }
    if (codeValue && isDuplicateDisciplineCode(codeValue)) {
      alert('Já existe uma disciplina com este código.');
      return;
    }
    const discipline = {
      id: generateId('discipline'),
      name,
      periodId: period,
      code: codeValue
    };
    assignColorToDiscipline(discipline);
    state.disciplines.push(discipline);
    nameInput.value = '';
    if (elements.disciplineCodeInput) {
      elements.disciplineCodeInput.value = '';
    }
    elements.disciplinePeriodSelect.value = '';
    refreshLists();
    persistState();
  });
}

elements.viewTypeSelect.addEventListener('change', (event) => {
  clearSelectedSlots();
  state.view = event.target.value;
  updateEntitySelector();
  persistState();
});

elements.entitySelector.addEventListener('change', (event) => {
  clearSelectedSlots({ preserveMode: true });
  state.selectedEntity = event.target.value;
  renderSchedule();
  persistState();
});

async function init() {
  await loadSavedConfigurationsFromServer();
  setupProfessorFormControls();
  bindForms();
  bindStorageControls();
  bindManagementPanel();
  bindSelectionControls();
  bindSearchFilters();
  resetSearchFilters();
  updateSelectionUI();
  setStorageFeedback('');
  const restored = restoreStateFromStorage();
  if (!restored) {
    refreshLists();
    elements.viewTypeSelect.value = state.view;
    updateEntitySelector();
  }
  updateSelectionUI();
}

function startApp() {
  init().catch((error) => {
    console.error('Falha durante a inicialização.', error);
    setStorageFeedback('Erro ao iniciar o aplicativo. Verifique a conexão com o servidor.', 'error');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
