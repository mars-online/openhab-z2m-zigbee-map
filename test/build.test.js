// SPDX-License-Identifier: EPL-2.0
// Tests for the rule YAML generation and for build.js (reproducible, built files current, generator.html offline).
// Usage: node community/zigbee-radio-map/test/build.test.js   (exit code 1 on failure)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const yaml = require('js-yaml');
const G = require('../src/gen.js');
const B = require('../build.js');
const { world } = require('./rule.test.js');

const ROOT = path.join(__dirname, '..');
const SOURCES = B.sources();

function mqttOpts(over) {
  return Object.assign({ mode: 'mqtt', uid: 'zigbee_radio_map', label: '', liveItem: 'ZigbeeMap_Live', dataItem: 'ZigbeeMap_Data',
    thing: 'mqtt:broker:mybroker', switchThing: false, baseTopic: 'zigbee2mqtt', timeoutMin: 15, query: ['Kitchen_Plug', 'it\'s "x"'] }, over || {});
}
const zmOf = script => { const ctx = vm.createContext({}); vm.runInContext(script.substring(0, script.indexOf('\n};\n') + 3), ctx); return vm.runInContext('ZM', ctx); };

const tests = {
  'rule YAML: shape, script and triggers (mqtt)'() {
    const r = yaml.load(G.generateRule(mqttOpts(), SOURCES));
    assert.deepStrictEqual(Object.keys(r), ['uid', 'label', 'description', 'configuration', 'triggers', 'conditions', 'actions']);
    assert.strictEqual(r.uid, 'zigbee_radio_map'); assert.strictEqual(r.label, 'Zigbee radio map: live link quality');
    assert.deepStrictEqual(r.configuration, {}); assert.deepStrictEqual(r.conditions, []);
    assert.deepStrictEqual(r.triggers.map(t => [t.type, t.configuration]), [
      ['core.ItemCommandTrigger', { itemName: 'ZigbeeMap_Live' }],
      ['core.ChannelEventTrigger', { channelUID: 'mqtt:broker:mybroker:zbmap' }],
      ['core.ChannelEventTrigger', { channelUID: 'mqtt:broker:mybroker:zbmap_avail' }],
      ['core.SystemStartlevelTrigger', { startlevel: 100 }]]);
    assert.strictEqual(r.actions.length, 1);
    const a = r.actions[0];
    assert.strictEqual(a.type, 'script.ScriptAction'); assert.strictEqual(a.configuration.type, 'application/javascript');
    const zm = zmOf(a.configuration.script);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(zm)), { liveItem: 'ZigbeeMap_Live', dataItem: 'ZigbeeMap_Data', thing: 'mqtt:broker:mybroker',
      switchThing: false, baseTopic: 'zigbee2mqtt', timeoutMs: 900000, writeMs: 1000, query: ['Kitchen_Plug', 'it\'s "x"'] });
    assert.strictEqual(a.configuration.script, G.RULE_HEADER + 'var ZM = ' + JSON.stringify(zm, null, 2) + ';\n' + SOURCES.mqtt + '\n' + SOURCES.core);
    assert.ok(G.generateRule(mqttOpts(), SOURCES).includes('      script: |\n        // SPDX-License-Identifier: EPL-2.0\n'));
    assert.ok(G.generateRule(mqttOpts(), SOURCES).startsWith('# SPDX-License-Identifier: EPL-2.0\n'));
  },
  'rule YAML: demo mode'() {
    const r = yaml.load(G.generateRule({ mode: 'demo', uid: 'u1', label: 'L', liveItem: 'A_Live', dataItem: 'A_Data', baseTopic: 'zigbee2mqtt',
      timeoutMin: 5, demo: { seed: 1, devices: [{ name: 'x', router: true, q: 100, mode: 'ok' }] } }, SOURCES));
    assert.strictEqual(r.label, 'L');
    assert.deepStrictEqual(r.triggers.map(t => t.type), ['core.ItemCommandTrigger', 'core.SystemStartlevelTrigger']);
    const s = r.actions[0].configuration.script, zm = zmOf(s);
    assert.strictEqual(zm.timeoutMs, 300000); assert.strictEqual(zm.demo.devices[0].name, 'x');
    assert.ok(s.endsWith(SOURCES.demo + '\n' + SOURCES.core));
  },
  'rule YAML: awkward values stay intact'() {
    const names = ['it\'s "x"', 'Küche: 1', '#hash', ' lead', 'a b', 'c\u0085d'];
    const text = G.generateRule(mqttOpts({ query: names, label: 'x: "y" # z', uid: 'my_rule' }), SOURCES);
    const r = yaml.load(text);
    assert.strictEqual(r.label, 'x: "y" # z');
    assert.deepStrictEqual(Array.from(zmOf(r.actions[0].configuration.script).query), names);
  },
  'generated MQTT script runs in the sandbox (ON, one message, OFF)'() {
    const r = yaml.load(G.generateRule(mqttOpts(), SOURCES));
    const w = world({ script: r.actions[0].configuration.script });
    w.run(undefined); w.cmdOn(); w.advance(3000);
    w.msg('zigbee2mqtt/Kitchen_Plug', '{"linkquality":120}');
    assert.strictEqual(w.data().d.Kitchen_Plug.q, 120);
    assert.strictEqual(w.published.length, 2);
    w.cmdOff(); assert.strictEqual(w.data().e, 0);
  },
  'build is reproducible and the built files are current'() {
    const a = B.build(), b = B.build();
    assert.deepStrictEqual(a, b);
    assert.deepStrictEqual(Object.keys(a).sort(), ['demo/zigbee_map_demo_page.yaml', 'demo/zigbee_map_demo_rule.yaml', 'generator.html']);
    for (const f of Object.keys(a)) assert.ok(fs.readFileSync(path.join(ROOT, f), 'utf8') === a[f], f + ' is not current: run node build.js');
  },
  'demo files'() {
    const p = yaml.load(fs.readFileSync(path.join(ROOT, 'demo', 'zigbee_map_demo_page.yaml'), 'utf8'));
    assert.strictEqual(p.config.imageUrl, 'https://demo.openhab.org/static/floorplan/groundfloor.jpg');
    assert.strictEqual(p.config.label, 'Zigbee radio map (demo)');
    assert.strictEqual(p.markers.length, 16 + 3);
    const pos = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', 'positions.json'), 'utf8'));
    for (const m of p.markers.filter(m => !m.config.useTooltipAsLabel)) assert.strictEqual(m.config.coords, pos[m.config.name], m.config.name);
    const r = yaml.load(fs.readFileSync(path.join(ROOT, 'demo', 'zigbee_map_demo_rule.yaml'), 'utf8'));
    assert.strictEqual(r.uid, 'zigbee_radio_map_demo');
    assert.strictEqual(r.triggers[0].configuration.itemName, 'ZigbeeMapDemo_Live');
    assert.strictEqual(zmOf(r.actions[0].configuration.script).demo.devices.length, 15);
  },
  'generator.html is offline and complete'() {
    const html = fs.readFileSync(path.join(ROOT, 'generator.html'), 'utf8');
    assert.ok(!/__GEN__|__SOURCES__/.test(html));
    assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'external script');
    assert.ok(!/<link[^>]*\shref=["']?https?:/i.test(html), 'external stylesheet');
    assert.ok(!/@import|url\(\s*["']?https?:/i.test(html), 'external css/font');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.ok(scripts.length >= 1);
    for (const s of scripts) new vm.Script(s);
    const ctx = { window: {} }; ctx.window = ctx;
    vm.runInNewContext(scripts[0], ctx);
    assert.strictEqual(ctx.ZMGen.SOURCES.core, SOURCES.core);
  }
};

tests['generator.html: form fields, both languages, test hook'] = function () {
  const html = fs.readFileSync(path.join(ROOT, 'generator.html'), 'utf8');
  assert.ok(html.includes('window.ZMApp'));
  for (const id of ['zm-lang', 'zm-image', 'zm-url', 'zm-devices', 'zm-thing', 'zm-switch', 'zm-query']) assert.ok(html.includes('id="' + id + '"'), id);
  for (const t of ['Device list', 'Geräteliste', 'MQTT broker thing UID', 'UID des MQTT-Broker-Things', 'Copy', 'Kopieren']) assert.ok(html.includes(t), t);
  assert.ok(html.split('\n').slice(0, 3).join('\n').includes('SPDX-License-Identifier: EPL-2.0'));
};

module.exports = { tests };

if (require.main === module) {
  let fail = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { fn(); console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
  }
  console.log(Object.keys(tests).length - fail + '/' + Object.keys(tests).length + ' ok');
  process.exit(fail ? 1 : 0);
}
