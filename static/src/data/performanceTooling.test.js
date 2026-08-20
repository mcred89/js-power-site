const fs = require('fs');
const os = require('os');
const path = require('path');

const { inspectBundle, TRACKER_JS_BUDGET_BYTES } = require('../../scripts/check-bundle-budget');
const {
  PROGRESS_HISTORY_SIZES,
  buildActiveRoutine,
  buildBackupPair,
  buildCompletedRoutines,
  buildProgressHistory,
} = require('../../scripts/performance-fixtures');

const makeBuild = ({ entrySource = 'tracker', worker = '', lazy = true } = {}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcilroy-budget-'));
  fs.mkdirSync(path.join(directory, 'static/js'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'static/js/main.js'), 'initial bundle');
  fs.writeFileSync(path.join(directory, 'static/js/main.js.map'), JSON.stringify({ sources: [entrySource] }));
  if (lazy) fs.writeFileSync(path.join(directory, 'static/js/lazy.js'), 'lazy bundle');
  fs.writeFileSync(path.join(directory, 'asset-manifest.json'), JSON.stringify({
    files: {
      'main.js': '/static/js/main.js',
      ...(lazy ? { 'static/js/lazy.js': '/static/js/lazy.js' } : {}),
    },
    entrypoints: ['static/js/main.js'],
  }));
  fs.writeFileSync(path.join(directory, 'service-worker.js'), worker);
  return directory;
};

describe('deterministic performance fixtures', () => {
  it('builds the requested stable fixture sizes', () => {
    expect(buildActiveRoutine().workouts).toHaveLength(15);
    expect(buildActiveRoutine().workouts[14].session.status).toBe('inProgress');
    expect(buildCompletedRoutines(10)).toHaveLength(10);
    expect(buildCompletedRoutines(1)[0].workouts).toHaveLength(156);
    PROGRESS_HISTORY_SIZES.forEach(size => {
      expect(buildProgressHistory(size)[0].workouts).toHaveLength(size);
    });
  });

  it('creates identical and one-nested-set-different large backups', () => {
    const pair = buildBackupPair(100);
    expect(pair.identical).toEqual(pair.original);
    expect(pair.changed).not.toEqual(pair.original);
    expect(pair.changed.routines[0].workouts[50].session.exercises[0].sets[1].actualReps).toBe(6);
  });
});

describe('bundle budget inspection', () => {
  it('uses the locked 66.7 kB gzip tracker budget', () => {
    expect(TRACKER_JS_BUDGET_BYTES).toBe(66700);
  });

  it('rejects website-only router sources in the initial entry', () => {
    const build = makeBuild({ entrySource: 'webpack:///./node_modules/react-router-dom/index.js' });
    expect(inspectBundle(build).errors.join('\n')).toContain('Website-only sources');
  });

  it('requires lazy chunks in a generated service-worker precache', () => {
    const missing = makeBuild({ worker: "const CACHE_NAME = 'mcilroy-shell-abcdef';" });
    expect(inspectBundle(missing).errors.join('\n')).toContain('static/js/lazy.js');
    const included = makeBuild({ worker: "const CACHE_NAME = 'mcilroy-shell-abcdef'; const PRECACHE = ['/static/js/lazy.js'];" });
    expect(inspectBundle(included).errors).toEqual([]);
  });

  it('stays compatible with the legacy worker until generation is introduced', () => {
    const build = makeBuild({ worker: "const CACHE_NAME = 'mcilroy-method-v2';" });
    expect(inspectBundle(build).errors).toEqual([]);
  });
});
