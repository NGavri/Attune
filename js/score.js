/* js/score.js  (owner: A)
 * Baseline + 0-10 stress score + spike detection.
 *   Listens: 'sample', 'beat'
 *   Emits:   'baseline' {state:'start'|'progress'|'done', secondsLeft, values}
 *            'score'    {t, score, gsrPct, bpm, rmssd}   once per second after the baseline
 *            'spike'    {t, score}
 * Works with GSR only (no pulse sensor): if no heartbeats arrived in the last 10 s,
 * the score is computed from the skin response alone.
 */
(function () {
  'use strict';

  var A = window.attune;

  // ---------- tunable constants ----------
  var BASELINE_S = 45;        // baseline length (seconds)
  var AUTO_START_MS = 3000;   // start the baseline 3 s after the first sample
  var W_GSR = 0.6, W_HR = 0.25, W_HRV = 0.15;
  var Z_FULL = 4;             // a z-score of 4 counts as "fully stressed" for that signal
  var HRV_FULL = 0.5;         // a 50% HRV drop counts as fully stressed
  var SMOOTH = 0.3;           // new = 0.3 * raw + 0.7 * previous
  var SPIKE_HOLD_S = 3;       // score must stay >= threshold this many seconds
  var SPIKE_COOLDOWN_MS = 60000;
  var HR_WINDOW_MS = 10000;
  var HRV_WINDOW_MS = 30000;
  var MIN_BEATS = 10;

  function setting(name, def) {
    var s = A.settings;
    var v = s && typeof s[name] === 'number' && isFinite(s[name]) ? s[name] : def;
    return v;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function mean(a) { if (!a.length) return null; var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function sd(a) {
    if (a.length < 2) return 0;
    var m = mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / (a.length - 1));
  }
  function rmssd(ibis) {
    if (ibis.length < MIN_BEATS) return null;
    var s = 0, n = 0;
    for (var i = 1; i < ibis.length; i++) { var d = ibis[i] - ibis[i - 1]; s += d * d; n++; }
    return n ? Math.sqrt(s / n) : null;
  }

  // ---------- incoming data (timestamps = wall clock, so demo and device behave the same) ----------
  var secGsr = [];          // GSR samples that arrived during the current second
  var lastSecGsr = [];      // samples from the last full second
  var beats = [];           // [{at, bpm, ibi}] for the last 30 s
  var firstSampleAt = null;
  var autoTimer = null;

  A.on('sample', function (d) {
    if (!d || typeof d.gsr !== 'number' || !isFinite(d.gsr)) return;
    secGsr.push(d.gsr);
    if (firstSampleAt === null) {
      firstSampleAt = Date.now();
      if (!baseline.running && !baseline.values) {
        autoTimer = setTimeout(startBaseline, AUTO_START_MS);
      }
    }
  });

  A.on('beat', function (d) {
    if (!d || !isFinite(d.bpm) || !isFinite(d.ibi)) return;
    beats.push({ at: Date.now(), bpm: d.bpm, ibi: d.ibi });
    var cutoff = Date.now() - HRV_WINDOW_MS;
    while (beats.length && beats[0].at < cutoff) beats.shift();
  });

  // ---------- baseline ----------
  var baseline = { running: false, left: 0, gsr: [], bpm: [], ibi: [], values: null };
  var smooth = null;
  var above = 0;
  var lastSpikeAt = -Infinity;

  function startBaseline() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    baseline.running = true;
    baseline.left = BASELINE_S;
    baseline.gsr = [];
    baseline.bpm = [];
    baseline.ibi = [];
    baseline.values = null;
    baseline.beatStart = Date.now();
    smooth = null;
    above = 0;
    A.state.lastScore = null;
    A.emit('baseline', { state: 'start', secondsLeft: BASELINE_S });
  }
  A.startBaseline = startBaseline;

  function finishBaseline() {
    var bb = beats.filter(function (b) { return b.at >= baseline.beatStart; });
    var gMean = mean(baseline.gsr);
    var values = {
      gsrMean: gMean,
      gsrSd: sd(baseline.gsr),
      hrMean: null, hrSd: null, rmssd: null
    };
    if (bb.length >= MIN_BEATS) {
      var bpms = bb.map(function (b) { return b.bpm; });
      values.hrMean = mean(bpms);
      values.hrSd = sd(bpms);
      values.rmssd = rmssd(bb.map(function (b) { return b.ibi; }));
    }
    baseline.running = false;
    if (!gMean || !isFinite(gMean) || gMean <= 0) {
      // No usable GSR (sensor off?): try again.
      A.emit('status', { msg: 'No skin signal during baseline - check the sleeves, retrying' });
      startBaseline();
      return;
    }
    baseline.values = values;
    A.emit('baseline', { state: 'done', secondsLeft: 0, values: values });
  }

  // ---------- the 1-second clock ----------
  setInterval(function () {
    lastSecGsr = secGsr;
    secGsr = [];
    var g1 = mean(lastSecGsr);

    if (baseline.running) {
      if (g1 !== null) baseline.gsr.push(g1);
      baseline.left -= 1;
      if (baseline.left > 0) {
        A.emit('baseline', { state: 'progress', secondsLeft: baseline.left });
      } else {
        finishBaseline();
      }
      return;
    }

    var v = baseline.values;
    if (!v || g1 === null) return;   // no baseline yet, or no data this second

    var sign = setting('gsrSign', -1);
    var floorPct = setting('gsrFloorPct', 3);
    var threshold = setting('spikeThreshold', 6);

    var gsrPct = sign * (g1 - v.gsrMean) / v.gsrMean * 100;
    var gsrZ = sign * (g1 - v.gsrMean) / Math.max(v.gsrSd, v.gsrMean * floorPct / 100);
    var gsrPart = clamp(gsrZ / Z_FULL, 0, 1);

    var now = Date.now();
    var recent = beats.filter(function (b) { return b.at >= now - HR_WINDOW_MS; });
    var hr = recent.length ? mean(recent.map(function (b) { return b.bpm; })) : null;
    var raw;

    if (!recent.length) {
      // GSR only (no pulse sensor, or finger off the sensor)
      raw = gsrPart;
    } else {
      var hrZ = (hr !== null && v.hrMean !== null) ? (hr - v.hrMean) / Math.max(v.hrSd || 0, 2) : 0;
      var rNow = rmssd(beats.map(function (b) { return b.ibi; }));
      var hrvDrop = (v.rmssd && rNow !== null) ? (v.rmssd - rNow) / v.rmssd : 0;
      raw = W_GSR * gsrPart + W_HR * clamp(hrZ / Z_FULL, 0, 1) + W_HRV * clamp(hrvDrop / HRV_FULL, 0, 1);
    }

    smooth = smooth === null ? raw : SMOOTH * raw + (1 - SMOOTH) * smooth;
    var score = clamp(Math.round(10 * smooth), 0, 10);

    var rNowOut = recent.length ? rmssd(beats.map(function (b) { return b.ibi; })) : null;
    var out = { t: now, score: score, gsrPct: Math.round(gsrPct * 10) / 10, bpm: hr, rmssd: rNowOut };
    A.state.lastScore = out;
    A.emit('score', out);

    // spike: score >= threshold for 3 s in a row, then 60 s cooldown
    above = score >= threshold ? above + 1 : 0;
    if (above >= SPIKE_HOLD_S && now - lastSpikeAt >= SPIKE_COOLDOWN_MS) {
      lastSpikeAt = now;
      above = 0;
      A.emit('spike', { t: now, score: score });
    }
  }, 1000);

  // ---------- "Re-do baseline" button ----------
  function addButton() {
    var host = document.getElementById('live-actions');
    if (!host || document.getElementById('btnBaseline')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'btnBaseline';
    b.textContent = 'Re-do baseline';
    b.addEventListener('click', startBaseline);
    host.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButton);
  else addButton();
})();
