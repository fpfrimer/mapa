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
  activeConfigurationId: '',
  activeConfigurationName: '',
  activeConfigurationStatus: 'idle',
  selectedSlots: new Set()
};

let counters = {
  period: 1,
  professor: 1,
  room: 1,
  discipline: 1
};

let savedConfigurations = [];

const ACTIVE_CONFIG_STATUS = {
  IDLE: 'idle',
  NEEDS_NAME: 'needs-name',
  DIRTY: 'dirty',
  SAVING: 'saving',
  SYNCED: 'synced',
  ERROR: 'error'
};

const ACTIVE_CONFIG_STATUS_VALUES = new Set(Object.values(ACTIVE_CONFIG_STATUS));
const ACTIVE_CONFIG_AUTOSAVE_DELAY = 5000;
let activeConfigAutosaveTimer = null;

const searchQueries = {
  period: '',
  professor: '',
  room: '',
  discipline: ''
};

const searchFilters = {
  professor: {
    onlyCourseArea: false
  },
  discipline: {
    periodId: ''
  },
  room: {
    periodId: ''
  }
};

let activePanelKey = null;

const SLOT_DRAG_THRESHOLD = 6;
let pendingSlotDrag = null;
let activeSlotDrag = null;
const suppressedSlotClickButtons = new WeakSet();

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

const DEFAULT_DISCIPLINE_COLOR = disciplineColorPalette[0] || '#2962ff';

const DARK_MODE_STORAGE_KEY = 'planner.darkMode';
const ICON_SPRITE_PATH = 'assets/icons/ui-icons.svg';

function createIcon(symbolId, additionalClass = '') {
  if (!symbolId) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const classNames = ['icon'];
  if (additionalClass) {
    classNames.push(additionalClass);
  }
  svg.setAttribute('class', classNames.join(' '));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  const reference = `${ICON_SPRITE_PATH}#${symbolId}`;
  use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', reference);
  use.setAttribute('href', reference);
  svg.appendChild(use);
  return svg;
}

function updateIconReference(svgElement, symbolId) {
  if (!svgElement || !symbolId) return;
  const use = svgElement.querySelector('use');
  if (!use) return;
  const reference = `${ICON_SPRITE_PATH}#${symbolId}`;
  use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', reference);
  use.setAttribute('href', reference);
}

function createVisuallyHiddenText(label) {
  const span = document.createElement('span');
  span.className = 'visually-hidden';
  span.textContent = label;
  return span;
}

function normalizeColorValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeHexColor(value) {
  const normalized = normalizeColorValue(value);
  if (!normalized) return '';
  const hexMatch = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(normalized);
  if (!hexMatch) return '';
  if (hexMatch[1].length === 3) {
    const expanded = hexMatch[1]
      .split('')
      .map((char) => `${char}${char}`)
      .join('');
    return `#${expanded.toLowerCase()}`;
  }
  return `#${hexMatch[1].toLowerCase()}`;
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

function getUsedDisciplineColors(periodId, ignoreDiscipline = null) {
  const normalizedPeriod = typeof periodId === 'string' ? periodId : '';
  const used = new Set();
  state.disciplines.forEach((item) => {
    if (!item || item === ignoreDiscipline) return;
    if ((item.periodId || '') !== normalizedPeriod) return;
    const color = normalizeHexColor(item.color);
    if (color) {
      used.add(color);
    }
  });
  return used;
}

function assignColorToDiscipline(discipline) {
  if (!discipline) return;
  const normalized = normalizeHexColor(discipline.color);
  if (normalized) {
    discipline.color = normalized;
    return;
  }
  const usedColors = getUsedDisciplineColors(discipline?.periodId || '', discipline);
  const color = pickDisciplineColor(usedColors) || DEFAULT_DISCIPLINE_COLOR;
  if (color) {
    discipline.color = color;
  }
}

function ensureDisciplineColors() {
  const usageMap = new Map();
  state.disciplines.forEach((discipline) => {
    if (!discipline) return;
    const periodId = typeof discipline.periodId === 'string' ? discipline.periodId : '';
    if (!usageMap.has(periodId)) {
      usageMap.set(periodId, new Set());
    }
    const used = usageMap.get(periodId);
    const normalized = normalizeHexColor(discipline.color);
    if (normalized) {
      discipline.color = normalized;
      used.add(normalized);
    }
  });

  state.disciplines.forEach((discipline) => {
    if (!discipline) return;
    const periodId = typeof discipline.periodId === 'string' ? discipline.periodId : '';
    if (!usageMap.has(periodId)) {
      usageMap.set(periodId, new Set());
    }
    const used = usageMap.get(periodId);
    const normalized = normalizeHexColor(discipline.color);
    if (normalized) return;
    const color = pickDisciplineColor(used) || DEFAULT_DISCIPLINE_COLOR;
    if (color) {
      discipline.color = color;
      used.add(color);
    }
  });
}

function loadDarkModePreference(defaultValue = false) {
  try {
    const stored = localStorage.getItem(DARK_MODE_STORAGE_KEY);
    if (stored === null) return defaultValue;
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return defaultValue;
  } catch (error) {
    console.warn('Não foi possível carregar a preferência de tema.', error);
    return defaultValue;
  }
}

function saveDarkModePreference(enabled) {
  try {
    localStorage.setItem(DARK_MODE_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch (error) {
    console.warn('Não foi possível salvar a preferência de tema.', error);
  }
}

function applyDarkMode(enabled) {
  const { darkModeToggle } = elements;
  document.body.classList.toggle('theme-dark', Boolean(enabled));
  if (!darkModeToggle) return;
  const icon = darkModeToggle.querySelector('.icon');
  const isEnabled = Boolean(enabled);
  darkModeToggle.setAttribute('aria-pressed', String(isEnabled));
  darkModeToggle.setAttribute(
    'aria-label',
    isEnabled ? 'Desativar modo noturno' : 'Ativar modo noturno'
  );
  darkModeToggle.setAttribute(
    'title',
    isEnabled ? 'Desativar modo noturno' : 'Ativar modo noturno'
  );
  if (icon) {
    updateIconReference(icon, isEnabled ? 'icon-sun' : 'icon-moon');
  }
}

function setupDarkModeToggle() {
  const { darkModeToggle } = elements;
  if (!darkModeToggle) return;
  const initialPreference = loadDarkModePreference();
  applyDarkMode(initialPreference);
  darkModeToggle.addEventListener('click', () => {
    const next = !document.body.classList.contains('theme-dark');
    applyDarkMode(next);
    saveDarkModePreference(next);
  });
}

function colorWithAlpha(color, alpha = 0.18) {
  const normalized = normalizeHexColor(color);
  if (!normalized) return '';
  const hex = normalized.slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some((component) => Number.isNaN(component))) {
    return '';
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function suggestDisciplineColor(periodId, ignoreDiscipline = null) {
  const used = getUsedDisciplineColors(periodId, ignoreDiscipline);
  return pickDisciplineColor(used) || DEFAULT_DISCIPLINE_COLOR;
}

function resetDisciplineColorInput() {
  const colorInput = elements?.disciplineColorInput;
  if (!colorInput) return;
  colorInput.dataset.userSelected = '';
  colorInput.dataset.suggestedColor = '';
  const fallback = normalizeHexColor(DEFAULT_DISCIPLINE_COLOR) || '#2962ff';
  if (fallback) {
    colorInput.value = fallback;
  }
}

function updateDisciplineColorSuggestion(options = {}) {
  const { force = false } = options;
  const colorInput = elements?.disciplineColorInput;
  const periodSelect = elements?.disciplinePeriodSelect;
  if (!colorInput || !periodSelect) return;
  if (force) {
    colorInput.dataset.userSelected = '';
  }
  const userSet = colorInput.dataset.userSelected === 'true';
  const periodId = periodSelect.value;
  const current = normalizeHexColor(colorInput.value);
  if (!periodId) {
    if (force || !userSet || !current) {
      const fallback = normalizeHexColor(DEFAULT_DISCIPLINE_COLOR) || current || '#2962ff';
      if (fallback) {
        colorInput.value = fallback;
        colorInput.dataset.suggestedColor = fallback;
      }
    }
    return;
  }
  if (force || !userSet || !current) {
    const suggestion = suggestDisciplineColor(periodId);
    if (suggestion) {
      colorInput.value = suggestion;
      colorInput.dataset.suggestedColor = suggestion;
    }
    return;
  }
  const previousSuggestion = normalizeHexColor(colorInput.dataset.suggestedColor || '');
  const nextSuggestion = suggestDisciplineColor(periodId);
  if (previousSuggestion && current === previousSuggestion && nextSuggestion && nextSuggestion !== current) {
    colorInput.value = nextSuggestion;
    colorInput.dataset.suggestedColor = nextSuggestion;
  }
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
  return professor.name || '';
}

const days = [
  { key: 'monday', label: 'Segunda' },
  { key: 'tuesday', label: 'Terça' },
  { key: 'wednesday', label: 'Quarta' },
  { key: 'thursday', label: 'Quinta' },
  { key: 'friday', label: 'Sexta' },
  { key: 'saturday', label: 'Sábado' }
];

const defaultDayShortLabels = {
  monday: 'Seg',
  tuesday: 'Ter',
  wednesday: 'Qua',
  thursday: 'Qui',
  friday: 'Sex',
  saturday: 'Sáb'
};

const dayLabelMap = days.reduce((acc, day) => {
  acc[day.key] = day.label;
  return acc;
}, {});

const dayShortLabelMap = days.reduce((acc, day) => {
  acc[day.key] = defaultDayShortLabels[day.key] || day.label.slice(0, 3);
  return acc;
}, {});

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
      { code: 'T1', time: '13:00 - 13:50' },
      { code: 'T2', time: '13:50 - 14:40' },
      { code: 'T3', time: '14:40 - 15:30' },
      { code: 'T4', time: '15:50 - 16:40' },
      { code: 'T5', time: '16:40 - 17:20' },
      { code: 'T6', time: '17:20 - 18:00' }
    ]
  },
  {
    name: 'Noite',
    key: 'noite',
    slots: [
      { code: 'N1', time: '18:40 - 19:30' },
      { code: 'N2', time: '19:30 - 20:20' },
      { code: 'N3', time: '20:20 - 21:10' },
      { code: 'N4', time: '21:20 - 22:10' },
      { code: 'N5', time: '22:10 - 23:00' },
      { code: 'N6', time: '--:-- - --:--0' }
    ]
  }
];

function parseTimeToMinutes(value) {
  if (!value) return NaN;
  const [hoursStr, minutesStr] = value.split(':');
  const hours = Number.parseInt(hoursStr, 10);
  const minutes = Number.parseInt(minutesStr, 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return NaN;
  }
  return hours * 60 + minutes;
}

function computeDurationFromRange(range) {
  if (!range) return 0;
  const [start, end] = range.split('-').map((part) => part.trim());
  if (!start || !end) return 0;
  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(end);
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
    return 0;
  }
  let duration = endMinutes - startMinutes;
  if (duration <= 0) {
    duration += 24 * 60;
  }
  return duration;
}

const slotDictionary = sessions.reduce((acc, session, sessionIndex) => {
  session.slots.forEach((slot, slotIndex) => {
    acc[slot.code] = {
      ...slot,
      sessionName: session.name,
      order: sessionIndex * 10 + slotIndex,
      durationMinutes: computeDurationFromRange(slot.time)
    };
  });
  return acc;
}, {});

const fallbackSlotDurationMinutes = 50;

