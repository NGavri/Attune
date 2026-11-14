/* Attune - js/bus.js
   Tiny event bus. Modules talk to each other ONLY through this.
   attune.on(name, fn)   listen
   attune.off(name, fn)  stop listening
   attune.emit(name, data)  call every listener; one broken listener never stops the others */
   
window.attune = {
  _listeners: {},

  on: function (name, fn) {
    if (typeof fn !== 'function') return;
    (this._listeners[name] = this._listeners[name] || []).push(fn);
  },

  off: function (name, fn) {
    var list = this._listeners[name];
    if (!list) return;
    this._listeners[name] = list.filter(function (f) { return f !== fn; });
  },

  emit: function (name, data) {
    // copy the list so listeners can call on/off while we loop
    var list = (this._listeners[name] || []).slice();
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](data);
      } catch (err) {
        console.error('[attune] listener for "' + name + '" threw:', err);
      }
    }
  },

  state: {}
};
