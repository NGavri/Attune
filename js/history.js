/* js/history.js - History and insights tab (owner: B)
 * Draws inside #tab-history. Plain script, no modules.
 * Redraws on 'tab' {name:'history'}, 'checkin', 'trigger-saved', 'relief'.
 */
(function () {
  'use strict';

  var root = null;
  var confirmingClear = false;
  var wired = false;

  // ---------- small helpers ----------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function fmtTime(t) {
    var n = num(t);
    if (n === null) return '';
    var d = new Date(n);
    if (isNaN(d.getTime())) return '';
    var day = d.toLocaleDateString('en-US', { weekday: 'short' });
    var time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return day + ' ' + time;
  }

  function fmtNum(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return '-';
    var d = digits == null ? 1 : digits;
    var s = n.toFixed(d);
    return s.replace(/\.0+$/, '');
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  // ---------- reading the store (defensive about its shape) ----------
  function readAll() {
    var all = null;
    try {
      if (window.attune && attune.store && typeof attune.store.getAll === 'function') {
        all = attune.store.getAll();
      }
    } catch (e) {
      all = null;
    }
    var out = { checkins: [], triggers: [], reliefs: [], raw: all };
    if (!all) return out;

    function pick(obj, keys) {
      for (var i = 0; i < keys.length; i++) {
        if (Array.isArray(obj[keys[i]])) return obj[keys[i]];
      }
      return [];
    }

    if (Array.isArray(all)) {
      // Flat list: sort items into buckets by their shape.
      all.forEach(function (it) {
        if (!it || typeof it !== 'object') return;
        if (it.type === 'checkin' || ('self' in it && 'body' in it)) out.checkins.push(it);
        else if (it.type === 'trigger' || 'category' in it) out.triggers.push(it);
        else if (it.type === 'relief' || 'method' in it) out.reliefs.push(it);
      });
    } else if (typeof all === 'object') {
      out.checkins = pick(all, ['checkins', 'checkIns', 'checkin']);
      out.triggers = pick(all, ['triggers', 'trigger']);
      out.reliefs = pick(all, ['reliefs', 'relief', 'reliefSessions', 'sessions']);
    }
    return out;
  }

  // ---------- computing the numbers ----------
  function awareness(checkins) {
    var total = checkins.length;
    var inTune = 0, rated = 0, noticed = 0, missed = 0;
    checkins.forEach(function (c) {
      var self = num(c.self), body = num(c.body);
      if (self !== null && body !== null) {
        rated++;
        if (Math.abs(self - body) <= 2) inTune++;
      }
      if (c.source === 'spike') {
        if (c.noticed === false) missed++;
        else if (c.noticed === true) noticed++;
      } else if (c.noticed === true || c.noticed === undefined) {
        noticed++;
      }
    });
    return {
      total: total,
      pct: rated ? Math.round((inTune / rated) * 100) : null,
      noticed: noticed,
      missed: missed
    };
  }

  function triggerStats(triggers) {
    var counts = {};
    triggers.forEach(function (t) {
      var cat = (t && t.category) ? String(t.category) : 'Other';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    var list = Object.keys(counts).map(function (k) {
      return { category: k, count: counts[k] };
    });
    list.sort(function (a, b) {
      return b.count - a.count || a.category.localeCompare(b.category);
    });
    var recent = triggers.slice().sort(function (a, b) {
      return (num(b.t) || 0) - (num(a.t) || 0);
    }).slice(0, 5);
    return { list: list, recent: recent };
  }

  function reliefStats(reliefs) {
    var res = {
      breathing: { n: 0, sum: 0 },
      music: { n: 0, sum: 0 }
    };
    reliefs.forEach(function (r) {
      var m = String(r.method || '').toLowerCase();
      var key = m.indexOf('breath') === 0 ? 'breathing' : (m.indexOf('music') === 0 ? 'music' : null);
      if (!key) return;
      var before = num(r.scoreBefore), after = num(r.scoreAfter);
      res[key].n++;
      if (before !== null && after !== null) res[key].sum += (before - after);
    });
    return {
      breathing: { n: res.breathing.n, avg: res.breathing.n ? res.breathing.sum / res.breathing.n : null },
      music: { n: res.music.n, avg: res.music.n ? res.music.sum / res.music.n : null }
    };
  }

  // ---------- building the HTML ----------
  function awarenessCard(a) {
    var h = '<section class="hist-card" id="hist-awareness"><h3 class="hist-h">Awareness</h3>';
    if (!a.total) {
      h += '<p class="hist-empty">No check-ins yet. Try one from the Live tab.</p></section>';
      return h;
    }
    h += '<div class="hist-stats">';
    h += '<div class="hist-stat"><div class="hist-big">' + a.total + '</div><div class="hist-lbl">Check-ins</div></div>';
    h += '<div class="hist-stat"><div class="hist-big">' + (a.pct === null ? '-' : a.pct + '%') + '</div><div class="hist-lbl">In tune</div></div>';
    h += '<div class="hist-stat"><div class="hist-big">' + a.noticed + '</div><div class="hist-lbl">Noticed on your own: ' + a.noticed + '</div></div>';
    h += '<div class="hist-stat"><div class="hist-big hist-clay">' + a.missed + '</div><div class="hist-lbl">Missed: ' + a.missed + '</div></div>';
    h += '</div>';
    h += '<p class="hist-note">In tune means what you said was within 2 points of what your body showed.</p>';
    h += '</section>';
    return h;
  }

  function triggersCard(ts) {
    var h = '<section class="hist-card" id="hist-triggers"><h3 class="hist-h">Triggers</h3>';
    if (!ts.list.length) {
      h += '<p class="hist-empty">No triggers logged yet.</p></section>';
      return h;
    }
    var max = ts.list[0].count || 1;
    h += '<div class="hist-bars">';
    ts.list.forEach(function (it) {
      var w = Math.max(4, Math.round((it.count / max) * 100));
      h += '<div class="hist-bar-row">' +
        '<div class="hist-bar-label">' + esc(it.category) + '</div>' +
        '<div class="hist-bar-track"><div class="hist-bar-fill" style="width:' + w + '%"></div></div>' +
        '<div class="hist-bar-count">' + it.count + '</div>' +
        '</div>';
    });
    h += '</div>';
    h += '<h4 class="hist-sub">Most recent</h4><ul class="hist-list">';
    ts.recent.forEach(function (t) {
      var when = fmtTime(t.t);
      var cat = t.category ? String(t.category) : 'Other';
      h += '<li><span class="hist-mono">' + esc(when ? when + ' - ' : '') + '</span>' + esc(cat) + '</li>';
    });
    h += '</ul></section>';
    return h;
  }

  function reliefRow(label, s) {
    var avg;
    if (!s.n || s.avg === null) {
      avg = '<span class="hist-lbl">No sessions yet</span>';
    } else {
      var drop = s.avg;
      avg = '<span class="hist-big hist-sage">' + (drop > 0 ? '-' : (drop < 0 ? '+' : '')) + fmtNum(Math.abs(drop), 1) + '</span>' +
        '<span class="hist-lbl"> average score change</span>';
    }
    return '<div class="hist-relief-row"><div class="hist-relief-name">' + esc(label) +
      '<div class="hist-lbl">' + plural(s.n, 'session', 'sessions') + '</div></div>' +
      '<div class="hist-relief-val">' + avg + '</div></div>';
  }

  function reliefCard(rs) {
    var h = '<section class="hist-card" id="hist-relief"><h3 class="hist-h">Relief</h3>';
    if (!rs.breathing.n && !rs.music.n) {
      h += '<p class="hist-empty">No relief sessions yet. Try breathing or music from the Relief tab.</p></section>';
      return h;
    }
    h += reliefRow('Breathing', rs.breathing);
    h += reliefRow('Music', rs.music);
    h += '<p class="hist-note">Score change is the stress score before minus after. A bigger drop means it helped more.</p>';
    h += '</section>';
    return h;
  }

  function checkinsCard(checkins) {
    var h = '<section class="hist-card" id="hist-checkins"><h3 class="hist-h">Last 10 check-ins</h3>';
    if (!checkins.length) {
      h += '<p class="hist-empty">No check-ins yet.</p></section>';
      return h;
    }
    var last = checkins.slice().sort(function (a, b) {
      return (num(b.t) || 0) - (num(a.t) || 0);
    }).slice(0, 10);
    h += '<ul class="hist-list">';
    last.forEach(function (c) {
      var self = num(c.self), body = num(c.body);
      h += '<li><span class="hist-mono">' + esc(fmtTime(c.t)) + '</span> ' +
        'You said ' + (self === null ? '-' : fmtNum(self, 1)) +
        ' / Body ' + (body === null ? '-' : fmtNum(body, 1)) + '</li>';
    });
    h += '</ul></section>';
    return h;
  }

  function actionsCard() {
    var h = '<section class="hist-card" id="hist-actions"><h3 class="hist-h">Your data</h3>';
    h += '<p class="hist-note">Everything stays on this laptop, in this browser.</p>';
    h += '<div class="hist-btn-row">';
    h += '<button type="button" class="hist-btn" data-hist="export">Export data (JSON)</button>';
    if (!confirmingClear) {
      h += '<button type="button" class="hist-btn hist-btn-danger" data-hist="clear">Clear all data</button>';
    }
    h += '</div>';
    if (confirmingClear) {
      h += '<div class="hist-confirm" role="alert">' +
        '<p class="hist-confirm-text">Are you sure? This deletes all check-ins, triggers and relief sessions. It cannot be undone.</p>' +
        '<div class="hist-btn-row">' +
        '<button type="button" class="hist-btn hist-btn-danger" data-hist="clear-yes">Yes, delete everything</button>' +
        '<button type="button" class="hist-btn" data-hist="clear-no">Cancel</button>' +
        '</div></div>';
    }
    h += '</section>';
    return h;
  }

  // ---------- styles (scoped with hist- prefix; no shadows, gradients, emoji) ----------
  function injectStyles() {
    if (document.getElementById('hist-style')) return;
    var css = [
      '#tab-history .hist-wrap{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;align-items:start}',
      '#tab-history .hist-card{background:#F5F1EA;border:1px solid #1F1B16;border-radius:6px;padding:18px 20px;color:#1F1B16}',
      '#tab-history .hist-h{font-family:"Fraunces",serif;font-weight:600;font-size:22px;margin:0 0 12px}',
      '#tab-history .hist-sub{font-family:"Fraunces",serif;font-weight:600;font-size:16px;margin:16px 0 6px}',
      '#tab-history .hist-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}',
      '#tab-history .hist-big{font-family:"Fraunces",serif;font-size:32px;line-height:1.1}',
      '#tab-history .hist-lbl{font-family:"IBM Plex Sans",sans-serif;font-size:13px;opacity:.75}',
      '#tab-history .hist-clay{color:#C2410C}',
      '#tab-history .hist-sage{color:#5F7A61}',
      '#tab-history .hist-note{font-family:"IBM Plex Sans",sans-serif;font-size:13px;opacity:.75;margin:12px 0 0}',
      '#tab-history .hist-empty{font-family:"IBM Plex Sans",sans-serif;font-size:15px;opacity:.75;margin:0}',
      '#tab-history .hist-mono{font-family:"IBM Plex Mono",monospace;font-size:13px}',
      '#tab-history .hist-list{list-style:none;margin:0;padding:0;font-family:"IBM Plex Sans",sans-serif;font-size:14px}',
      '#tab-history .hist-list li{padding:6px 0;border-bottom:1px solid rgba(31,27,22,.15)}',
      '#tab-history .hist-list li:last-child{border-bottom:none}',
      '#tab-history .hist-bars{display:flex;flex-direction:column;gap:8px}',
      '#tab-history .hist-bar-row{display:grid;grid-template-columns:130px 1fr 28px;gap:10px;align-items:center;font-family:"IBM Plex Sans",sans-serif;font-size:14px}',
      '#tab-history .hist-bar-track{background:rgba(31,27,22,.08);height:14px;border-radius:3px;overflow:hidden}',
      '#tab-history .hist-bar-fill{background:#C2410C;height:100%}',
      '#tab-history .hist-bar-count{font-family:"IBM Plex Mono",monospace;font-size:13px;text-align:right}',
      '#tab-history .hist-relief-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(31,27,22,.15);font-family:"IBM Plex Sans",sans-serif}',
      '#tab-history .hist-relief-name{font-size:16px}',
      '#tab-history .hist-relief-val{text-align:right}',
      '#tab-history .hist-relief-val .hist-big{font-size:26px}',
      '#tab-history .hist-btn-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}',
      '#tab-history .hist-btn{font-family:"IBM Plex Sans",sans-serif;font-size:14px;color:#1F1B16;background:#F5F1EA;border:1px solid #1F1B16;border-radius:4px;padding:8px 14px;cursor:pointer}',
      '#tab-history .hist-btn:hover{background:#1F1B16;color:#F5F1EA}',
      '#tab-history .hist-btn-danger{border-color:#C2410C;color:#C2410C}',
      '#tab-history .hist-btn-danger:hover{background:#C2410C;color:#F5F1EA}',
      '#tab-history .hist-confirm{margin-top:14px;padding:12px;border:1px solid #C2410C;border-radius:4px}',
      '#tab-history .hist-confirm-text{font-family:"IBM Plex Sans",sans-serif;font-size:14px;margin:0}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'hist-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ---------- rendering ----------
  function render() {
    root = document.getElementById('tab-history');
    if (!root) return;
    injectStyles();
    var d = readAll();
    var html = '<div class="hist-wrap">' +
      awarenessCard(awareness(d.checkins)) +
      triggersCard(triggerStats(d.triggers)) +
      reliefCard(reliefStats(d.reliefs)) +
      checkinsCard(d.checkins) +
      actionsCard() +
      '</div>';
    root.innerHTML = html;
  }

  // ---------- actions ----------
  function exportData() {
    var data;
    try { data = attune.store.getAll(); } catch (e) { data = {}; }
    var json = JSON.stringify(data == null ? {} : data, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    a.href = url;
    a.download = 'attune-data-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function clearAll() {
    var done = false;
    try {
      var s = window.attune && attune.store;
      var names = ['clearAll', 'clear', 'reset', 'wipe'];
      for (var i = 0; i < names.length && s; i++) {
        if (typeof s[names[i]] === 'function') {
          s[names[i]]();
          done = true;
          break;
        }
      }
    } catch (e) { /* fall through to localStorage */ }
    if (!done) {
      try {
        var keys = [];
        for (var k = 0; k < localStorage.length; k++) {
          var key = localStorage.key(k);
          if (key && key.toLowerCase().indexOf('attune') === 0) keys.push(key);
        }
        keys.forEach(function (key) { localStorage.removeItem(key); });
      } catch (e2) { /* ignore */ }
    }
  }

  function onClick(e) {
    var el = e.target;
    while (el && el !== root && !(el.getAttribute && el.getAttribute('data-hist'))) {
      el = el.parentNode;
    }
    if (!el || el === root || !el.getAttribute) return;
    var action = el.getAttribute('data-hist');
    if (action === 'export') {
      exportData();
    } else if (action === 'clear') {
      confirmingClear = true;
      render();
    } else if (action === 'clear-no') {
      confirmingClear = false;
      render();
    } else if (action === 'clear-yes') {
      clearAll();
      confirmingClear = false;
      render();
    }
  }

  // ---------- wiring ----------
  function wire() {
    if (wired) return;
    root = document.getElementById('tab-history');
    if (!root) return;
    wired = true;
    root.addEventListener('click', onClick);

    attune.on('tab', function (d) {
      if (d && d.name === 'history') {
        confirmingClear = false;
        render();
      }
    });
    attune.on('checkin', render);
    attune.on('trigger-saved', render);
    attune.on('relief', render);

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
