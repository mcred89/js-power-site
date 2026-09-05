import { createImportPlan } from './importBackup';
import { routineHistoryCsvRowIterator, routinePlanCsvRowIterator } from './routineCsv';
import { exportBackup, parseBackup } from './storageBackup';
import { DATABASE_VERSION } from './storageMigrations';
import { isSupportedRoutine } from './retiredStrongman';
import { createTransferPackage, openTransferPackage } from './transferPackage';
import { sharedTransferContents } from './transferUi';

export const DATA_TASKS = Object.freeze({
  PARSE_BACKUP: 'parse-backup',
  READ_IMPORT_FILE: 'read-import-file',
  PLAN_IMPORT: 'plan-import',
  SERIALIZE_BACKUP: 'serialize-backup',
  SERIALIZE_TRANSFER: 'serialize-transfer',
  CREATE_TRANSFER: 'create-transfer',
  OPEN_TRANSFER: 'open-transfer',
  OPEN_TRANSFER_PLAN: 'open-transfer-plan',
  PLAN_CSV: 'plan-csv',
  HISTORY_CSV: 'history-csv',
});

export const streamCsvChunks = (rows, emit, size = 64 * 1024) => {
  let chunk = '';
  let index = 0;
  for (const row of rows) {
    let value = `${index ? '\n' : ''}${row}`;
    while (value.length) {
      const available = size - chunk.length;
      chunk += value.slice(0, available);
      value = value.slice(available);
      if (chunk.length === size) { emit(chunk); chunk = ''; }
    }
    index += 1;
  }
  if (chunk) emit(chunk);
};

const collectCsvChunks = (rows, size) => {
  const chunks = [];
  streamCsvChunks(rows, chunk => chunks.push(chunk), size);
  return chunks;
};

const normalizeRoutineTransfer = payload => {
  if (![1, 2].includes(payload.version) || !payload.routine ||
      typeof payload.routine !== 'object' || Array.isArray(payload.routine) ||
      (payload.version === 2 && (!Number.isInteger(payload.schemaVersion) ||
        payload.schemaVersion < 1 || payload.schemaVersion > DATABASE_VERSION))) {
    throw new Error('This is not a supported routine transfer.');
  }
  if (!isSupportedRoutine(payload.routine)) {
    throw new Error('Strongman blocks are no longer supported. Use a full backup to preserve this block as archived data.');
  }
  const migrated = parseBackup(JSON.stringify({
    format: 'mcilroy-method-backup',
    version: payload.version === 1 ? 1 : payload.schemaVersion,
    profiles: [], routines: [payload.routine], templates: [],
  }));
  return { ...payload, version: 2, schemaVersion: DATABASE_VERSION, routine: migrated.routines[0] };
};

// Task handlers are deliberately environment-neutral: the worker and fallback execute the
// exact same functions, preventing feature or error-message drift between older browsers.
export const dataTaskHandlers = {
  [DATA_TASKS.READ_IMPORT_FILE]: ({ contents }) => {
    const shared = sharedTransferContents(contents);
    if (shared) return { transfer: shared };
    if (JSON.parse(contents)?.format === 'mcilroy-method-encrypted-transfer') return { locked: true };
    return { backup: parseBackup(contents) };
  },
  [DATA_TASKS.PARSE_BACKUP]: ({ contents }) => parseBackup(contents),
  [DATA_TASKS.PLAN_IMPORT]: ({ backup, profiles, routines, templates, archives }) => createImportPlan(backup, profiles, routines, templates, archives),
  [DATA_TASKS.SERIALIZE_BACKUP]: ({ profiles, routines, templates, archives }) => exportBackup(profiles, routines, templates, archives),
  [DATA_TASKS.SERIALIZE_TRANSFER]: payload => JSON.stringify(payload),
  [DATA_TASKS.CREATE_TRANSFER]: ({ contents, data, currentTime, options }) => (
    createTransferPackage(contents === undefined ? JSON.stringify(data) : contents, currentTime, options)
  ),
  [DATA_TASKS.OPEN_TRANSFER]: ({ contents, key, currentTime }) => openTransferPackage(contents, key, currentTime),
  [DATA_TASKS.OPEN_TRANSFER_PLAN]: async ({ contents, key, currentTime, local }) => {
    const plaintext = await openTransferPackage(contents, key, currentTime);
    const payload = JSON.parse(plaintext);
    if (payload.format === 'mcilroy-method-routine-transfer') {
      return { routine: normalizeRoutineTransfer(payload) };
    }
    return { plan: createImportPlan(parseBackup(plaintext), local.profiles, local.routines, local.templates, local.archives) };
  },
  [DATA_TASKS.PLAN_CSV]: ({ routine, chunkSize }) => collectCsvChunks(routinePlanCsvRowIterator(routine), chunkSize),
  [DATA_TASKS.HISTORY_CSV]: ({ routine, chunkSize }) => collectCsvChunks(routineHistoryCsvRowIterator(routine), chunkSize),
};

export const streamDataTask = (type, payload, emit) => {
  if (type === DATA_TASKS.PLAN_CSV) return streamCsvChunks(routinePlanCsvRowIterator(payload.routine), emit, payload.chunkSize);
  if (type === DATA_TASKS.HISTORY_CSV) return streamCsvChunks(routineHistoryCsvRowIterator(payload.routine), emit, payload.chunkSize);
  return emit(runDataTask(type, payload));
};

export const runDataTask = (type, payload) => {
  const handler = dataTaskHandlers[type];
  if (!handler) throw new Error(`Unknown data task: ${type}.`);
  return handler(payload);
};
