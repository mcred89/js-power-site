const fs = require('fs');
const http = require('http');
const path = require('path');

const buildDirectory = path.resolve(__dirname, '..', 'build');
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
  const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '');
  const candidate = path.resolve(buildDirectory, relativePath);
  const safeCandidate = candidate.startsWith(`${buildDirectory}${path.sep}`) ? candidate : '';
  const filePath = safeCandidate && fs.existsSync(safeCandidate) && fs.statSync(safeCandidate).isFile()
    ? safeCandidate
    : path.join(buildDirectory, 'index.html');

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
