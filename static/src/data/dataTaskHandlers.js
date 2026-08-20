import { createImportPlan } from './importBackup';
import { routineHistoryCsvRowIterator, routinePlanCsvRowIterator } from './routines';
import { exportBackup, parseBackup } from './storage';
import { createTransferPackage, openTransferPackage } from './transferPackage';

export const DATA_TASKS = Object.freeze({
  PARSE_BACKUP: 'parse-backup',
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

// Task handlers are deliberately environment-neutral: the worker and fallback execute the
// exact same functions, preventing feature or error-message drift between older browsers.
export const dataTaskHandlers = {
  [DATA_TASKS.PARSE_BACKUP]: ({ contents }) => parseBackup(contents),
  [DATA_TASKS.PLAN_IMPORT]: ({ backup, profiles, routines, templates }) => createImportPlan(backup, profiles, routines, templates),
  [DATA_TASKS.SERIALIZE_BACKUP]: ({ profiles, routines, templates }) => exportBackup(profiles, routines, templates),
  [DATA_TASKS.SERIALIZE_TRANSFER]: payload => JSON.stringify(payload),
  [DATA_TASKS.CREATE_TRANSFER]: ({ contents, data, currentTime, options }) => (
    createTransferPackage(contents === undefined ? JSON.stringify(data) : contents, currentTime, options)
  ),
  [DATA_TASKS.OPEN_TRANSFER]: ({ contents, key, currentTime }) => openTransferPackage(contents, key, currentTime),
  [DATA_TASKS.OPEN_TRANSFER_PLAN]: async ({ contents, key, currentTime, local }) => {
    const plaintext = await openTransferPackage(contents, key, currentTime);
    const payload = JSON.parse(plaintext);
    if (payload.format === 'mcilroy-method-routine-transfer' && payload.version === 1 && payload.routine) {
      return { routine: payload };
    }
    return { plan: createImportPlan(parseBackup(plaintext), local.profiles, local.routines, local.templates) };
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
