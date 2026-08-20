'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TRACKER_JS_BUDGET_BYTES = 66700;
const WEBSITE_ONLY_SOURCE_PATTERNS = [
  /node_modules\/react-router(?:-dom)?\//,
  /src\/containers\/MaxesForm\.js$/,
  /src\/components\/CalculatorWebsite\.js$/,
];

const normalizeAsset = value => String(value).replace(/^\//, '');

const initialJavaScript = manifest => (manifest.entrypoints || [])
  .filter(asset => /\.js$/.test(asset) && !/\.map$/.test(asset))
  .map(normalizeAsset);

const lazyJavaScript = manifest => Object.values(manifest.files || {})
  .filter(asset => /\.js$/.test(asset) && !/\.map$/.test(asset))
  .map(normalizeAsset)
  .filter(asset => !initialJavaScript(manifest).includes(asset));

const sourcesForAsset = (buildDir, asset) => {
  const mapPath = path.join(buildDir, `${asset}.map`);
  if (!fs.existsSync(mapPath)) return [];
  return JSON.parse(fs.readFileSync(mapPath, 'utf8')).sources || [];
};

const inspectBundle = (buildDir, options = {}) => {
  const budgetBytes = options.budgetBytes || TRACKER_JS_BUDGET_BYTES;
  const manifestPath = path.join(buildDir, 'asset-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const initialAssets = initialJavaScript(manifest);
  const gzipBytes = initialAssets.reduce((total, asset) => {
    const contents = fs.readFileSync(path.join(buildDir, asset));
    return total + zlib.gzipSync(contents, { level: 9 }).length;
  }, 0);
  const websiteOnlySources = initialAssets.flatMap(asset => sourcesForAsset(buildDir, asset))
    .filter(source => WEBSITE_ONLY_SOURCE_PATTERNS.some(pattern => pattern.test(source)));
  const errors = [];
  if (gzipBytes > budgetBytes) {
    errors.push(`Tracker initial JavaScript is ${(gzipBytes / 1000).toFixed(2)} kB gzip; budget is ${(budgetBytes / 1000).toFixed(2)} kB.`);
  }
  if (websiteOnlySources.length) {
    errors.push(`Website-only sources found in tracker entry: ${[...new Set(websiteOnlySources)].join(', ')}`);
  }

  const workerPath = path.join(buildDir, 'service-worker.js');
  if (fs.existsSync(workerPath)) {
    const worker = fs.readFileSync(workerPath, 'utf8');
    // Versioned generated workers own a complete manifest. Legacy public workers are
    // tolerated until generation lands, avoiding a check that guesses their format.
    if (/mcilroy-shell-[a-f0-9]+/i.test(worker)) {
      lazyJavaScript(manifest).forEach(asset => {
        if (!worker.includes(`/${asset}`) && !worker.includes(asset)) {
          errors.push(`Lazy chunk is missing from the service-worker precache: /${asset}`);
        }
      });
    }
  }

  return { budgetBytes, errors, gzipBytes, initialAssets, websiteOnlySources };
};

const main = () => {
  const buildDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'build'));
  const result = inspectBundle(buildDir);
  console.log(`Tracker initial JavaScript: ${(result.gzipBytes / 1000).toFixed(2)} kB gzip (${result.initialAssets.join(', ')})`);
  if (result.errors.length) {
    result.errors.forEach(error => console.error(`ERROR: ${error}`));
    process.exitCode = 1;
  } else {
    console.log(`Bundle budget passed: at most ${(result.budgetBytes / 1000).toFixed(2)} kB gzip.`);
  }
};

if (require.main === module) main();

module.exports = { TRACKER_JS_BUDGET_BYTES, inspectBundle };
