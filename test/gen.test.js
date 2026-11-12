// SPDX-License-Identifier: EPL-2.0
// Tests for the generator functions in src/gen.js (device list parsing, validation, parking grid, page YAML).
// Usage: node community/zigbee-radio-map/test/gen.test.js   (exit code 1 on failure)
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const yaml = require('js-yaml');
const G = require('../src/gen.js');

const DEMO_TEXT = fs.readFileSync(path.join(__dirname, '..', 'demo', 'devices.json'), 'utf8');
const plain = obj => JSON.parse(JSON.stringify(obj));

function defaults(over) {
  return Object.assign({ lang: 'en', liveItem: 'ZigbeeMap_Live', dataItem: 'ZigbeeMap_Data', thing: 'mqtt:broker:mybroker',
    baseTopic: 'zigbee2mqtt', imageWidth: 703, imageHeight: 786, timeoutMin: 15, imageUrl: '/static/floorplan.png' }, over || {});
}
function page(devices, over) {
  return yaml.load(G.generatePage(Object.assign(defaults({ label: '' }), { devices }, over || {})));
}
const labels = m => m.config.useTooltipAsLabel === true;

const tests = {
  'parseDevices: demo list'() {
    const r = G.parseDevices(DEMO_TEXT);
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.devices.length, 16);
    assert.deepStrictEqual(plain(r.devices[0]), { name: 'Coordinator', type: 'coordinator', query: false });
    const routers = r.devices.filter(d => d.type === 'router'), ends = r.devices.filter(d => d.type === 'enddevice');
    assert.strictEqual(routers.length, 7); assert.ok(routers.every(d => d.query));
    assert.strictEqual(ends.length, 8); assert.ok(ends.every(d => !d.query));
    const names = r.devices.slice(1).map(d => d.name.toLowerCase());
    assert.deepStrictEqual(names, names.slice().sort());
  },
  'parseDevices: disabled devices are skipped, nested state found, read-only state not queried'() {
    const list = [
      { friendly_name: 'b', type: 'Router', definition: { exposes: [{ type: 'switch', features: [{ type: 'composite', features: [{ property: 'state', access: 7 }] }] }] } },
      { friendly_name: 'A', type: 'Router', definition: { exposes: [{ property: 'state', access: 1 }] } },
      { friendly_name: 'gone', type: 'EndDevice', disabled: true },
      { friendly_name: 'c', type: 'EndDevice' }];
    const r = G.parseDevices(JSON.stringify(list));
    assert.deepStrictEqual(plain(r.devices), [{ name: 'A', type: 'router', query: false }, { name: 'b', type: 'router', query: true },
      { name: 'c', type: 'enddevice', query: false }]);
  },
  'parseDevices: plain list'() {
    const r = G.parseDevices('# my devices\n\nLamp one;router\n  Door  \nHub;coordinator\nsensor;enddevice\n');
    assert.deepStrictEqual(r.errors, []);
    assert.deepStrictEqual(plain(r.devices), [{ name: 'Hub', type: 'coordinator', query: false },
      { name: 'Door', type: 'enddevice', query: false }, { name: 'Lamp one', type: 'router', query: false },
      { name: 'sensor', type: 'enddevice', query: false }]);
  },
  'parseDevices: errors, never an exception'() {
    const bad = ['', '   \n ', '{}', '<html><body>x</body></html>', '{"version":"2.1","coordinator":{"type":"zStack3x0"}}',
      '[1,2,3]', '[{"ieee_address":"0x1"}]', '[{"friendly_name":"a"},{"friendly_name":"a"}]', 'a\na', 'a;bulb',
      '[{"friendly_name":"x"', 'null', '"text"', 'a;coordinator\nb;coordinator'];
    for (const b of bad) {
      let r;
      assert.doesNotThrow(() => { r = G.parseDevices(b); }, JSON.stringify(b));
      assert.ok(r.errors.length > 0, 'no error for ' + JSON.stringify(b));
      assert.strictEqual(r.devices.length, 0, JSON.stringify(b));
      assert.ok(r.errors.every(e => typeof e === 'string' && e.length > 5));
    }
    assert.ok(G.parseDevices('', 'de').errors[0] !== G.parseDevices('', 'en').errors[0], 'German error texts');
  },
  'validate: defaults are fine, one error per broken rule'() {
    assert.deepStrictEqual(G.validate(defaults()), []);
    const broken = [{ liveItem: '1abc' }, { dataItem: 'a-b' }, { liveItem: '' }, { thing: 'mqtt:broker' }, { thing: 'mqtt:broker:my broker' },
      { baseTopic: '' }, { baseTopic: 'z2m/#' }, { baseTopic: 'a/+/b' }, { baseTopic: '/z2m' }, { baseTopic: 'z2m/' },
      { imageWidth: 99 }, { imageHeight: 50.5 }, { imageWidth: 'abc' }, { timeoutMin: 0 }, { timeoutMin: 121 }, { timeoutMin: 2.5 },
      { imageUrl: '  ' }, { dataItem: 'ZigbeeMap_Live' }];
    for (const b of broken) assert.strictEqual(G.validate(defaults(b)).length, 1, JSON.stringify(b) + ' ' + G.validate(defaults(b)));
    assert.deepStrictEqual(G.validate(defaults({ thing: 'mqtt:broker:my-broker_2', baseTopic: 'home/z2m', timeoutMin: 120 })), []);
  },
  'layoutParked'() {
    const c = G.layoutParked(16, 703, 786);
    assert.strictEqual(c.length, 16); assert.strictEqual(new Set(c).size, 16);
    for (const s of c) {
      const [y, x] = s.split(',').map(Number);
      assert.ok(y > 0 && y < 786 && x > 0 && x < 703, s);
      assert.ok(/^-?\d+(\.\d)?,-?\d+(\.\d)?$/.test(s), s);
    }
    const one = G.layoutParked(1, 703, 786); assert.strictEqual(one.length, 1);
    assert.deepStrictEqual(G.layoutParked(0, 703, 786), []);
    // first row at the top (y measured from the bottom)
    assert.ok(Number(c[0].split(',')[0]) > 600);
  },
  'generatePage: round trip with awkward names'() {
    const names = ['Küche "Lampe": 1', "it's", ' lead', 'a#b', 'x/y', 'back\\slash', '- dash', 'yes', '123'];
    const devices = [{ name: 'Coordinator', type: 'coordinator', query: false }]
      .concat(names.map((n, i) => ({ name: n, type: i % 2 ? 'router' : 'enddevice', query: false })));
    const text = G.generatePage(Object.assign(defaults({ label: '' }), { devices }));
    assert.ok(!/visibleTo/.test(text));
    const p = yaml.load(text);
    assert.strictEqual(p.config.imageWidth, 703); assert.strictEqual(p.config.imageHeight, 786);
    assert.strictEqual(p.config.label, 'Zigbee radio map');
    assert.strictEqual(p.markers.length, devices.length + 4);
    const got = p.markers.filter(m => !labels(m)).map(m => m.config.name);
    assert.deepStrictEqual(got, ['Coordinator'].concat(names));
    for (const m of p.markers) assert.deepStrictEqual(Object.keys(m), ['component', 'config', 'slots']);
    // no device name anywhere but in the name field (the parked note is a label)
    for (const m of p.markers.filter(m => !labels(m) && m.config.name !== 'Coordinator')) {
      const rest = JSON.stringify(Object.assign({}, m.config, { name: undefined }));
      for (const n of names.filter(n => n.length > 3)) assert.ok(!rest.includes(JSON.stringify(n).slice(1, -1)), n + ' in ' + m.config.name);
    }
  },
  'generatePage: markers of one type are identical except coords and name'() {
    const p = page([{ name: 'r1', type: 'router' }, { name: 'r2', type: 'router' }, { name: 'e1', type: 'enddevice' }, { name: 'e2', type: 'enddevice' }]);
    const strip = n => { const m = plain(p.markers.find(m => m.config.name === n)); delete m.config.coords; delete m.config.name; return m; };
    assert.deepStrictEqual(strip('r1'), strip('r2'));
    assert.deepStrictEqual(strip('e1'), strip('e2'));
    assert.notDeepStrictEqual(strip('r1'), strip('e1'));
    assert.strictEqual(strip('r1').config.icon, 'f7:arrow_2_circlepath_circle_fill');
    assert.strictEqual(strip('e1').config.icon, 'f7:largecircle_fill_circle');
  },
  'generatePage: positions win, others are parked; no note without parked devices'() {
    const devs = [{ name: 'a', type: 'router' }, { name: 'b', type: 'enddevice' }];
    const p = page(devs, { positions: { a: '100,200' } });
    assert.strictEqual(p.markers.find(m => m.config.name === 'a').config.coords, '100,200');
    assert.strictEqual(p.markers.find(m => m.config.name === 'b').config.coords, G.layoutParked(1, 703, 786)[0]);
    assert.strictEqual(p.markers.length, 2 + 4);
    const q = page(devs, { positions: { a: '100,200', b: '300,400' } });
    assert.strictEqual(q.markers.length, 2 + 3);
  },
  'generatePage: coordinator, labels, German'() {
    const devs = [{ name: 'Coordinator', type: 'coordinator' }, { name: 'z', type: 'router' }];
    const en = page(devs), de = page(devs, { lang: 'de' });
    const co = en.markers[0].config;
    assert.strictEqual(co.name, 'Coordinator'); assert.strictEqual(co.iconSize, 26); assert.strictEqual(co.iconStyle.color, '#ef6c00');
    assert.strictEqual(co.icon, 'f7:arrow_2_circlepath_circle_fill');
    assert.strictEqual(de.markers[0].config.name, 'Koordinator'); assert.strictEqual(de.config.label, 'Zigbee-Funkkarte');
    assert.ok(JSON.stringify(de).includes('Koordinator') && JSON.stringify(de).includes('noch kein Wert'));
    const lab = en.markers.filter(labels).map(m => m.config);
    assert.deepStrictEqual(lab.map(c => c.coords), ['31,28', '86,28', '141,28', '197,28']);
    assert.strictEqual(lab[0].item, 'ZigbeeMap_Live'); assert.strictEqual(lab[0].action, 'toggle');
    assert.strictEqual(lab[0].zoomVisibilityMin, undefined); assert.strictEqual(lab[1].zoomVisibilityMin, undefined);
    assert.strictEqual(lab[2].zoomVisibilityMin, 0); assert.strictEqual(lab[3].zoomVisibilityMin, 0);
    assert.ok(lab.every(c => c.tooltipStyle.lineHeight === '1.3'));
    const wide = page(devs, { imageWidth: 1700, imageHeight: 1500 }).markers.filter(labels);
    assert.strictEqual(wide[2].config.zoomVisibilityMin, -1.3);
    assert.ok(en.config.stylesheet.includes('@keyframes zmA') && en.config.stylesheet.includes('@keyframes zmB'));
    assert.strictEqual(page(devs, { label: 'My map' }).config.label, 'My map');
  },
  'generatePage: label and URL with quotes and newlines stay one scalar'() {
    const p = page([{ name: 'a', type: 'router' }], { label: 'x: "y"\n# z', imageUrl: "/static/it's.png" });
    assert.strictEqual(p.config.label, 'x: "y"\n# z'); assert.strictEqual(p.config.imageUrl, "/static/it's.png");
  },
  'label markers are as wide as their text'() {
    // MainUI puts a useTooltipAsLabel text into a block div of iconSize px: without max-content the background
    // stops after 40 px and the text runs past it (seen in the first real MainUI test, 2026-11-12)
    const y = require('js-yaml');
    const page = y.load(fs.readFileSync(path.join(__dirname, '../demo/zigbee_map_demo_page.yaml'), 'utf8'));
    const labels = page.markers.filter(m => m.config.useTooltipAsLabel);
    assert.ok(labels.length >= 3);
    labels.forEach(m => assert.strictEqual(m.config.tooltipStyle.width, 'max-content', m.config.name));
  },
  'demoDevices'() {
    const d = G.demoDevices(JSON.parse(DEMO_TEXT));
    assert.strictEqual(d.length, 15);
    assert.deepStrictEqual(plain(d[0]), { name: 'Kitchen_CeilingLight', router: true, q: 190, mode: 'ok' });
  }
};

let fail = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
}
console.log(Object.keys(tests).length - fail + '/' + Object.keys(tests).length + ' ok');
process.exit(fail ? 1 : 0);
