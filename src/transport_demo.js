// SPDX-License-Identifier: EPL-2.0
// ===== Zigbee radio map: demo transport =====
// No MQTT: while live is ON, one chained timer feeds invented messages into zmMessage, so the demo exercises the
// real parsing and the real data format. ZM.demo = { seed, devices: [{ name, router, q, mode: ok|offline|silent }] }.
// Every 250 ms one device of the start queue reports (routers first, so they show up within 2 s); 5 s after the
// start the "offline" devices go offline; afterwards every 2 s a random "ok" device reports q = base +- 8.

function zmTransportStart() {
  zmTransportStop();
  var devs = ZM.demo.devices, base = ZM.baseTopic + '/';
  var seed = ZM.demo.seed || 1;
  var rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };   // Park-Miller LCG
  var report = function (d) {
    var q = Math.max(0, Math.min(255, d.q + Math.floor(rnd() * 17) - 8));
    zmMessage(base + d.name + '#' + JSON.stringify({ linkquality: q }));
  };
  var queue = [], ok = [], i;
  for (i = 0; i < devs.length; i++) {
    if (devs[i].mode === 'silent') continue;
    zmMessage(base + devs[i].name + '/availability#online');
    if (devs[i].mode === 'ok') ok.push(devs[i]);
  }
  for (i = 0; i < devs.length; i++) if (devs[i].mode === 'ok' && devs[i].router) queue.push(devs[i]);
  for (i = 0; i < devs.length; i++) if (devs[i].mode === 'ok' && !devs[i].router) queue.push(devs[i]);
  for (i = 0; i < devs.length; i++) if (devs[i].mode === 'offline') queue.push(devs[i]);
  var tick = 0;
  var step = function () {
    tick++;
    if (tick <= queue.length) report(queue[tick - 1]);
    if (tick === 20) {
      for (var k = 0; k < devs.length; k++) {
        if (devs[k].mode === 'offline') zmMessage(base + devs[k].name + '/availability#offline');
      }
    }
    if (tick > queue.length && tick % 8 === 0 && ok.length) report(ok[Math.floor(rnd() * ok.length)]);
    cache.private.put('zmDemoTimer', setTimeout(step, 250));
  };
  cache.private.put('zmDemoTimer', setTimeout(step, 250));
}

function zmTransportStop() {
  var id = cache.private.get('zmDemoTimer');
  if (id !== null && id !== undefined) clearTimeout(id);
  cache.private.remove('zmDemoTimer');
}
