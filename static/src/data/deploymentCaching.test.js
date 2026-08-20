const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  IMMUTABLE_CACHE,
  NO_CACHE,
  SHORT_CACHE,
  cacheControlMatches,
  deploymentHeaderTargets,
} = require('../../scripts/verify-deployment-headers');

describe('deployment caching', () => {
  const staticRoot = path.resolve(__dirname, '../..');

  const runDeployment = dryRun => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-caching-'));
    const binDirectory = path.join(temporaryDirectory, 'bin');
    const awsLog = path.join(temporaryDirectory, 'aws.log');
    fs.mkdirSync(binDirectory);
    fs.writeFileSync(path.join(binDirectory, 'aws'), `#!/usr/bin/env bash
printf '%s\\t' "$@" >> "$AWS_MOCK_LOG"
printf '\\n' >> "$AWS_MOCK_LOG"
if [[ "$1 $2" == 'cloudfront create-invalidation' ]]; then printf 'mock-invalidation\\n'; fi
`);
    fs.writeFileSync(path.join(binDirectory, 'npm'), '#!/usr/bin/env bash\nexit 0\n');
    fs.writeFileSync(path.join(binDirectory, 'node'), '#!/usr/bin/env bash\nexit 0\n');
    fs.chmodSync(path.join(binDirectory, 'aws'), 0o755);
    fs.chmodSync(path.join(binDirectory, 'npm'), 0o755);
    fs.chmodSync(path.join(binDirectory, 'node'), 0o755);

    const result = spawnSync('bash', ['scripts/deploy.sh', ...(dryRun ? ['--dry-run'] : [])], {
      cwd: staticRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        AWS_MOCK_LOG: awsLog,
        PATH: `${binDirectory}:${process.env.PATH}`,
      },
    });
    const calls = fs.readFileSync(awsLog, 'utf8').trim().split('\n')
      .map(line => line.split('\t').filter(Boolean));
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    expect(result.status).toBe(0);
    return calls;
  };

  const deploymentCalls = calls => calls.filter(call => call[0] === 's3');

  it('previews exactly five scoped S3 operations without invalidation', () => {
    const calls = runDeployment(true);
    const operations = deploymentCalls(calls);
    expect(operations).toHaveLength(5);
    expect(operations[0]).toEqual(['s3', 'sync', 'build/static/', 's3://themcilroy.com/static/', '--delete', '--region', 'us-west-2', '--exclude', '*.map', '--cache-control', IMMUTABLE_CACHE, '--dryrun']);
    expect(operations[1]).toEqual(['s3', 'sync', 'build/', 's3://themcilroy.com/', '--delete', '--region', 'us-west-2', '--exclude', 'static/*', '--exclude', '*.map', '--exclude', 'index.html', '--exclude', 'service-worker.js', '--cache-control', SHORT_CACHE, '--dryrun']);
    expect(operations[2]).toEqual(['s3', 'cp', 'build/index.html', 's3://themcilroy.com/index.html', '--region', 'us-west-2', '--cache-control', NO_CACHE, '--content-type', 'text/html; charset=utf-8', '--dryrun']);
    expect(operations[3]).toEqual(['s3', 'cp', 'build/service-worker.js', 's3://themcilroy.com/service-worker.js', '--region', 'us-west-2', '--cache-control', NO_CACHE, '--content-type', 'application/javascript; charset=utf-8', '--dryrun']);
    expect(operations[4]).toEqual(['s3', 'rm', 's3://themcilroy.com/static/', '--recursive', '--region', 'us-west-2', '--exclude', '*', '--include', '*.map', '--dryrun']);
    expect(calls.some(call => call[0] === 'cloudfront')).toBe(false);
  });

  it('keeps mutating deletion and map removal scoped before invalidating', () => {
    const calls = runDeployment(false);
    const operations = deploymentCalls(calls);
    expect(operations).toHaveLength(5);
    expect(operations[0].slice(0, 5)).toEqual(['s3', 'sync', 'build/static/', 's3://themcilroy.com/static/', '--delete']);
    expect(operations[0]).not.toContain('--dryrun');
    expect(operations[4]).toEqual(['s3', 'rm', 's3://themcilroy.com/static/', '--recursive', '--region', 'us-west-2', '--exclude', '*', '--include', '*.map']);
    expect(calls.filter(call => call[0] === 'cloudfront').map(call => call.slice(0, 3))).toEqual([
      ['cloudfront', 'create-invalidation', '--distribution-id'],
      ['cloudfront', 'wait', 'invalidation-completed'],
    ]);
  });

  it('classifies production header checks by asset type', () => {
    const targets = deploymentHeaderTargets({
      files: {
        'main.js': '/static/js/main.abc12345.js',
        'main.css': '/static/css/main.abc12345.css',
        'main.js.map': '/static/js/main.abc12345.js.map',
      },
    }, 'https://example.test');
    expect(targets).toEqual([
      { url: 'https://example.test/index.html', cacheControl: NO_CACHE },
      { url: 'https://example.test/service-worker.js', cacheControl: NO_CACHE },
      { url: 'https://example.test/manifest.json', cacheControl: SHORT_CACHE },
      { url: 'https://example.test/icon-192.png', cacheControl: SHORT_CACHE },
      { url: 'https://example.test/icon-512.png', cacheControl: SHORT_CACHE },
      { url: 'https://example.test/static/js/main.abc12345.js', cacheControl: IMMUTABLE_CACHE },
      { url: 'https://example.test/static/css/main.abc12345.css', cacheControl: IMMUTABLE_CACHE },
    ]);
    expect(cacheControlMatches('immutable, max-age=31536000, public', IMMUTABLE_CACHE)).toBe(true);
    expect(cacheControlMatches('public, max-age=300', IMMUTABLE_CACHE)).toBe(false);
  });

  it('fails clearly when either hashed asset class is absent', () => {
    expect(() => deploymentHeaderTargets({ files: { css: '/static/css/main.abc12345.css' } }, 'https://example.test'))
      .toThrow('no hashed JavaScript asset');
    expect(() => deploymentHeaderTargets({ files: { js: '/static/js/main.abc12345.js' } }, 'https://example.test'))
      .toThrow('no hashed CSS asset');
  });
});
