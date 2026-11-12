// SPDX-License-Identifier: EPL-2.0
// Probe image source: renders a generated page as plain HTML, with the page expressions evaluated like MainUI does
// (config = the marker's raw config) and with data produced by the real rule script in the test sandbox.
// An approximation of the MainUI plan page (Leaflet is replaced by absolutely positioned elements), good for colours,
// positions, labels and texts. Three panels: desktop 1000 px while live (with the tooltip of TIP_NAME), desktop just
// after live was switched off and on again (values of the earlier session are pale), phone 412 px with live off.
// Usage: node test/probe.js OUT.html PAGE.yaml RULE.yaml BACKGROUND_IMAGE [seconds=60]
//        then render OUT.html, e.g. with headless Firefox (1000 + 1000 + 412 px wide panels side by side)
'use strict';
const fs = require('fs'), path = require('path');
const yaml = require('js-yaml');
const expr = require('jse-eval');
const dayjs = require('dayjs');
expr.jsep.plugins.register(require('@jsep-plugin/regex').default || require('@jsep-plugin/regex'),
  require('@jsep-plugin/arrow').default || require('@jsep-plugin/arrow'),
  require('@jsep-plugin/object').default || require('@jsep-plugin/object'),
  require('@jsep-plugin/template').default || require('@jsep-plugin/template'));
const { world } = require('./rule.test.js');

const [OUT, PAGE, RULE, BG] = process.argv.slice(2, 6);
const SECONDS = Number(process.argv[6] || 60);
const TIP_NAME = 'Front_Door', RESTART_MS = 1500;
if (!OUT || !PAGE || !RULE || !BG) { console.error('usage: node test/probe.js OUT.html PAGE.yaml RULE.yaml BACKGROUND_IMAGE [seconds]'); process.exit(2); }

const page = yaml.load(fs.readFileSync(PAGE, 'utf8'));
const rule = yaml.load(fs.readFileSync(RULE, 'utf8'));
const script = rule.actions[0].configuration.script;
const liveItem = rule.triggers.find(t => t.type === 'core.ItemCommandTrigger').configuration.itemName;
const W = page.config.imageWidth, H = page.config.imageHeight;

// ---- run the rule: live for SECONDS, then off, wait, on again for RESTART_MS ----
const mqtt = rule.triggers.some(t => t.type === 'core.ChannelEventTrigger');
const w = world({ script, bare: !mqtt, things: [], cfg: { liveItem, dataItem: liveItem.replace(/_Live$/, '_Data') } });
const dataItem = Object.keys(w.states).find(k => k !== liveItem);
const snap = () => ({ states: Object.assign({}, w.states), now: w.now });
w.now = Date.now(); w.run(undefined); w.cmdOn(); w.advance(SECONDS * 1000);
const live = snap();
w.cmdOff(); const off = snap();
w.advance(600000); w.cmdOn(); w.advance(RESTART_MS);
const restart = snap();

function ev(value, s, config) {
  if (typeof value !== 'string' || !value.startsWith('=')) return value;
  const store = new Proxy({}, { get: (t, k) => ({ state: k in s.states ? s.states[k] : '-' }) });
  const dj = (...a) => a.length ? dayjs(...a) : dayjs(s.now);
  const r = expr.evaluate(expr.parse(value.substring(1)), { items: store, Math, Number, JSON, dayjs: dj, screen: {}, user: {}, config });
  if (r instanceof Error) throw r;
  return r;
}
const evAll = (v, s, c) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, evAll(x, s, c)])) : ev(v, s, c);
const css = o => Object.entries(o || {}).map(([k, v]) => k.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + ':' + v).join(';');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function panel(title, width, s, tipName) {
  const scale = width / W, zoom = Math.log2(scale), h = Math.round(H * scale);
  let out = `<div class="panel"><div class="cap">${esc(title)}</div><div class="plan" style="width:${width}px;height:${h}px">`;
  let tip = '';
  for (const m of page.markers) {
    const c = evAll(m.config, s, m.config);
    if (c.zoomVisibilityMin !== undefined && zoom < c.zoomVisibilityMin) continue;
    const [y, x] = c.coords.split(',').map(Number), px = x * scale, py = (H - y) * scale;
    if (c.useTooltipAsLabel) {
      // MainUI: the label sits in a 40 x 40 px icon box centred on the coords and overflows to the right
      out += `<div class="label" style="left:${px - 20}px;top:${py - 20}px;${css(c.tooltipStyle)}">${esc(c.tooltip)}</div>`;
      continue;
    }
    const z = c.iconSize || 40;
    out += `<i class="f7-icons" style="position:absolute;left:${px - z / 2}px;top:${py - z / 2}px;font-size:${z}px;width:${z}px;height:${z}px;line-height:${z}px;${css(c.iconStyle)}">${c.icon.substring(3)}</i>`;
    if (c.name === tipName) tip = `<div class="tip" style="left:${px + 14}px;top:${py - 32}px">${esc(c.tooltip)}</div>`;
  }
  return out + tip + '</div></div>';
}

const font = 'file://' + path.join(__dirname, 'node_modules', 'framework7-icons', 'fonts', 'Framework7Icons-Regular.woff2');
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: 'Framework7 Icons'; src: url('${font}') format('woff2'); }
body { margin: 0; padding: 10px; background: #fff; font: 14px Roboto, 'Noto Sans', Arial, sans-serif; display: flex; gap: 14px; align-items: flex-start; }
.f7-icons { font-family: 'Framework7 Icons'; font-style: normal; font-weight: normal; display: inline-block; letter-spacing: normal;
  text-transform: none; white-space: nowrap; direction: ltr; font-feature-settings: 'liga'; text-align: center; overflow: hidden; }
.cap { font-weight: bold; margin-bottom: 6px; }
.plan { font: 12px/1.5 'Helvetica Neue', Arial, Helvetica, sans-serif; position: relative; overflow: hidden; background: #fff url('file://${path.resolve(BG)}') 0 0 / 100% 100% no-repeat; outline: 1px solid #999; }
.label { position: absolute; white-space: nowrap; }
.tip { position: absolute; background: #fff; color: #222; border-radius: 3px; padding: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.4); font-size: 12px; white-space: nowrap; }
${page.config.stylesheet}
</style>
${panel('Desktop, live ON for ' + SECONDS + ' s (pointer on ' + TIP_NAME + ')', 1000, live, TIP_NAME)}
${panel('Desktop, live off and on again ' + RESTART_MS / 1000 + ' s ago', 1000, restart, '')}
${panel('Phone, live off', 412, Object.assign({}, off, { states: Object.assign({}, off.states, { [liveItem]: 'OFF' }) }), '')}
`;
fs.writeFileSync(OUT, html);
const d = JSON.parse(live.states[dataItem]).d;
console.log('devices with data ' + Object.keys(d).length + ', json ' + live.states[dataItem].length + ' bytes');
console.log(Object.keys(d).map(n => n + ':' + (d[n].q === undefined ? '-' : d[n].q) + (d[n].a === 0 ? '(offline)' : '')).join('  '));
