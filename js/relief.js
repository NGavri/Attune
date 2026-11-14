/* js/relief.js - Attune relief tab (breathing guide + music + shared session logic)
 * Owner: B
 *
 * Both methods use the same startSession(method) / endSession() / showResult().
 * Other modules can still add methods with:
 *   attune.relief.registerMethod(key, { label, start(stageEl, session), stop(session) })
 */
(function () {
  'use strict';

  window.attune = window.attune || {};
  var A = window.attune;

  var methods = {};          // registry: method key -> {label, start, stop}
  var scoreLog = [];         // last 60 s of score events: {at, score, gsrPct}
  var session = null;        // the running session, or null
  var root = null;           // #relief-root, inside #tab-relief
  var view = 'choice';       // 'choice' | 'session' | 'result'
  var soundOn = false;       // "Sound on" checkbox state (breathing)
  var soundBoxes = [];       // every "Sound on" checkbox currently on screen

  var IN_SECONDS = 4;
  var OUT_SECONDS = 6;
  var LOG_WINDOW_MS = 60 * 1000;
  var AVG_WINDOW_MS = 20 * 1000;
  var MIN_MEASURE_MS = 10 * 1000;   // shorter than this: result is not meaningful

  var BUILT_IN_TRACKS = [
    { name: 'Calm 1', src: 'audio/calm1.mp3' },
    { name: 'Calm 2', src: 'audio/calm2.mp3' },
    { name: 'Calm 3', src: 'audio/calm3.mp3' }
  ];
  var MISSING_TEXT = 'Track missing - pick a song from your computer instead';

  /* ---------------------------------------------------------------- helpers */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  function sessionSeconds() {
    var s = A.settings && A.settings.reliefSeconds;
    s = Number(s ?? 60);
    return isFinite(s) && s >= 5 ? Math.round(s) : 60;
  }

  /* ------------------------------------------------------- score rolling list */

  function pruneLog() {
    var cutoff = Date.now() - LOG_WINDOW_MS;
    while (scoreLog.length && scoreLog[0].at < cutoff) scoreLog.shift();
  }

  function onScore(s) {
    if (!s) return;
    scoreLog.push({ at: Date.now(), score: s.score, gsrPct: s.gsrPct });
    pruneLog();
  }

  // Average score and gsrPct over the last windowMs. null if no scores at all.
  function recentAverage(windowMs) {
    pruneLog();
    var cutoff = Date.now() - windowMs;
    var sumS = 0, nS = 0, sumG = 0, nG = 0;
    for (var i = 0; i < scoreLog.length; i++) {
      var e = scoreLog[i];
      if (e.at < cutoff) continue;
      if (isNum(e.score)) { sumS += e.score; nS++; }
      if (isNum(e.gsrPct)) { sumG += e.gsrPct; nG++; }
    }
    if (nS === 0) return null;
    return { score: sumS / nS, gsrPct: nG ? sumG / nG : null };
  }

  /* ------------------------------------------------------------------ styles */

  function injectStyles() {
    if (document.getElementById('relief-styles')) return;
    var css = [
      '#relief-root{max-width:760px;margin:0 auto;padding:24px 16px;color:#1F1B16;font-family:"IBM Plex Sans",sans-serif;text-align:center}',
      '#relief-root h2{font-family:"Fraunces",serif;font-weight:600;font-size:30px;margin:0 0 6px}',
      '#relief-root .rl-sub{margin:0 0 24px;color:#1F1B16;opacity:.75}',
      '#relief-root .rl-cards{display:flex;gap:16px;flex-wrap:wrap;justify-content:center}',
      '#relief-root .rl-card{flex:1 1 280px;min-height:170px;padding:24px;background:#FBF8F2;border:1px solid #1F1B16;border-radius:6px;color:#1F1B16;font-family:inherit;cursor:pointer;display:flex;flex-direction:column;justify-content:center;gap:8px}',
      '#relief-root .rl-card:hover:not(:disabled){background:#EFE9DD}',
      '#relief-root .rl-card:focus-visible{outline:2px solid #5F7A61;outline-offset:2px}',
      '#relief-root .rl-card:disabled{cursor:default;opacity:.55;border-style:dashed}',
      '#relief-root .rl-card-title{font-family:"Fraunces",serif;font-size:28px;font-weight:600}',
      '#relief-root .rl-card-text{font-size:15px;opacity:.8}',
      '#relief-root .rl-sound{display:inline-flex;align-items:center;gap:8px;margin-top:20px;font-size:15px;cursor:pointer}',
      '#relief-root .rl-stage{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:340px}',
      '#relief-root .rl-circle-wrap{position:relative;width:280px;height:280px;display:flex;align-items:center;justify-content:center}',
      '#relief-root .rl-circle{position:absolute;top:0;left:0;width:280px;height:280px;border-radius:50%;background:#DDE5DC;border:2px solid #5F7A61;transform:scale(.5);transition:transform 4s ease-in-out}',
      '#relief-root .rl-circle-label{position:relative;font-family:"Fraunces",serif;font-size:26px;font-weight:500}',
      '#relief-root .rl-count{font-family:"IBM Plex Mono",monospace;font-size:64px;line-height:1;margin-top:20px}',
      '#relief-root .rl-count-label{font-size:14px;opacity:.7;margin-top:4px}',
      '#relief-root .rl-btn{margin-top:24px;padding:10px 28px;font-family:inherit;font-size:16px;color:#1F1B16;background:#F5F1EA;border:1px solid #1F1B16;border-radius:6px;cursor:pointer}',
      '#relief-root .rl-btn:hover{background:#EFE9DD}',
      '#relief-root .rl-btn.primary{background:#1F1B16;color:#F5F1EA}',
      '#relief-root .rl-btn.primary:hover{background:#3A342B}',
      '#relief-root .rl-btn-row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}',
      '#relief-root .rl-result-main{font-family:"Fraunces",serif;font-size:40px;font-weight:600;margin:16px 0 8px}',
      '#relief-root .rl-result-line{font-size:20px;margin:6px 0}',
      '#relief-root .rl-good{color:#5F7A61}',
      '#relief-root .rl-bad{color:#C2410C}',
      '#relief-root .rl-note{font-size:17px;margin:16px 0}',
      /* comparison under the choice cards */
      '#relief-root .rl-compare{margin-top:24px;font-size:16px}',
      '#relief-root .rl-compare-sep{margin:0 10px;opacity:.5}',
      '#relief-root .rl-win{font-weight:600;color:#5F7A61}',
      '#relief-root .rl-verdict{font-family:"Fraunces",serif;font-size:22px;font-weight:600;color:#5F7A61;margin-top:8px}',
      /* music stage */
      '#relief-root .rl-music{display:flex;flex-direction:column;align-items:center;gap:16px;width:100%}',
      '#relief-root .rl-file{display:flex;flex-direction:column;align-items:center;gap:8px;font-size:16px;cursor:pointer}',
      '#relief-root .rl-file input{font-family:inherit;font-size:14px;color:#1F1B16;max-width:100%}',
      '#relief-root .rl-or{font-size:14px;opacity:.7}',
      '#relief-root .rl-track{margin:0;padding:10px 22px;font-size:16px}',
      '#relief-root .rl-now{font-family:"Fraunces",serif;font-size:24px;font-weight:500;min-height:32px;margin-top:8px;word-break:break-word}',
      '#relief-root .rl-warn{color:#C2410C;font-size:16px;min-height:22px}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = 'relief-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ----------------------------------------------------------- soft sound */

  var audio = { ctx: null, osc: null, gain: null };

  // Only ever called from a click/change handler chain (or later timers once the
  // context already exists), so the browser's autoplay rules are satisfied.
  function ensureCtx() {
    if (!audio.ctx) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      audio.ctx = new Ctor();
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return audio.ctx;
  }

  function audioStart() {
    if (audio.osc) return;
    var ctx = ensureCtx();
    if (!ctx) return;
    audio.gain = ctx.createGain();
    audio.gain.gain.value = 0.0001;
    audio.osc = ctx.createOscillator();
    audio.osc.type = 'sine';
    audio.osc.frequency.value = 220;
    audio.osc.connect(audio.gain);
    audio.gain.connect(ctx.destination);
    audio.osc.start();
  }

  function audioRamp(target, seconds) {
    if (!audio.gain || !audio.ctx) return;
    var g = audio.gain.gain;
    var now = audio.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(g.value, 0.0001), now);
    g.linearRampToValueAtTime(target, now + seconds);
  }

  function audioStop() {
    if (!audio.osc || !audio.ctx) return;
    var osc = audio.osc, gain = audio.gain, ctx = audio.ctx;
    audio.osc = null;
    audio.gain = null;
    try {
      var now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
      gain.gain.linearRampToValueAtTime(0.0001, now + 0.15);
      osc.stop(now + 0.2);
    } catch (e) { /* already stopped */ }
  }

  function makeSoundCheckbox() {
    var label = el('label', 'rl-sound');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = soundOn;
    label.appendChild(box);
    label.appendChild(el('span', null, 'Sound on'));
    soundBoxes.push(box);
    box.addEventListener('change', function () {
      soundOn = box.checked;
      soundBoxes.forEach(function (b) { b.checked = soundOn; });
      var cur = session && session.breath;
      if (!cur) return;
      if (soundOn) {
        audioStart();                           // inside the change event = user gesture
        if (cur.phase === 'in') audioRamp(0.06, IN_SECONDS);
        else audioRamp(0.0001, OUT_SECONDS);
      } else {
        audioStop();
      }
    });
    return label;
  }

  /* -------------------------------------------------------------- breathing */

  function startBreathing(stage, sess) {
    var wrap = el('div', 'rl-circle-wrap');
    var circle = el('div', 'rl-circle');
    var label = el('div', 'rl-circle-label', 'Get ready');
    wrap.appendChild(circle);
    wrap.appendChild(label);
    stage.appendChild(wrap);
    stage.appendChild(makeSoundCheckbox());

    var breath = { phase: null, timers: [], circle: circle, label: label };
    sess.breath = breath;

    function setPhase(phase) {
      breath.phase = phase;
      if (phase === 'in') {
        label.textContent = 'Breathe in';
        circle.style.transition = 'transform ' + IN_SECONDS + 's ease-in-out';
        circle.style.transform = 'scale(1)';
        if (soundOn) { audioStart(); audioRamp(0.06, IN_SECONDS); }
      } else {
        label.textContent = 'Breathe out';
        circle.style.transition = 'transform ' + OUT_SECONDS + 's ease-in-out';
        circle.style.transform = 'scale(0.5)';
        if (soundOn) { audioStart(); audioRamp(0.0001, OUT_SECONDS); }
      }
    }

    function cycle() {
      setPhase('in');
      breath.timers.push(setTimeout(function () {
        setPhase('out');
        breath.timers.push(setTimeout(cycle, OUT_SECONDS * 1000));
      }, IN_SECONDS * 1000));
    }

    // Let the browser paint the small circle first so the first "in" animates.
    void circle.offsetWidth;
    cycle();
  }

  function stopBreathing(sess) {
    var breath = sess && sess.breath;
    if (breath) {
      breath.timers.forEach(clearTimeout);
      breath.timers = [];
    }
    audioStop();
  }

  /* ------------------------------------------------------------------ music */

  // Music plays only after the person clicks a track button or picks a file.
  // The countdown and the "before" score start at the moment playback actually
  // begins, so the measurement covers time with music, not time spent choosing.
  function startMusic(stage, sess) {
    var player = document.createElement('audio');
    player.loop = true;
    player.preload = 'auto';

    var music = {
      player: player,
      objectUrl: null,
      kind: null,            // 'builtin' | 'file'
      name: '',
      pendingPlay: null      // function that retries play() from a click
    };
    sess.music = music;
    sess.waiting = true;     // countdown holds until the first sound plays

    var box = el('div', 'rl-music');

    // File picker
    var fileLabel = el('label', 'rl-file');
    fileLabel.appendChild(el('span', null, 'Choose a song from this computer'));
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileLabel.appendChild(fileInput);
    box.appendChild(fileLabel);

    box.appendChild(el('div', 'rl-or', 'or play a built-in calm track'));

    // Built-in tracks
    var row = el('div', 'rl-btn-row');
    BUILT_IN_TRACKS.forEach(function (track) {
      var b = el('button', 'rl-btn rl-track', track.name);
      b.type = 'button';
      b.addEventListener('click', function () { playBuiltIn(track); });
      row.appendChild(b);
    });
    box.appendChild(row);

    var now = el('div', 'rl-now', '');
    var warn = el('div', 'rl-warn', '');
    var playBtn = el('button', 'rl-btn primary', 'Play');
    playBtn.type = 'button';
    playBtn.style.display = 'none';
    playBtn.style.marginTop = '0';
    playBtn.addEventListener('click', function () {
      if (music.pendingPlay) music.pendingPlay();
    });
    box.appendChild(now);
    box.appendChild(warn);
    box.appendChild(playBtn);
    stage.appendChild(box);

    function showNow() {
      now.textContent = music.name ? 'Now playing: ' + music.name : '';
    }

    function releaseSource() {
      player.pause();
      player.removeAttribute('src');
      try { player.load(); } catch (e) { /* ignore */ }
      if (music.objectUrl) {
        URL.revokeObjectURL(music.objectUrl);
        music.objectUrl = null;
      }
    }

    function showMissing() {
      music.name = '';
      now.textContent = '';
      playBtn.style.display = 'none';
      warn.textContent = music.kind === 'file'
        ? 'Could not play that file - pick another song'
        : MISSING_TEXT;
    }

    function tryPlay() {
      var p;
      try { p = player.play(); } catch (e) { showMissing(); return; }
      if (p && typeof p.then === 'function') {
        p.then(function () {
          playBtn.style.display = 'none';
        }).catch(function (err) {
          if (!err) return;
          if (err.name === 'AbortError') return;              // a newer pick replaced this one
          if (err.name === 'NotAllowedError') {
            // Browser wants a fresh click: offer a Play button.
            warn.textContent = '';
            now.textContent = music.name ? music.name : '';
            music.pendingPlay = tryPlay;
            playBtn.style.display = '';
            return;
          }
          showMissing();
        });
      }
    }

    function load(src, kind, name) {
      releaseSource();
      music.kind = kind;
      music.name = name;
      music.pendingPlay = null;
      warn.textContent = '';
      playBtn.style.display = 'none';
      showNow();
      player.src = src;
      tryPlay();
    }

    function playBuiltIn(track) {
      load(track.src, 'builtin', track.name);
    }

    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var url = URL.createObjectURL(f);
      load(url, 'file', f.name);
      music.objectUrl = url;                  // load() clears the old one first, then we keep this one
    });

    // Real sound has started: begin the measured session now.
    player.addEventListener('playing', function () {
      if (session !== sess || session.music !== music) return;
      if (!sess.waiting) return;
      sess.waiting = false;
      var t = Date.now();
      sess.startedAt = t;
      sess.endsAt = t + sess.seconds * 1000;
      sess.before = recentAverage(AVG_WINDOW_MS);
      showNow();
    });

    player.addEventListener('error', function () {
      if (!player.getAttribute('src')) return;               // we cleared it ourselves
      if (session !== sess) return;
      showMissing();
    });
  }

  function stopMusic(sess) {
    var music = sess && sess.music;
    if (!music) return;
    var player = music.player;
    try {
      player.pause();
      player.removeAttribute('src');
      player.load();
    } catch (e) { /* ignore */ }
    if (music.objectUrl) {
      URL.revokeObjectURL(music.objectUrl);
      music.objectUrl = null;
    }
    music.pendingPlay = null;
    sess.music = null;
  }

  /* ----------------------------------------------- breathing vs music compare */

  function reliefStats() {
    var stats = { breathing: { sum: 0, n: 0 }, music: { sum: 0, n: 0 } };
    var list = [];
    try {
      var all = A.store && typeof A.store.getAll === 'function' ? A.store.getAll() : null;
      if (all && Array.isArray(all.reliefs)) list = all.reliefs;
    } catch (e) { console.error('relief stats failed', e); }
    list.forEach(function (r) {
      if (!r || !stats[r.method]) return;
      if (!isNum(r.scoreBefore) || !isNum(r.scoreAfter)) return;
      stats[r.method].sum += r.scoreBefore - r.scoreAfter;
      stats[r.method].n++;
    });
    return stats;
  }

  function avgDropText(s) {
    return s.n ? round1(s.sum / s.n).toFixed(1) : 'n/a';
  }

  function sessionsText(n) {
    return '(' + n + (n === 1 ? ' session)' : ' sessions)');
  }

  function buildComparison() {
    var stats = reliefStats();
    var b = stats.breathing, m = stats.music;
    var bAvg = b.n ? b.sum / b.n : null;
    var mAvg = m.n ? m.sum / m.n : null;

    var winner = null;
    if (b.n >= 1 && m.n >= 1) {
      if (round1(bAvg) > round1(mAvg)) winner = 'breathing';
      else if (round1(mAvg) > round1(bAvg)) winner = 'music';
    }

    var box = el('div', 'rl-compare');
    var line = el('div', null, '');

    var bSpan = el('span', winner === 'breathing' ? 'rl-win' : null,
      'Breathing: average score drop ' + avgDropText(b) + ' ' + sessionsText(b.n));
    var sep = el('span', 'rl-compare-sep', '|');
    var mSpan = el('span', winner === 'music' ? 'rl-win' : null,
      'Music: average score drop ' + avgDropText(m) + ' ' + sessionsText(m.n));
    line.appendChild(bSpan);
    line.appendChild(sep);
    line.appendChild(mSpan);
    box.appendChild(line);

    if (winner) {
      box.appendChild(el('div', 'rl-verdict',
        winner === 'breathing' ? 'For you, breathing works better' : 'For you, music works better'));
    }
    return box;
  }

  /* ---------------------------------------------------------------- screens */

  function clearRoot() {
    soundBoxes = [];
    if (root) root.textContent = '';
  }

  function showChoice() {
    if (!root || session) return;
    view = 'choice';
    clearRoot();

    root.appendChild(el('h2', null, 'Relief'));
    root.appendChild(el('p', 'rl-sub', 'Pick one. Your body will tell us how much it helped.'));

    var cards = el('div', 'rl-cards');

    var breathe = el('button', 'rl-card');
    breathe.type = 'button';
    breathe.appendChild(el('span', 'rl-card-title', 'Breathe'));
    breathe.appendChild(el('span', 'rl-card-text', 'A slow guided breath: 4 seconds in, 6 seconds out.'));
    breathe.addEventListener('click', function () { startSession('breathing'); });
    cards.appendChild(breathe);

    var music = el('button', 'rl-card');
    music.type = 'button';
    music.appendChild(el('span', 'rl-card-title', 'Play my music'));
    if (methods.music) {
      music.appendChild(el('span', 'rl-card-text', 'Listen to a song of your own, or a calm track, while we measure.'));
      music.addEventListener('click', function () { startSession('music'); });
    } else {
      music.disabled = true;
      music.appendChild(el('span', 'rl-card-text', 'Coming soon'));
    }
    cards.appendChild(music);

    root.appendChild(cards);
    root.appendChild(buildComparison());
    root.appendChild(makeSoundCheckbox());
  }

  function showSessionView(method) {
    view = 'session';
    clearRoot();

    var m = methods[method];
    root.appendChild(el('h2', null, m && m.label ? m.label : 'Relief'));

    var stage = el('div', 'rl-stage');
    root.appendChild(stage);

    var count = el('div', 'rl-count', String(session.seconds));
    var countLabel = el('div', 'rl-count-label', 'seconds left');
    root.appendChild(count);
    root.appendChild(countLabel);

    var stop = el('button', 'rl-btn', 'Stop');
    stop.type = 'button';
    stop.addEventListener('click', function () { endSession(true); });
    root.appendChild(stop);

    session.countEl = count;
    session.stageEl = stage;
  }

  /* ----------------------------------------------------------- session logic */

  function startSession(method) {
    if (session) return;                      // one session at a time
    method = method || 'breathing';
    var m = methods[method];
    if (!m) return;
    if (!root) init();
    if (!root) return;

    var seconds = sessionSeconds();
    var now = Date.now();
    session = {
      method: method,
      seconds: seconds,
      startedAt: now,
      endsAt: now + seconds * 1000,
      before: recentAverage(AVG_WINDOW_MS),   // null if no scores yet
      waiting: false,                         // music holds the countdown until sound starts
      tick: null,
      countEl: null,
      stageEl: null,
      breath: null,
      music: null
    };

    showSessionView(method);
    m.start(session.stageEl, session);        // synchronous: still inside the user's click

    session.tick = setInterval(function () {
      if (!session) return;
      if (session.waiting) {
        if (session.countEl) session.countEl.textContent = String(session.seconds);
        return;
      }
      var left = Math.max(0, Math.ceil((session.endsAt - Date.now()) / 1000));
      if (session.countEl) session.countEl.textContent = String(left);
      if (left <= 0) endSession(false);
    }, 250);
  }

  function endSession(stopped) {
    if (!session) return null;
    var s = session;
    session = null;                           // set first so a second call does nothing
    if (s.tick) clearInterval(s.tick);

    var m = methods[s.method];
    try { if (m && m.stop) m.stop(s); } catch (e) { console.error('relief stop failed', e); }

    // If the music never started, nothing was measured.
    var elapsedMs = s.waiting ? 0 : Date.now() - s.startedAt;
    var after = recentAverage(AVG_WINDOW_MS);
    var before = s.before;

    var result = {
      method: s.method,
      stopped: !!stopped,
      elapsedMs: elapsedMs,
      tooShort: elapsedMs < MIN_MEASURE_MS,
      scoreBefore: before ? round1(before.score) : null,
      scoreAfter: after ? round1(after.score) : null,
      gsrBefore: before && isNum(before.gsrPct) ? round1(before.gsrPct) : null,
      gsrAfter: after && isNum(after.gsrPct) ? round1(after.gsrPct) : null,
      gsrDrop: null,
      measured: false
    };
    if (isNum(result.gsrBefore) && isNum(result.gsrAfter)) {
      result.gsrDrop = round1(result.gsrBefore - result.gsrAfter);
    }
    result.measured = !result.tooShort && result.scoreBefore !== null && result.scoreAfter !== null;

    if (result.measured) {
      var record = {
        t: Date.now(),
        method: s.method,
        scoreBefore: result.scoreBefore,
        scoreAfter: result.scoreAfter,
        gsrBefore: result.gsrBefore,
        gsrAfter: result.gsrAfter
      };
      try {
        if (A.store && typeof A.store.addRelief === 'function') A.store.addRelief(record);
      } catch (e) { console.error('addRelief failed', e); }

      if (typeof A.emit === 'function') {
        A.emit('relief', {
          method: s.method,
          scoreBefore: result.scoreBefore,
          scoreAfter: result.scoreAfter,
          gsrDrop: result.gsrDrop
        });
      }
    }

    showResult(result);
    return result;
  }

  function showResult(result) {
    if (!root) init();
    if (!root) return;
    view = 'result';
    clearRoot();

    root.appendChild(el('h2', null, result.stopped ? 'Session stopped' : 'Session complete'));

    if (result.measured) {
      root.appendChild(el('div', 'rl-result-main',
        'Stress score: ' + Math.round(result.scoreBefore) + ' -> ' + Math.round(result.scoreAfter)));

      if (isNum(result.gsrDrop)) {
        var abs = Math.abs(result.gsrDrop).toFixed(1);
        var text, cls;
        if (result.gsrDrop > 0) {
          text = 'Skin response: ' + abs + ' points lower than before';
          cls = 'rl-good';
        } else if (result.gsrDrop < 0) {
          text = 'Skin response: ' + abs + ' points higher than before';
          cls = 'rl-bad';
        } else {
          text = 'Skin response: about the same as before';
          cls = '';
        }
        root.appendChild(el('div', 'rl-result-line ' + cls, text));
      }
    } else if (result.tooShort) {
      root.appendChild(el('div', 'rl-note', 'That was too short to measure. Try a full session.'));
    } else {
      root.appendChild(el('div', 'rl-note', 'Connect the device to measure your result'));
    }

    var row = el('div', 'rl-btn-row');
    var again = el('button', 'rl-btn primary', 'Try again');
    again.type = 'button';
    again.addEventListener('click', function () {
      view = 'choice';
      showChoice();
    });
    row.appendChild(again);
    root.appendChild(row);
  }

  /* ------------------------------------------------------------ registration */

  function registerMethod(key, impl) {
    methods[key] = impl;
    if (root && view === 'choice' && !session) showChoice();   // enable its card
  }

  methods.breathing = {
    label: 'Breathe',
    start: startBreathing,
    stop: stopBreathing
  };

  methods.music = {
    label: 'Play my music',
    start: startMusic,
    stop: stopMusic
  };

  /* -------------------------------------------------------------------- init */

  function init() {
    if (root) return;
    var tab = document.getElementById('tab-relief');
    if (!tab) return;
    injectStyles();
    root = document.getElementById('relief-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'relief-root';
      tab.appendChild(root);
    }
    showChoice();
  }

  if (typeof A.on === 'function') A.on('score', onScore);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  A.relief = {
    startSession: startSession,
    endSession: endSession,
    showResult: showResult,
    showChoice: showChoice,
    registerMethod: registerMethod,
    recentAverage: recentAverage
  };
})();
