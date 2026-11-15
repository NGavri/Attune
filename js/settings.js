/* js/settings.js  (owner: A)
 * attune.settings + the Settings tab.
 * Loads right after js/bus.js, so every other module can read attune.settings.
 * Saved in localStorage key "attune.settings". Changes apply immediately.
 */
(function () {
  'use strict';

  var A = window.attune;
  var KEY = 'attune.settings';
  var DEFAULTS = {
    gsrSign: -1,          // Grove: reading goes DOWN when stressed
    gsrFloorPct: 3,       // GSR sensitivity floor (%). Higher = less jumpy
    spikeThreshold: 6,    // score (0-10) that counts as a stress spike
    reliefSeconds: 60     // relief session length (60 = demo, 120 = normal)
  };

  function load() {
    var s = {};
    for (var k in DEFAULTS) s[k] = DEFAULTS[k];
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        for (var key in DEFAULTS) {
          if (saved && typeof saved[key] === 'number' && isFinite(saved[key])) s[key] = saved[key];
        }
      }
    } catch (e) { /* storage blocked: keep defaults */ }
    return s;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(A.settings)); } catch (e) { /* ignore */ }
  }

  A.settings = load();

  /* ---------- keep the last 10 minutes of data for the CSV export ---------- */
  var KEEP_MS = 10 * 60 * 1000;
  var samples = [];   // [t, pulse, gsr]   (t = device ms)
  var scores = [];    // [t, score, gsrPct, bpm, rmssd]   (t = wall-clock ms)

  A.on('sample', function (d) {
    if (!d) return;
    samples.push([d.t, d.pulse, d.gsr]);
    var cutoff = d.t - KEEP_MS;
    while (samples.length && samples[0][0] < cutoff) samples.shift();
    if (samples.length > 40000) samples.splice(0, samples.length - 40000); // safety cap
  });

  A.on('score', function (d) {
    if (!d) return;
    scores.push([d.t, d.score, d.gsrPct, d.bpm, d.rmssd]);
    var cutoff = Date.now() - KEEP_MS;
    while (scores.length && scores[0][0] < cutoff) scores.shift();
  });

  function cell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return isFinite(v) ? String(Math.round(v * 100) / 100) : '';
    return String(v);
  }

  function downloadCSV() {
    var lines = ['type,t,pulse,gsr,score,gsrPct,bpm,rmssd'];
    samples.forEach(function (r) { lines.push(['sample', cell(r[0]), cell(r[1]), cell(r[2]), '', '', '', ''].join(',')); });
    scores.forEach(function (r) { lines.push(['score', cell(r[0]), '', '', cell(r[1]), cell(r[2]), cell(r[3]), cell(r[4])].join(',')); });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'attune-session-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------- the Settings tab ---------- */
  function field(label, control, hint) {
    var wrap = document.createElement('div');
    wrap.className = 'setting';
    var l = document.createElement('label');
    l.textContent = label;
    wrap.appendChild(l);
    wrap.appendChild(control);
    if (hint) {
      var h = document.createElement('p');
      h.className = 'hint';
      h.textContent = hint;
      wrap.appendChild(h);
    }
    return wrap;
  }

  function select(options, value, onChange) {
    var s = document.createElement('select');
    s.style.width = 'auto';
    options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = String(o[0]);
      opt.textContent = o[1];
      if (Number(o[0]) === Number(value)) opt.selected = true;
      s.appendChild(opt);
    });
    s.addEventListener('change', function () { onChange(Number(s.value)); });
    return s;
  }

  function number(value, min, max, step, onChange) {
    var n = document.createElement('input');
    n.type = 'number';
    n.min = min; n.max = max; n.step = step;
    n.value = value;
    n.addEventListener('change', function () {
      var v = Number(n.value);
      if (!isFinite(v)) { n.value = value; return; }
      v = Math.min(max, Math.max(min, v));
      n.value = v;
      onChange(v);
    });
    return n;
  }

  function set(key, v) {
    A.settings[key] = v;
    save();
    A.emit('settings', { key: key, value: v });
  }

  function render() {
    var host = document.getElementById('tab-settings');
    if (!host) return;
    host.innerHTML = '';
    var h = document.createElement('h2');
    h.textContent = 'Settings';
    host.appendChild(h);

    host.appendChild(field('GSR direction',
      select([[-1, 'Reading goes DOWN when stressed (Grove sensor)'], [1, 'Reading goes UP when stressed (foil electrodes)']],
        A.settings.gsrSign, function (v) { set('gsrSign', v); }),
      'If the score never rises when you take a deep breath, flip this.'));

    host.appendChild(field('GSR sensitivity floor (%)',
      number(A.settings.gsrFloorPct, 0.5, 10, 0.5, function (v) { set('gsrFloorPct', v); }),
      'Higher = calmer score (fewer false alarms). Lower = more sensitive.'));

    host.appendChild(field('Spike threshold (0-10)',
      number(A.settings.spikeThreshold, 3, 9, 1, function (v) { set('spikeThreshold', v); }),
      'The check-in pops up when the score stays at or above this for 3 seconds.'));

    host.appendChild(field('Relief session length',
      select([[60, '60 s (demo)'], [120, '120 s (normal)']],
        A.settings.reliefSeconds, function (v) { set('reliefSeconds', v); })));

    var row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '12px';
    row.style.marginTop = '24px';

    var csv = document.createElement('button');
    csv.type = 'button';
    csv.textContent = 'Download session CSV';
    csv.addEventListener('click', downloadCSV);
    row.appendChild(csv);

    var reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset settings';
    reset.addEventListener('click', function () {
      for (var k in DEFAULTS) A.settings[k] = DEFAULTS[k];
      save();
      A.emit('settings', { key: 'all' });
      render();
    });
    row.appendChild(reset);
    host.appendChild(row);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
