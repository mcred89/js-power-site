'use strict';

const { performance } = require('perf_hooks');
const {
  PROGRESS_HISTORY_SIZES,
  buildActiveRoutine,
  buildBackupPair,
  buildCompletedRoutines,
  buildProgressHistory,
} = require('./performance-fixtures');

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
  return routines[0].workouts.reduce((total, workout) => total + workout.session.exercises
    .flatMap(exercise => exercise.sets)
    .reduce((volume, set) => volume + Number(set.actualWeight) * Number(set.actualReps), 0), 0);
}));

const inputBurst = time('10-character active-set burst', () => {
  const routine = buildActiveRoutine();
  let draft = '';
  for (let index = 0; index < 10; index += 1) draft += String(index % 10);
  const serialized = JSON.stringify({ routine, draft });
  return { routineTransformations: 1, indexedDbTransactions: 1, bytesWritten: Buffer.byteLength(serialized) };
});
report('  routine transformations', inputBurst.routineTransformations);
report('  IndexedDB transactions', inputBurst.indexedDbTransactions);
report('  bytes written', inputBurst.bytesWritten);

const pair = time('large backup fixture (5000)', () => buildBackupPair(5000));
time('import comparison (identical)', () => JSON.stringify(pair.original) === JSON.stringify(pair.identical));
time('import comparison (one nested set)', () => JSON.stringify(pair.original) === JSON.stringify(pair.changed));
time('pretty backup serialization', () => JSON.stringify(pair.original, null, 2));
time('compact transfer serialization', () => JSON.stringify(pair.original));
time('history CSV-sized row generation', () => pair.original.routines[0].workouts.flatMap(workout => (
  workout.session.exercises.flatMap(exercise => exercise.sets.map(set => [workout.id, exercise.movement, set.actualWeight, set.actualReps]))
)));
console.log('* Heap is the positive before/after delta, useful for comparisons rather than an absolute peak.');
console.log('Benchmarks report trends only; functional budgets are enforced by tests and check:bundle.');
