/* js/store.js - owner: B
 * attune.store: tiny wrapper around localStorage.
 * All data lives in ONE object under the key "attune.data":
 *   { checkins: [], triggers: [], reliefs: [] }
 * If localStorage is unavailable (private mode, quota, blocked), data is kept
 * in memory instead, so the app still works until the page is reloaded.
 */
(function () {
  window.attune = window.attune || {};

  var KEY = 'attune.data';
  var memory = null;        // in-memory copy, used when localStorage fails
  var useMemory = false;    // true once a localStorage read/write has failed

  function empty() {
    return { checkins: [], triggers: [], reliefs: [] };
  }

  // Make sure the object has all three arrays, whatever was stored.
  function normalize(d) {
    var out = empty();
    if (d && typeof d === 'object') {
      if (Array.isArray(d.checkins)) out.checkins = d.checkins;
      if (Array.isArray(d.triggers)) out.triggers = d.triggers;
      if (Array.isArray(d.reliefs)) out.reliefs = d.reliefs;
    }
    return out;
  }

  function load() {
    if (useMemory) return normalize(memory);
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return normalize(JSON.parse(raw));
      return memory ? normalize(memory) : empty();
    } catch (e) {
      // Blocked storage or corrupted JSON: fall back to memory.
      useMemory = true;
      return normalize(memory);
    }
  }

  function save(data) {
    memory = data; // always keep a copy in memory
    if (useMemory) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      useMemory = true;
    }
  }

  function add(listName, obj) {
    var data = load();
    data[listName].push(obj);
    save(data);
    return obj;
  }

  attune.store = {
    // Returns a copy: { checkins: [], triggers: [], reliefs: [] }
    getAll: function () {
      return JSON.parse(JSON.stringify(load()));
    },
    addCheckin: function (obj) { return add('checkins', obj); },
    addTrigger: function (obj) { return add('triggers', obj); },
    addRelief: function (obj) { return add('reliefs', obj); },
    clearAll: function () {
      var data = empty();
      memory = data;
      try {
        localStorage.removeItem(KEY);
      } catch (e) {
        useMemory = true;
      }
      save(data);
    }
  };
})();
