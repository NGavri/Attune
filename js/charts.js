/* js/charts.js  (owner: A)
 *
 * Live graphs + live numbers. Talks to the rest of the app ONLY through the bus.
 *   Listens: 'sample', 'beat', 'baseline', 'score', 'tab'
 *   Needs:   js/bus.js loaded first (global `attune`), Chart.js 4.4.1 (global `Chart`)
 *   Fills:   #live-graphs (two stacked charts) and #live-side (score, BPM, HRV, baseline)
 */
(function () {
  'use strict';

  // ---------- constants ----------
  var WINDOW_S = 15;      // seconds shown on the x axis
  var REDRAW_MS = 100;    // redraw at most 10 times per second
  var REF_SECONDS = 2;    // before the baseline is done: reference = mean gsr of the first 2 s
  var T_IS_MS = true;     // 'sample'.t is milliseconds (the serial <ms> field). Set false if data.js sends seconds.

  var INK = '#1F1B16';
  var CLAY = '#C2410C';
  var SAGE = '#5F7A61';
  var AXIS = '#6B635A';
  var ZERO_LINE = '#D9D2C7';
  var MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

  var A = window.attune;
  if (!A || typeof A.on !== 'function') {
    console.error('charts.js: js/bus.js must load before charts.js (attune.on is missing).');
    return;
  }

  // ---------- state ----------
  var buf = [];           // [{t, pulse, gsr}] for the last WINDOW_S seconds (t in seconds)
  var lastT = null;
  var baselineRef = null; // gsrMean from the 'baseline' event with state 'done'
  var provRef = null;     // provisional reference from the first REF_SECONDS of samples
  var provStart = null;
  var provSum = 0;
  var provN = 0;
  var dirty = false;

  var side = { score: null, bpm: null, rmssd: null, baseline: null };
  var ui = null;          // side-panel elements, set in init()
  var skinChart = null;
  var pulseChart = null;

  // ---------- helpers ----------
  // Real number or null. (Plain Number(null) is 0, which would show a fake value.)
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function gsrSign() {
    var g = Number(A.settings && A.settings.gsrSign !== undefined && A.settings.gsrSign !== null ? A.settings.gsrSign : -1);
    return isFinite(g) ? g : -1;
  }

  function resetSeries() {
    buf = [];
    lastT = null;
    baselineRef = null;
    provRef = null;
    provStart = null;
    provSum = 0;
    provN = 0;
  }

  // ---------- bus: samples -> buffer ----------
  A.on('sample', function (d) {
    if (!d) return;
    var t = num(d.t);
    var pulse = num(d.pulse);
    var gsr = num(d.gsr);
    if (t === null || pulse === null || gsr === null) return;
    if (T_IS_MS) t = t / 1000;

    // The clock jumped backwards: new device, or fake data -> real data. Start fresh.
    if (lastT !== null && t < lastT - 1) resetSeries();
    lastT = t;

    // Provisional reference: average gsr of the first REF_SECONDS of samples.
    if (provRef === null) {
      if (provStart === null) provStart = t;
      if (t - provStart < REF_SECONDS) {
        provSum += gsr;
        provN += 1;
      } else {
        var mean = provSum / provN; // provN >= 1: the first sample is always counted
        if (mean > 0) {
          provRef = mean;
        } else {
          provStart = t; // all zeros (no finger yet?): try again from here
          provSum = gsr;
          provN = 1;
        }
      }
    }

    buf.push({ t: t, pulse: pulse, gsr: gsr });
    while (buf.length && buf[0].t < t - WINDOW_S) buf.shift();
    dirty = true;
  });

  // ---------- bus: baseline / score / beat -> side panel ----------
  A.on('baseline', function (d) {
    if (!d) return;
    side.baseline = { state: d.state, secondsLeft: d.secondsLeft };
    if (d.state === 'done') {
      var m = num(d.values && d.values.gsrMean);
      if (m !== null && m > 0) {
        baselineRef = m; // switch to the new reference
        dirty = true;
      }
    }
    paintSide();
  });

  A.on('score', function (d) {
    if (!d) return;
    side.score = num(d.score);
    side.rmssd = num(d.rmssd);
    paintSide();
  });

  A.on('beat', function (d) {
    if (!d) return;
    side.bpm = num(d.bpm);
    paintSide();
  });

  // A chart created inside a hidden tab can be 0 px wide; re-measure when Live is shown.
  A.on('tab', function (d) {
    if (d && d.name === 'live') {
      if (skinChart) skinChart.resize();
      if (pulseChart) pulseChart.resize();
    }
  });

  // ---------- redraw (throttled) ----------
  function redraw() {
    dirty = false;
    if (!skinChart || !pulseChart || !buf.length) return;

    var tNow = buf[buf.length - 1].t;
    var ref = baselineRef !== null ? baselineRef : provRef; // null until the first 2 s have passed
    var sign = gsrSign();
    var skin = [];
    var pulse = [];

    for (var i = 0; i < buf.length; i++) {
      var s = buf[i];
      var x = s.t - tNow; // -15 ... 0 (seconds ago)
      pulse.push({ x: x, y: s.pulse });
      if (ref !== null) skin.push({ x: x, y: sign * (s.gsr - ref) / ref * 100 });
    }

    skinChart.data.datasets[0].data = skin;
    pulseChart.data.datasets[0].data = pulse;
    skinChart.update('none');
    pulseChart.update('none');
  }

  setInterval(function () {
    if (dirty) redraw();
  }, REDRAW_MS);

  // ---------- side panel ----------
  function paintSide() {
    if (!ui) return;

    var sc = side.score;
    if (sc !== null) {
      var n = Math.min(10, Math.max(0, Math.round(sc)));
      ui.score.textContent = String(n);
      ui.score.className = 'attune-score-num ' + (n <= 3 ? 'score-low' : n <= 6 ? 'score-mid' : 'score-high');
    } else {
      ui.score.textContent = '--';
      ui.score.className = 'attune-score-num';
    }

    ui.bpm.textContent = side.bpm !== null && side.bpm > 0 ? String(Math.round(side.bpm)) : '--';
    ui.hrv.textContent = side.rmssd !== null ? Math.round(side.rmssd) + ' ms' : '--';

    var b = side.baseline;
    var text = 'Baseline: --';
    if (b) {
      if (b.state === 'done') {
        text = 'Baseline done';
      } else {
        var left = num(b.secondsLeft);
        text = 'Baseline: ' + (left === null ? '--' : Math.ceil(Math.max(0, left))) + ' s left - keep your hand still';
      }
    }
    ui.baseline.textContent = text;
  }

  function buildSide(host) {
    var wrap = document.createElement('div');
    wrap.className = 'attune-side';
    wrap.innerHTML =
      '<div class="attune-stat">' +
        '<div class="attune-stat-label">Stress score</div>' +
        '<div class="attune-score"><span class="attune-score-num">--</span><span class="attune-score-max"> / 10</span></div>' +
      '</div>' +
      '<div class="attune-stat">' +
        '<div class="attune-stat-label">BPM</div>' +
        '<div class="attune-stat-value attune-bpm">--</div>' +
      '</div>' +
      '<div class="attune-stat">' +
        '<div class="attune-stat-label">HRV (RMSSD)</div>' +
        '<div class="attune-stat-value attune-hrv">--</div>' +
      '</div>' +
      '<p class="attune-baseline">Baseline: --</p>';
    host.appendChild(wrap);

    ui = {
      score: wrap.querySelector('.attune-score-num'),
      bpm: wrap.querySelector('.attune-bpm'),
      hrv: wrap.querySelector('.attune-hrv'),
      baseline: wrap.querySelector('.attune-baseline')
    };
  }

  // ---------- charts ----------
  function makeChart(host, title, color, isSkin) {
    var card = document.createElement('div');
    card.className = 'attune-chart-card';
    var heading = document.createElement('div');
    heading.className = 'attune-chart-title';
    heading.textContent = title;
    var box = document.createElement('div');
    box.className = 'attune-chart-box';
    var canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', title);
    box.appendChild(canvas);
    card.appendChild(heading);
    card.appendChild(box);
    host.appendChild(card);

    var tickFont = { family: MONO, size: 12 };

    // Skin response: only the zero line is drawn; every other grid line is invisible.
    var isZero = function (ctx) {
      return !!ctx.tick && Math.abs(ctx.tick.value) < 1e-9;
    };
    var yGrid = isSkin
      ? {
          display: true,
          drawTicks: false,
          color: function (ctx) { return isZero(ctx) ? ZERO_LINE : 'transparent'; },
          lineWidth: function (ctx) { return isZero(ctx) ? 1 : 0; }
        }
      : { display: false };

    var yScale = {
      grid: yGrid,
      border: { display: false },
      ticks: { color: AXIS, font: tickFont, maxTicksLimit: isSkin ? 5 : 4, padding: 8 },
      // Same width on both charts so the two plot areas line up.
      afterFit: function (scale) { scale.width = 56; }
    };
    if (isSkin) {
      yScale.suggestedMin = -5; // keeps 0 on screen and stops tiny noise from looking dramatic
      yScale.suggestedMax = 5;
    } else {
      yScale.grace = '10%';
    }

    return new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [{
          data: [],
          borderColor: color,
          borderWidth: 1.5,
          backgroundColor: 'transparent',
          fill: false,
          pointRadius: 0,
          pointHoverRadius: 0,
          pointHitRadius: 0,
          tension: 0
        }]
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        normalized: true,
        events: [],
        layout: { padding: { top: 4, right: 10 } },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: {
            type: 'linear',
            min: -WINDOW_S,
            max: 0,
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: AXIS,
              font: tickFont,
              stepSize: 5,
              padding: 6,
              callback: function (v) { return v === 0 ? 'now' : v + ' s'; }
            }
          },
          y: yScale
        }
      }
    });
  }

  function buildCharts(host) {
    if (typeof Chart === 'undefined') {
      console.error('charts.js: Chart.js is not loaded. Check that its <script> comes before charts.js.');
      return;
    }
    skinChart = makeChart(host, 'Skin response (% vs baseline, up = more stressed)', CLAY, true);
    pulseChart = makeChart(host, 'Pulse', INK, false);

    // Canvas text is drawn once, so redraw after the web font has arrived.
    if (document.fonts && document.fonts.load) {
      document.fonts.load('12px "IBM Plex Mono"').then(function () {
        skinChart.update('none');
        pulseChart.update('none');
      }).catch(function () {});
    }
  }

  // ---------- default look for the side panel ----------
  // :where() has zero specificity, so anything in css/style.css overrides these without a fight.
  function injectStyle() {
    if (document.getElementById('attune-charts-style')) return;
    var st = document.createElement('style');
    st.id = 'attune-charts-style';
    st.textContent =
      ':where(.attune-chart-card){margin:0 0 24px}' +
      ':where(.attune-chart-title){margin:0 0 6px;font:500 14px/1.3 "IBM Plex Sans",system-ui,sans-serif;color:' + INK + '}' +
      ':where(.attune-chart-box){position:relative;width:100%;height:200px}' +
      ':where(.attune-stat){margin:0 0 24px}' +
      ':where(.attune-stat-label){font:400 14px/1.3 "IBM Plex Sans",system-ui,sans-serif;color:' + AXIS + '}' +
      ':where(.attune-score){margin-top:2px;line-height:1}' +
      ':where(.attune-score-num){font:500 72px/1 Fraunces,Georgia,serif;font-variant-numeric:tabular-nums;color:' + INK + '}' +
      ':where(.attune-score-max){font:400 20px/1 "IBM Plex Mono",ui-monospace,monospace;color:' + AXIS + '}' +
      ':where(.attune-stat-value){font:500 28px/1.2 "IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums;color:' + INK + '}' +
      ':where(.attune-baseline){margin:0;font:400 14px/1.4 "IBM Plex Sans",system-ui,sans-serif;color:' + AXIS + '}' +
      ':where(.score-low){color:' + SAGE + '}' +
      ':where(.score-mid){color:' + INK + '}' +
      ':where(.score-high){color:' + CLAY + '}';
    document.head.appendChild(st);
  }

  // ---------- start ----------
  function init() {
    injectStyle();

    var graphsHost = document.getElementById('live-graphs');
    var sideHost = document.getElementById('live-side');

    if (graphsHost) buildCharts(graphsHost);
    else console.warn('charts.js: #live-graphs not found in index.html');

    if (sideHost) buildSide(sideHost);
    else console.warn('charts.js: #live-side not found in index.html');

    paintSide();      // show anything that arrived before the page was ready
    dirty = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
