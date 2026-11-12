// SPDX-License-Identifier: EPL-2.0
// ===== Zigbee radio map: MQTT transport =====
// Messages arrive through the two publish trigger channels of the broker thing ZM.thing.
// If ZM.switchThing is true, that thing is enabled only while live is ON (a second broker thing used only for the
// map). Guard: a thing that other things use as their bridge (the main broker) is never switched.
// At live start the devices in ZM.query get "<base>/<name>/get {"state":""}"; the answer brings a fresh linkquality.

function zmThing() {
  return things.getThing(ZM.thing, true);
}

// UID of the first other thing that uses ZM.thing as its bridge, or ''
function zmBridgeChild() {
  var all = things.getThings();
  for (var i = 0; i < all.length; i++) {
    if (String(all[i].bridgeUID) === ZM.thing && String(all[i].uid) !== ZM.thing) return String(all[i].uid);
  }
  return '';
}

function zmQuery() {
  var mqtt = actions.get('mqtt', ZM.thing);
  ZM.query.forEach(function (name) {
    mqtt.publishMQTT(ZM.baseTopic + '/' + name + '/get', JSON.stringify({ state: '' }), false);
  });
}

function zmTransportStart() {
  var t = zmThing();
  if (!t) { console.warn('Zigbee radio map: thing ' + ZM.thing + ' not found, no query and no switching'); return; }
  if (ZM.switchThing) {
    var child = zmBridgeChild();
    if (child) {
      console.warn('Zigbee radio map: thing ' + ZM.thing + ' is the bridge of ' + child +
        ', so it is not switched on and off (set switchThing to false or use a second broker thing)');
    } else if (!t.isEnabled) {
      t.setEnabled(true);
    }
  }
  if (!ZM.query.length) return;
  var tries = 0;
  var check = function () {
    cache.private.remove('zmQueryTimer');
    var th = zmThing();
    if (th && String(th.status) === 'ONLINE') { zmQuery(); return; }
    if (++tries > 15) { console.warn('Zigbee radio map: thing ' + ZM.thing + ' not ONLINE after 15 s, no query sent'); return; }
    cache.private.put('zmQueryTimer', setTimeout(check, 1000));
  };
  check();
}

function zmTransportStop() {
  var id = cache.private.get('zmQueryTimer');
  if (id !== null && id !== undefined) clearTimeout(id);
  cache.private.remove('zmQueryTimer');
  if (!ZM.switchThing) return;
  var t = zmThing();
  if (!t || zmBridgeChild()) return;
  if (t.isEnabled) t.setEnabled(false);
}
