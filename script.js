const state = {
  periods: [],
  professors: [],
  rooms: [],
  disciplines: [],
  schedule: {}, // periodId -> { slotKey: { disciplineId, professorId, roomId } }
  view: 'period',
  selectedEntity: '',
  editing: null
};

let counters = {
  period: 1,
  professor: 1,
  room: 1,
  discipline: 1
};

const STORAGE_KEY = 'academic-planner-state-v1';
const COUNTERS_KEY = 'academic-planner-counters-v1';

const days = [
  { key: 'monday', label: 'Segunda' },
  { key: 'tuesday', label: 'Terça' },
  { key: 'wednesday', label: 'Quarta' },
  { key: 'thursday', label: 'Quinta' },
  { key: 'friday', label: 'Sexta' },
  { key: 'saturday', label: 'Sábado' }
];

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

const elements = {
  periodForm: document.getElementById('period-form'),
  professorForm: document.getElementById('professor-form'),
  roomForm: document.getElementById('room-form'),
  disciplineForm: document.getElementById('discipline-form'),
  periodList: document.getElementById('period-list'),
  professorList: document.getElementById('professor-list'),
  roomList: document.getElementById('room-list'),
  disciplineList: document.getElementById('discipline-list'),
  disciplinePeriodSelect: document.getElementById('discipline-period'),
  viewTypeSelect: document.getElementById('view-type'),
  entitySelector: document.getElementById('entity-selector'),
  scheduleContainer: document.getElementById('schedule-container'),
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
  saveBrowserButton: document.getElementById('save-browser'),
  restoreBrowserButton: document.getElementById('restore-browser'),
  exportButton: document.getElementById('export-config'),
  importInput: document.getElementById('import-config'),
  clearBrowserButton: document.getElementById('clear-browser'),
  storageFeedback: document.getElementById('storage-feedback')
};

function generateId(type) {
  return `${type}-${counters[type]++}`;
}

function renderEntityList(list, container) {
  container.innerHTML = '';
  list.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item.name;
    container.appendChild(li);
  });
}

function refreshLists() {
  renderEntityList(state.periods, elements.periodList);
  renderEntityList(state.professors, elements.professorList);
  renderEntityList(state.rooms, elements.roomList);
  renderEntityList(state.disciplines, elements.disciplineList);
  updateDisciplinePeriodOptions();
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
    option.textContent = item.name;
    entitySelector.appendChild(option);
  });
  if (!source.some((item) => item.id === state.selectedEntity)) {
    state.selectedEntity = '';
  }
  if (state.selectedEntity) {
    entitySelector.value = state.selectedEntity;
  }
  renderSchedule();
}

function getDisciplineById(id) {
  return state.disciplines.find((d) => d.id === id) || null;
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

function buildCellContent(assignments) {
  if (!assignments.length) {
    return '<span class="slot-empty">Disponível</span>';
  }
  return assignments
    .map(({ periodId, data }) => {
      const discipline = getDisciplineById(data.disciplineId);
      const professor = getProfessorById(data.professorId);
      const room = getRoomById(data.roomId);
      const period = getPeriodById(periodId);
      const lines = [];
      if (discipline) lines.push(`<strong>${discipline.name}</strong>`);
      if (period) lines.push(`<span class="badge period">${period.name}</span>`);
      if (professor) lines.push(`<span class="badge professor">${professor.name}</span>`);
      if (room) lines.push(`<span class="badge room">Sala ${room.name}</span>`);
      return `<div class="slot-content">${lines.join('')}</div>`;
    })
    .join('');
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
        button.innerHTML = buildCellContent(assignments);
        cell.appendChild(button);
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    });
  });

  table.appendChild(tbody);
  scheduleContainer.appendChild(table);

  scheduleContainer.querySelectorAll('.slot-cell').forEach((btn) => {
    btn.addEventListener('click', () => openAssignmentModal(btn.dataset.day, btn.dataset.slot));
  });
}

