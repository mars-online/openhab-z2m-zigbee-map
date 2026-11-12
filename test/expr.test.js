// SPDX-License-Identifier: EPL-2.0
// Evaluates every expression of a generated page with the evaluator of MainUI 5.1.4 (jse-eval 1.5.2 + the jsep
// plugins arrow/object/regex/template, same context names, `config` = the marker's own raw config).
// Usage: node community/zigbee-radio-map/test/expr.test.js   (exit code 1 on failure)
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const yaml = require('js-yaml');
const expr = require('jse-eval');
const dayjs = require('dayjs');
expr.jsep.plugins.register(require('@jsep-plugin/regex').default || require('@jsep-plugin/regex'),
  require('@jsep-plugin/arrow').default || require('@jsep-plugin/arrow'),
  require('@jsep-plugin/object').default || require('@jsep-plugin/object'),
  require('@jsep-plugin/template').default || require('@jsep-plugin/template'));
const G = require('../src/gen.js');
const { world } = require('./rule.test.js');

const ROOT = path.join(__dirname, '..');
const DEVICES = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', 'devices.json'), 'utf8'));
const POS = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', 'positions.json'), 'utf8'));
const LIVE = 'ZigbeeMap_Live', DATA = 'ZigbeeMap_Data';
const now = dayjs().unix();

function makePage(lang) {
  return yaml.load(G.generatePage({ lang, label: '', imageUrl: '/static/floorplan.png', imageWidth: 703, imageHeight: 786,
    liveItem: LIVE, dataItem: DATA, devices: G.parseDevices(JSON.stringify(DEVICES)).devices, positions: POS }));
}
const EN = makePage('en'), DE = makePage('de');
const marker = (p, name) => p.markers.find(m => m.config.name === name).config;

// one expression; an Error (thrown or returned, MainUI returns it) fails the test
function ev(value, states, config) {
  if (typeof value !== 'string' || !value.startsWith('=')) return value;
  const store = new Proxy({}, { get: (t, k) => ({ state: k in states ? states[k] : '-' }) });
  const r = expr.evaluate(expr.parse(value.substring(1)), { items: store, Math, Number, JSON, dayjs, screen: {}, user: {}, config });
  if (r instanceof Error) throw r;
  return r;
}
function evAll(v, states, config) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, evAll(x, states, config)]));
  return ev(v, states, config);
}
const evm = (p, name, key, states) => { const c = marker(p, name); return key(evAll(c, states, c)); };
const data = obj => ({ [DATA]: JSON.stringify(obj), [LIVE]: 'ON' });

// the data item as the real demo rule writes it after 60 s of live
function demoState() {
  const DEMO = { seed: 1, devices: G.demoDevices(DEVICES) };
  const w = world({ transport: 'transport_demo.js', bare: true, cfg: { liveItem: LIVE, dataItem: DATA, thing: '', query: [], demo: DEMO } });
  w.now = Date.now(); w.run(undefined); w.cmdOn(); w.advance(60000);
  return { [LIVE]: 'ON', [DATA]: w.states[DATA] };
}