const slotsPerDay = sessions.reduce((total, session) => total + session.slots.length, 0);
const totalWeeklySlots = slotsPerDay * days.length;

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
  disciplineNameInput: document.getElementById('discipline-name'),
  disciplineCodeInput: document.getElementById('discipline-code'),
  disciplineHoursInput: document.getElementById('discipline-hours'),
  disciplineColorInput: document.getElementById('discipline-color'),
  periodList: document.getElementById('period-list'),
  professorList: document.getElementById('professor-list'),
  roomList: document.getElementById('room-list'),
  disciplineList: document.getElementById('discipline-list'),
  professorDisciplineSelect: document.getElementById('professor-discipline'),
  professorDisciplineAdd: document.getElementById('professor-discipline-add'),
  professorDisciplineList: document.getElementById('professor-discipline-list'),
  professorAreaCheckbox: document.getElementById('professor-area'),
  professorAreaFilter: document.getElementById('professor-filter-area'),
  entityMenu: document.querySelector('.entity-menu'),
  menuButtons: document.querySelectorAll('.menu-button[data-panel]'),
  managementPanel: document.getElementById('management-panel'),
  panelTitle: document.getElementById('panel-title'),
  panelClose: document.querySelector('.panel-close'),
  panelSections: document.querySelectorAll('#management-panel .panel-section'),
  periodSearch: document.getElementById('period-search'),
  professorSearch: document.getElementById('professor-search'),
  roomSearch: document.getElementById('room-search'),
  disciplineSearch: document.getElementById('discipline-search'),
  disciplinePeriodSelect: document.getElementById('discipline-period'),
  disciplinePeriodFilter: document.getElementById('discipline-filter-period'),
  roomPeriodFilter: document.getElementById('room-filter-period'),
  viewTypeSelect: document.getElementById('view-type'),
  entitySelector: document.getElementById('entity-selector'),
  scheduleContainer: document.getElementById('schedule-container'),
  scheduleTitle: document.getElementById('schedule-title'),
  toggleMultiSelect: document.getElementById('toggle-multi-select'),
  selectionSummary: document.getElementById('selection-summary'),
  editSelection: document.getElementById('edit-selection'),
  clearSelection: document.getElementById('clear-selection'),
  activeConfigName: document.getElementById('active-config-name'),
  activeConfigStatus: document.getElementById('active-config-status'),
  quickSaveButton: document.getElementById('quick-save-config'),
  viewSummary: document.getElementById('view-summary'),
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
  storageFeedback: document.getElementById('storage-feedback'),
  darkModeToggle: document.getElementById('dark-mode-toggle')
};

function clearRelatedHighlights() {
  const { scheduleContainer } = elements;
  if (!scheduleContainer) return;
  scheduleContainer
    .querySelectorAll('.slot-cell.is-related-origin, .slot-cell.is-related-match')
    .forEach((cell) => {
      cell.classList.remove('is-related-origin', 'is-related-match');
    });
}

function highlightRelatedDisciplines(disciplineIds, originCell) {
  if (!Array.isArray(disciplineIds) || disciplineIds.length === 0) {
    clearRelatedHighlights();
    return;
  }
  const { scheduleContainer } = elements;
  if (!scheduleContainer) return;
  const idSet = new Set(disciplineIds);
  clearRelatedHighlights();
  scheduleContainer.querySelectorAll('.slot-cell[data-discipline-ids]').forEach((cell) => {
    const ids = cell.dataset.disciplineIds
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!ids?.length) return;
    if (ids.some((id) => idSet.has(id))) {
      if (cell === originCell) {
        cell.classList.add('is-related-origin');
      } else {
        cell.classList.add('is-related-match');
      }
    }
  });
}

const menuButtons = Array.from(elements.menuButtons || []);
const panelSections = Array.from(elements.panelSections || []);

function normalizeActiveConfigurationStatus(value) {
  return ACTIVE_CONFIG_STATUS_VALUES.has(value) ? value : ACTIVE_CONFIG_STATUS.IDLE;
}

function getActiveConfigurationStatusText() {
  const status = normalizeActiveConfigurationStatus(state.activeConfigurationStatus);
  switch (status) {
    case ACTIVE_CONFIG_STATUS.SAVING:
      return 'Sincronizando…';
    case ACTIVE_CONFIG_STATUS.SYNCED:
      return 'Sincronizada.';
    case ACTIVE_CONFIG_STATUS.DIRTY:
      return 'Alterações pendentes de sincronização.';
    case ACTIVE_CONFIG_STATUS.ERROR:
      return 'Falha ao sincronizar.';
    case ACTIVE_CONFIG_STATUS.NEEDS_NAME:
      return state.activeConfigurationName
        ? 'Salve manualmente para ativar a sincronização automática.'
        : 'Defina um nome para habilitar a sincronização automática.';
    case ACTIVE_CONFIG_STATUS.IDLE:
    default:
      return state.activeConfigurationName ? 'Configuração ativa pronta para edição.' : 'Nenhuma configuração ativa.';
  }
}

function updateActiveConfigurationDisplay() {
  const { activeConfigName, activeConfigStatus, quickSaveButton } = elements;
  const status = normalizeActiveConfigurationStatus(state.activeConfigurationStatus);
  const hasName = Boolean(state.activeConfigurationName);

  if (activeConfigName) {
    activeConfigName.textContent = hasName ? state.activeConfigurationName : 'Sem nome';
    activeConfigName.classList.toggle('is-placeholder', !hasName);
  }

  if (activeConfigStatus) {
    const baseClass = 'active-config-status';
    activeConfigStatus.textContent = getActiveConfigurationStatusText();
    activeConfigStatus.className = `${baseClass} ${baseClass}--${status}`;
  }

  if (quickSaveButton) {
    const isSaving = status === ACTIVE_CONFIG_STATUS.SAVING;
    quickSaveButton.disabled = isSaving;
    quickSaveButton.textContent = isSaving ? 'Sincronizando…' : 'Sincronizar';
    quickSaveButton.setAttribute('aria-busy', isSaving ? 'true' : 'false');
    quickSaveButton.title = hasName
      ? 'Sincronizar configuração ativa com o servidor'
      : 'Defina um nome para salvar esta configuração';
  }
}

function updateActiveConfigurationStatus(status, options = {}) {
  const normalized = normalizeActiveConfigurationStatus(status);
  const { force = false } = options;
  if (!force && state.activeConfigurationStatus === normalized) {
    return;
  }
  state.activeConfigurationStatus = normalized;
  if (
    normalized === ACTIVE_CONFIG_STATUS.SYNCED ||
    normalized === ACTIVE_CONFIG_STATUS.IDLE ||
    normalized === ACTIVE_CONFIG_STATUS.ERROR ||
    normalized === ACTIVE_CONFIG_STATUS.NEEDS_NAME
  ) {
    clearActiveConfigurationAutosave();
  }
  updateActiveConfigurationDisplay();
}

function activateConfigurationEntry(entry, options = {}) {
  if (!entry) return;
  const id = typeof entry.id === 'string' ? entry.id : '';
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  state.activeConfigurationId = id;
  state.activeConfigurationName = name;
  const targetStatus =
    typeof options.status === 'string'
      ? options.status
      : id && name
      ? ACTIVE_CONFIG_STATUS.SYNCED
      : ACTIVE_CONFIG_STATUS.IDLE;
  updateActiveConfigurationStatus(targetStatus, { force: true });
  updateActiveConfigurationDisplay();
}

function resetActiveConfiguration(options = {}) {
  state.activeConfigurationId = '';
  state.activeConfigurationName = '';
  const targetStatus =
    typeof options.status === 'string' ? options.status : ACTIVE_CONFIG_STATUS.IDLE;
  updateActiveConfigurationStatus(targetStatus, { force: true });
  updateActiveConfigurationDisplay();
}

function clearActiveConfigurationAutosave() {
  if (activeConfigAutosaveTimer) {
    clearTimeout(activeConfigAutosaveTimer);
    activeConfigAutosaveTimer = null;
  }
}

function scheduleActiveConfigurationAutosave() {
  if (!state.activeConfigurationName || !state.activeConfigurationId) {
    return;
  }
  if (state.activeConfigurationStatus === ACTIVE_CONFIG_STATUS.SAVING) {
    return;
  }
  clearActiveConfigurationAutosave();
  activeConfigAutosaveTimer = setTimeout(() => {
    autoSaveActiveConfiguration();
  }, ACTIVE_CONFIG_AUTOSAVE_DELAY);
}

async function autoSaveActiveConfiguration() {
  clearActiveConfigurationAutosave();
  if (!state.activeConfigurationName || !state.activeConfigurationId) {
    updateActiveConfigurationStatus(ACTIVE_CONFIG_STATUS.NEEDS_NAME, { force: true });
    return;
  }

  const previousStatus = state.activeConfigurationStatus;
  updateActiveConfigurationStatus(ACTIVE_CONFIG_STATUS.SAVING, { force: true });

  try {
    const result = await upsertSavedConfiguration(state.activeConfigurationName, null, {
      skipConfirmation: true,
      notify: false
    });
    if (result === 'success') {
      updateActiveConfigurationStatus(ACTIVE_CONFIG_STATUS.SYNCED, { force: true });
      if (previousStatus !== ACTIVE_CONFIG_STATUS.SYNCED) {
        setStorageFeedback(`Configuração "${state.activeConfigurationName}" sincronizada automaticamente.`, 'success');
      }
    } else if (result === 'error') {
      updateActiveConfigurationStatus(ACTIVE_CONFIG_STATUS.ERROR, { force: true });
      setStorageFeedback('Não foi possível sincronizar a configuração ativa automaticamente.', 'error');
    } else {
      updateActiveConfigurationStatus(ACTIVE_CONFIG_STATUS.DIRTY, { force: true });
    }
  } catch (error) {
    console.error('Erro durante a sincronização automática.', error);
    updateActiveConfigurationStatus(ACTIVE_CONFIG_STATUS.ERROR, { force: true });
    setStorageFeedback('Não foi possível sincronizar a configuração ativa automaticamente.', 'error');
  }
}

function markActiveConfigurationDirty() {
  if (!state.activeConfigurationName) {
    if (state.activeConfigurationStatus !== ACTIVE_CONFIG_STATUS.NEEDS_NAME) {
      updateActiveConfigurationStatus(ACTIVE_CONFIG_STATUS.NEEDS_NAME, { force: true });
      setStorageFeedback('Nomeie a configuração atual para habilitar a sincronização automática.', 'warning');
    }
    return;
  }

  if (!state.activeConfigurationId) {
    if (state.activeConfigurationStatus !== ACTIVE_CONFIG_STATUS.NEEDS_NAME) {
      updateActiveConfigurationStatus(ACTIVE_CONFIG_STATUS.NEEDS_NAME, { force: true });
      setStorageFeedback('Salve a configuração nomeada manualmente para ativar a sincronização automática.', 'warning');
    }
    return;
  }

  if (state.activeConfigurationStatus === ACTIVE_CONFIG_STATUS.SAVING) {
    return;
  }

  updateActiveConfigurationStatus(ACTIVE_CONFIG_STATUS.DIRTY, { force: true });
  scheduleActiveConfigurationAutosave();
}

updateActiveConfigurationDisplay();

