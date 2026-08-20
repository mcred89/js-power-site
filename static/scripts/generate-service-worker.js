'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const normalizeUrl = value => `/${String(value).replace(/^\/+/, '')}`;
const isPrecachedAsset = value => /\.(?:js|css|png|svg|ico|webp|jpe?g)$/i.test(value) && !/\.map$/i.test(value);

const collectPrecacheUrls = (buildDir, manifest) => {
  const emittedAssets = Object.values(manifest.files || {})
    .map(normalizeUrl)
    .filter(isPrecachedAsset);
  const required = ['/index.html', '/manifest.json'];
  const rootIcons = fs.readdirSync(buildDir)
    .filter(name => /(?:icon|logo).*\.(?:png|svg|ico|webp|jpe?g)$/i.test(name))
    .map(normalizeUrl);
  return [...new Set([...required, ...rootIcons, ...emittedAssets])].sort();
};

const generateServiceWorker = ({
  buildDir = path.resolve(__dirname, '..', 'build'),
  templatePath = path.resolve(__dirname, 'service-worker-template.js'),
} = {}) => {
  const manifestPath = path.join(buildDir, 'asset-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing asset manifest: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const urls = collectPrecacheUrls(buildDir, manifest);
  const fingerprints = urls.map(url => {
    const assetPath = path.join(buildDir, url.replace(/^\//, ''));
    if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
      throw new Error(`Precache asset is missing: ${url}`);
    }
    return [url, crypto.createHash('sha256').update(fs.readFileSync(assetPath)).digest('hex')];
  });
  const buildId = crypto.createHash('sha256').update(JSON.stringify(fingerprints)).digest('hex').slice(0, 16);
  const template = fs.readFileSync(templatePath, 'utf8');
  const output = template
    .replace('__SHELL_CACHE__', `mcilroy-shell-${buildId}`)
    .replace('__PRECACHE_URLS__', JSON.stringify(urls, null, 2));
  const outputPath = path.join(buildDir, 'service-worker.js');
  fs.writeFileSync(outputPath, output);
  return { buildId, outputPath, urls };
};

const main = () => {
  const result = generateServiceWorker();
  console.log(`Generated ${path.basename(result.outputPath)} for ${result.urls.length} assets (${result.buildId}).`);
};

if (require.main === module) main();

module.exports = { collectPrecacheUrls, generateServiceWorker };
