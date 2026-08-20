'use strict';

const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

// Benchmarks execute the same ES modules shipped by CRA. Keeping this small loader here
// avoids maintaining benchmark-only copies whose apparent speed can drift from production.
process.env.BABEL_ENV = 'test';
process.env.NODE_ENV = 'test';
const sourceRoot = path.resolve(__dirname, '..', 'src');
const originalJavaScriptLoader = require.extensions['.js'];
require.extensions['.js'] = (module, filename) => {
  if (!filename.startsWith(sourceRoot)) return originalJavaScriptLoader(module, filename);
  const transformed = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename,
    presets: [require.resolve('babel-preset-react-app')],
    sourceMaps: false,
  });
  return module._compile(transformed.code, filename);
};
const {
  PROGRESS_HISTORY_SIZES,
  buildActiveRoutine,
  buildBackupPair,
  buildCompletedRoutines,
  buildProgressHistory,
} = require('./performance-fixtures');
const { buildProgressFacts, summarizeProgressFacts } = require('../src/data/progress');
const { serializedRecordsEqual } = require('../src/data/recordComparison');
const { DATA_TASKS, runDataTask, streamDataTask } = require('../src/data/dataTaskHandlers');
const { adjustSessionSet } = require('../src/data/routines');

const time = (name, operation) => {
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  const result = operation();
  const elapsed = performance.now() - started;
  const heapDelta = Math.max(0, process.memoryUsage().heapUsed - before);
  console.log(`${name.padEnd(42)} ${elapsed.toFixed(2).padStart(9)} ms  ${(heapDelta / 1024 / 1024).toFixed(2).padStart(7)} MiB heap`);
  return result;
};

const report = (name, value) => console.log(`${name.padEnd(42)} ${value}`);

console.log('McIlroy Method seeded performance report');
console.log('Operation'.padEnd(42), '     Time', '     Peak*');
time('cold Today data (active routine)', () => JSON.parse(JSON.stringify(buildActiveRoutine())));
[1, 5, 10].forEach(years => time(`${years}-year completed history fixture`, () => buildCompletedRoutines(years)));
PROGRESS_HISTORY_SIZES.forEach(size => time(`progress preprocessing (${size})`, () => {
  const routines = buildProgressHistory(size);
  const facts = buildProgressFacts(routines);
  return summarizeProgressFacts(facts, { range: 'all', now: new Date('2085-01-01T00:00:00Z') });
}));

const inputBurst = time('10-character active-set burst', () => {
  const routine = buildActiveRoutine();
  let draft = '';
  for (let index = 0; index < 10; index += 1) draft += String(index % 10);
  const workout = routine.workouts.find(item => item.session?.status === 'inProgress');
  const exercise = workout.session.exercises[0];
  const set = exercise.sets[0];
  const adjusted = adjustSessionSet(routine, workout.id, exercise.exerciseId, set.id, { actualWeight: draft });
  const serialized = JSON.stringify(adjusted);
  return { routineTransformations: adjusted === routine ? 0 : 1, indexedDbTransactions: adjusted === routine ? 0 : 1, bytesWritten: Buffer.byteLength(serialized) };
});
report('  routine transformations', inputBurst.routineTransformations);
report('  IndexedDB transactions', inputBurst.indexedDbTransactions);
report('  bytes written', inputBurst.bytesWritten);

const pair = time('large backup fixture (5000)', () => buildBackupPair(5000));
time('import comparison (identical)', () => serializedRecordsEqual(pair.original, pair.identical));
time('import comparison (one nested set)', () => serializedRecordsEqual(pair.original, pair.changed));
const taskPayload = { profiles: pair.original.profiles, routines: pair.original.routines, templates: pair.original.templates };
time('pretty backup serialization', () => runDataTask(DATA_TASKS.SERIALIZE_BACKUP, taskPayload));
time('compact transfer serialization', () => runDataTask(DATA_TASKS.SERIALIZE_TRANSFER, pair.original));
time('history CSV worker streaming', () => {
  let bytes = 0;
  streamDataTask(DATA_TASKS.HISTORY_CSV, { routine: pair.original.routines[0] }, chunk => { bytes += Buffer.byteLength(chunk); });
  return bytes;
});
console.log('* Heap is the positive before/after delta, useful for comparisons rather than an absolute peak.');
console.log('Benchmarks report trends only; functional budgets are enforced by tests and check:bundle.');