function normalizeText(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

function roomHasAssignmentsInPeriod(roomId, periodId) {
  if (!roomId || !periodId) return false;
  const schedule = state.schedule?.[periodId];
  if (!schedule || typeof schedule !== 'object') return false;
  return Object.values(schedule).some((entry) => entry && entry.roomId === roomId);
}

function matchesSearchQuery(item, type, query, filters = {}) {
  const normalizedQuery = typeof query === 'string' ? query : '';
  let matchesText = true;

  if (normalizedQuery) {
    matchesText = false;
    const name = normalizeText(item?.name || '');
    if (name.includes(normalizedQuery)) {
      matchesText = true;
    }

    if (!matchesText && type === 'professor') {
      const labels = getProfessorDisciplineLabels(item || {});
      matchesText = labels.some((label) => normalizeText(label).includes(normalizedQuery));
    }

    if (!matchesText && type === 'discipline') {
      const code = normalizeText(item?.code || '');
      if (code && code.includes(normalizedQuery)) {
        matchesText = true;
      }
    }

    if (!matchesText && type === 'discipline') {
      const period = getPeriodById(item?.periodId);
      if (period && normalizeText(period.name).includes(normalizedQuery)) {
        matchesText = true;
      }
    }
  }

  if (!matchesText) {
    return false;
  }

  if (type === 'professor' && filters.onlyCourseArea) {
    return Boolean(item?.isCourseArea);
  }

  if (type === 'discipline' && filters.periodId) {
    return (item?.periodId || '') === filters.periodId;
  }

  if (type === 'room' && filters.periodId) {
    return roomHasAssignmentsInPeriod(item?.id, filters.periodId);
  }

  return true;
}

const searchableDropdowns = new Map();

class SearchableDropdown {
  constructor(select, container, config = {}) {
    this.select = select;
    this.container = container;
    this.input = container?.querySelector('.searchable-input') || null;
    this.toggle = container?.querySelector('.searchable-toggle') || null;
    this.list = container?.querySelector('.searchable-options') || null;
    this.options = [];
    this.filteredOptions = [];
    this.highlightedIndex = -1;
    this.searchTerm = '';
    this.placeholder = config.placeholder || '';

    this.handleDocumentClick = this.handleDocumentClick.bind(this);
    this.handleInputFocus = this.handleInputFocus.bind(this);
    this.handleInputBlur = this.handleInputBlur.bind(this);
    this.handleInput = this.handleInput.bind(this);
    this.handleKeydown = this.handleKeydown.bind(this);
    this.handleToggle = this.handleToggle.bind(this);

    if (this.select) {
      this.select.classList.add('searchable-native');
      this.select.setAttribute('tabindex', '-1');
      this.select.setAttribute('aria-hidden', 'true');
    }

    if (this.input) {
      if (this.placeholder && !this.input.placeholder) {
        this.input.placeholder = this.placeholder;
      }
      this.input.setAttribute('role', 'combobox');
      this.input.setAttribute('aria-autocomplete', 'list');
      this.input.setAttribute('aria-expanded', 'false');
    }

    if (this.toggle) {
      this.toggle.setAttribute('aria-expanded', 'false');
    }

    if (this.list && this.input) {
      if (!this.list.id) {
        this.list.id = `${this.select.id}-listbox`;
      }
      this.list.setAttribute('role', this.list.getAttribute('role') || 'listbox');
      this.input.setAttribute('aria-controls', this.list.id);
    }

    this.attachEvents();
    this.syncOptions();
    this.updateDisabledState();
  }

  attachEvents() {
    if (this.input) {
      this.input.addEventListener('focus', this.handleInputFocus);
      this.input.addEventListener('blur', this.handleInputBlur);
      this.input.addEventListener('input', this.handleInput);
      this.input.addEventListener('keydown', this.handleKeydown);
    }
    if (this.toggle) {
      this.toggle.addEventListener('click', this.handleToggle);
    }
  }

  isOpen() {
    return this.container?.classList.contains('open');
  }

  handleToggle(event) {
    event.preventDefault();
    if (!this.input) return;
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
      this.input.focus();
    }
  }

  handleInputFocus() {
    this.open();
    if (this.input && typeof this.input.select === 'function') {
      requestAnimationFrame(() => {
        this.input.select();
      });
    }
  }

  handleInputBlur() {
    setTimeout(() => {
      this.close();
    }, 100);
  }

  handleInput(event) {
    this.filterOptions(event.target.value || '');
  }

  handleKeydown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!this.isOpen()) this.open();
      this.moveHighlight(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.isOpen()) this.open();
      this.moveHighlight(-1);
    } else if (event.key === 'Enter') {
      if (this.isOpen() && this.highlightedIndex >= 0) {
        event.preventDefault();
        const option = this.filteredOptions[this.highlightedIndex];
        if (option && !option.disabled) {
          this.selectValue(option.value);
        }
      }
    } else if (event.key === 'Escape') {
      if (this.isOpen()) {
        event.preventDefault();
        this.close();
        this.input?.blur();
      }
    }
  }

  handleDocumentClick(event) {
    if (!this.container?.contains(event.target)) {
      this.close();
    }
  }

  open() {
    if (!this.container || this.isOpen()) return;
    this.container.classList.add('open');
    this.toggle?.setAttribute('aria-expanded', 'true');
    this.input?.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', this.handleDocumentClick);
    this.filterOptions(this.input?.value || '');
  }

  close() {
    if (!this.container || !this.isOpen()) return;
    this.container.classList.remove('open');
    this.toggle?.setAttribute('aria-expanded', 'false');
    this.input?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', this.handleDocumentClick);
    this.searchTerm = '';
    this.highlightedIndex = -1;
    this.refreshInputDisplay();
  }

  syncOptions({ preserveSearch = false } = {}) {
    if (!this.select) return;
    const term = preserveSearch ? this.searchTerm : '';
    this.options = Array.from(this.select.options || []).map((option) => ({
      value: option.value,
      label: option.textContent || '',
      disabled: option.disabled,
      dataset: { ...option.dataset }
    }));
    if (this.isOpen()) {
      this.filterOptions(term);
    } else {
      this.filteredOptions = [...this.options];
      this.highlightedIndex = -1;
      if (!preserveSearch) {
        this.searchTerm = '';
      }
    }
    this.refreshInputDisplay();
    this.updateDisabledState();
  }

  refreshInputDisplay() {
    if (!this.input) return;
    const selected = this.options.find((option) => option.value === this.select?.value);
    const label = selected ? selected.label : '';
    this.input.value = label;
    this.input.setAttribute('data-current-label', label || '');
  }

  filterOptions(term) {
    this.searchTerm = term || '';
    const normalized = normalizeText(this.searchTerm);
    this.filteredOptions = this.options.filter((option) => {
      if (!normalized) return true;
      return normalizeText(option.label).includes(normalized);
    });
    if (this.filteredOptions.length) {
      const selectedIndex = this.filteredOptions.findIndex(
        (option) => option.value === this.select?.value && !option.disabled
      );
      if (selectedIndex !== -1) {
        this.highlightedIndex = selectedIndex;
      } else {
        this.highlightedIndex = this.filteredOptions.findIndex((option) => !option.disabled);
      }
    } else {
      this.highlightedIndex = -1;
    }
    this.renderOptions();
  }

  renderOptions() {
    if (!this.list) return;
    this.list.innerHTML = '';
    if (!this.filteredOptions.length) {
      const empty = document.createElement('li');
      empty.className = 'searchable-empty';
      empty.textContent = 'Nenhum resultado';
      this.list.appendChild(empty);
      return;
    }
    this.filteredOptions.forEach((option, index) => {
      const item = document.createElement('li');
      item.className = 'searchable-option';
      if (option.value === '') item.classList.add('is-placeholder');
      if (option.dataset?.available === 'true') item.classList.add('is-available');
      if (option.dataset?.group === 'linked') item.classList.add('is-linked');
      if (option.disabled) item.classList.add('is-disabled');
      if (option.value === this.select?.value) item.classList.add('is-selected');
      if (index === this.highlightedIndex) item.classList.add('is-highlighted');
      item.setAttribute('role', 'option');
      item.dataset.value = option.value;
      item.textContent = option.label || '';
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        if (option.disabled) return;
        this.selectValue(option.value);
      });
      this.list.appendChild(item);
    });
    this.scrollToHighlighted();
  }

  scrollToHighlighted() {
    if (!this.list) return;
    const items = Array.from(this.list.querySelectorAll('.searchable-option'));
    if (!items.length || this.highlightedIndex < 0 || this.highlightedIndex >= items.length) return;
    const target = items[this.highlightedIndex];
    if (target?.scrollIntoView) {
      target.scrollIntoView({ block: 'nearest' });
    }
  }

  moveHighlight(step) {
    if (!this.filteredOptions.length) return;
    let index = this.highlightedIndex;
    const total = this.filteredOptions.length;
    for (let i = 0; i < total; i += 1) {
      index = (index + step + total) % total;
      const option = this.filteredOptions[index];
      if (option && !option.disabled) {
        this.highlightedIndex = index;
        this.updateHighlightClasses();
        break;
      }
    }
  }

  updateHighlightClasses() {
    if (!this.list) return;
    const items = Array.from(this.list.querySelectorAll('.searchable-option'));
    items.forEach((item, idx) => {
      if (idx === this.highlightedIndex) {
        item.classList.add('is-highlighted');
        if (item.scrollIntoView) {
          item.scrollIntoView({ block: 'nearest' });
        }
      } else {
        item.classList.remove('is-highlighted');
      }
    });
  }

  selectValue(value) {
    if (!this.select) return;
    const previous = this.select.value;
    this.select.value = value || '';
    this.refreshInputDisplay();
    if (previous !== value) {
      this.select.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      this.select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.close();
  }

  updateFromSelect() {
    this.refreshInputDisplay();
    if (this.isOpen()) {
      this.filterOptions(this.searchTerm);
    }
  }

  setValue(value) {
    if (!this.select) return;
    this.select.value = value || '';
    this.updateFromSelect();
  }

  updateDisabledState() {
    const disabled = Boolean(this.select?.disabled);
    if (!this.container) return;
    if (disabled) {
      this.close();
    }
    this.container.classList.toggle('is-disabled', disabled);
    if (this.input) {
      this.input.disabled = disabled;
      this.input.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    }
    if (this.toggle) {
      this.toggle.disabled = disabled;
      this.toggle.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    }
  }

  setDisabled(disabled) {
    if (this.select) {
      this.select.disabled = Boolean(disabled);
    }
    this.updateDisabledState();
  }
}

function registerSearchableDropdown(selectId, config = {}) {
  const select = document.getElementById(selectId);
  const container = document.querySelector(`.searchable-select[data-select="${selectId}"]`);
  if (!select || !container) return null;
  const dropdown = new SearchableDropdown(select, container, config);
  searchableDropdowns.set(selectId, dropdown);
  return dropdown;
}

function syncSearchableDropdownOptions(selectElement) {
  if (!selectElement) return;
  const dropdown = searchableDropdowns.get(selectElement.id);
  if (dropdown) {
    dropdown.syncOptions({ preserveSearch: dropdown.isOpen() });
  }
}

function updateSearchableDropdownValue(selectElement, value) {
  if (!selectElement) return;
  const dropdown = searchableDropdowns.get(selectElement.id);
  if (dropdown) {
    dropdown.setValue(value || '');
  } else {
    selectElement.value = value || '';
  }
}

function setSearchableDropdownDisabled(selectElement, disabled) {
  if (!selectElement) return;
  selectElement.disabled = Boolean(disabled);
  const dropdown = searchableDropdowns.get(selectElement.id);
  if (dropdown) {
    dropdown.setDisabled(disabled);
  }
}

function normalizeCode(value) {
  return normalizeText(value || '');
}

function normalizeRequiredSlots(value) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return numeric;
}

let latestDisciplineUsage = {};

