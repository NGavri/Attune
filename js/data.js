/* Attune - js/data.js
   1) handleLine(): turns one text line from the device into bus events.
   2) Fake data stream: builds text lines in the SAME format and feeds them to
      handleLine(), so demo data and real data go through exactly the same code.
   3) TODO: Web Serial connection (bottom of this file).

   Line format:
     D,<ms>,<pulse_raw>,<gsr>      about 50 per second
     B,<ms>,<ibi_ms>,<bpm>         once per heartbeat
     S,<message>                   status                                      */
(function () {
  'use strict';

  /* ---------------- 1. LINE PARSER ---------------- */

  var counts = { samples: 0, beats: 0 };

  function num(s) {
    if (s === undefined) return NaN;
    s = String(s).trim();
    return s === '' ? NaN : Number(s);   // Number('') would be 0, so check first
  }

  function handleLine(line) {
    try {
      if (typeof line !== 'string') return;
      line = line.trim();
      if (line.length < 3 || line.charAt(1) !== ',') return;

      var kind = line.charAt(0);
      var p = line.split(',');

      if (kind === 'D') {
        var t = num(p[1]), pulse = num(p[2]), gsr = num(p[3]);
        if (!isFinite(t) || !isFinite(pulse) || !isFinite(gsr)) return;
        counts.samples++;
        attune.emit('sample', { t: t, pulse: pulse, gsr: gsr });

      } else if (kind === 'B') {
        var bt = num(p[1]), ibi = num(p[2]), bpm = num(p[3]);
        if (!isFinite(bt) || !isFinite(ibi) || !isFinite(bpm)) return;
        counts.beats++;
        attune.emit('beat', { t: bt, ibi: ibi, bpm: bpm });

      } else if (kind === 'S') {
        var msg = line.slice(2).trim();     // keep commas inside the message
        if (!msg) return;
        attune.emit('status', { msg: msg });
      }
      // any other first letter: ignored
    } catch (err) {
      console.error('[attune] handleLine failed on:', line, err);
    }
  }

  attune.handleLine = handleLine;

  // Every second, log how many samples and beats arrived in that second.
  setInterval(function () {
    console.log('[attune data] last second: ' + counts.samples + ' samples, ' + counts.beats + ' beats');
    counts.samples = 0;
    counts.beats = 0;
  }, 1000);


  /* ---------------- 2. FAKE DATA STREAM ---------------- */

  var SAMPLE_MS = 20;     // one D line every 20 ms (50 per second)
  var BASE_BPM = 70;
  var RISE_MS = 3000;     // simulated stress: arousal 0 -> 1 in 3 s ...
  var FALL_MS = 40000;    // ... then back to 0 over 40 s

  var btnDemo = document.getElementById('btnDemo');
  var btnSim = document.getElementById('btnSimStress');

  var demo = {
    timer: null,
    wall0: 0,            // performance.now() when the demo started
    simMs: 0,            // fake "ms since the device started"
    prevBeat: 0,         // time of the last fake heartbeat
    nextBeat: 0,         // time of the next fake heartbeat
    stressStart: null    // simMs when the stress ramp started (null = calm)
  };

  // 0..1. Rises over 3 s, then falls over 40 s.
  function arousalAt(ms) {
    if (demo.stressStart === null) return 0;
    var el = ms - demo.stressStart;
    if (el < 0) return 0;
    if (el < RISE_MS) return el / RISE_MS;
    if (el < RISE_MS + FALL_MS) return 1 - (el - RISE_MS) / FALL_MS;
    demo.stressStart = null;
    return 0;
  }

  // Time until the next beat. Stress = faster heart (+15 bpm) and less variation.
  function nextInterval(arousal) {
    var bpm = BASE_BPM + 15 * arousal;
    var jitter = 0.05 * (1 - 0.6 * arousal);
    return (60000 / bpm) * (1 + (Math.random() * 2 - 1) * jitter);
  }

  // One heartbeat: sharp rise (90 ms), slower fall, small bump on the way down. Returns 0..1.
  function pulseShape(ms) {
    if (ms < 90) return Math.sin((ms / 90) * Math.PI / 2);
    var x = ms - 90;
    return Math.exp(-x / 180) + 0.18 * Math.exp(-Math.pow((x - 200) / 45, 2) / 2);
  }

  function clamp(v) {
    return Math.max(0, Math.min(4095, Math.round(v)));
  }

  function makeSample(ms) {
    var arousal = arousalAt(ms);

    // heartbeat(s) that happened since the last sample
    while (ms >= demo.nextBeat) {
      var ibi = Math.round(demo.nextBeat - demo.prevBeat);
      handleLine('B,' + Math.round(demo.nextBeat) + ',' + ibi + ',' + Math.round(60000 / ibi));
      demo.prevBeat = demo.nextBeat;
      demo.nextBeat += nextInterval(arousal);
    }

    var pulse = 1800 + 600 * pulseShape(ms - demo.prevBeat) + (Math.random() - 0.5) * 16;

    var sign = (attune.settings && typeof attune.settings.gsrSign === 'number') ? attune.settings.gsrSign : -1;
    var drift = 50 * Math.sin(ms / 9000) + 30 * Math.sin(ms / 3100 + 1.3);
    var gsr = (2000 + drift + (Math.random() - 0.5) * 8) * (1 + sign * 0.12 * arousal);

    handleLine('D,' + ms + ',' + clamp(pulse) + ',' + clamp(gsr));
  }

  // Runs often; produces as many 20 ms samples as real time requires
  // (keeps the rate right even if the browser delays a timer).
  function tick() {
    var elapsed = performance.now() - demo.wall0;
    if (elapsed - demo.simMs > 2000) {      // tab was asleep: skip ahead instead of flooding
      demo.simMs = Math.floor(elapsed / SAMPLE_MS) * SAMPLE_MS;
      demo.prevBeat = demo.simMs - 60000 / BASE_BPM;
      demo.nextBeat = demo.simMs;
    }
    while (demo.simMs + SAMPLE_MS <= elapsed) {
      demo.simMs += SAMPLE_MS;
      makeSample(demo.simMs);
    }
  }

  function startDemo() {
    if (demo.timer) return;
    demo.wall0 = performance.now();
    demo.simMs = 0;
    demo.stressStart = null;
    demo.nextBeat = 500;
    demo.prevBeat = 500 - 60000 / BASE_BPM;
    demo.timer = setInterval(tick, 10);
    if (btnDemo) btnDemo.textContent = 'Stop demo data';
    if (btnSim) btnSim.hidden = false;
    attune.emit('status', { msg: 'Demo data running' });
  }

  function stopDemo() {
    if (!demo.timer) return;
    clearInterval(demo.timer);
    demo.timer = null;
    if (btnDemo) btnDemo.textContent = 'Use demo data';
    if (btnSim) btnSim.hidden = true;
    attune.emit('status', { msg: 'Demo data stopped' });
  }

  attune.startDemo = startDemo;
  attune.stopDemo = stopDemo;

  if (btnDemo) {
    btnDemo.addEventListener('click', function () {
      if (demo.timer) stopDemo(); else startDemo();
    });
  }

  if (btnSim) {
    btnSim.addEventListener('click', function () {
      if (!demo.timer) return;
      // If already aroused, continue the rise from the current level (no sudden jump).
      demo.stressStart = demo.simMs - arousalAt(demo.simMs) * RISE_MS;
    });
  }


  /* ================================================================
     TODO (NEXT STEP): WEB SERIAL CONNECTION
     ----------------------------------------------------------------
     - Click handler for #btnConnect (Chrome only: navigator.serial).
     - navigator.serial.requestPort(), then port.open({ baudRate: 115200 }).
     - Read bytes, decode to text, split on "\n" (keep the unfinished last
       piece for the next chunk), and call handleLine(line) for each line.
     - Call stopDemo() before connecting so the two streams don't mix.
     - Emit attune.emit('status', { msg: ... }) on connect / disconnect / error.
     ================================================================ */

})();
