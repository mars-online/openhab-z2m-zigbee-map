// SPDX-License-Identifier: EPL-2.0
// Tests for the rule script (src/rule_core.js + one transport) in a small openhab-js sandbox.
// The script is assembled exactly as the generator does it: 'var ZM = {...};' + transport + core.
// Usage: node community/zigbee-radio-map/test/rule.test.js   (exit code 1 on failure)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

const SRC = path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const LIVE = 'ZigbeeMap_Live', DATA = 'ZigbeeMap_Data', THING = 'mqtt:broker:mybroker';
const T0 = 1_800_000_000_000;

function config(over) {
  return Object.assign({ liveItem: LIVE, dataItem: DATA, thing: THING, switchThing: false, baseTopic: 'zigbee2mqtt',
    timeoutMs: 900000, writeMs: 1000, query: ['Kitchen Plug', 'Hall_Light'] }, over || {});
}

function buildScript(cfg, transport) {
  return 'var ZM = ' + JSON.stringify(cfg, null, 2) + ';\n' + read(transport) + '\n' + read('rule_core.js');
}

// opts: cfg (overrides of ZM), transport (file name), noItems, live (initial state), things (list), bare (no things/actions)
function world(opts = {}) {
  const cfg = config(opts.cfg);
  const script = opts.script || buildScript(cfg, opts.transport || 'transport_mqtt.js');
  const w = { now: T0, timers: [], published: [], commands: [], updates: [], logs: [], warnings: [], enabledCalls: [], added: [] };
  w.states = opts.noItems ? {} : { [cfg.liveItem]: opts.live || 'OFF', [cfg.dataItem]: 'NULL' };
  w.things = opts.things !== undefined ? opts.things : [{ uid: cfg.thing, status: 'ONLINE', enabled: true }];
  const item = name => (name in w.states) ? {
    name,
    get state () { return w.states[name]; },
    postUpdate (v) { w.updates.push([name, String(v)]); w.states[name] = String(v); },
    sendCommand (v) { w.commands.push([name, String(v)]); }
  } : null;
  const thingApi = t => ({
    get uid () { return t.uid; },
    get bridgeUID () { return t.bridgeUID || null; },
    get status () { return t.status; },
    get isEnabled () { return t.enabled; },
    setEnabled (b) { w.enabledCalls.push([t.uid, b]); t.enabled = b; }
  });
  const priv = new Map();
  const sandbox = {
    items: {
      getItem: (n, nullIfMissing) => { const i = item(n); if (!i && !nullIfMissing) throw new Error('no item ' + n); return i; },
      addItem: c => { w.added.push(c); w.states[c.name] = 'NULL'; return item(c.name); }
    },
    cache: { private: { get: k => priv.has(k) ? priv.get(k) : null, put: (k, v) => priv.set(k, v), remove: k => priv.delete(k) } },
    setTimeout: (fn, ms) => { const id = w.timers.length + 1; w.timers.push({ id, at: w.now + ms, fn, live: true }); return id; },
    clearTimeout: id => { const t = w.timers.find(x => x.id === id); if (t) t.live = false; },
    console: { warn: m => { w.logs.push(m); w.warnings.push(m); }, info: m => w.logs.push(m), log: m => w.logs.push(m) },
    Date: { now: () => w.now },
    JSON, Math, parseInt, isNaN, String, Number, Object
  };
  if (!opts.bare) {
    sandbox.things = {
      getThing: (uid, nullIfMissing) => { const t = w.things.find(x => x.uid === uid); if (!t && !nullIfMissing) throw new Error('no thing ' + uid); return t ? thingApi(t) : null; },
      getThings: () => w.things.map(thingApi)
    };
    sandbox.actions = { get: (scope, uid) => {
      if (scope !== 'mqtt' || !w.things.some(x => x.uid === uid)) throw new Error('no action for ' + uid);
      return { publishMQTT: (t, p, r) => w.published.push({ uid, t, p: JSON.parse(p), r }) };
    } };
  }
  const ctx = vm.createContext(sandbox);
  w.run = ev => { sandbox.event = ev; vm.runInContext(script, ctx); };
  w.advance = ms => {
    const end = w.now + ms;
    for (;;) {
      const due = w.timers.filter(t => t.live && t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      w.now = Math.max(w.now, due.at); due.live = false; due.fn();
    }
    w.now = end;
  };
  w.liveTimers = () => w.timers.filter(t => t.live);
  w.writes = () => w.updates.filter(u => u[0] === cfg.dataItem);
  w.data = () => JSON.parse(w.states[cfg.dataItem]);
  w.cmdOn = () => { w.run({ eventType: 'command', itemName: cfg.liveItem, receivedCommand: 'ON' }); w.states[cfg.liveItem] = 'ON'; };
  w.cmdOff = () => { w.run({ eventType: 'command', itemName: cfg.liveItem, receivedCommand: 'OFF' }); w.states[cfg.liveItem] = 'OFF'; };
  w.msg = (topic, value) => w.run({ eventType: 'triggered', receivedEvent: topic + '#' + value });
  w.raw = payload => w.run({ eventType: 'triggered', receivedEvent: payload });
  w.state = () => vm.runInContext('zmState()', ctx);
  return w;
}

const S = T0 / 1000;
const tests = {
  'start creates missing items'() {
    const w = world({ noItems: true }); w.run(undefined);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(w.added)), [
      { type: 'Switch', name: LIVE, label: 'Zigbee radio map: live', category: 'network' },
      { type: 'String', name: DATA, label: 'Zigbee radio map: data (JSON)', category: 'network' }]);
    assert.strictEqual(w.states[LIVE], 'OFF');
  },
  'start with existing items adds nothing'() {
    const w = world(); w.run(undefined);
    assert.deepStrictEqual(w.added, []); assert.strictEqual(w.states[LIVE], 'OFF');
  },
  'start with live ON and no timer commands OFF'() {
    const w = world({ live: 'ON' }); w.run(undefined);
    assert.deepStrictEqual(w.commands, [[LIVE, 'OFF']]);
  },
  'start with live ON and running timer changes nothing'() {
    const w = world(); w.cmdOn(); const u = w.updates.length, p = w.published.length;
    w.run(undefined);
    assert.deepStrictEqual(w.commands, []); assert.strictEqual(w.updates.length, u); assert.strictEqual(w.published.length, p);
  },
  'command ON'() {
    const w = world(); w.run({ eventType: 'command', itemName: LIVE, receivedCommand: 'ON' });  // item still reads OFF
    assert.strictEqual(w.writes().length, 1);
    const d = w.data(); assert.strictEqual(d.s0, S); assert.strictEqual(d.e, S + 900);
    assert.strictEqual(w.published.length, 2);
  },
  'command OFF'() {
    const w = world(); w.cmdOn(); w.advance(5000); w.cmdOff();
    assert.strictEqual(w.data().e, 0);
    assert.deepStrictEqual(w.liveTimers(), []);
    w.advance(900000); assert.deepStrictEqual(w.commands, []);
  },
  'timeout commands OFF'() {
    const w = world(); w.cmdOn();
    w.advance(899999); assert.deepStrictEqual(w.commands, []);
    w.advance(1); assert.deepStrictEqual(w.commands, [[LIVE, 'OFF']]);
  },
  'json message'() {
    const w = world(); w.cmdOn(); w.advance(5000);
    w.msg('zigbee2mqtt/Kitchen Plug', '{"state":"ON","linkquality":87}');
    const d = w.data();
    assert.deepStrictEqual(d.d['Kitchen Plug'], { q: 87, t: S + 5 }); assert.strictEqual(d.u, 'Kitchen Plug'); assert.strictEqual(d.n, 1);
  },
  'attribute message'() {
    const w = world(); w.cmdOn(); w.advance(5000);
    w.msg('zigbee2mqtt/Kitchen Plug/linkquality', '87');
    const d = w.data();
    assert.deepStrictEqual(d.d['Kitchen Plug'], { q: 87, t: S + 5 }); assert.strictEqual(d.u, 'Kitchen Plug'); assert.strictEqual(d.n, 1);
  },
  'availability'() {
    const w = world(); w.cmdOn();
    w.msg('zigbee2mqtt/A/availability', '{"state":"offline"}'); w.advance(2000);
    w.msg('zigbee2mqtt/B/availability', 'online'); w.advance(2000);
    const d = w.data();
    assert.strictEqual(d.d.A.a, 0); assert.strictEqual(d.d.B.a, 1); assert.strictEqual(d.n, 0); assert.strictEqual(d.u, '');
  },
  'ignored'() {
    const w = world(); w.cmdOn(); w.advance(5000);
    const before = JSON.stringify(w.state()), u = w.updates.length;
    w.msg('zigbee2mqtt/bridge/devices', '[{"friendly_name":"x"}]');
    w.msg('zigbee2mqtt/bridge/logging', '{"linkquality":5}');
    w.msg('zigbee2mqtt/X/set', '{"state":"ON"}');
    w.msg('zigbee2mqtt/X', 'not json');
    w.msg('zigbee2mqtt/X', '{"linkquality":"high"}');
    w.msg('zigbee2mqtt/X/linkquality', 'abc');
    w.msg('zigbee2mqtt/X/availability', '{"state":"weird"}');
    w.msg('other/X', '{"linkquality":5}');
    w.raw('no separator');
    w.advance(5000);
    assert.strictEqual(JSON.stringify(w.state()), before); assert.strictEqual(w.updates.length, u);
  },
  'name with slash'() {
    const w = world(); w.cmdOn(); w.advance(5000);
    w.msg('zigbee2mqtt/attic/lamp', '{"linkquality":40}');
    assert.strictEqual(w.data().d['attic/lamp'].q, 40);
  },
  'custom base topic'() {
    const w = world({ cfg: { baseTopic: 'home/z2m' } }); w.cmdOn(); w.advance(5000);
    w.msg('home/z2m/Kitchen Plug', '{"linkquality":99}');
    w.msg('zigbee2mqtt/Other', '{"linkquality":99}');
    assert.deepStrictEqual(Object.keys(w.data().d), ['Kitchen Plug']);
    assert.ok(w.published.every(p => p.t.startsWith('home/z2m/')));
  },
  'live OFF collects without writing'() {
    const w = world();
    w.msg('zigbee2mqtt/A', '{"linkquality":10}'); w.msg('zigbee2mqtt/B', '{"linkquality":20}'); w.msg('zigbee2mqtt/C/linkquality', '30');
    assert.strictEqual(w.writes().length, 0);
    w.advance(60000); w.cmdOn();
    const d = w.data();
    assert.deepStrictEqual(Object.keys(d.d).sort(), ['A', 'B', 'C']); assert.ok(d.d.A.t < d.s0);
  },
  'write limit'() {
    const w = world(); w.cmdOn(); w.advance(5000); const u = w.writes().length;
    for (let i = 0; i < 200; i++) w.msg('zigbee2mqtt/D' + (i % 7), '{"linkquality":' + i + '}');
    assert.strictEqual(w.writes().length - u, 1);
    w.advance(1000);
    assert.strictEqual(w.writes().length - u, 2);
    const d = w.data(); assert.strictEqual(d.n, 200);
    assert.strictEqual(d.u, 'D' + (199 % 7)); assert.strictEqual(d.d['D' + (199 % 7)].q, 199);
    w.advance(10000); assert.strictEqual(w.writes().length - u, 2);
  },
  'no switching by default'() {
    const w = world({ things: [{ uid: THING, status: 'ONLINE', enabled: true }] }); w.cmdOn(); w.cmdOff();
    assert.deepStrictEqual(w.enabledCalls, []);
    assert.deepStrictEqual(w.published, [
      { uid: THING, t: 'zigbee2mqtt/Kitchen Plug/get', p: { state: '' }, r: false },
      { uid: THING, t: 'zigbee2mqtt/Hall_Light/get', p: { state: '' }, r: false }]);
  },
  'switching'() {
    const th = { uid: THING, status: 'UNINITIALIZED', enabled: false };
    const w = world({ cfg: { switchThing: true }, things: [th] });
    w.cmdOn(); th.status = 'OFFLINE';
    assert.deepStrictEqual(w.enabledCalls, [[THING, true]]); assert.strictEqual(w.published.length, 0);
    w.advance(1000); assert.strictEqual(w.published.length, 0);
    th.status = 'ONLINE'; w.advance(1000); assert.strictEqual(w.published.length, 2);
    w.advance(20000); assert.strictEqual(w.published.length, 2);
    w.cmdOff(); assert.deepStrictEqual(w.enabledCalls, [[THING, true], [THING, false]]);
  },
  'switching gives up'() {
    const th = { uid: THING, status: 'OFFLINE', enabled: false };
    const w = world({ cfg: { switchThing: true }, things: [th] });
    w.cmdOn(); w.advance(14000); assert.strictEqual(w.warnings.length, 0);
    w.advance(1000);
    assert.strictEqual(w.published.length, 0); assert.strictEqual(w.warnings.length, 1);
    assert.deepStrictEqual(w.liveTimers().length, 1);   // only the live timeout timer is left
    w.advance(60000); assert.strictEqual(w.warnings.length, 1);
  },
  'main broker guard'() {
    const w = world({ cfg: { switchThing: true }, things: [{ uid: THING, status: 'ONLINE', enabled: true },
      { uid: 'mqtt:topic:mybroker:sensor1', bridgeUID: THING, status: 'ONLINE', enabled: true }] });
    w.cmdOn(); w.cmdOff();
    assert.deepStrictEqual(w.enabledCalls, []);
    assert.strictEqual(w.warnings.length, 1); assert.ok(w.warnings[0].includes(THING), w.warnings[0]);
    assert.strictEqual(w.published.length, 2);
  },
  'missing thing'() {
    const w = world({ things: [] }); w.cmdOn();
    assert.strictEqual(w.warnings.length, 1); assert.ok(w.warnings[0].includes(THING));
    w.advance(5000); w.msg('zigbee2mqtt/A', '{"linkquality":50}');
    assert.strictEqual(w.data().d.A.q, 50);
    w.advance(900000); assert.deepStrictEqual(w.commands, [[LIVE, 'OFF']]);
    w.cmdOff(); assert.strictEqual(w.data().e, 0);
  },
  'empty query list'() {
    const w = world({ cfg: { query: [] } }); w.cmdOn(); w.advance(20000);
    assert.strictEqual(w.published.length, 0); assert.strictEqual(w.warnings.length, 0);
  }
};