function openAssignmentModal(dayKey, slotCode) {
  if (!state.selectedEntity) {
    alert('Selecione um item para editar o horário.');
    return;
  }
  state.editing = {
    dayKey,
    slotCode,
    originalPeriodId: null,
    originalEntry: null
  };

  elements.assignmentDay.value = days.find((d) => d.key === dayKey)?.label || '';
  elements.assignmentSlot.value = `${slotCode}`;

  populateModalSelects();
  const key = slotKey(dayKey, slotCode);
  let existing = null;

  if (state.view === 'period') {
    existing = getAssignmentForPeriod(state.selectedEntity, key);
    state.editing.originalPeriodId = state.selectedEntity;
  } else if (state.view === 'professor') {
    const result = findAssignmentByProfessor(state.selectedEntity, key);
    if (result) {
      existing = result.data;
      state.editing.originalPeriodId = result.periodId;
    }
  } else if (state.view === 'room') {
    const result = findAssignmentByRoom(state.selectedEntity, key);
    if (result) {
      existing = result.data;
      state.editing.originalPeriodId = result.periodId;
    }
  }

  if (existing) {
    state.editing.originalEntry = existing;
    elements.assignmentDiscipline.value = existing.disciplineId;
    elements.assignmentPeriod.value = state.editing.originalPeriodId;
    elements.assignmentProfessor.value = existing.professorId || '';
    elements.assignmentRoom.value = existing.roomId || '';
  } else {
    elements.assignmentDiscipline.value = '';
    elements.assignmentPeriod.value = state.view === 'period' ? state.selectedEntity : '';
    elements.assignmentProfessor.value = state.view === 'professor' ? state.selectedEntity : '';
    elements.assignmentRoom.value = state.view === 'room' ? state.selectedEntity : '';
  }

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

  updatePeriodByDiscipline();
  updateSuggestions();
  elements.modal.classList.remove('hidden');
}

function closeModal() {
  elements.modal.classList.add('hidden');
  state.editing = null;
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

elements.assignmentProfessor.addEventListener('change', updateSuggestions);
elements.assignmentRoom.addEventListener('change', updateSuggestions);
elements.assignmentPeriod.addEventListener('change', updateSuggestions);

elements.assignmentForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state.editing) return;

  const { dayKey, slotCode, originalPeriodId } = state.editing;
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

  const key = slotKey(dayKey, slotCode);
  const conflicts = findConflicts({
    periodId,
    professorId,
    roomId,
    key,
    originalPeriodId,
    originalEntry: state.editing.originalEntry
  });
  if (conflicts.length) {
    const proceed = confirm(
      `Existem conflitos neste horário:\n\n${conflicts.join('\n')}\n\nDeseja substituir mesmo assim?`
    );
    if (!proceed) {
      return;
    }
  }

  const schedule = ensureSchedule(periodId);
  schedule[key] = { disciplineId, professorId, roomId };

  if (originalPeriodId && originalPeriodId !== periodId) {
    const previous = ensureSchedule(originalPeriodId);
    delete previous[key];
  }

  persistState();
  closeModal();
  renderSchedule();
});

elements.removeAssignment.addEventListener('click', () => {
  if (!state.editing) return;
  const { dayKey, slotCode, originalPeriodId } = state.editing;
  const key = slotKey(dayKey, slotCode);
  let removed = false;

  if (state.view === 'period') {
    const schedule = ensureSchedule(state.selectedEntity);
    removed = Boolean(schedule[key]);
    delete schedule[key];
  } else {
    const sourcePeriod = originalPeriodId;
    if (sourcePeriod) {
      const schedule = ensureSchedule(sourcePeriod);
      removed = Boolean(schedule[key]);
      delete schedule[key];
    }
  }

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
      `Período já ocupado por ${discipline ? discipline.name : 'outra disciplina'}.`
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
  if (!state.editing) return;
  const { dayKey, slotCode, originalPeriodId, originalEntry } = state.editing;
  const key = slotKey(dayKey, slotCode);
  const periodId = elements.assignmentPeriod.value;
  const professorId = elements.assignmentProfessor.value;
  const roomId = elements.assignmentRoom.value;
  const disciplineId = elements.assignmentDiscipline.value;

  const availableRooms = state.rooms.filter((room) => {
    if (!room.id) return false;
    return !Object.entries(state.schedule).some(([pId, slots]) => {
      const entry = slots[key];
      if (!entry) return false;
      const isSameRecord = originalEntry && entry === originalEntry && pId === originalPeriodId;
      if (isSameRecord) return false;
      return entry.roomId === room.id;
    });
  });

  const availableProfessors = state.professors.filter((professor) => {
    if (!professor.id) return false;
    return !Object.entries(state.schedule).some(([pId, slots]) => {
      const entry = slots[key];
      if (!entry) return false;
      const isSameRecord = originalEntry && entry === originalEntry && pId === originalPeriodId;
      if (isSameRecord) return false;
      return entry.professorId === professor.id;
    });
  });

  const periodConflicts = [];
  if (periodId) {
    const entry = state.schedule[periodId]?.[key];
    if (entry) {
      const discipline = getDisciplineById(entry.disciplineId);
      periodConflicts.push(
        `Período já possui ${discipline ? discipline.name : 'outra disciplina'} neste horário.`
      );
    }
  }

  const suggestions = [];
  const disciplineInfo = disciplineId ? getDisciplineById(disciplineId) : null;
  let disciplinePeriodHint = '';
  if (disciplineInfo) {
    const period = getPeriodById(disciplineInfo.periodId);
    disciplinePeriodHint = period ? `Disciplina vinculada ao período ${period.name}.` : '';
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
        ? availableProfessors.map((p) => p.name).join(', ')
        : 'Nenhum professor livre'
    }</span>`
  );

  periodConflicts.forEach((conflict) => {
    suggestions.push(`<span class="suggestion-warning">${conflict}</span>`);
  });

  elements.suggestions.innerHTML = suggestions.join('');
}

function populateModalSelects() {
  elements.assignmentDiscipline.innerHTML = '<option value="">Selecione</option>';
  state.disciplines.forEach((discipline) => {
    const option = document.createElement('option');
    option.value = discipline.id;
    option.textContent = discipline.name;
    elements.assignmentDiscipline.appendChild(option);
  });

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
    option.textContent = professor.name;
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
  state.professors = Array.isArray(data.professors) ? data.professors : [];
  state.rooms = Array.isArray(data.rooms) ? data.rooms : [];
  state.disciplines = Array.isArray(data.disciplines) ? data.disciplines : [];
  state.schedule = data.schedule && typeof data.schedule === 'object' ? data.schedule : {};
  state.view = data.view || 'period';
  state.selectedEntity = data.selectedEntity || '';
  elements.viewTypeSelect.value = state.view;
  refreshLists();
  updateEntitySelector();
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

function exportConfiguration() {
  try {
    const payload = {
      generatedAt: new Date().toISOString(),
      state: getPersistableSnapshot(),
      counters
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `cronograma-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setStorageFeedback('Arquivo JSON exportado com sucesso.', 'success');
  } catch (error) {
    console.error('Erro ao exportar configuração.', error);
    setStorageFeedback('Não foi possível exportar os dados.', 'error');
  }
}

