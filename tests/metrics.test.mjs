import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { METRICS, thresholdsFor, levelOf, normalizeHost, rateText, targetOptions } = require(
  '../com.ulanzi.glancesmonitor.ulanziPlugin/plugin/metrics.js'
);

const fixture = (version) => JSON.parse(readFileSync(new URL(`./fixtures/glances-v${version}.json`, import.meta.url)));
const v4 = fixture(4);
const v3 = fixture(3);

for (const [version, data] of [['v4', v4], ['v3', v3]]) {
  test(`${version}: scalar metrics read the documented fields`, () => {
    assert.equal(METRICS.cpu.read(data.cpu).bar, data.cpu.total);
    assert.equal(METRICS.mem.read(data.mem).text, `${Math.round(data.mem.percent)}%`);
    assert.equal(METRICS.swap.read(data.memswap).bar, data.memswap.percent);
    const load = METRICS.load.read(data.load);
    assert.equal(load.bar, (data.load.min1 / data.load.cpucore) * 100);
  });

  test(`${version}: disk picks the root mount and skips snap squashfs`, () => {
    const reading = METRICS.disk.read(data.fs, '');
    assert.equal(reading.sublabel, '/');
    assert.ok(!targetOptions('disk', data.fs).some((mount) => mount.startsWith('/snap/')));
  });

  test(`${version}: network skips loopback and virtual interfaces`, () => {
    const options = targetOptions('net', data.network);
    assert.ok(!options.includes('lo'));
    assert.ok(!options.includes('docker0'));
    const reading = METRICS.net.read(data.network, '');
    assert.equal(reading.bar, null);
    assert.match(reading.lines[0], /^↓\d/);
    assert.match(reading.lines[1], /^↑\d/);
  });

  test(`${version}: temperature prefers the CPU sensor and its own limits`, () => {
    const reading = METRICS.temp.read(data.sensors, '');
    assert.equal(reading.sublabel, 'Tctl');
    const composite = METRICS.temp.read(data.sensors, 'Composite');
    assert.deepEqual(composite.thresholds, [74, 79]);
  });
}

test('unknown targets and empty lists report a code', () => {
  assert.throws(() => METRICS.disk.read(v4.fs, '/nope'), { code: 'notfound' });
  assert.throws(() => METRICS.gpu.read(v3.gpu, ''), { code: 'nodata' });
});

test('v3 network rate divides bytes by the update interval', () => {
  const nic = { interface_name: 'eth0', rx: 2048, tx: 1024, time_since_update: 2 };
  assert.deepEqual(METRICS.net.read([nic], 'eth0').lines, ['↓1.0K', '↑512B']);
});

test('user thresholds override the defaults, empty fields keep them', () => {
  assert.deepEqual(thresholdsFor('cpu', { warn: '', danger: '' }), [70, 90]);
  assert.deepEqual(thresholdsFor('cpu', { warn: '50', danger: '' }), [50, 90]);
  assert.equal(thresholdsFor('net', {}), null);
  assert.equal(levelOf(95, [70, 90]), 'danger');
  assert.equal(levelOf(75, [70, 90]), 'warn');
  assert.equal(levelOf(10, [70, 90]), 'ok');
  assert.equal(levelOf(10, null), 'neutral');
});

test('host input is normalized', () => {
  assert.equal(normalizeHost('192.168.1.10:61208'), 'http://192.168.1.10:61208');
  assert.equal(normalizeHost('https://nas.local/glances/'), 'https://nas.local/glances');
  assert.equal(normalizeHost('http://x:61208/api/4/cpu'), 'http://x:61208');
  assert.equal(normalizeHost('  '), '');
});

test('rates use short binary units', () => {
  assert.equal(rateText(0), '0B');
  assert.equal(rateText(999), '999B');
  assert.equal(rateText(1536), '1.5K');
  assert.equal(rateText(50 * 1024 * 1024), '50M');
});