// ---- demo transport ----
const DEMO_LIST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'demo', 'devices.json'), 'utf8'));
const DEMO = { seed: 1, devices: require('../src/gen.js').demoDevices(DEMO_LIST) };
const demoWorld = () => world({ transport: 'transport_demo.js', bare: true,
  cfg: { liveItem: 'ZigbeeMapDemo_Live', dataItem: 'ZigbeeMapDemo_Data', thing: '', query: [], demo: DEMO } });
function demo60() { const w = demoWorld(); w.run(undefined); w.cmdOn(); w.advance(60000); return w; }

Object.assign(tests, {
  'demo: no things or actions needed'() {
    const w = demoWorld(); w.run(undefined); w.cmdOn(); w.advance(60000); w.cmdOff();
    assert.strictEqual(w.data().e, 0); assert.strictEqual(w.warnings.length, 0);
  },
  'demo: after 60 s'() {
    const d = demo60().data().d;
    for (const x of DEMO.devices.filter(x => x.mode === 'ok')) {
      assert.ok(d[x.name] && Math.abs(d[x.name].q - x.q) <= 8, x.name + ' ' + JSON.stringify(d[x.name]));
      assert.strictEqual(d[x.name].a, 1, x.name);
    }
    assert.strictEqual(d.LivingRoom_Thermostat.a, 0); assert.ok(d.LivingRoom_Thermostat.q !== undefined);
    assert.ok(!d.Kitchen_Temperature || d.Kitchen_Temperature.q === undefined);
    assert.ok(DEMO.devices.length === 15 && DEMO.devices.filter(x => x.router).length === 7);
  },
  'demo: routers within 2 s'() {
    const w = demoWorld(); w.run(undefined); w.cmdOn(); w.advance(2000);
    const d = w.data().d;
    for (const x of DEMO.devices.filter(x => x.router)) assert.ok(d[x.name] && d[x.name].q !== undefined, x.name);
  },
  'demo: deterministic'() {
    assert.strictEqual(JSON.stringify(demo60().data()), JSON.stringify(demo60().data()));
  },
  'demo: stops'() {
    const w = demo60(); w.cmdOff(); const n = w.writes().length;
    assert.deepStrictEqual(w.liveTimers(), []);
    w.advance(60000); assert.strictEqual(w.writes().length, n);
  },
  'demo: colours'() {
    const qs = Object.values(demo60().data().d).filter(x => x.q !== undefined && x.a !== 0).map(x => x.q);
    assert.ok(qs.some(q => q <= 30), 'red'); assert.ok(qs.some(q => q > 30 && q <= 100), 'yellow'); assert.ok(qs.some(q => q >= 120), 'green');
  }
});

module.exports = { world, buildScript, config, tests };

if (require.main === module) {
  const all = tests;
  let fail = 0;
  for (const [name, fn] of Object.entries(all)) {
    try { fn(); console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
  }
  console.log(Object.keys(all).length - fail + '/' + Object.keys(all).length + ' ok');
  process.exit(fail ? 1 : 0);
}
