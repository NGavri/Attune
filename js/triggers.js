/* js/triggers.js (owner: B)
 * Trigger log: "What's happening right now?" modal.
 *
 * Listens:  'open-trigger' {t}
 * Emits:    'open-trigger' {t}            (from the "Log a trigger" button)
 *           'trigger-saved' {t, category}
 * Uses:     attune.store.addTrigger({t, category, note, body})
 *           attune.state.lastScore
 */
(function () {
  'use strict';

  var CATEGORIES = [
    'Exam / studying',
    'Work / deadline',
    'Social',
    'Family / phone call',
    'Health / body',
    'Other'
  ];

  var STYLE_ID = 'triggers-style';
  var BUTTON_ID = 'btn-log-trigger';

  var current = null; // { overlay, t, saving, onKey }

  /* ---------- styles (paper and ink, flat, no shadows or gradients) ---------- */

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '.trg-overlay{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1000;',
      'background:rgba(31,27,22,0.45);display:flex;align-items:center;justify-content:center;padding:16px;}',
      '.trg-modal{background:#F5F1EA;color:#1F1B16;border:2px solid #1F1B16;border-radius:6px;',
      'width:100%;max-width:480px;max-height:92vh;overflow-y:auto;padding:28px 24px;',
      'font-family:"IBM Plex Sans",system-ui,sans-serif;}',
      '.trg-title{font-family:"Fraunces",Georgia,serif;font-weight:600;font-size:26px;',
      'line-height:1.2;margin:0 0 18px 0;}',
      '.trg-options{display:flex;flex-direction:column;gap:10px;}',
      '.trg-opt{font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:18px;font-weight:500;',
      'text-align:left;color:#1F1B16;background:#F5F1EA;border:2px solid #1F1B16;border-radius:6px;',
      'padding:16px 18px;cursor:pointer;}',
      '.trg-opt:hover,.trg-opt:focus-visible{background:#1F1B16;color:#F5F1EA;outline:none;}',
      '.trg-other{display:none;margin-top:14px;}',
      '.trg-other.trg-show{display:block;}',
      '.trg-input{width:100%;box-sizing:border-box;font-family:"IBM Plex Sans",system-ui,sans-serif;',
      'font-size:16px;color:#1F1B16;background:#FFFFFF;border:2px solid #1F1B16;border-radius:6px;',
      'padding:12px 14px;margin-bottom:10px;}',
      '.trg-input:focus{outline:2px solid #C2410C;outline-offset:1px;}',
      '.trg-row{display:flex;gap:10px;}',
      '.trg-save{font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:16px;font-weight:600;',
      'color:#F5F1EA;background:#C2410C;border:2px solid #C2410C;border-radius:6px;',
      'padding:12px 22px;cursor:pointer;}',
      '.trg-save:hover,.trg-save:focus-visible{background:#1F1B16;border-color:#1F1B16;outline:none;}',
      '.trg-cancel{font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:14px;color:#1F1B16;',
      'background:transparent;border:none;text-decoration:underline;cursor:pointer;margin-top:16px;padding:4px 0;}',
      '.trg-saved{font-family:"Fraunces",Georgia,serif;font-size:30px;font-weight:600;',
      'color:#5F7A61;text-align:center;padding:36px 0;}',
      '.trg-log-btn{font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:14px;font-weight:500;',
      'color:#1F1B16;background:transparent;border:1.5px solid #1F1B16;border-radius:6px;',
      'padding:8px 14px;cursor:pointer;}',
      '.trg-log-btn:hover,.trg-log-btn:focus-visible{background:#1F1B16;color:#F5F1EA;outline:none;}'
    ].join('');
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  }

  /* ---------- modal ---------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function closeModal() {
    if (!current) return;
    document.removeEventListener('keydown', current.onKey);
    if (current.overlay.parentNode) current.overlay.parentNode.removeChild(current.overlay);
    current = null;
  }

  function save(category, note) {
    if (!current || current.saving) return;
    current.saving = true;

    var t = current.t;
    var last = window.attune && attune.state ? attune.state.lastScore : null;
    var entry = {
      t: t,
      category: category,
      note: note || '',
      body: last ? last.score : null
    };

    try {
      attune.store.addTrigger(entry);
    } catch (err) {
      console.warn('[triggers] could not save trigger:', err);
    }

    // Show "Saved" for 1 second, then close and announce.
    var modal = current.overlay.querySelector('.trg-modal');
    modal.innerHTML = '';
    var saved = el('div', 'trg-saved', 'Saved');
    saved.setAttribute('role', 'status');
    modal.appendChild(saved);

    setTimeout(function () {
      closeModal();
      attune.emit('trigger-saved', { t: t, category: category });
    }, 1000);
  }

  function openModal(data) {
    if (current) return; // already open
    var root = document.getElementById('modal-root');
    if (!root) {
      console.warn('[triggers] #modal-root not found');
      return;
    }
    injectStyles();

    var t = data && typeof data.t === 'number' ? data.t : Date.now();

    var overlay = el('div', 'trg-overlay');
    var modal = el('div', 'trg-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'trg-title');

    var title = el('h2', 'trg-title', "What's happening right now?");
    title.id = 'trg-title';
    modal.appendChild(title);

    var options = el('div', 'trg-options');
    var otherBox = el('div', 'trg-other');
    var input = el('input', 'trg-input');
    input.type = 'text';
    input.maxLength = 200;
    input.placeholder = 'What is going on?';
    input.setAttribute('aria-label', 'Describe what is happening');

    CATEGORIES.forEach(function (name) {
      var btn = el('button', 'trg-opt', name);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        if (name === 'Other') {
          otherBox.classList.add('trg-show');
          input.focus();
        } else {
          save(name, '');
        }
      });
      options.appendChild(btn);
    });
    modal.appendChild(options);

    var saveBtn = el('button', 'trg-save', 'Save');
    saveBtn.type = 'button';
    saveBtn.addEventListener('click', function () {
      save('Other', input.value.trim());
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        save('Other', input.value.trim());
      }
    });
    var row = el('div', 'trg-row');
    row.appendChild(saveBtn);
    otherBox.appendChild(input);
    otherBox.appendChild(row);
    modal.appendChild(otherBox);

    var cancel = el('button', 'trg-cancel', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', closeModal);
    modal.appendChild(cancel);

    overlay.appendChild(modal);
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay && current && !current.saving) closeModal();
    });

    var onKey = function (e) {
      if (e.key === 'Escape' && current && !current.saving) closeModal();
    };
    document.addEventListener('keydown', onKey);

    root.appendChild(overlay);
    current = { overlay: overlay, t: t, saving: false, onKey: onKey };

    var first = options.querySelector('button');
    if (first) first.focus();
  }

  /* ---------- "Log a trigger" button ---------- */

  function addButton() {
    var host = document.getElementById('live-actions');
    if (!host || document.getElementById(BUTTON_ID)) return;
    injectStyles();
    var btn = el('button', 'trg-log-btn', 'Log a trigger');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.addEventListener('click', function () {
      attune.emit('open-trigger', { t: Date.now() });
    });
    host.appendChild(btn);
  }

  /* ---------- wire up ---------- */

  attune.on('open-trigger', openModal);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addButton);
  } else {
    addButton();
  }
})();