const tests = {
  'every expression evaluates for empty, NULL, UNDEF, truncated and real states'() {
    const real = demoState();
    const states = [{}, { [DATA]: '-', [LIVE]: '-' }, { [DATA]: 'NULL', [LIVE]: 'NULL' }, { [DATA]: 'UNDEF' }, { [DATA]: '' },
      { [DATA]: '{"d":' }, { [DATA]: '{}' }, { [DATA]: '{"d":{"x":' }, real];
    let n = 0;
    for (const p of [EN, DE]) for (const st of states) for (const m of p.markers) { evAll(m.config, st, m.config); n++; }
    assert.ok(n > 300);
  },
  'colour: no value white, offline grey, gradient'() {
    const col = (d, st) => evm(EN, 'Front_Door', c => c.iconStyle.color, st || data({ s0: now, d: { Front_Door: d } }));
    assert.strictEqual(col(), '#ffffff');
    assert.strictEqual(col(null, { [DATA]: 'NULL' }), '#ffffff');
    assert.strictEqual(col({ q: 99, t: now, a: 0 }), '#9e9e9e');
    assert.strictEqual(col({ q: 22, t: now }), 'hsl(0, 85%, 42%)');
    assert.strictEqual(col({ q: 75, t: now }), 'hsl(60, 85%, 42%)');
    assert.strictEqual(col({ q: 200, t: now }), 'hsl(120, 85%, 42%)');
    assert.strictEqual(col({ q: 30, t: now }), 'hsl(0, 85%, 42%)');
    assert.strictEqual(col({ q: 120, t: now }), 'hsl(120, 85%, 42%)');
  },
  'opacity: pale for values older than the session'() {
    const op = t => evm(EN, 'Kitchen_Plug', c => c.iconStyle.opacity, data({ s0: now - 100, d: { Kitchen_Plug: { q: 80, t } } }));
    assert.strictEqual(op(now - 3600), 0.4); assert.strictEqual(op(now - 50), 1);
  },
  'blink only the last fresh device, name alternates'() {
    const an = (name, n, age) => evm(EN, name, c => c.iconStyle.animation,
      data({ u: 'Kitchen_Plug', n, s0: now - 60, d: { Kitchen_Plug: { q: 87, t: now - age }, Sofa_Lamp: { q: 70, t: now } } }));
    assert.strictEqual(an('Kitchen_Plug', 3, 1), 'zmA 0.9s ease-out 1');
    assert.strictEqual(an('Kitchen_Plug', 4, 1), 'zmB 0.9s ease-out 1');
    assert.strictEqual(an('Sofa_Lamp', 4, 1), 'none');
    assert.strictEqual(an('Kitchen_Plug', 4, 60), 'none');
  },
  'tooltips in both languages'() {
    const tt = (p, d) => evm(p, 'Front_Door', c => c.tooltip, data({ s0: now, d: { Front_Door: d } }));
    assert.strictEqual(tt(EN, { q: 22, t: now - 120 }), 'Front_Door · LQI 22 · 2 min ago');
    assert.strictEqual(tt(EN, { q: 22, t: now - 10 }), 'Front_Door · LQI 22 · just now');
    assert.strictEqual(tt(EN, { q: 22, t: now - 3 * 3600 }), 'Front_Door · LQI 22 · 3 h ago');
    assert.strictEqual(tt(EN, { q: 22, t: now - 5 * 86400 }), 'Front_Door · LQI 22 · 5 days ago');
    assert.strictEqual(tt(EN, { q: 22, t: now - 120, a: 0 }), 'Front_Door · LQI 22 · 2 min ago · offline');
    assert.strictEqual(tt(EN, undefined), 'Front_Door · no value yet');
    assert.strictEqual(tt(EN, { a: 0 }), 'Front_Door · no value yet · offline');
    assert.strictEqual(tt(DE, { q: 22, t: now - 120 }), 'Front_Door · LQI 22 · vor 2 min');
    assert.strictEqual(tt(DE, { q: 22, t: now - 10 }), 'Front_Door · LQI 22 · gerade eben');
    assert.strictEqual(tt(DE, { q: 22, t: now - 5 * 86400 }), 'Front_Door · LQI 22 · vor 5 Tagen');
    assert.strictEqual(tt(DE, undefined), 'Front_Door · noch kein Wert');
  },
  'live label: remaining minutes and colour'() {
    const on = data({ e: now + 12 * 60 - 5, d: {} }), off = { [LIVE]: 'OFF', [DATA]: 'NULL' };
    assert.strictEqual(evm(EN, 'Live', c => c.tooltip, on), '● Live · 12 min left');
    assert.strictEqual(evm(DE, 'Live', c => c.tooltip, on), '● Live · noch 12 min');
    assert.strictEqual(evm(EN, 'Live', c => c.tooltipStyle.background, on), '#2e7d32');
    assert.strictEqual(evm(EN, 'Live', c => c.tooltip, off), '○ Live off – tap to start');
    assert.strictEqual(evm(DE, 'Live', c => c.tooltip, off), '○ Live aus – antippen');
    assert.strictEqual(evm(EN, 'Live', c => c.tooltipStyle.background, off), '#616161');
    assert.strictEqual(evm(EN, 'Live', c => c.tooltip, { [LIVE]: 'ON', [DATA]: '-' }), '● Live · 0 min left');
  },
  'every f7 icon exists in framework7-icons'() {
    const dir = path.join(__dirname, 'node_modules', 'framework7-icons', 'svg');
    for (const p of [EN, DE]) for (const m of p.markers) {
      const i = m.config.icon;
      if (typeof i === 'string' && i.startsWith('f7:')) assert.ok(fs.existsSync(path.join(dir, i.substring(3) + '.svg')), i);
    }
  }
};

let fail = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
}
console.log(Object.keys(tests).length - fail + '/' + Object.keys(tests).length + ' ok');
process.exit(fail ? 1 : 0);
