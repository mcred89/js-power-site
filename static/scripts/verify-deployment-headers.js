#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const IMMUTABLE_CACHE = 'public,max-age=31536000,immutable';
const SHORT_CACHE = 'public,max-age=300';
const NO_CACHE = 'no-cache';

const normalizeCacheControl = value => String(value || '')
  .toLowerCase()
  .split(',')
  .map(part => part.trim())
  .filter(Boolean)
  .sort()
  .join(',');

const cacheControlMatches = (actual, expected) => (
  normalizeCacheControl(actual) === normalizeCacheControl(expected)
);

const deploymentHeaderTargets = (manifest, baseUrl) => {
  const files = Object.values(manifest.files || {});
  const hashedJavaScript = files.find(file => /\/static\/.*\.[0-9a-f]{8}\.js$/.test(file));
  const hashedCss = files.find(file => /\/static\/.*\.[0-9a-f]{8}\.css$/.test(file));
  if (!hashedJavaScript) throw new Error('asset-manifest.json contains no hashed JavaScript asset');
  if (!hashedCss) throw new Error('asset-manifest.json contains no hashed CSS asset');

  return [
    ['/index.html', NO_CACHE],
    ['/service-worker.js', NO_CACHE],
    ['/manifest.json', SHORT_CACHE],
    ['/icon-192.png', SHORT_CACHE],
    ['/icon-512.png', SHORT_CACHE],
    [hashedJavaScript, IMMUTABLE_CACHE],
    [hashedCss, IMMUTABLE_CACHE],
  ].map(([assetPath, cacheControl]) => ({
    url: new URL(assetPath, `${baseUrl.replace(/\/$/, '')}/`).toString(),
    cacheControl,
  }));
};

const verifyDeploymentHeaders = async ({
  baseUrl,
  manifestPath = path.resolve(process.cwd(), 'build/asset-manifest.json'),
  fetchImpl = global.fetch,
} = {}) => {
  if (!baseUrl) throw new Error('A production base URL is required');
  if (typeof fetchImpl !== 'function') throw new Error('This Node.js version does not provide fetch');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const targets = deploymentHeaderTargets(manifest, baseUrl);

  for (const target of targets) {
    const response = await fetchImpl(target.url, { method: 'HEAD', redirect: 'follow' });
    if (!response.ok) throw new Error(`${target.url} returned HTTP ${response.status}`);
    const actual = response.headers.get('cache-control');
    if (!cacheControlMatches(actual, target.cacheControl)) {
      throw new Error(`${target.url} has Cache-Control ${JSON.stringify(actual)}; expected ${target.cacheControl}`);
    }
    console.log(`${target.url}: ${actual}`);
  }
};

if (require.main === module) {
  verifyDeploymentHeaders({ baseUrl: process.argv[2] }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  IMMUTABLE_CACHE,
  NO_CACHE,
  SHORT_CACHE,
  cacheControlMatches,
  deploymentHeaderTargets,
  verifyDeploymentHeaders,
};