function computeDisciplineUsage() {
  const counts = new Map();
  Object.values(state.schedule || {}).forEach((slots) => {
    Object.values(slots || {}).forEach((entry) => {
      if (!entry || !entry.disciplineId) return;
      const current = counts.get(entry.disciplineId) || 0;
      counts.set(entry.disciplineId, current + 1);
    });
  });

  const usage = {};
  state.disciplines.forEach((discipline) => {
    if (!discipline) return;
    const required = normalizeRequiredSlots(discipline.requiredSlots);
    const actual = counts.get(discipline.id) || 0;
    const missing = required > 0 ? Math.max(required - actual, 0) : 0;
    const excess = required > 0 ? Math.max(actual - required, 0) : 0;
    usage[discipline.id] = { required, actual, missing, excess };
  });

  latestDisciplineUsage = usage;
  return usage;
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

function buildScheduleHeading() {
  if (!state.selectedEntity) {
    return 'Selecione um item para visualizar o cronograma';
  }

  if (state.view === 'period') {
    const period = getPeriodById(state.selectedEntity);
    if (period) {
      return `Cronograma do período ${period.name}`;
    }
  } else if (state.view === 'professor') {
    const professor = getProfessorById(state.selectedEntity);
    if (professor) {
      return `Cronograma do docente ${professor.name}`;
    }
  } else if (state.view === 'room') {
    const room = getRoomById(state.selectedEntity);
    if (room) {
      return `Cronograma da sala ${room.name}`;
    }
  }

  return 'Cronograma selecionado';
}

function updateScheduleTitle() {
  const { scheduleTitle } = elements;
  if (!scheduleTitle) return;

  const heading = buildScheduleHeading();
  scheduleTitle.textContent = heading;

  const isPlaceholder = !state.selectedEntity;
  scheduleTitle.classList.toggle('is-muted', isPlaceholder);
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
  const filters = searchFilters[type] || {};
  const disciplineUsage = type === 'discipline' ? computeDisciplineUsage() : null;
  const filtered = list
    .map((item) => {
      const isEditing =
        state.entityEditing && state.entityEditing.type === type && state.entityEditing.id === item.id;
      return { item, isEditing };
    })
    .filter(({ item, isEditing }) => {
      if (isEditing) return true;
      return matchesSearchQuery(item, type, query, filters);
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
    let usage = null;
    if (type === 'discipline' && disciplineUsage) {
      usage = disciplineUsage[item.id] || null;
      if (usage && usage.required > 0) {
        if (usage.missing > 0) {
          li.classList.add('discipline-underloaded');
        } else if (usage.excess > 0) {
          li.classList.add('discipline-overloaded');
        }
      }
    }

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
      let requiredInput = null;
      let colorInput = null;
      if (type === 'discipline') {
        codeInput = document.createElement('input');
        codeInput.type = 'text';
        codeInput.placeholder = 'Código (opcional)';
        codeInput.value = item.code || '';
        form.appendChild(codeInput);

        requiredInput = document.createElement('input');
        requiredInput.type = 'number';
        requiredInput.min = '0';
        requiredInput.placeholder = 'Qtd. de horários (opcional)';
        requiredInput.value = item.requiredSlots ? String(item.requiredSlots) : '';
        form.appendChild(requiredInput);

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

        colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.id = `discipline-color-${item.id}`;
        const existingColor = normalizeHexColor(item.color);
        const suggestedColor = suggestDisciplineColor(item.periodId, item);
        const fallbackColor = existingColor || suggestedColor || normalizeHexColor(DEFAULT_DISCIPLINE_COLOR) || '#2962ff';
        colorInput.value = fallbackColor;
        colorInput.dataset.suggestedColor = existingColor || suggestedColor || fallbackColor;
        colorInput.addEventListener('input', () => {
          colorInput.dataset.userSelected = 'true';
        });

        const colorField = document.createElement('label');
        colorField.className = 'color-picker-field';
        colorField.setAttribute('for', colorInput.id);
        const colorLabel = document.createElement('span');
        colorLabel.textContent = 'Cor';
        colorField.appendChild(colorLabel);
        colorField.appendChild(colorInput);
        form.appendChild(colorField);

        form.appendChild(periodSelect);

        periodSelect.addEventListener('change', () => {
          const suggestion = suggestDisciplineColor(periodSelect.value, item);
          if (suggestion) {
            colorInput.value = suggestion;
            colorInput.dataset.suggestedColor = suggestion;
            colorInput.dataset.userSelected = '';
          }
        });
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
        checkboxText.textContent = 'Docente da área do curso';
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
          updates.requiredSlots = normalizeRequiredSlots(requiredInput?.value || 0);
          const selectedPeriod = periodSelect?.value || '';
          if (!selectedPeriod) {
            alert('Selecione um período para a disciplina.');
            return;
          }
          updates.color = normalizeHexColor(colorInput?.value || '');
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
        const periodMeta = document.createElement('span');
        periodMeta.className = 'entity-meta';
        periodMeta.textContent = period ? period.name : 'Sem período';
        info.appendChild(periodMeta);

        if (usage) {
          const usageMeta = document.createElement('span');
          usageMeta.className = 'entity-meta';
          if (usage.required > 0) {
            usageMeta.textContent = `Horários atribuídos: ${usage.actual} de ${usage.required}`;
          } else {
            usageMeta.textContent = `Horários atribuídos: ${usage.actual}`;
          }
          info.appendChild(usageMeta);

          if (usage.required > 0) {
            if (usage.missing > 0) {
              const badge = document.createElement('span');
              badge.className = 'entity-badge warning';
              badge.textContent = `Faltam ${usage.missing}`;
              info.appendChild(badge);
            } else if (usage.excess > 0) {
              const badge = document.createElement('span');
              badge.className = 'entity-badge danger';
              badge.textContent = `Excesso de ${usage.excess}`;
              info.appendChild(badge);
            } else {
              const badge = document.createElement('span');
              badge.className = 'entity-badge success';
              badge.textContent = 'Carga atendida';
              info.appendChild(badge);
            }
          }
        }
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
      const editIcon = createIcon('icon-edit', 'icon--toolbar');
      if (editIcon) {
        editButton.appendChild(editIcon);
      }
      editButton.appendChild(createVisuallyHiddenText('Editar'));
      editButton.title = 'Editar';
      editButton.addEventListener('click', () => startEntityEditing(type, item.id));
      actions.appendChild(editButton);

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'icon-button danger';
      const removeIcon = createIcon('icon-delete', 'icon--toolbar');
      if (removeIcon) {
        removeButton.appendChild(removeIcon);
      }
      removeButton.appendChild(createVisuallyHiddenText('Remover'));
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
  const addIcon = createIcon('icon-add', 'icon--small');
  if (addIcon) {
    addButton.appendChild(addIcon);
  }
  addButton.appendChild(createVisuallyHiddenText('Adicionar disciplina'));

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
        const removeIcon = createIcon('icon-remove', 'icon--small');
        if (removeIcon) {
          removeButton.appendChild(removeIcon);
        }
        removeButton.appendChild(createVisuallyHiddenText('Remover disciplina'));
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
      const removeIcon = createIcon('icon-remove', 'icon--small');
      if (removeIcon) {
        removeButton.appendChild(removeIcon);
      }
      removeButton.appendChild(createVisuallyHiddenText('Remover disciplina'));
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

function ensureFilterConsistency() {
  const validPeriodIds = new Set(state.periods.map((period) => period.id));

  if (searchFilters.discipline.periodId && !validPeriodIds.has(searchFilters.discipline.periodId)) {
    searchFilters.discipline.periodId = '';
    if (elements.disciplinePeriodFilter) {
      elements.disciplinePeriodFilter.value = '';
    }
  }

  if (searchFilters.room.periodId && !validPeriodIds.has(searchFilters.room.periodId)) {
    searchFilters.room.periodId = '';
    if (elements.roomPeriodFilter) {
      elements.roomPeriodFilter.value = '';
    }
  }
}

function refreshLists() {
  ensureFilterConsistency();
  ensureDisciplineColors();
  sortAllCollections();
  renderEntityList(state.periods, elements.periodList, 'period');
  renderEntityList(state.professors, elements.professorList, 'professor');
  renderEntityList(state.rooms, elements.roomList, 'room');
  renderEntityList(state.disciplines, elements.disciplineList, 'discipline');
  updateDisciplinePeriodOptions();
  updateProfessorDisciplineOptions();
  updateDisciplineColorSuggestion();
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
    entity.requiredSlots = normalizeRequiredSlots(updates.requiredSlots || 0);
    entity.periodId = newPeriod;
    const normalizedColor = normalizeHexColor(updates.color || entity.color);
    if (normalizedColor) {
      entity.color = normalizedColor;
    } else {
      entity.color = '';
      assignColorToDiscipline(entity);
    }
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
  const { disciplinePeriodSelect, disciplinePeriodFilter, roomPeriodFilter } = elements;
  const periods = state.periods.map((period) => ({ id: period.id, name: period.name }));
  const periodIds = new Set(periods.map((period) => period.id));

  if (disciplinePeriodSelect) {
    const currentValue = disciplinePeriodSelect.value;
    disciplinePeriodSelect.innerHTML = '<option value="">Período</option>';
    periods.forEach((period) => {
      const option = document.createElement('option');
      option.value = period.id;
      option.textContent = period.name;
      disciplinePeriodSelect.appendChild(option);
    });
    disciplinePeriodSelect.value = periodIds.has(currentValue) ? currentValue : '';
  }

  if (disciplinePeriodFilter) {
    const currentFilterValue = periodIds.has(searchFilters.discipline.periodId)
      ? searchFilters.discipline.periodId
      : '';
    searchFilters.discipline.periodId = currentFilterValue;
    disciplinePeriodFilter.innerHTML = '<option value="">Todos os períodos</option>';
    periods.forEach((period) => {
      const option = document.createElement('option');
      option.value = period.id;
      option.textContent = period.name;
      disciplinePeriodFilter.appendChild(option);
    });
    disciplinePeriodFilter.value = currentFilterValue;
  }

  if (roomPeriodFilter) {
    const currentRoomFilterValue = periodIds.has(searchFilters.room.periodId)
      ? searchFilters.room.periodId
      : '';
    searchFilters.room.periodId = currentRoomFilterValue;
    roomPeriodFilter.innerHTML = '<option value="">Todos os períodos</option>';
    periods.forEach((period) => {
      const option = document.createElement('option');
      option.value = period.id;
      option.textContent = period.name;
      roomPeriodFilter.appendChild(option);
    });
    roomPeriodFilter.value = currentRoomFilterValue;
  }
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
  entitySelector.innerHTML = '<option value=""></option>';
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
  syncSearchableDropdownOptions(entitySelector);
  updateSearchableDropdownValue(entitySelector, state.selectedEntity || '');
  renderSchedule();
}

function getDisciplineById(id) {
  return state.disciplines.find((d) => d.id === id) || null;
}

function getDisciplineColor(discipline) {
  return normalizeHexColor(discipline?.color);
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

function getDayLabel(dayKey) {
  return dayLabelMap[dayKey] || dayKey;
}

function getDayShortLabel(dayKey) {
  return dayShortLabelMap[dayKey] || getDayLabel(dayKey);
}

function formatCompactSlotLabel(dayKey, slotCode) {
  return `${getDayShortLabel(dayKey)} ${slotCode}`;
}

function getSlotDurationMinutes(slotCode) {
  const info = slotDictionary[slotCode];
  if (!info) {
    return fallbackSlotDurationMinutes;
  }
  const { durationMinutes } = info;
  if (Number.isFinite(durationMinutes) && durationMinutes > 0) {
    return durationMinutes;
  }
  return fallbackSlotDurationMinutes;
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
    const toggleLabel = state.multiSelectMode
      ? 'Desativar seleção múltipla'
      : 'Ativar seleção múltipla';
    toggleMultiSelect.setAttribute('aria-pressed', state.multiSelectMode ? 'true' : 'false');
    toggleMultiSelect.setAttribute('aria-label', toggleLabel);
    toggleMultiSelect.setAttribute('title', toggleLabel);
    toggleMultiSelect.classList.toggle('is-active', state.multiSelectMode);
    const hiddenToggleLabel = toggleMultiSelect.querySelector('.visually-hidden');
    if (hiddenToggleLabel) {
      hiddenToggleLabel.textContent = toggleLabel;
    }
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
    editSelection.setAttribute('aria-label', 'Editar seleção');
    editSelection.setAttribute(
      'title',
      count ? 'Editar seleção' : 'Editar seleção (selecione horários)'
    );
    editSelection.setAttribute('aria-disabled', editSelection.disabled ? 'true' : 'false');
  }
  if (clearSelection) {
    clearSelection.disabled = !count;
    clearSelection.setAttribute('aria-label', 'Limpar seleção');
    clearSelection.setAttribute(
      'title',
      count ? 'Limpar seleção' : 'Limpar seleção (selecione horários)'
    );
    clearSelection.setAttribute('aria-disabled', clearSelection.disabled ? 'true' : 'false');
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
  if (suppressedSlotClickButtons.has(button)) {
    suppressedSlotClickButtons.delete(button);
    return;
  }
  if (activeSlotDrag) {
    return;
  }
  if (state.multiSelectMode) {
    toggleSlotSelection(dayKey, slotCode, button);
    return;
  }
  clearRelatedHighlights();
  openAssignmentModalForSlots([{ dayKey, slotCode }]);
}

function detachSlotPointerHandlers(button) {
  if (!button) return;
  button.removeEventListener('pointermove', onSlotPointerMove);
  button.removeEventListener('pointerup', onSlotPointerUp);
  button.removeEventListener('pointercancel', onSlotPointerCancel);
}

function onSlotPointerDown(event, button, dayKey, slotCode) {
  if (!button || typeof event?.button !== 'number') return;
  if (event.button !== 0) return;
  if (!state.selectedEntity) return;
  if (state.multiSelectMode || state.selectedSlots.size) return;
  if (activeSlotDrag || pendingSlotDrag) return;

  const allowedViews = ['period', 'professor', 'room'];
  if (!allowedViews.includes(state.view)) return;

  const key = slotKey(dayKey, slotCode);
  let periodId = null;
  let assignment = null;

  if (state.view === 'period') {
    periodId = state.selectedEntity;
    assignment = getAssignmentForPeriod(periodId, key);
  } else {
    const assignments = getCellAssignments(state.view, state.selectedEntity, dayKey, slotCode);
    const draggableInfo = getDraggableAssignmentInfo(assignments);
    if (draggableInfo) {
      periodId = draggableInfo.periodId;
      assignment = draggableInfo.data;
    }
  }

  if (!assignment || !periodId) return;

  pendingSlotDrag = {
    button,
    dayKey,
    slotCode,
    key,
    periodId,
    assignment,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY
  };

  try {
    button.setPointerCapture(event.pointerId);
  } catch (error) {
    // ignore capture errors in unsupported browsers
  }

  button.addEventListener('pointermove', onSlotPointerMove);
  button.addEventListener('pointerup', onSlotPointerUp);
  button.addEventListener('pointercancel', onSlotPointerCancel);
}

function onSlotPointerMove(event) {
  if (pendingSlotDrag && event.pointerId === pendingSlotDrag.pointerId) {
    const deltaX = event.clientX - pendingSlotDrag.startX;
    const deltaY = event.clientY - pendingSlotDrag.startY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (distance >= SLOT_DRAG_THRESHOLD) {
      startSlotDrag(pendingSlotDrag, event);
      pendingSlotDrag = null;
      if (event.cancelable) {
        event.preventDefault();
      }
    }
  }

  if (activeSlotDrag && event.pointerId === activeSlotDrag.pointerId) {
    if (event.cancelable) {
      event.preventDefault();
    }
    updateActiveDragPosition(event);
  }
}

function onSlotPointerUp(event) {
  finishSlotDrag(event, false);
}

function onSlotPointerCancel(event) {
  finishSlotDrag(event, true);
}

function startSlotDrag(candidate, event) {
  if (!candidate) return;

  activeSlotDrag = {
    pointerId: candidate.pointerId,
    periodId: candidate.periodId,
    assignment: candidate.assignment,
    key: candidate.key,
    originButton: candidate.button,
    evaluations: evaluateSlotDragTargets(candidate),
    hoverButton: null
  };

  applySlotDragClasses(activeSlotDrag);
  updateActiveDragPosition(event);
}

function evaluateSlotDragTargets(candidate) {
  const map = new Map();
  const container = elements.scheduleContainer;
  if (!container) return map;
  const buttons = container.querySelectorAll('.slot-cell');
  buttons.forEach((button) => {
    if (!button) return;
    const { day: dayKey, slot: slotCode } = button.dataset || {};
    if (!dayKey || !slotCode) return;
    const key = slotKey(dayKey, slotCode);
    const conflicts = findConflicts({
      periodId: candidate.periodId,
      professorId: candidate.assignment.professorId,
      roomId: candidate.assignment.roomId,
      key,
      originalPeriodId: candidate.periodId,
      originalEntry: candidate.assignment
    });
    map.set(button, {
      key,
      dayKey,
      slotCode,
      compatible: conflicts.length === 0,
      conflicts
    });
  });
  return map;
}

function applySlotDragClasses(context) {
  const container = elements.scheduleContainer;
  context.evaluations.forEach((info, button) => {
    button.classList.add('is-drag-target');
    if (info.key === context.key) {
      button.classList.add('is-drag-origin');
      button.classList.remove('is-drag-compatible', 'is-drag-incompatible');
    } else {
      button.classList.remove('is-drag-origin');
      if (info.compatible) {
        button.classList.add('is-drag-compatible');
        button.classList.remove('is-drag-incompatible');
      } else {
        button.classList.add('is-drag-incompatible');
        button.classList.remove('is-drag-compatible');
      }
    }
  });

  if (container) {
    container.classList.add('is-dragging');
  }
}

function updateActiveDragPosition(event) {
  const targetButton = getSlotButtonFromPoint(event.clientX, event.clientY);
  setActiveDragHover(targetButton);
}

function getSlotButtonFromPoint(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const element = document.elementFromPoint(x, y);
  if (!element) return null;
  return element.closest('.slot-cell');
}

function setActiveDragHover(button) {
  if (!activeSlotDrag) return;
  const nextButton = button && activeSlotDrag.evaluations.has(button) ? button : null;
  if (activeSlotDrag.hoverButton && activeSlotDrag.hoverButton !== nextButton) {
    activeSlotDrag.hoverButton.classList.remove('is-drag-hover');
  }
  if (nextButton && activeSlotDrag.hoverButton !== nextButton) {
    nextButton.classList.add('is-drag-hover');
  }
  activeSlotDrag.hoverButton = nextButton;
}

function finishSlotDrag(event, cancelled) {
  const button = event.currentTarget;
  detachSlotPointerHandlers(button);
  try {
    if (button && typeof event.pointerId === 'number') {
      button.releasePointerCapture(event.pointerId);
    }
  } catch (error) {
    // ignore release errors
  }

  if (pendingSlotDrag && event.pointerId === pendingSlotDrag.pointerId) {
    pendingSlotDrag = null;
  }

  if (!activeSlotDrag || event.pointerId !== activeSlotDrag.pointerId) {
    return;
  }

  const context = activeSlotDrag;
  let dropInfo = null;

  if (!cancelled) {
    const hovered = context.hoverButton;
    if (hovered && context.evaluations.has(hovered)) {
      dropInfo = context.evaluations.get(hovered);
    } else {
      const fallback = getSlotButtonFromPoint(event.clientX, event.clientY);
      if (fallback && context.evaluations.has(fallback)) {
        dropInfo = context.evaluations.get(fallback);
      }
    }
  }

  const shouldMove = Boolean(dropInfo && dropInfo.compatible && dropInfo.key !== context.key);

  clearActiveSlotDrag();

  if (button) {
    suppressedSlotClickButtons.add(button);
  }

  if (shouldMove) {
    performSlotDrop(context, dropInfo);
  }
}

function clearActiveSlotDrag() {
  if (!activeSlotDrag) return;
  activeSlotDrag.evaluations.forEach((info, button) => {
    button.classList.remove(
      'is-drag-target',
      'is-drag-compatible',
      'is-drag-incompatible',
      'is-drag-hover',
      'is-drag-origin'
    );
  });
  const container = elements.scheduleContainer;
  if (container) {
    container.classList.remove('is-dragging');
  }
  activeSlotDrag = null;
}

function performSlotDrop(context, targetInfo) {
  if (!context || !targetInfo) return;
  const schedule = ensureSchedule(context.periodId);
  const currentEntry = schedule[context.key];
  const entry = currentEntry || context.assignment;
  if (!entry) return;

  if (schedule[targetInfo.key] && schedule[targetInfo.key] !== entry) {
    delete schedule[targetInfo.key];
  }

  delete schedule[context.key];
  schedule[targetInfo.key] = entry;

  persistState();
  renderSchedule();
  refreshLists();
}

function setupSlotDrag(button, dayKey, slotCode) {
  if (!button) return;
  button.addEventListener('pointerdown', clearRelatedHighlights);
  button.addEventListener('pointerdown', (event) => onSlotPointerDown(event, button, dayKey, slotCode));
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
    errors.push('Docente removido do cadastro.');
  } else if (discipline && !professorHasDiscipline(professor, discipline.id)) {
    const disciplineName = discipline?.name || 'esta disciplina';
    errors.push(`Docente ${professor.name} não está vinculado a ${disciplineName}.`);
  }

  if (!room) {
    errors.push('Sala removida do cadastro.');
  }

  if (discipline) {
    const usage = latestDisciplineUsage?.[discipline.id];
    if (usage && usage.required > 0 && usage.excess > 0) {
      errors.push(
        `Disciplina excedeu a carga prevista em ${usage.excess} horário${usage.excess > 1 ? 's' : ''}.`
      );
    }
  }

  return [...new Set(errors)];
}

function buildCellContent(assignments) {
  if (!assignments.length) {
    return { html: '<span class="slot-empty">Disponível</span>', errors: [] };
  }

  const errorSet = new Set();
  const escapeAttribute = (value) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const parts = assignments.map(({ periodId, data }) => {
    const discipline = getDisciplineById(data.disciplineId);
    const professor = getProfessorById(data.professorId);
    const room = getRoomById(data.roomId);
    const period = getPeriodById(periodId);
    const disciplineLabel = discipline ? formatDisciplineLabel(discipline) : '';
    const lines = [];

    if (period) {
      lines.push(
        `<span class="slot-line slot-line-period"><span class="badge period">${period.name}</span></span>`
      );
    }

    if (professor) {
      let professorLine = `<span class="badge docente">${professor.name}`;
      if (professor.isCourseArea) {
        professorLine +=
          '<span class="course-area-indicator" aria-hidden="true"></span><span class="visually-hidden">Docente da área do curso</span>';
      }
      professorLine += '</span>';
      lines.push(`<span class="slot-line slot-line-professor">${professorLine}</span>`);
    }

    if (room) {
      lines.push(
        `<span class="slot-line slot-line-room"><span class="badge room">Sala ${room.name}</span></span>`
      );
    }

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

    const attributes = [];
    if (disciplineLabel) {
      const accessibleLabel = `Disciplina: ${disciplineLabel}`;
      const escapedLabel = escapeAttribute(accessibleLabel);
      attributes.push(`title="${escapedLabel}"`, `aria-label="${escapedLabel}"`);
    }

    const styleAttr = styleParts.length ? ` style="${styleParts.join('; ')}"` : '';
    const attrString = attributes.length ? ` ${attributes.join(' ')}` : '';
    return `<div class="${classes.join(' ')}"${styleAttr}${attrString}>${lines.join('')}</div>`;
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

function getDraggableAssignmentInfo(assignments) {
  if (!Array.isArray(assignments)) return null;
  const valid = assignments.filter((entry) => entry && entry.data && entry.periodId);
  if (valid.length !== 1) {
    return null;
  }
  return valid[0];
}

function renderSchedule() {
  const { scheduleContainer } = elements;
  clearRelatedHighlights();
  scheduleContainer.innerHTML = '';
  updateScheduleTitle();
  if (!state.selectedEntity) {
    renderViewSummary();
    scheduleContainer.innerHTML = '<p class="placeholder">Cadastre e selecione um item para visualizar o mapa de horários.</p>';
    updateSelectionUI();
    return;
  }

  computeDisciplineUsage();

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
        const key = slotKey(day.key, slot.code);
        const assignments = getCellAssignments(state.view, state.selectedEntity, day.key, slot.code);
        const draggableInfo = getDraggableAssignmentInfo(assignments);
        const cellContent = buildCellContent(assignments);
        const disciplineIds = assignments
          .map((entry) => entry?.data?.disciplineId)
          .filter(Boolean);
        const uniqueDisciplineIds = [...new Set(disciplineIds)];
        if (uniqueDisciplineIds.length) {
          button.dataset.disciplineIds = uniqueDisciplineIds.join(',');
          const handleHighlight = () => highlightRelatedDisciplines(uniqueDisciplineIds, button);
          button.addEventListener('mouseenter', handleHighlight);
          button.addEventListener('focus', handleHighlight);
          button.addEventListener('mouseleave', clearRelatedHighlights);
          button.addEventListener('blur', clearRelatedHighlights);
        } else {
          delete button.dataset.disciplineIds;
        }
        button.innerHTML = cellContent.html;
        if (cellContent.errors.length) {
          button.classList.add('has-error');
          button.title = cellContent.errors.map((error) => `• ${error}`).join('\n');
        } else {
          button.classList.remove('has-error');
          button.removeAttribute('title');
        }
        if (draggableInfo) {
          button.classList.add('is-draggable');
        } else {
          button.classList.remove('is-draggable');
        }
        if (state.selectedSlots.has(key)) {
          button.classList.add('selected');
          button.setAttribute('aria-pressed', 'true');
        } else {
          button.setAttribute('aria-pressed', 'false');
        }
        button.addEventListener('click', (event) => {
          handleSlotClick(event.currentTarget, day.key, slot.code);
        });
        setupSlotDrag(button, day.key, slot.code);
        cell.appendChild(button);
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    });
  });
  
  table.appendChild(tbody);
  scheduleContainer.appendChild(table);
  updateSelectionUI();
  renderViewSummary();
}

function compareSlotPosition(a, b) {
  const dayDiff = (dayOrder[a.dayKey] ?? 0) - (dayOrder[b.dayKey] ?? 0);
  if (dayDiff !== 0) return dayDiff;
  const orderA = slotDictionary[a.slotCode]?.order ?? 0;
  const orderB = slotDictionary[b.slotCode]?.order ?? 0;
  return orderA - orderB;
}

function formatDurationMinutes(totalMinutes) {
  const minutes = Math.max(Math.round(totalMinutes), 0);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const parts = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (remainder > 0) {
    parts.push(`${remainder}min`);
  }
  if (!parts.length) {
    parts.push('0min');
  }
  return parts.join(' ');
}

function formatPercentage(value) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  const rounded = Math.round(value * 10) / 10;
  const fractionDigits = Number.isInteger(rounded) ? 0 : 1;
  return rounded.toLocaleString('pt-BR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  });
}

function createSummaryPlaceholder(text) {
  const paragraph = document.createElement('p');
  paragraph.className = 'summary-placeholder';
  paragraph.textContent = text;
  return paragraph;
}

function createSummaryCollapsible(label, content, { startOpen = false } = {}) {
  const details = document.createElement('details');
  details.className = 'summary-collapsible';
  if (startOpen) {
    details.open = true;
  }

  const summary = document.createElement('summary');
  summary.className = 'summary-collapsible-toggle';
  summary.textContent = label;
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'summary-collapsible-content';
  body.appendChild(content);
  details.appendChild(body);

  return details;
}

function renderViewSummary() {
  const container = elements.viewSummary;
  if (!container) return;
  container.innerHTML = '';
  container.classList.remove('has-content', 'is-empty');

  if (!state.selectedEntity) {
    container.classList.add('is-empty');
    container.appendChild(
      createSummaryPlaceholder('Selecione um item para visualizar detalhes da agenda.')
    );
    return;
  }

  let fragment = null;
  if (state.view === 'period') {
    fragment = buildPeriodSummary(state.selectedEntity);
  } else if (state.view === 'professor') {
    fragment = buildProfessorSummary(state.selectedEntity);
  } else if (state.view === 'room') {
    fragment = buildRoomSummary(state.selectedEntity);
  }

  if (fragment) {
    container.classList.add('has-content');
    container.appendChild(fragment);
  } else {
    container.classList.add('is-empty');
    container.appendChild(createSummaryPlaceholder('Nenhum dado disponível para esta visualização.'));
  }
}

function buildPeriodSummary(periodId) {
  const period = getPeriodById(periodId);
  if (!period) return null;

  const fragment = document.createDocumentFragment();
  const title = document.createElement('h3');
  title.className = 'summary-title';
  title.textContent = `Disciplinas de ${period.name}`;
  fragment.appendChild(title);

  const disciplines = state.disciplines.filter((discipline) => discipline.periodId === periodId);
  if (!disciplines.length) {
    fragment.appendChild(createSummaryPlaceholder('Nenhuma disciplina cadastrada para este período.'));
    return fragment;
  }

  const schedule = state.schedule[periodId] || {};
  const disciplineData = new Map();
  Object.entries(schedule).forEach(([key, entry]) => {
    if (!entry || !entry.disciplineId) return;
    const { dayKey, slotCode } = parseSlotKey(key);
    const record = disciplineData.get(entry.disciplineId) || {
      slots: [],
      professors: new Set()
    };
    record.slots.push({ dayKey, slotCode });
    if (entry.professorId) {
      record.professors.add(entry.professorId);
    }
    disciplineData.set(entry.disciplineId, record);
  });

  const list = document.createElement('ul');
  list.className = 'summary-list';

  const sorted = [...disciplines];
  sorted.sort((a, b) => compareEntities('discipline', a, b));

  sorted.forEach((discipline) => {
    const item = document.createElement('li');
    item.className = 'summary-item';
    const usage = latestDisciplineUsage?.[discipline.id];
    if (usage && usage.required > 0) {
      if (usage.missing > 0) {
        item.classList.add('discipline-underloaded');
      } else if (usage.excess > 0) {
        item.classList.add('discipline-overloaded');
      } else {
        item.classList.add('discipline-balanced');
      }
    }

    const header = document.createElement('div');
    header.className = 'summary-item-header';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'summary-item-title';
    titleSpan.textContent = formatDisciplineLabel(discipline);
    header.appendChild(titleSpan);

    if (usage && usage.required > 0) {
      const status = document.createElement('span');
      status.className = 'summary-status';
      if (usage.missing > 0) {
        status.dataset.status = 'warning';
        status.textContent = `Faltam ${usage.missing} de ${usage.required}`;
      } else if (usage.excess > 0) {
        status.dataset.status = 'danger';
        status.textContent = `Excedente de ${usage.excess} (meta ${usage.required})`;
      } else {
        status.dataset.status = 'success';
        status.textContent = `Meta: ${usage.required} horário${
          usage.required > 1 ? 's' : ''
        }`;
      }
      header.appendChild(status);
    }

    item.appendChild(header);

    const details = document.createElement('div');
    details.className = 'summary-item-details';

    const record = disciplineData.get(discipline.id) || { slots: [], professors: new Set() };
    const professorNames = Array.from(record.professors)
      .map((id) => getProfessorById(id)?.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

    const professorsLine = document.createElement('p');
    professorsLine.className = 'summary-line';
    professorsLine.innerHTML = `<strong>Docentes:</strong> ${
      professorNames.length ? professorNames.join(', ') : 'Não definidos'
    }`;
    details.appendChild(professorsLine);

    const slots = record.slots.slice().sort(compareSlotPosition);
    const slotLabels = slots.map(({ dayKey, slotCode }) => formatCompactSlotLabel(dayKey, slotCode));
    const slotLine = document.createElement('p');
    slotLine.className = 'summary-line';
    slotLine.innerHTML = slotLabels.length
      ? `<strong>Horários (${slotLabels.length}):</strong> ${slotLabels.join(', ')}`
      : '<strong>Horários:</strong> Sem atribuições.';
    details.appendChild(slotLine);

    item.appendChild(details);
    list.appendChild(item);
  });

  const collapsible = createSummaryCollapsible(
    `Disciplinas deste período (${sorted.length})`,
    list
  );
  fragment.appendChild(collapsible);
  return fragment;
}

function buildProfessorSummary(professorId) {
  const professor = getProfessorById(professorId);
  if (!professor) return null;

  const fragment = document.createDocumentFragment();
  const title = document.createElement('h3');
  title.className = 'summary-title';
  title.textContent = professor.name;
  fragment.appendChild(title);

  if (professor.isCourseArea) {
    const badge = document.createElement('p');
    badge.className = 'summary-meta';
    badge.textContent = 'Docente da área do curso';
    fragment.appendChild(badge);
  }

  const assignments = [];
  Object.entries(state.schedule).forEach(([periodId, slots]) => {
    Object.entries(slots).forEach(([key, entry]) => {
      if (entry?.professorId === professorId) {
        const { dayKey, slotCode } = parseSlotKey(key);
        assignments.push({ periodId, entry, dayKey, slotCode });
      }
    });
  });

  const classCount = assignments.length;
  const totalMinutes = assignments.reduce(
    (sum, assignment) => sum + getSlotDurationMinutes(assignment.slotCode),
    0
  );

  const totals = document.createElement('p');
  totals.className = 'summary-highlight';
  totals.innerHTML = `<strong>Aulas:</strong> ${classCount} • <strong>Horas:</strong> ${formatDurationMinutes(
    totalMinutes
  )}`;
  fragment.appendChild(totals);

  const linkedLabels = getProfessorDisciplineLabels(professor);
  const linkedLine = document.createElement('p');
  linkedLine.className = 'summary-line';
  linkedLine.innerHTML = `<strong>Disciplinas vinculadas:</strong> ${
    linkedLabels.length ? linkedLabels.join(', ') : 'Nenhuma disciplina vinculada'
  }`;
  fragment.appendChild(linkedLine);

  if (!assignments.length) {
    fragment.appendChild(createSummaryPlaceholder('Nenhum horário atribuído para este docente.'));
    return fragment;
  }

  const disciplineMap = new Map();
  assignments.forEach((item) => {
    const discipline = getDisciplineById(item.entry.disciplineId);
    if (!discipline) return;
    let summary = disciplineMap.get(discipline.id);
    if (!summary) {
      summary = {
        discipline,
        count: 0,
        periods: new Set(),
        slots: []
      };
      disciplineMap.set(discipline.id, summary);
    }
    summary.count += 1;
    summary.periods.add(item.periodId);
    summary.slots.push({ dayKey: item.dayKey, slotCode: item.slotCode });
  });

  if (!disciplineMap.size) {
    fragment.appendChild(createSummaryPlaceholder('Nenhum horário atribuído para este docente.'));
    return fragment;
  }

  const list = document.createElement('ul');
  list.className = 'summary-list';

  const sorted = Array.from(disciplineMap.values());
  sorted.sort((a, b) => compareEntities('discipline', a.discipline, b.discipline));

  sorted.forEach((record) => {
    const item = document.createElement('li');
    item.className = 'summary-item';

    const header = document.createElement('div');
    header.className = 'summary-item-header';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'summary-item-title';
    titleSpan.textContent = formatDisciplineLabel(record.discipline);
    header.appendChild(titleSpan);

    const status = document.createElement('span');
    status.className = 'summary-status';
    status.dataset.status = 'info';
    status.textContent = `${record.count} horário${record.count > 1 ? 's' : ''}`;
    header.appendChild(status);

    item.appendChild(header);

    const details = document.createElement('div');
    details.className = 'summary-item-details';

    const periods = Array.from(record.periods)
      .map((id) => getPeriodById(id)?.name || id)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
    if (periods.length) {
      const periodLine = document.createElement('p');
      periodLine.className = 'summary-line';
      periodLine.innerHTML = `<strong>Períodos:</strong> ${periods.join(', ')}`;
      details.appendChild(periodLine);
    }

    const slotLabels = record.slots
      .sort(compareSlotPosition)
      .map((slot) => formatCompactSlotLabel(slot.dayKey, slot.slotCode));
    const slotLine = document.createElement('p');
    slotLine.className = 'summary-line';
    slotLine.innerHTML = slotLabels.length
      ? `<strong>Horários:</strong> ${slotLabels.join(', ')}`
      : '<strong>Horários:</strong> Sem horários atribuídos.';
    details.appendChild(slotLine);

    item.appendChild(details);
    list.appendChild(item);
  });

  const collapsible = createSummaryCollapsible(
    `Disciplinas atribuídas (${sorted.length})`,
    list
  );
  fragment.appendChild(collapsible);
  return fragment;
}

function buildRoomSummary(roomId) {
  const room = getRoomById(roomId);
  if (!room) return null;

  const fragment = document.createDocumentFragment();
  const title = document.createElement('h3');
  title.className = 'summary-title';
  title.textContent = `Sala ${room.name}`;
  fragment.appendChild(title);

  const slotGroups = new Map();
  Object.entries(state.schedule).forEach(([periodId, slots]) => {
    Object.entries(slots).forEach(([key, entry]) => {
      if (entry?.roomId !== roomId) return;
      const { dayKey, slotCode } = parseSlotKey(key);
      let group = slotGroups.get(key);
      if (!group) {
        group = { dayKey, slotCode, entries: [] };
        slotGroups.set(key, group);
      }
      group.entries.push({ periodId, entry });
    });
  });

  const usedSlots = slotGroups.size;
  const occupancyPercent = totalWeeklySlots > 0 ? (usedSlots / totalWeeklySlots) * 100 : 0;
  const highlight = document.createElement('p');
  highlight.className = 'summary-highlight';
  highlight.innerHTML = `<strong>Ocupação:</strong> ${usedSlots} de ${totalWeeklySlots} horário${
    totalWeeklySlots === 1 ? '' : 's'
  } (${formatPercentage(occupancyPercent)}%)`;
  fragment.appendChild(highlight);

  if (!slotGroups.size) {
    fragment.appendChild(createSummaryPlaceholder('Nenhum horário reservado para esta sala.'));
    return fragment;
  }

  const list = document.createElement('ul');
  list.className = 'summary-list';

  const sorted = Array.from(slotGroups.values());
  sorted.sort((a, b) => compareSlotPosition(a, b));

  sorted.forEach((group) => {
    const item = document.createElement('li');
    item.className = 'summary-item';

    const header = document.createElement('div');
    header.className = 'summary-item-header';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'summary-item-title';
    titleSpan.textContent = formatCompactSlotLabel(group.dayKey, group.slotCode);
    header.appendChild(titleSpan);

    if (group.entries.length > 1) {
      const warning = document.createElement('span');
      warning.className = 'summary-status';
      warning.dataset.status = 'danger';
      warning.textContent = `${group.entries.length} reservas`;
      header.appendChild(warning);
    }

    item.appendChild(header);

    const details = document.createElement('div');
    details.className = 'summary-item-details';
    group.entries.forEach(({ periodId, entry }) => {
      const discipline = getDisciplineById(entry.disciplineId);
      const period = getPeriodById(periodId);
      const professor = getProfessorById(entry.professorId);
      const line = document.createElement('p');
      line.className = 'summary-line';
      const parts = [];
      if (discipline) {
        parts.push(formatDisciplineLabel(discipline));
      }
      if (period) {
        parts.push(`Período: ${period.name}`);
      }
      if (professor) {
        parts.push(`Docente: ${professor.name}`);
      }
      if (!parts.length) {
        parts.push('Reserva sem detalhes cadastrados.');
      }
      line.textContent = parts.join(' • ');
      details.appendChild(line);
    });

    item.appendChild(details);
    list.appendChild(item);
  });

  const collapsible = createSummaryCollapsible(
    `Horários reservados (${sorted.length})`,
    list
  );
  fragment.appendChild(collapsible);
  return fragment;
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

  const initialDiscipline = disciplineValues.size === 1 ? [...disciplineValues][0] : '';
  updateSearchableDropdownValue(elements.assignmentDiscipline, initialDiscipline);

  let initialPeriod = '';
  if (state.view === 'period') {
    initialPeriod = state.selectedEntity;
  } else if (periodValues.size === 1) {
    initialPeriod = [...periodValues][0];
  }
  updateSearchableDropdownValue(elements.assignmentPeriod, initialPeriod);

  let initialProfessor = '';
  if (state.view === 'professor') {
    initialProfessor = state.selectedEntity;
  } else if (professorValues.size === 1) {
    initialProfessor = [...professorValues][0];
  }
  updateSearchableDropdownValue(elements.assignmentProfessor, initialProfessor);

  let initialRoom = '';
  if (state.view === 'room') {
    initialRoom = state.selectedEntity;
  } else if (roomValues.size === 1) {
    initialRoom = [...roomValues][0];
  }
  updateSearchableDropdownValue(elements.assignmentRoom, initialRoom);

  prioritizeAssignmentProfessors();
  prioritizeAssignmentDisciplines();

  if (state.view === 'period') {
    setSearchableDropdownDisabled(elements.assignmentPeriod, true);
    updateSearchableDropdownValue(elements.assignmentPeriod, state.selectedEntity);
  } else {
    setSearchableDropdownDisabled(elements.assignmentPeriod, false);
  }

  if (state.view === 'professor') {
    setSearchableDropdownDisabled(elements.assignmentProfessor, true);
    updateSearchableDropdownValue(elements.assignmentProfessor, state.selectedEntity);
  } else {
    setSearchableDropdownDisabled(elements.assignmentProfessor, false);
  }

  if (state.view === 'room') {
    setSearchableDropdownDisabled(elements.assignmentRoom, true);
    updateSearchableDropdownValue(elements.assignmentRoom, state.selectedEntity);
  } else {
    setSearchableDropdownDisabled(elements.assignmentRoom, false);
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
  prioritizeAssignmentProfessors();
  updateSuggestions();
});

elements.assignmentProfessor.addEventListener('change', () => {
  prioritizeAssignmentDisciplines();
  updateSuggestions();
});
elements.assignmentRoom.addEventListener('change', updateSuggestions);
elements.assignmentPeriod.addEventListener('change', updateSuggestions);

if (elements.suggestions) {
  elements.suggestions.addEventListener('click', (event) => {
    const roomTarget = event.target.closest('[data-suggestion-room]');
    if (roomTarget) {
      const { suggestionRoom } = roomTarget.dataset;
      if (suggestionRoom) {
        updateSearchableDropdownValue(elements.assignmentRoom, suggestionRoom);
        elements.assignmentRoom.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }

    const target = event.target.closest('[data-suggestion-action]');
    if (!target) return;
    handleSuggestionAction(target.dataset.suggestionAction);
  });
}

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
  refreshLists();
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
    persistState({ markDirty: false });
    closeModal();
    renderSchedule();
    refreshLists();
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
        `Docente indisponível (compromisso no período ${period ? period.name : pId}).`
      );
    }
    if (entry.roomId === roomId) {
      const period = getPeriodById(pId);
      conflicts.push(`Sala ocupada pelo período ${period ? period.name : pId}.`);
    }
  });

  return [...new Set(conflicts)];
}

function getAssignmentDetails() {
  if (!state.assignmentEditing || !Array.isArray(state.assignmentEditing.details)) {
    return [];
  }
  return state.assignmentEditing.details;
}

function getAvailableRoomsForDetails(details) {
  if (!Array.isArray(details) || !details.length) {
    return state.rooms.filter((room) => room && room.id);
  }

  return state.rooms.filter((room) => {
    if (!room || !room.id) return false;
    return details.every((detail) => {
      const key = detail.key;
      return !Object.entries(state.schedule).some(([pId, slots]) => {
        const entry = slots?.[key];
        if (!entry) return false;
        const isSameRecord =
          detail.originalEntry && detail.originalPeriodId === pId && entry === detail.originalEntry;
        if (isSameRecord) return false;
        return entry.roomId === room.id;
      });
    });
  });
}

function updateSuggestions() {
  if (!state.assignmentEditing || !Array.isArray(state.assignmentEditing.details)) return;
  const details = state.assignmentEditing.details;
  if (!details.length) return;

  const availableRooms = getAvailableRoomsForDetails(details);
  fillAssignmentRoomOptions({ availableRooms });

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

  const periodConflicts = [];
  if (periodId) {
    const entry = state.schedule[periodId]?.[key];
    const isSameRecord =
      detail.originalEntry && periodId === detail.originalPeriodId && entry === detail.originalEntry;
    if (entry && !isSameRecord) {
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
      updateSearchableDropdownValue(elements.assignmentPeriod, disciplineInfo.periodId);
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
  if (availableRooms.length) {
    const options = availableRooms
      .map(
        (room) =>
          `<button type="button" class="suggestion-chip" data-suggestion-room="${room.id}">${room.name}</button>`
      )
      .join('');
    suggestions.push(
      `<div class="suggestion-block"><span class="suggestion-label">Salas disponíveis:</span><div class="suggestion-options">${options}</div></div>`
    );
  } else {
    suggestions.push('<span><strong>Salas disponíveis:</strong> Nenhuma sala livre</span>');
  }

  if (disciplineId) {
    const recommendedProfessors = availableProfessors.filter((professor) =>
      professorHasDiscipline(professor, disciplineId)
    );
    if (recommendedProfessors.length) {
      suggestions.push(
        `<span><strong>Docentes vinculados à disciplina:</strong> ${recommendedProfessors
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
        '<button type="button" class="suggestion-warning suggestion-action" data-suggestion-action="link-professor">Docente selecionado não está vinculado a esta disciplina. Clique para vincular.</button>'
      );
    }
  }

  periodConflicts.forEach((conflict) => {
    suggestions.push(`<span class="suggestion-warning">${conflict}</span>`);
  });

  elements.suggestions.innerHTML = suggestions.join('');
}

function handleSuggestionAction(action) {
  if (action !== 'link-professor') return;
  if (!state.assignmentEditing) return;
  const disciplineId = elements.assignmentDiscipline.value;
  const professorId = elements.assignmentProfessor.value;
  if (!disciplineId || !professorId) return;

  const discipline = getDisciplineById(disciplineId);
  const professor = getProfessorById(professorId);
  if (!discipline || !professor) return;

  const proceed = confirm(
    `Deseja vincular o docente ${professor.name} à disciplina ${formatDisciplineLabel(discipline)}?`
  );
  if (!proceed) return;

  const updated = sanitizeDisciplineIdList(professor.disciplineIds);
  if (updated.includes(disciplineId)) {
    return;
  }

  updated.push(disciplineId);
  professor.disciplineIds = updated;
  persistState();
  refreshLists();
  prioritizeAssignmentProfessors();
  prioritizeAssignmentDisciplines();
  updateSuggestions();
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

function getProfessorsOrderedForDiscipline(disciplineId) {
  const prioritizedIds = new Set();
  if (disciplineId) {
    state.professors.forEach((professor) => {
      if (professorHasDiscipline(professor, disciplineId)) {
        prioritizedIds.add(professor.id);
      }
    });
  }

  const prioritized = [];
  const others = [];
  state.professors.forEach((professor) => {
    const option = {
      id: professor.id,
      label: formatProfessorOptionLabel(professor),
      linked: prioritizedIds.has(professor.id)
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
  elements.assignmentDiscipline.innerHTML = '<option value=""></option>';
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
  const nextValue = stillExists ? currentValue : '';
  syncSearchableDropdownOptions(elements.assignmentDiscipline);
  updateSearchableDropdownValue(elements.assignmentDiscipline, nextValue);
}

function fillAssignmentProfessorOptions(disciplineId, options = {}) {
  if (!elements.assignmentProfessor) return;
  const { preserveValue = true, presetValue = null } = options;
  const currentValue = preserveValue ? elements.assignmentProfessor.value : '';
  const desiredValue = presetValue !== null ? presetValue : currentValue;
  const professorOptions = getProfessorsOrderedForDiscipline(disciplineId);

  elements.assignmentProfessor.innerHTML = '<option value=""></option>';
  professorOptions.forEach(({ id, label, linked }) => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    if (linked) {
      option.dataset.group = 'linked';
    }
    elements.assignmentProfessor.appendChild(option);
  });

  if (desiredValue) {
    const exists = professorOptions.some((option) => option.id === desiredValue);
    const nextValue = exists ? desiredValue : '';
    syncSearchableDropdownOptions(elements.assignmentProfessor);
    updateSearchableDropdownValue(elements.assignmentProfessor, nextValue);
  } else {
    syncSearchableDropdownOptions(elements.assignmentProfessor);
    updateSearchableDropdownValue(elements.assignmentProfessor, '');
  }
}

function fillAssignmentRoomOptions(options = {}) {
  if (!elements.assignmentRoom) return;
  const { preserveValue = true, availableRooms = null } = options;
  const currentValue = preserveValue ? elements.assignmentRoom.value : '';
  const details = getAssignmentDetails();
  const resolvedAvailable = Array.isArray(availableRooms)
    ? availableRooms
    : getAvailableRoomsForDetails(details);
  const availableIds = new Set(resolvedAvailable.filter((room) => room && room.id).map((room) => room.id));
  const rooms = state.rooms.filter((room) => room && room.id);

  rooms.sort((a, b) => {
    const aAvailable = availableIds.has(a.id);
    const bAvailable = availableIds.has(b.id);
    if (aAvailable !== bAvailable) {
      return aAvailable ? -1 : 1;
    }
    return compareEntities('room', a, b);
  });

  elements.assignmentRoom.innerHTML = '<option value=""></option>';
  rooms.forEach((room) => {
    const option = document.createElement('option');
    option.value = room.id;
    option.textContent = room.name;
    if (availableIds.has(room.id)) {
      option.dataset.available = 'true';
    }
    elements.assignmentRoom.appendChild(option);
  });

  const nextValue = currentValue && rooms.some((room) => room.id === currentValue) ? currentValue : '';
  syncSearchableDropdownOptions(elements.assignmentRoom);
  updateSearchableDropdownValue(elements.assignmentRoom, nextValue);
}

function populateModalSelects() {
  sortAllCollections();
  fillAssignmentDisciplineOptions(state.view === 'professor' ? state.selectedEntity : '');

  elements.assignmentPeriod.innerHTML = '<option value=""></option>';
  state.periods.forEach((period) => {
    const option = document.createElement('option');
    option.value = period.id;
    option.textContent = period.name;
    elements.assignmentPeriod.appendChild(option);
  });

  fillAssignmentProfessorOptions('', { preserveValue: false });
  fillAssignmentRoomOptions({ preserveValue: false });
  syncSearchableDropdownOptions(elements.assignmentPeriod);
  updateSearchableDropdownValue(elements.assignmentPeriod, '');
}

function prioritizeAssignmentDisciplines() {
  if (!elements.assignmentDiscipline) return;
  const professorId = elements.assignmentProfessor.value;
  fillAssignmentDisciplineOptions(professorId);
}

function prioritizeAssignmentProfessors() {
  if (!elements.assignmentProfessor) return;
  const disciplineId = elements.assignmentDiscipline.value;
  fillAssignmentProfessorOptions(disciplineId);
}

function updatePeriodByDiscipline() {
  const disciplineId = elements.assignmentDiscipline.value;
  if (!disciplineId) return;
  const discipline = getDisciplineById(disciplineId);
  if (!discipline) return;
  const periodId = discipline.periodId;
  const forcedPeriod = state.view === 'period' ? state.selectedEntity : periodId;
  updateSearchableDropdownValue(elements.assignmentPeriod, forcedPeriod);
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

  let savedEntry = null;

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
      savedEntry = updated;
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
      savedEntry = created;
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
  if (savedEntry) {
    activateConfigurationEntry(savedEntry, { status: ACTIVE_CONFIG_STATUS.SYNCED });
    persistState({ markDirty: false });
  }
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
    activateConfigurationEntry(config, { status: ACTIVE_CONFIG_STATUS.SYNCED });
    persistState({ markDirty: false });
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
      if (state.activeConfigurationId === configId) {
        resetActiveConfiguration();
      }
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

async function handleQuickConfigSave() {
  if (state.activeConfigurationStatus === ACTIVE_CONFIG_STATUS.SAVING) {
    return;
  }

  let targetName = (state.activeConfigurationName || '').trim();
  if (!targetName) {
    const response = prompt('Informe um nome para a configuração atual:');
    const trimmed = (response || '').trim();
    if (!trimmed) {
      updateActiveConfigurationStatus(ACTIVE_CONFIG_STATUS.NEEDS_NAME, { force: true });
      setStorageFeedback('Informe um nome para salvar a configuração atual.', 'warning');
      return;
    }
    targetName = trimmed;
    state.activeConfigurationName = targetName;
    updateActiveConfigurationDisplay();
  }

  clearActiveConfigurationAutosave();
  updateActiveConfigurationStatus(ACTIVE_CONFIG_STATUS.SAVING, { force: true });

  const result = await upsertSavedConfiguration(targetName, null, {
    skipConfirmation: true,
    notify: true
  });

  if (result === 'success') {
    updateActiveConfigurationStatus(ACTIVE_CONFIG_STATUS.SYNCED, { force: true });
  } else if (result === 'error') {
    updateActiveConfigurationStatus(ACTIVE_CONFIG_STATUS.ERROR, { force: true });
    setStorageFeedback('Não foi possível sincronizar a configuração ativa.', 'error');
  } else {
    if (!state.activeConfigurationId) {
      updateActiveConfigurationStatus(ACTIVE_CONFIG_STATUS.NEEDS_NAME, { force: true });
    } else {
      updateActiveConfigurationStatus(ACTIVE_CONFIG_STATUS.DIRTY, { force: true });
    }
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
    selectedEntity: state.selectedEntity,
    activeConfigurationId: state.activeConfigurationId,
    activeConfigurationName: state.activeConfigurationName
  };
}

function persistState(options = {}) {
  const { notify = false, markDirty = true } = options;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getPersistableSnapshot()));
    localStorage.setItem(COUNTERS_KEY, JSON.stringify(counters));
    if (notify) {
      setStorageFeedback('Configuração salva no navegador.', 'success');
    }
  } catch (error) {
    console.error('Erro ao salvar dados no navegador.', error);
    setStorageFeedback('Não foi possível salvar os dados localmente.', 'error');
  } finally {
    if (markDirty) {
      markActiveConfigurationDirty();
    }
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
        color: normalizeHexColor(discipline?.color),
        requiredSlots: normalizeRequiredSlots(discipline?.requiredSlots)
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
  state.activeConfigurationId = typeof data.activeConfigurationId === 'string' ? data.activeConfigurationId : '';
  state.activeConfigurationName = typeof data.activeConfigurationName === 'string' ? data.activeConfigurationName : '';
  const hasActiveConfiguration = state.activeConfigurationId && state.activeConfigurationName;
  updateActiveConfigurationStatus(
    hasActiveConfiguration ? ACTIVE_CONFIG_STATUS.SYNCED : ACTIVE_CONFIG_STATUS.IDLE,
    { force: true }
  );
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
  resetDisciplineColorInput();
  updateDisciplineColorSuggestion({ force: true });
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
    persistState({ markDirty: false });
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
  resetActiveConfiguration();
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
  resetDisciplineColorInput();
  updateDisciplineColorSuggestion({ force: true });
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
  if (elements.quickSaveButton) {
    elements.quickSaveButton.addEventListener('click', handleQuickConfigSave);
  }
  if (elements.refreshConfigsButton) {
    elements.refreshConfigsButton.addEventListener('click', () => {
      loadSavedConfigurationsFromServer({ notify: true });
    });
  }
  if (elements.saveBrowserButton) {
    elements.saveBrowserButton.addEventListener('click', () =>
      persistState({ notify: true, markDirty: false })
    );
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

  if (elements.professorAreaFilter) {
    elements.professorAreaFilter.checked = Boolean(searchFilters.professor.onlyCourseArea);
    elements.professorAreaFilter.addEventListener('change', (event) => {
      searchFilters.professor.onlyCourseArea = event.target.checked;
      refreshLists();
    });
  }

  if (elements.disciplinePeriodFilter) {
    elements.disciplinePeriodFilter.value = searchFilters.discipline.periodId || '';
    elements.disciplinePeriodFilter.addEventListener('change', (event) => {
      searchFilters.discipline.periodId = event.target.value;
      refreshLists();
    });
  }

  if (elements.roomPeriodFilter) {
    elements.roomPeriodFilter.value = searchFilters.room.periodId || '';
    elements.roomPeriodFilter.addEventListener('change', (event) => {
      searchFilters.room.periodId = event.target.value;
      refreshLists();
    });
  }
}

function resetSearchFilters() {
  searchQueries.period = '';
  searchQueries.professor = '';
  searchQueries.room = '';
  searchQueries.discipline = '';

  searchFilters.professor.onlyCourseArea = false;
  searchFilters.discipline.periodId = '';
  searchFilters.room.periodId = '';

  if (elements.periodSearch) elements.periodSearch.value = '';
  if (elements.professorSearch) elements.professorSearch.value = '';
  if (elements.roomSearch) elements.roomSearch.value = '';
  if (elements.disciplineSearch) elements.disciplineSearch.value = '';
  if (elements.professorAreaFilter) elements.professorAreaFilter.checked = false;
  if (elements.disciplinePeriodFilter) elements.disciplinePeriodFilter.value = '';
  if (elements.roomPeriodFilter) elements.roomPeriodFilter.value = '';
}

function setupSearchableDropdowns() {
  registerSearchableDropdown('assignment-discipline', { placeholder: 'Buscar disciplina' });
  registerSearchableDropdown('assignment-period', { placeholder: 'Buscar período' });
  registerSearchableDropdown('assignment-professor', { placeholder: 'Buscar docente' });
  registerSearchableDropdown('assignment-room', { placeholder: 'Buscar sala' });
  registerSearchableDropdown('entity-selector', { placeholder: 'Buscar item' });
}

function bindForms() {
  if (elements.periodForm) {
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
  }

  if (elements.professorForm) {
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
  }

  if (elements.roomForm) {
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
  }

  if (elements.disciplineColorInput) {
    elements.disciplineColorInput.addEventListener('input', () => {
      elements.disciplineColorInput.dataset.userSelected = 'true';
    });
  }

  if (elements.disciplinePeriodSelect) {
    elements.disciplinePeriodSelect.addEventListener('change', () => {
      updateDisciplineColorSuggestion({ force: true });
    });
  }

  if (elements.disciplineForm) {
    elements.disciplineForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const nameInput = elements.disciplineNameInput;
      if (!nameInput) return;
      const name = nameInput.value.trim();
      const period = elements.disciplinePeriodSelect?.value || '';
      const codeValue = elements.disciplineCodeInput?.value.trim() || '';
      const hoursValue = elements.disciplineHoursInput?.value || '';
      const colorValue = normalizeHexColor(elements.disciplineColorInput?.value || '');
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
        code: codeValue,
        requiredSlots: normalizeRequiredSlots(hoursValue),
        color: colorValue
      };
      assignColorToDiscipline(discipline);
      state.disciplines.push(discipline);
      nameInput.value = '';
      if (elements.disciplineCodeInput) {
        elements.disciplineCodeInput.value = '';
      }
      if (elements.disciplineHoursInput) {
        elements.disciplineHoursInput.value = '';
      }
      if (elements.disciplinePeriodSelect) {
        elements.disciplinePeriodSelect.value = '';
      }
      resetDisciplineColorInput();
      updateDisciplineColorSuggestion({ force: true });
      refreshLists();
      persistState();
    });
  }

  updateDisciplineColorSuggestion({ force: true });
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
  setupDarkModeToggle();
  await loadSavedConfigurationsFromServer();
  setupProfessorFormControls();
  setupSearchableDropdowns();
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
