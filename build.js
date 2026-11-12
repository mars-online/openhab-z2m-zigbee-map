// SPDX-License-Identifier: EPL-2.0
// Build: node build.js  -> generator.html (src/generator.src.html with src/gen.js and the rule sources inlined)
//                          demo/zigbee_map_demo_page.yaml, demo/zigbee_map_demo_rule.yaml
// No arguments, no dependencies. Running it twice changes nothing.
'use strict';
const fs = require('fs'), path = require('path');
const G = require('./src/gen.js');

const ROOT = __dirname;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DEMO_IMAGE = 'https://demo.openhab.org/static/floorplan/groundfloor.jpg';

function sources() {
  return { core: read('src/rule_core.js'), mqtt: read('src/transport_mqtt.js'), demo: read('src/transport_demo.js') };
}

// text that is placed inside an inline <script>: "</script" must not end it early
const inline = s => s.replace(/<\/script/gi, '<\\/script');

function demoPageOpts() {
  return { lang: 'en', label: 'Zigbee radio map (demo)', imageUrl: DEMO_IMAGE, imageWidth: 703, imageHeight: 786,
    liveItem: 'ZigbeeMapDemo_Live', dataItem: 'ZigbeeMapDemo_Data',
    devices: G.parseDevices(read('demo/devices.json')).devices, positions: JSON.parse(read('demo/positions.json')) };
}

function demoRuleOpts() {
  return { mode: 'demo', uid: 'zigbee_radio_map_demo', label: 'Zigbee radio map (demo): simulated link quality',
    liveItem: 'ZigbeeMapDemo_Live', dataItem: 'ZigbeeMapDemo_Data', baseTopic: 'zigbee2mqtt', timeoutMin: 15,
    demo: { seed: 1, devices: G.demoDevices(JSON.parse(read('demo/devices.json'))) } };
}

// returns { relative path: content }
function build() {
  const src = sources();
  const html = read('src/generator.src.html')
    .replace('/*__GEN__*/', () => inline(read('src/gen.js')))
    .replace('/*__SOURCES__*/', () => 'ZMGen.SOURCES = ' + inline(JSON.stringify(src)) + ';');
  return {
    'generator.html': html,
    'demo/zigbee_map_demo_page.yaml': G.generatePage(demoPageOpts()),
    'demo/zigbee_map_demo_rule.yaml': G.generateRule(demoRuleOpts(), src)
  };
}

module.exports = { build, sources, demoPageOpts, demoRuleOpts };

if (require.main === module) {
  const files = build();
  for (const f of Object.keys(files)) {
    fs.writeFileSync(path.join(ROOT, f), files[f]);
    console.log(f + ': ' + files[f].length + ' chars');
  }
}
