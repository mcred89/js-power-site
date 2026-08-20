const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const { generateServiceWorker } = require('../../scripts/generate-service-worker');

const templatePath = path.resolve(__dirname, '../../scripts/service-worker-template.js');

const makeBuild = ({ omitLazy = false } = {}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcilroy-worker-'));
  fs.mkdirSync(path.join(directory, 'static/js'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'static/css'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'index.html'), '<main>app</main>');
  fs.writeFileSync(path.join(directory, 'manifest.json'), '{}');
  fs.writeFileSync(path.join(directory, 'icon-192.png'), 'icon');
  fs.writeFileSync(path.join(directory, 'static/js/main.123.js'), 'main');
  if (!omitLazy) fs.writeFileSync(path.join(directory, 'static/js/lazy.456.chunk.js'), 'lazy');
  fs.writeFileSync(path.join(directory, 'static/css/main.789.css'), 'styles');
  fs.writeFileSync(path.join(directory, 'asset-manifest.json'), JSON.stringify({
    files: {
      'main.js': '/static/js/main.123.js',
      'lazy.js': '/static/js/lazy.456.chunk.js',
      'main.css': '/static/css/main.789.css',
      'main.js.map': '/static/js/main.123.js.map',
    },
  }));
  return directory;
};

describe('generated service worker', () => {
  it('deterministically versions and precaches every emitted application asset except maps', () => {
    const build = makeBuild();
    const first = generateServiceWorker({ buildDir: build, templatePath });
    const firstOutput = fs.readFileSync(first.outputPath, 'utf8');
    const second = generateServiceWorker({ buildDir: build, templatePath });

    expect(second.buildId).toBe(first.buildId);
    expect(first.urls).toEqual([
      '/icon-192.png',
      '/index.html',
      '/manifest.json',
      '/static/css/main.789.css',
      '/static/js/lazy.456.chunk.js',
      '/static/js/main.123.js',
    ]);
    expect(firstOutput).toContain(`mcilroy-shell-${first.buildId}`);
    expect(firstOutput).not.toContain('main.123.js.map');
    expect(firstOutput).not.toContain("const SHELL_CACHE = '__SHELL_CACHE__'");
  });

  it('changes the release ID when emitted contents change', () => {
    const build = makeBuild();
    const first = generateServiceWorker({ buildDir: build, templatePath });
    fs.writeFileSync(path.join(build, 'static/js/main.123.js'), 'changed main');
    const second = generateServiceWorker({ buildDir: build, templatePath });
    expect(second.buildId).not.toBe(first.buildId);
  });

  it('fails generation rather than installing an incomplete release', () => {
    const build = makeBuild({ omitLazy: true });
    expect(() => generateServiceWorker({ buildDir: build, templatePath }))
      .toThrow('Precache asset is missing: /static/js/lazy.456.chunk.js');
  });

  it('keeps shell activation atomic and transfer storage release-independent', () => {
    const template = fs.readFileSync(templatePath, 'utf8');
    const installHandler = template.split("self.addEventListener('activate'")[0];
    expect(template).toContain('cache.addAll(PRECACHE_URLS)');
    expect(template).toContain('await caches.delete(SHELL_CACHE)');
    expect(template).toContain('throw error');
    expect(installHandler).not.toContain('self.skipWaiting()');
    expect(template).toContain('await caches.delete(previousShell)');
    expect(template).toContain("const TRANSFER_CACHE = 'mcilroy-incoming-transfer'");
    expect(template).toContain("cache.match('/index.html')");
    expect(template).not.toMatch(/fetch\(event\.request\)[\s\S]*?put\('\/index\.html'/);
    expect(template).toContain("response.ok && response.type === 'basic' && !response.redirected");
    expect(template).toContain('event.waitUntil(cacheWrite)');
    expect(template).toContain("if (!['script', 'style', 'font', 'image'].includes(event.request.destination)) return");
    expect(template).toContain("if (url.origin !== self.location.origin) return");
  });

  it('activation deletes only the superseded active cache and protects a newer waiting cache', async () => {
    const handlers = {};
    const cacheNames = new Set([
      'mcilroy-shell-old',
      'mcilroy-shell-current',
      'mcilroy-shell-newer-waiting',
    ]);
    const metadataEntries = new Map([
      ['/__mcilroy-active-shell', new Response('mcilroy-shell-old')],
    ]);
    const metadata = {
      match: jest.fn(key => Promise.resolve(metadataEntries.get(key))),
      put: jest.fn((key, response) => {
        metadataEntries.set(key, response);
        return Promise.resolve();
      }),
    };
    const caches = {
      open: jest.fn(name => Promise.resolve(name === 'mcilroy-release-metadata' ? metadata : {})),
      delete: jest.fn(name => Promise.resolve(cacheNames.delete(name))),
    };
    const source = fs.readFileSync(templatePath, 'utf8')
      .replace('__SHELL_CACHE__', 'mcilroy-shell-current')
      .replace('__PRECACHE_URLS__', '[]');
    vm.runInNewContext(source, {
      caches,
      Response,
      Set,
      URL,
      fetch: jest.fn(),
      self: {
        location: { origin: 'https://example.test' },
        clients: { claim: jest.fn().mockResolvedValue() },
        addEventListener: (name, handler) => { handlers[name] = handler; },
      },
    });
    let activation;
    handlers.activate({ waitUntil: promise => { activation = promise; } });
    await activation;

    expect(caches.delete).toHaveBeenCalledTimes(1);
    expect(caches.delete).toHaveBeenCalledWith('mcilroy-shell-old');
    expect(cacheNames).toContain('mcilroy-shell-current');
    expect(cacheNames).toContain('mcilroy-shell-newer-waiting');
    expect(await (await metadataEntries.get('/__mcilroy-active-shell')).text()).toBe('mcilroy-shell-current');
  });

  it('extends the update message until skipWaiting completes', () => {
    const handlers = {};
    const skipWaitingPromise = Promise.resolve();
    const skipWaiting = jest.fn(() => skipWaitingPromise);
    const source = fs.readFileSync(templatePath, 'utf8')
      .replace('__SHELL_CACHE__', 'mcilroy-shell-current')
      .replace('__PRECACHE_URLS__', '[]');
    vm.runInNewContext(source, {
      Set,
      URL,
      self: {
        location: { origin: 'https://example.test' },
        skipWaiting,
        addEventListener: (name, handler) => { handlers[name] = handler; },
      },
    });
    const waitUntil = jest.fn();

    handlers.message({ data: 'skip-waiting', waitUntil });

    expect(skipWaiting).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledWith(skipWaitingPromise);

    const unrelatedWaitUntil = jest.fn();
    handlers.message({ data: 'unrelated', waitUntil: unrelatedWaitUntil });
    expect(skipWaiting).toHaveBeenCalledTimes(1);
    expect(unrelatedWaitUntil).not.toHaveBeenCalled();
  });
});
