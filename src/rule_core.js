// SPDX-License-Identifier: EPL-2.0
// ===== Zigbee radio map: rule core =====
// Live link quality (LQI) of Zigbee2MQTT devices for an openHAB floor plan page.
// The generator puts "var ZM = {...};" and one transport (MQTT or demo) above this file.
// Triggers: command on ZM.liveItem, channel events "<topic>#<value>", system start level 100.
// Data item content: {"u":last device,"n":counter,"s0":session start,"e":live end,"d":{name:{"q":lqi,"t":epoch s,"a":1|0}}}
// Values are always collected in memory; the data item is written only while live is ON, at most once per ZM.writeMs.

function zmNow() { return Math.floor(Date.now() / 1000); }

function zmState() {
  var s = cache.private.get('zmState');
  if (!s) {
    s = { u: '', n: 0, s0: 0, e: 0, d: {} };
    cache.private.put('zmState', s);
  }
  return s;
}

function zmCancel(key) {
  var id = cache.private.get(key);
  if (id !== null && id !== undefined) clearTimeout(id);
  cache.private.remove(key);
}

function zmFlush() {
  cache.private.put('zmLastWrite', Date.now());
  var it = items.getItem(ZM.dataItem, true);
  if (it) it.postUpdate(JSON.stringify(zmState()));
}

// Live is ON while the session end (e) is set. force: write now, regardless of live and of the write limit.
function zmWrite(force) {
  if (force) { zmCancel('zmWriteTimer'); zmFlush(); return; }
  if (!(zmState().e > 0)) return;
  if (cache.private.get('zmWriteTimer') !== null) return;      // a trailing write is already planned
  var last = cache.private.get('zmLastWrite') || 0;
  var wait = last + ZM.writeMs - Date.now();
  if (wait <= 0) { zmFlush(); return; }
  cache.private.put('zmWriteTimer', setTimeout(function () {
    cache.private.remove('zmWriteTimer');
    if (zmState().e > 0) zmFlush();
  }, wait));
}

function zmLiveStart() {
  var s = zmState();
  s.s0 = zmNow();
  s.e = s.s0 + Math.round(ZM.timeoutMs / 1000);
  zmCancel('zmTimer');
  cache.private.put('zmTimer', setTimeout(function () {
    cache.private.remove('zmTimer');
    var it = items.getItem(ZM.liveItem, true);
    if (it) it.sendCommand('OFF');
  }, ZM.timeoutMs));
  zmTransportStart();
  zmWrite(true);
}

function zmLiveStop() {
  zmCancel('zmTimer');
  zmCancel('zmWriteTimer');
  zmTransportStop();
  zmState().e = 0;
  zmWrite(true);
}

// "<base>/<name>#{json with linkquality}", "<base>/<name>/linkquality#87", "<base>/<name>/availability#online"
function zmMessage(payload) {
  var p = String(payload);
  var hash = p.indexOf('#');
  if (hash < 0) return;
  var topic = p.substring(0, hash), value = p.substring(hash + 1);
  var base = ZM.baseTopic + '/';
  if (topic.indexOf(base) !== 0) return;
  var rest = topic.substring(base.length);
  if (rest === '' || rest.indexOf('bridge/') === 0) return;
  var s = zmState(), name, q, j;
  if (/\/availability$/.test(rest)) {
    name = rest.substring(0, rest.length - '/availability'.length);
    var v = value.trim();
    try { j = JSON.parse(v); if (j && typeof j === 'object') v = String(j.state); } catch (e) { /* plain text */ }
    if (!name || (v !== 'online' && v !== 'offline')) return;
    (s.d[name] || (s.d[name] = {})).a = v === 'online' ? 1 : 0;
  } else {
    if (/\/linkquality$/.test(rest)) {
      name = rest.substring(0, rest.length - '/linkquality'.length);
      if (!/^\s*\d+\s*$/.test(value)) return;
      q = parseInt(value, 10);
    } else {
      name = rest;
      try { j = JSON.parse(value); } catch (e) { return; }
      if (!j || typeof j !== 'object' || typeof j.linkquality !== 'number' || isNaN(j.linkquality)) return;
      q = Math.round(j.linkquality);
    }
    if (!name) return;
    var dev = s.d[name] || (s.d[name] = {});
    dev.q = q;
    dev.t = zmNow();
    s.u = name;
    s.n = (s.n + 1) % 1000000;
  }
  zmWrite(false);
}

function zmSystemStart() {
  if (!items.getItem(ZM.liveItem, true)) {
    items.addItem({ type: 'Switch', name: ZM.liveItem, label: 'Zigbee radio map: live', category: 'network' });
  }
  if (!items.getItem(ZM.dataItem, true)) {
    items.addItem({ type: 'String', name: ZM.dataItem, label: 'Zigbee radio map: data (JSON)', category: 'network' });
  }
  var it = items.getItem(ZM.liveItem, true);
  var on = !!it && String(it.state) === 'ON';
  if (on && cache.private.get('zmTimer') !== null) return;     // a live session of this rule is running
  if (on) { it.sendCommand('OFF'); return; }
  zmTransportStop();
  if (it && String(it.state) !== 'OFF') it.postUpdate('OFF');
}

// Normalise the (converted or raw Java) event object.
function zmEvent(e) {
  if (!e) return { kind: 'start' };
  if (typeof e.getEvent === 'function') return { kind: 'channel', payload: String(e.getEvent()) };
  if (typeof e.getItemName === 'function' && typeof e.getItemCommand === 'function') {
    return { kind: 'command', item: String(e.getItemName()), value: String(e.getItemCommand()) };
  }
  if (e.eventType === 'triggered') return { kind: 'channel', payload: String(e.receivedEvent) };
  if (e.eventType === 'command') return { kind: 'command', item: String(e.itemName), value: String(e.receivedCommand) };
  return { kind: 'start' };
}

(function () {
  var ev = zmEvent(typeof event === 'undefined' ? null : event);
  if (ev.kind === 'channel') {
    zmMessage(ev.payload);
  } else if (ev.kind === 'command') {
    if (ev.item !== ZM.liveItem) return;
    if (ev.value === 'ON') zmLiveStart(); else zmLiveStop();
  } else {
    zmSystemStart();
  }
})();
