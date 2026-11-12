// SPDX-License-Identifier: EPL-2.0
// ===== Zigbee radio map: generator functions =====
// Pure functions without dependencies, used by generator.html (global ZMGen), by build.js and by the tests (module).
// parseDevices: Zigbee2MQTT device list -> devices; validate: form values -> errors;
// generatePage / generateRule: YAML text for the Code tab of a new floor plan page / a new rule.
(function (root) {
  'use strict';

  var TEXTS = {
    en: {
      pageLabel: 'Zigbee radio map',
      liveOn: ['● Live · ', ' min left'],
      liveOff: '○ Live off – tap to start',
      justNow: 'just now', minAgo: ['', ' min ago'], hAgo: ['', ' h ago'], dAgo: ['', ' days ago'],
      noValue: 'no value yet', offline: 'offline',
      legendLqi: 'LQI  ≤30 · 75 · ≥120',
      legendSymbols: 'white = no value yet · grey = offline · pale = older than this live session · ⟳ router · ◉ end device',
      coordinator: 'Coordinator',
      parkedNote: 'New devices are parked in a grid across the image, sorted by name. Drag them to their place in edit mode, then delete this note.'
    },
    de: {
      pageLabel: 'Zigbee-Funkkarte',
      liveOn: ['● Live · noch ', ' min'],
      liveOff: '○ Live aus – antippen',
      justNow: 'gerade eben', minAgo: ['vor ', ' min'], hAgo: ['vor ', ' h'], dAgo: ['vor ', ' Tagen'],
      noValue: 'noch kein Wert', offline: 'offline',
      legendLqi: 'LQI  ≤30 · 75 · ≥120',
      legendSymbols: 'weiß = noch kein Wert · grau = offline · blass = älter als diese Live-Runde · ⟳ Router · ◉ Endgerät',
      coordinator: 'Koordinator',
      parkedNote: 'Neue Geräte stehen als Raster über dem Bild, nach Namen sortiert. Im Bearbeiten-Modus an ihren Platz ziehen, dann diesen Hinweis löschen.'
    }
  };

  var ERRORS = {
    en: {
      empty: 'The device list is empty.',
      html: 'The device list looks like HTML. Paste the JSON of zigbee2mqtt/bridge/devices or one device name per line.',
      badJson: 'The device list is not valid JSON (is it complete?).',
      notArray: 'This JSON is not a device list. Use the message of the topic zigbee2mqtt/bridge/devices (it starts with "[").',
      noNames: 'No entry of the JSON list has a "friendly_name".',
      duplicate: 'Device name used twice: ',
      typeWord: 'Unknown device type (use router, coordinator or enddevice) in line: ',
      twoCoordinators: 'More than one coordinator in the list.',
      itemName: 'Item names may contain only letters, digits and _, and must not start with a digit: ',
      sameItems: 'The live item and the data item need different names.',
      thing: 'The broker thing UID looks like mqtt:broker:mybroker (at least three parts separated by ":").',
      baseTopic: 'The base topic must not be empty and must not contain # or +, or start or end with /.',
      imageSize: 'Image width and height must be whole numbers of at least 100.',
      timeout: 'The live time must be a whole number of minutes between 1 and 120.',
      imageUrl: 'The image URL is empty.'
    },
    de: {
      empty: 'Die Geräteliste ist leer.',
      html: 'Die Geräteliste sieht nach HTML aus. Das JSON von zigbee2mqtt/bridge/devices oder einen Gerätenamen pro Zeile einfügen.',
      badJson: 'Die Geräteliste ist kein gültiges JSON (ist sie vollständig?).',
      notArray: 'Dieses JSON ist keine Geräteliste. Die Nachricht des Topics zigbee2mqtt/bridge/devices verwenden (sie beginnt mit "[").',
      noNames: 'Kein Eintrag der JSON-Liste hat einen "friendly_name".',
      duplicate: 'Gerätename doppelt: ',
      typeWord: 'Unbekannter Gerätetyp (router, coordinator oder enddevice) in Zeile: ',
      twoCoordinators: 'Mehr als ein Koordinator in der Liste.',
      itemName: 'Item-Namen dürfen nur Buchstaben, Ziffern und _ enthalten und nicht mit einer Ziffer beginnen: ',
      sameItems: 'Live-Item und Daten-Item brauchen verschiedene Namen.',
      thing: 'Die UID des Broker-Things sieht aus wie mqtt:broker:meinbroker (mindestens drei Teile, getrennt durch ":").',
      baseTopic: 'Das Basis-Topic darf nicht leer sein, kein # oder + enthalten und nicht mit / beginnen oder enden.',
      imageSize: 'Bildbreite und -höhe müssen ganze Zahlen ab 100 sein.',
      timeout: 'Die Live-Dauer muss eine ganze Zahl von Minuten zwischen 1 und 120 sein.',
      imageUrl: 'Die Bild-URL ist leer.'
    }
  };

  function err(lang) { return ERRORS[lang] || ERRORS.en; }
  function texts(lang) { return TEXTS[lang] || TEXTS.en; }

  // coordinator first, then by name, case-insensitive (plain code unit order: the same in every browser)
  function sortDevices(list) {
    var rank = function (d) { return d.type === 'coordinator' ? 0 : 1; };
    return list.slice().sort(function (a, b) {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      var x = a.name.toLowerCase(), y = b.name.toLowerCase();
      return x < y ? -1 : x > y ? 1 : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
  }

  // a router whose exposes (searched through nested features) contain a settable/gettable "state" (access bit 4)
  function hasGettableState(exposes) {
    if (!exposes || typeof exposes.length !== 'number') return false;
    for (var i = 0; i < exposes.length; i++) {
      var e = exposes[i];
      if (!e || typeof e !== 'object') continue;
      if (e.property === 'state' && (Number(e.access) & 4)) return true;
      if (hasGettableState(e.features)) return true;
    }
    return false;
  }

  function parseDevices(text, lang) {
    var E = err(lang), out = [], errors = [];
    var t = String(text === undefined || text === null ? '' : text).trim();
    if (!t) return { devices: [], errors: [E.empty] };
    if (t.charAt(0) === '<') return { devices: [], errors: [E.html] };
    if (t.charAt(0) === '[' || t.charAt(0) === '{' || t.charAt(0) === '"' || t === 'null') {
      var j;
      try { j = JSON.parse(t); } catch (e) { return { devices: [], errors: [E.badJson] }; }
      if (!Array.isArray(j)) return { devices: [], errors: [E.notArray] };
      var named = 0;
      for (var i = 0; i < j.length; i++) {
        var d = j[i];
        if (!d || typeof d !== 'object' || typeof d.friendly_name !== 'string' || !d.friendly_name) continue;
        named++;
        if (d.disabled === true) continue;
        var type = d.type === 'Coordinator' ? 'coordinator' : d.type === 'Router' ? 'router' : 'enddevice';
        out.push({ name: d.friendly_name, type: type,
          query: type === 'router' && !!d.definition && hasGettableState(d.definition.exposes) });
      }
      if (!named) errors.push(E.noNames);
    } else {
      var lines = t.split(/\r?\n/);
      for (var k = 0; k < lines.length; k++) {
        var line = lines[k].trim();
        if (!line || line.charAt(0) === '#') continue;
        var semi = line.lastIndexOf(';'), name = line, word = 'enddevice';
        if (semi >= 0) {
          name = line.substring(0, semi).trim();
          word = line.substring(semi + 1).trim().toLowerCase().replace(/[\s_-]/g, '');
          if (word !== 'router' && word !== 'coordinator' && word !== 'enddevice') { errors.push(E.typeWord + line); continue; }
        }
        if (!name) { errors.push(E.typeWord + line); continue; }
        out.push({ name: name, type: word, query: false });
      }
    }
    var seen = {}, coordinators = 0;
    for (var n = 0; n < out.length; n++) {
      if (Object.prototype.hasOwnProperty.call(seen, out[n].name)) errors.push(E.duplicate + out[n].name);
      seen[out[n].name] = true;
      if (out[n].type === 'coordinator') coordinators++;
    }
    if (coordinators > 1) errors.push(E.twoCoordinators);
    if (!errors.length && !out.length) errors.push(E.empty);
    if (errors.length) return { devices: [], errors: errors };
    return { devices: sortDevices(out), errors: [] };
  }

  function isWhole(v, min, max) {
    var n = Number(v);
    return String(v).trim() !== '' && Math.floor(n) === n && n >= min && n <= max;
  }

  // opts: { lang, liveItem, dataItem, thing, baseTopic, imageWidth, imageHeight, timeoutMin, imageUrl }
  function validate(opts) {
    var E = err(opts.lang), errors = [], itemRe = /^[A-Za-z_][A-Za-z0-9_]*$/;
    [opts.liveItem, opts.dataItem].forEach(function (n) {
      if (!itemRe.test(String(n === undefined ? '' : n))) errors.push(E.itemName + JSON.stringify(String(n === undefined ? '' : n)));
    });
    if (itemRe.test(String(opts.liveItem)) && opts.liveItem === opts.dataItem) errors.push(E.sameItems);
    if (!/^[A-Za-z0-9_-]+(:[A-Za-z0-9_-]+){2,}$/.test(String(opts.thing || ''))) errors.push(E.thing);
    var b = String(opts.baseTopic === undefined ? '' : opts.baseTopic);
    if (!b || /[#+]/.test(b) || b.charAt(0) === '/' || b.charAt(b.length - 1) === '/') errors.push(E.baseTopic);
    if (!isWhole(opts.imageWidth, 100, 1e6) || !isWhole(opts.imageHeight, 100, 1e6)) errors.push(E.imageSize);
    if (!isWhole(opts.timeoutMin, 1, 120)) errors.push(E.timeout);
    if (!String(opts.imageUrl === undefined ? '' : opts.imageUrl).trim()) errors.push(E.imageUrl);
    return errors;
  }

  function round1(v) { return String(Math.round(v * 10) / 10); }

  // a grid over the image, filled row by row from the top; coords "y,x" with y measured from the bottom
  function layoutParked(n, width, height) {
    var out = [];
    if (!(n > 0)) return out;
    var cols = Math.max(1, Math.ceil(Math.sqrt(n * width / height))), cell = width / cols;
    for (var i = 0; i < n; i++) {
      out.push(round1(height - (Math.floor(i / cols) + 0.5) * cell) + ',' + round1((i % cols + 0.5) * cell));
    }
    return out;
  }

  // ---- page ----
  var ICON_ROUTER = 'f7:arrow_2_circlepath_circle_fill', ICON_END = 'f7:largecircle_fill_circle';
  var WHITE = '#ffffff', GREY = '#9e9e9e', ORANGE = '#ef6c00';
  var SHADOW = 'drop-shadow(0 0 1.5px rgba(0,0,0,0.85))';
  var BLINK_S = 0.9, BLINK_RECENT_S = 15;
  var STYLESHEET = '@keyframes zmA { 0% { transform: scale(1); } 30% { transform: scale(2); filter: drop-shadow(0 0 4px #fff) drop-shadow(0 0 2px #000); } 100% { transform: scale(1); } }\n' +
    '@keyframes zmB { 0% { transform: scale(1); } 30% { transform: scale(2); filter: drop-shadow(0 0 4px #fff) drop-shadow(0 0 2px #000); } 100% { transform: scale(1); } }';
  var HUE = 'Math.round(x.q <= 75 ? Math.max(0, x.q - 30) / 45 * 60 : 60 + Math.min(45, x.q - 75) / 45 * 60)';
  var HAS_Q = '(x && x.q !== undefined)';

  // single-quoted JS string literal for an expression
  function q(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }

  // the JSON of the data item, parsed defensively: '-' while loading, NULL/UNDEF before the first write,
  // a truncated value: anything that is not "{...}" gives an empty object (an evaluation error would not throw)
  function dataExpr(dataItem) {
    return "(s => (s && s[0] === '{' && s[s.length - 1] === '}') ? JSON.parse(s) : { d: {} })(items." + dataItem + '.state)';
  }

  // expression with D = data and x = the entry of this marker's device (config.name) or undefined
  function devExpr(dataItem, body) {
    return '=(D => (x => ' + body + ')(D.d ? D.d[config.name] : undefined))(' + dataExpr(dataItem) + ')';
  }

  function ageExpr(T) {
    var p = function (pair, v) { return q(pair[0]) + ' + ' + v + ' + ' + q(pair[1]); };
    return '(m => m < 1 ? ' + q(T.justNow) + ' : m < 60 ? ' + p(T.minAgo, 'm') + ' : m < 2880 ? ' + p(T.hAgo, 'Math.round(m / 60)') +
      ' : ' + p(T.dAgo, 'Math.round(m / 1440)') + ')(Math.round((dayjs().unix() - x.t) / 60))';
  }

  function marker(config) { return { component: 'oh-plan-marker', config: config, slots: { 'default': [] } }; }

  function deviceMarker(d, coords, opts, T) {
    if (d.type === 'coordinator') {
      return marker({ coords: coords, name: T.coordinator, icon: ICON_ROUTER, iconSize: 26, iconRotation: 0,
        iconStyle: { color: ORANGE, filter: SHADOW }, tooltip: T.coordinator });
    }
    var di = opts.dataItem;
    return marker({
      coords: coords, name: d.name, icon: d.type === 'router' ? ICON_ROUTER : ICON_END, iconSize: 20, iconRotation: 0,
      iconStyle: {
        color: devExpr(di, '!' + HAS_Q + " ? '" + WHITE + "' : (x.a === 0 ? '" + GREY + "' : 'hsl(' + " + HUE + " + ', 85%, 42%)')"),
        opacity: devExpr(di, '(' + HAS_Q + ' && D.s0 && x.t < D.s0) ? 0.4 : 1'),
        animation: devExpr(di, '(D.u === config.name && ' + HAS_Q + ' && dayjs().unix() - x.t <= ' + BLINK_RECENT_S + ') ? ' +
          "((D.n % 2) ? 'zmA' : 'zmB') + ' " + BLINK_S + "s ease-out 1' : 'none'"),
        filter: SHADOW
      },
      tooltip: devExpr(di, 'config.name + (' + HAS_Q + " ? ' · LQI ' + x.q + ' · ' + " + ageExpr(T) + ' : ' + q(' · ' + T.noValue) +
        ') + ((x && x.a === 0) ? ' + q(' · ' + T.offline) + " : '')")
    });
  }

  function label(name, coords, text, style, extra) {
    // MainUI renders the label as a block div inside an iconSize-wide icon: max-content lets the background follow the text
    var base = { width: 'max-content', padding: '4px 10px', borderRadius: '10px', fontSize: '13px', lineHeight: '1.3', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' };
    var k, st = {}, cfg = { coords: coords, name: name, useTooltipAsLabel: true, tooltip: text, tooltipStyle: st, iconSize: 40 };
    for (k in base) st[k] = base[k];
    for (k in style) st[k] = style[k];
    for (k in (extra || {})) cfg[k] = extra[k];
    return marker(cfg);
  }

  function labelMarkers(opts, T, parked) {
    var w = Number(opts.imageWidth), h = Number(opts.imageHeight);
    var at = function (p) { return Math.round(h * p) + ',' + Math.round(w * 0.04); };
    var hide = +(Math.log(700 / w) / Math.LN2).toFixed(1);
    if (hide === 0) hide = 0;                                   // no "-0"
    var on = 'items.' + opts.liveItem + ".state === 'ON'";
    var left = 'Math.max(0, Math.ceil(((D => D.e || 0)(' + dataExpr(opts.dataItem) + ') - dayjs().unix()) / 60))';
    var plain = { background: 'rgba(255,255,255,0.9)', color: '#222' };
    var out = [
      label('Live', at(0.04), '=(' + on + ') ? ' + q(T.liveOn[0]) + ' + ' + left + ' + ' + q(T.liveOn[1]) + ' : ' + q(T.liveOff),
        { background: '=(' + on + ") ? '#2e7d32' : '#616161'", color: 'white', padding: '6px 14px', borderRadius: '16px',
          fontWeight: 'bold', fontSize: '15px', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' },
        { item: opts.liveItem, action: 'toggle', actionItem: opts.liveItem, actionCommand: 'ON', actionCommandAlt: 'OFF' }),
      label('Legend LQI', at(0.11), T.legendLqi,
        { background: 'linear-gradient(90deg, hsl(0,85%,42%) 0%, hsl(60,85%,42%) 50%, hsl(120,85%,42%) 100%)',
          color: 'white', textShadow: '0 0 3px #000', fontWeight: 'bold' }),
      label('Legend symbols', at(0.18), T.legendSymbols, plain, { zoomVisibilityMin: hide })
    ];
    if (parked) out.push(label('Parked note', at(0.25), T.parkedNote, plain, { zoomVisibilityMin: hide }));
    return out;
  }

  // ---- tiny YAML writer: block mappings and sequences, every string as a JSON (= YAML double-quoted) scalar ----
  // JSON text that is also safe inside YAML: escape the characters YAML treats as line breaks or as non-printable
  function jsonSafe(v, indent) {
    return JSON.stringify(v, null, indent).replace(/[\u007f-\u009f\u2028\u2029\ufeff]/g, function (c) {
      return '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }
  function yamlScalar(v) {
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return jsonSafe(String(v));
  }
  function yamlLines(v, indent, out) {
    var pad = new Array(indent + 1).join(' ');
    if (Array.isArray(v)) {
      v.forEach(function (x) {
        var sub = [];
        yamlLines(x, indent + 2, sub);
        out.push(pad + '- ' + sub[0].substring(indent + 2));
        for (var i = 1; i < sub.length; i++) out.push(sub[i]);
      });
      return;
    }
    Object.keys(v).forEach(function (k) {
      var x = v[k];
      if (x === undefined) return;
      if (Array.isArray(x) && !x.length) out.push(pad + k + ': []');
      else if (x && typeof x === 'object' && !Object.keys(x).length) out.push(pad + k + ': {}');
      else if (x && typeof x === 'object') { out.push(pad + k + ':'); yamlLines(x, Array.isArray(x) ? indent : indent + 2, out); }
      else out.push(pad + k + ': ' + yamlScalar(x));
    });
  }
  function toYaml(v) { var out = []; yamlLines(v, 0, out); return out.join('\n') + '\n'; }

  // opts: { lang, label, imageUrl, imageWidth, imageHeight, liveItem, dataItem, devices, positions }
  function generatePage(opts) {
    var T = texts(opts.lang), pos = opts.positions || {}, devices = opts.devices || [];
    var w = Number(opts.imageWidth), h = Number(opts.imageHeight);
    var missing = devices.filter(function (d) { return !Object.prototype.hasOwnProperty.call(pos, d.name); });
    var grid = layoutParked(missing.length, w, h), parkedAt = {};
    missing.forEach(function (d, i) { parkedAt[d.name] = grid[i]; });
    var markers = devices.map(function (d) {
      return deviceMarker(d, Object.prototype.hasOwnProperty.call(pos, d.name) ? String(pos[d.name]) : parkedAt[d.name], opts, T);
    }).concat(labelMarkers(opts, T, missing.length > 0));
    var page = {
      config: { label: String(opts.label || '').trim() ? String(opts.label) : T.pageLabel, imageUrl: String(opts.imageUrl),
        imageWidth: w, imageHeight: h, backgroundColor: 'blackwhite', tooltipColor: 'white', noZoomAnimation: true,
        sidebar: true, stylesheet: STYLESHEET },
      markers: markers
    };
    return '# SPDX-License-Identifier: EPL-2.0\n# Zigbee radio map: floor plan page, generated by zigbee-radio-map (generator.html).\n' +
      '# Pages -> + -> Floor plan -> Code tab: replace everything with this text, then save.\n' +
      '# Data: items ' + opts.liveItem + ' and ' + opts.dataItem + ', written by the rule of the same generator.\n' +
      toYaml(page);
  }

  // ---- rule ----
  var RULE_HEADER = '// SPDX-License-Identifier: EPL-2.0\n// Zigbee radio map (zigbee-radio-map, generator.html): config, transport, core.\n';
  // opts: { mode: 'mqtt'|'demo', uid, label, liveItem, dataItem, thing, switchThing, baseTopic, timeoutMin, query, demo }
  // sources: { core, mqtt, demo } (file contents of src/rule_core.js, src/transport_mqtt.js, src/transport_demo.js)
  function generateRule(opts, sources) {
    var demo = opts.mode === 'demo';
    var zm = { liveItem: opts.liveItem, dataItem: opts.dataItem };
    if (!demo) { zm.thing = opts.thing; zm.switchThing = !!opts.switchThing; }
    zm.baseTopic = opts.baseTopic;
    zm.timeoutMs = Math.round(Number(opts.timeoutMin) * 60000);
    zm.writeMs = 1000;
    if (demo) zm.demo = opts.demo; else zm.query = (opts.query || []).slice();
    var script = RULE_HEADER + 'var ZM = ' + jsonSafe(zm, 2) + ';\n' + (demo ? sources.demo : sources.mqtt) + '\n' + sources.core;
    var triggers = [['core.ItemCommandTrigger', { itemName: opts.liveItem }]];
    if (!demo) {
      triggers.push(['core.ChannelEventTrigger', { channelUID: opts.thing + ':zbmap' }]);
      triggers.push(['core.ChannelEventTrigger', { channelUID: opts.thing + ':zbmap_avail' }]);
    }
    triggers.push(['core.SystemStartlevelTrigger', { startlevel: 100 }]);
    var min = Math.round(Number(opts.timeoutMin));
    var description = demo
      ? 'Demo of the Zigbee radio map: while ' + opts.liveItem + ' is ON (' + min + ' min), simulated link quality values of invented ' +
        'devices are written as JSON to ' + opts.dataItem + '. No MQTT needed. Press "Run now" once to create the two items.'
      : 'While ' + opts.liveItem + ' is ON (' + min + ' min), the link quality of all Zigbee2MQTT devices is written as JSON to ' +
        opts.dataItem + ' (at most once per second). Messages: channels zbmap and zbmap_avail of ' + opts.thing +
        '. Press "Run now" once to create the two items.';
    var y = ['uid: ' + yamlScalar(opts.uid),
      'label: ' + yamlScalar(String(opts.label || '').trim() ? opts.label : 'Zigbee radio map: live link quality'),
      'description: ' + yamlScalar(description), 'configuration: {}', 'triggers:'];
    triggers.forEach(function (t, i) {
      y.push('  - id: "' + (i + 1) + '"', '    configuration:');
      Object.keys(t[1]).forEach(function (k) { y.push('      ' + k + ': ' + yamlScalar(t[1][k])); });
      y.push('    type: ' + t[0]);
    });
    y.push('conditions: []', 'actions:', '  - id: "script"', '    configuration:', '      type: application/javascript', '      script: |');
    script.replace(/\n$/, '').split('\n').forEach(function (line) { y.push(line ? '        ' + line : ''); });
    y.push('    type: script.ScriptAction');
    return '# SPDX-License-Identifier: EPL-2.0\n# Zigbee radio map: rule, generated by zigbee-radio-map (generator.html).\n' +
      '# Rules -> + -> Code tab: replace everything with this text, save, then press "Run now" once.\n' + y.join('\n') + '\n';
  }

  // demo/devices.json entries carry { demo: { q, mode } } next to the Zigbee2MQTT fields
  function demoDevices(list) {
    return list.filter(function (d) { return d && d.demo; }).map(function (d) {
      return { name: d.friendly_name, router: d.type === 'Router', q: d.demo.q === undefined ? 0 : d.demo.q, mode: d.demo.mode };
    });
  }

  var ZMGen = { TEXTS: TEXTS, ERRORS: ERRORS, parseDevices: parseDevices, validate: validate, layoutParked: layoutParked,
    generatePage: generatePage, generateRule: generateRule, RULE_HEADER: RULE_HEADER, demoDevices: demoDevices, toYaml: toYaml };
  if (typeof module !== 'undefined' && module.exports) module.exports = ZMGen;
  else root.ZMGen = ZMGen;
})(this);
