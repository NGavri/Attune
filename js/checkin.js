/* js/checkin.js - owner: B
 * "How stressed do you feel?" check-in and
 * "You said X. Your body said Y."
 *
 * Listens:  'score', 'spike'
 * Emits:    'checkin' {t, self, body, source}
 *           'open-trigger' {t}
 * Saves:    attune.store.addCheckin({t, self, body, source, noticed})
 */
(function () {
  window.attune = window.attune || {};

  var modalOpen = false;       // never open a second modal while one is open
  var recentScores = [];       // [{at, score}] for the last 60 seconds
  var activeOverlay = null;
  var activeKeyHandler = null;

  // ---------- styles (injected once so this file works on its own) ----------
  function injectStyles() {
    if (document.getElementById('ck-style')) return;
    var css = [
      '.ck-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px}',
      '.ck-btn{font-family:"IBM Plex Sans",sans-serif;font-size:16px;line-height:1.2;',
      'padding:12px 20px;border:1.5px solid #1F1B16;border-radius:6px;',
      'background:#F5F1EA;color:#1F1B16;cursor:pointer}',
      '.ck-btn:hover{background:#EAE4D9}',
      '.ck-btn:focus-visible{outline:2px solid #1F1B16;outline-offset:2px}',
      '.ck-btn-big{font-size:22px;padding:18px 28px;background:#C2410C;',
      'border-color:#C2410C;color:#F5F1EA}',
      '.ck-btn-big:hover{background:#A8380A}',
      '.ck-overlay{position:fixed;inset:0;background:rgba(31,27,22,0.45);',
      'display:flex;align-items:center;justify-content:center;padding:16px;z-index:1000}',
      '.ck-modal{background:#F5F1EA;color:#1F1B16;border:1.5px solid #1F1B16;',
      'border-radius:8px;padding:28px;width:100%;max-width:560px;max-height:100%;',
      'overflow:auto;font-family:"IBM Plex Sans",sans-serif}',
      '.ck-title{font-family:"Fraunces",serif;font-weight:600;font-size:26px;',
      'line-height:1.25;margin:0 0 20px}',
      '.ck-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}',
      '.ck-num{font-family:"IBM Plex Mono",monospace;font-size:26px;padding:18px 0;',
      'border:1.5px solid #1F1B16;border-radius:6px;background:#F5F1EA;',
      'color:#1F1B16;cursor:pointer}',
      '.ck-num:hover{background:#EAE4D9}',
      '.ck-num:focus-visible{outline:2px solid #1F1B16;outline-offset:2px}',
      '.ck-scale{display:flex;justify-content:space-between;margin-top:8px;',
      'font-size:13px;color:#5C554B}',
      '.ck-result{font-family:"Fraunces",serif;font-weight:600;font-size:36px;',
      'line-height:1.2;margin:0 0 14px}',
      '.ck-note{font-size:18px;margin:0 0 6px}',
      '.ck-note-calm{color:#5F7A61}',
      '.ck-note-stress{color:#C2410C}'
    ].join('');
    var style = document.createElement('style');
    style.id = 'ck-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------- helpers ----------
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function spikeThreshold() {
    var s = attune.settings;
    return (s && s.spikeThreshold != null) ? s.spikeThreshold : 6;
  }

  function currentBodyScore() {
    var ls = attune.state && attune.state.lastScore;
    if (ls && typeof ls.score === 'number' && isFinite(ls.score)) {
      return Math.round(ls.score);
    }
    return null;
  }

  function pruneScores() {
    var cutoff = Date.now() - 60000;
    while (recentScores.length && recentScores[0].at < cutoff) {
      recentScores.shift();
    }
  }

  function closeModal() {
    if (activeKeyHandler) {
      document.removeEventListener('keydown', activeKeyHandler);
      activeKeyHandler = null;
    }
    if (activeOverlay && activeOverlay.parentNode) {
      activeOverlay.parentNode.removeChild(activeOverlay);
    }
    activeOverlay = null;
    modalOpen = false;
  }

  function goRelief() {
    var btn = document.getElementById('tabbtn-relief');
    if (btn) btn.click();
  }

  // ---------- modal ----------
  function openModal(source) {
    if (modalOpen) return;
    var root = document.getElementById('modal-root');
    if (!root) return;
    modalOpen = true;
    injectStyles();

    var overlay = el('div', 'ck-overlay');
    var box = el('div', 'ck-modal');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    overlay.appendChild(box);
    root.appendChild(overlay);
    activeOverlay = overlay;

    activeKeyHandler = function (e) {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', activeKeyHandler);

    showQuestion(box, source);
  }

  function showQuestion(box, source) {
    box.innerHTML = '';
    var title = source === 'spike'
      ? 'Your body is showing stress. How stressed do you feel?'
      : 'How stressed do you feel right now?';
    var h = el('h2', 'ck-title', title);
    h.id = 'ck-title';
    box.setAttribute('aria-labelledby', 'ck-title');
    box.appendChild(h);

    var grid = el('div', 'ck-grid');
    var first = null;
    for (var i = 1; i <= 10; i++) {
      (function (n) {
        var b = el('button', 'ck-num', String(n));
        b.type = 'button';
        b.addEventListener('click', function () { handlePick(box, source, n); });
        grid.appendChild(b);
        if (!first) first = b;
      })(i);
    }
    box.appendChild(grid);

    var scale = el('div', 'ck-scale');
    scale.appendChild(el('span', '', '1 = calm'));
    scale.appendChild(el('span', '', '10 = very stressed'));
    box.appendChild(scale);

    var actions = el('div', 'ck-actions');
    var cancel = el('button', 'ck-btn', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', closeModal);
    actions.appendChild(cancel);
    box.appendChild(actions);

    if (first) first.focus();
  }

  function handlePick(box, source, x) {
    var t = Date.now();
    var y = currentBodyScore();

    pruneScores();
    var noticed;
    if (source === 'button') {
      var th = spikeThreshold();
      noticed = recentScores.some(function (s) { return s.score >= th; });
    } else {
      noticed = x >= 6;
    }

    attune.store.addCheckin({ t: t, self: x, body: y, source: source, noticed: noticed });
    if (attune.emit) attune.emit('checkin', { t: t, self: x, body: y, source: source });

    showResult(box, x, y, t);
  }

  function showResult(box, x, y, t) {
    box.innerHTML = '';

    if (y === null) {
      var h0 = el('h2', 'ck-title', 'You said ' + x + '.');
      h0.id = 'ck-title';
      box.setAttribute('aria-labelledby', 'ck-title');
      box.appendChild(h0);
      box.appendChild(el('p', 'ck-note',
        "Your body reading isn't ready yet - finish the baseline first"));
    } else {
      var big = el('h2', 'ck-result', 'You said ' + x + '. Your body said ' + y + '.');
      big.id = 'ck-title';
      box.setAttribute('aria-labelledby', 'ck-title');
      box.appendChild(big);

      var line, cls;
      if (Math.abs(x - y) <= 2) {
        line = "You're in tune with your body.";
        cls = 'ck-note ck-note-calm';
      } else if (x < y - 2) {
        line = 'Your body is more stressed than you noticed.';
        cls = 'ck-note ck-note-stress';
      } else {
        line = 'You feel more stressed than your body shows.';
        cls = 'ck-note';
      }
      box.appendChild(el('p', cls, line));
    }

    var actions = el('div', 'ck-actions');

    var log = el('button', 'ck-btn', "Log what's happening");
    log.type = 'button';
    log.addEventListener('click', function () {
      closeModal(); // close first so triggers.js can open its own modal
      if (attune.emit) attune.emit('open-trigger', { t: t });
    });

    var relax = el('button', 'ck-btn', 'Relax now');
    relax.type = 'button';
    relax.addEventListener('click', function () {
      closeModal();
      goRelief();
    });

    var close = el('button', 'ck-btn', 'Close');
    close.type = 'button';
    close.addEventListener('click', closeModal);

    actions.appendChild(log);
    actions.appendChild(relax);
    actions.appendChild(close);
    box.appendChild(actions);
    log.focus();
  }

  // ---------- live-actions buttons ----------
  function addButtons() {
    var host = document.getElementById('live-actions');
    if (!host) return;
    injectStyles();

    if (!document.getElementById('btnFeelStressed')) {
      var stressed = el('button', 'ck-btn ck-btn-big', 'I feel stressed');
      stressed.id = 'btnFeelStressed';
      stressed.type = 'button';
      stressed.addEventListener('click', function () { openModal('button'); });
      host.appendChild(stressed);
    }

    if (!document.getElementById('btnRelaxNow')) {
      var relax = el('button', 'ck-btn', 'Relax now');
      relax.id = 'btnRelaxNow';
      relax.type = 'button';
      relax.addEventListener('click', goRelief);
      host.appendChild(relax);
    }
  }

  // ---------- bus wiring ----------
  function wireBus() {
    if (!attune.on) return;
    attune.on('score', function (s) {
      if (!s || typeof s.score !== 'number') return;
      recentScores.push({ at: Date.now(), score: s.score });
      pruneScores();
    });
    attune.on('spike', function () {
      openModal('spike'); // ignored automatically if a modal is already open
    });
  }

  function init() {
    addButtons();
    wireBus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
