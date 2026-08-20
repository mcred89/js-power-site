const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');
const { generateServiceWorker } = require('./generate-service-worker');

const buildDirectory = path.resolve(__dirname, '..', 'build');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcilroy-smoke-releases-'));
const releaseDirectories = {};
['one', 'two'].forEach(version => {
  const directory = path.join(fixtureRoot, version);
  fs.cpSync(buildDirectory, directory, { recursive: true });
  fs.appendFileSync(path.join(directory, 'index.html'), `<!-- smoke release ${version} -->`);
  generateServiceWorker({ buildDir: directory });
  releaseDirectories[version] = directory;
});
const failedDirectory = path.join(fixtureRoot, 'failed');
fs.cpSync(releaseDirectories.two, failedDirectory, { recursive: true });
const failedWorkerPath = path.join(failedDirectory, 'service-worker.js');
fs.writeFileSync(failedWorkerPath, fs.readFileSync(failedWorkerPath, 'utf8')
  .replace(/mcilroy-shell-[a-f0-9]+/, 'mcilroy-shell-failed-precache')
  .replace('const PRECACHE_URLS = [', "const PRECACHE_URLS = ['/missing-precache.js',"));
releaseDirectories.failed = failedDirectory;
let activeDirectory = releaseDirectories.one;
const resetRelease = () => { activeDirectory = releaseDirectories.one; };
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

http.createServer((request, response) => {
  const requestedPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  if (requestedPath === '/__smoke/release/reset') {
    resetRelease();
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    response.end();
    return;
  }
  const switchMatch = requestedPath.match(/^\/__smoke\/release\/(one|two|failed)$/);
  if (switchMatch) {
    activeDirectory = releaseDirectories[switchMatch[1]];
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    response.end();
    return;
  }
  const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '');
  const candidate = path.resolve(activeDirectory, relativePath);
  const safeCandidate = candidate.startsWith(`${activeDirectory}${path.sep}`) ? candidate : '';
  const existingFile = safeCandidate && fs.existsSync(safeCandidate) && fs.statSync(safeCandidate).isFile();
  if (!existingFile && path.extname(relativePath)) {
    response.writeHead(404, { 'Cache-Control': 'no-store' });
    response.end('Not found');
    return;
  }
  const filePath = existingFile ? safeCandidate : path.join(activeDirectory, 'index.html');

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(500);
      response.end('Unable to read production build.');
      return;
    }
    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
    });
    response.end(contents);
  });
}).listen(4173, '127.0.0.1', () => {
  process.stdout.write('Smoke server listening on http://127.0.0.1:4173\n');
});

const cleanup = () => fs.rmSync(fixtureRoot, { recursive: true, force: true });
process.once('exit', cleanup);
process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