function handleImportFile(event) {
  const [file] = event.target.files;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (loadEvent) => {
    try {
      const text = loadEvent.target?.result;
      const parsed = JSON.parse(text);
      const payload = parsed.state && typeof parsed.state === 'object' ? parsed.state : parsed;
      applyStateFromData(payload);
      if (parsed.counters && typeof parsed.counters === 'object') {
        counters = { ...counters, ...parsed.counters };
      } else {
        rebuildCounters();
      }
      persistState();
      setStorageFeedback('Configuração importada com sucesso.', 'success');
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
  const confirmed = confirm('Tem certeza de que deseja remover todos os dados salvos?');
  if (!confirmed) return;
  state.periods = [];
  state.professors = [];
  state.rooms = [];
  state.disciplines = [];
  state.schedule = {};
  state.view = 'period';
  state.selectedEntity = '';
  counters = { period: 1, professor: 1, room: 1, discipline: 1 };
  elements.viewTypeSelect.value = state.view;
  refreshLists();
  updateEntitySelector();
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(COUNTERS_KEY);
  setStorageFeedback('Dados removidos. Você pode começar um novo cronograma.', 'warning');
}

function bindStorageControls() {
  if (elements.saveBrowserButton) {
    elements.saveBrowserButton.addEventListener('click', () => persistState({ notify: true }));
  }
  if (elements.restoreBrowserButton) {
    elements.restoreBrowserButton.addEventListener('click', () => restoreStateFromStorage({ notify: true }));
  }
  if (elements.exportButton) {
    elements.exportButton.addEventListener('click', exportConfiguration);
  }
  if (elements.importInput) {
    elements.importInput.addEventListener('change', handleImportFile);
  }
  if (elements.clearBrowserButton) {
    elements.clearBrowserButton.addEventListener('click', clearAllData);
  }
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
    state.professors.push({ id: generateId('professor'), name });
    input.value = '';
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
    const input = document.getElementById('discipline-name');
    const name = input.value.trim();
    const period = elements.disciplinePeriodSelect.value;
    if (!name || !period) {
      alert('Informe o nome e selecione um período.');
      return;
    }
    state.disciplines.push({ id: generateId('discipline'), name, periodId: period });
    input.value = '';
    elements.disciplinePeriodSelect.value = '';
    refreshLists();
    persistState();
  });
}

elements.viewTypeSelect.addEventListener('change', (event) => {
  state.view = event.target.value;
  updateEntitySelector();
  persistState();
});

elements.entitySelector.addEventListener('change', (event) => {
  state.selectedEntity = event.target.value;
  renderSchedule();
  persistState();
});

function init() {
  bindForms();
  bindStorageControls();
  setStorageFeedback('');
  const restored = restoreStateFromStorage();
  if (!restored) {
    refreshLists();
    elements.viewTypeSelect.value = state.view;
    updateEntitySelector();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
