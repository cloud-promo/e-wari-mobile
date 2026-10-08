/* Moteur d'affichage e-Wari : gabarit (sc-if, sc-for, {{valeurs}}) + état, mise à jour minimale du DOM (morphdom) */
(function () {
  var H = {}, hid = 0, comp = null, root = null, tpl = null, queued = false;
  var ONE = /^\{\{\s*([\w.]+)\s*\}\}$/, ANY = /\{\{\s*([\w.]+)\s*\}\}/g;
  function get(sc, path) { var p = path.split('.'), v = sc[p[0]]; for (var i = 1; i < p.length && v != null; i++) v = v[p[i]]; return v; }
  function txt(s, sc) { return s.indexOf('{{') < 0 ? s : s.replace(ANY, function (_, p) { var v = get(sc, p); return v == null ? '' : String(v); }); }
  function build(src, sc, out) {
    for (var n = src.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { out.appendChild(document.createTextNode(txt(n.nodeValue, sc))); continue; }
      if (n.nodeType !== 1) continue;
      var tag = n.localName, m;
      if (tag === 'sc-if') { m = ONE.exec(n.getAttribute('value') || ''); if (m && get(sc, m[1])) build(n, sc, out); continue; }
      if (tag === 'sc-for') {
        m = ONE.exec(n.getAttribute('list') || ''); var as = n.getAttribute('as'), list = m ? get(sc, m[1]) : null;
        if (list && list.length) for (var i = 0; i < list.length; i++) { var s2 = Object.create(sc); s2[as] = list[i]; build(n, s2, out); }
        continue;
      }
      var el = n.namespaceURI === 'http://www.w3.org/2000/svg' ? document.createElementNS(n.namespaceURI, tag) : document.createElement(tag);
      for (var a = 0; a < n.attributes.length; a++) {
        var at = n.attributes[a], nm = at.name, v = at.value, one = ONE.exec(v);
        if (nm.slice(0, 2) === 'on') {
          var f = one ? get(sc, one[1]) : null;
          if (typeof f === 'function') { var id = 'h' + (hid++); H[id] = f; el.setAttribute('data-' + nm, id); }
          continue;
        }
        var val = one ? get(sc, one[1]) : txt(v, sc);
        if (tag === 'textarea' && nm === 'value') { el.textContent = val == null ? '' : String(val); continue; }
        if (val === true) el.setAttribute(nm, '');
        else if (val !== false && val != null) el.setAttribute(nm, String(val));
      }
      build(n, sc, el);
      out.appendChild(el);
    }
  }
  function render() {
    queued = false; H = {}; hid = 0;
    var vals = comp.renderVals();
    var next = document.createElement('div'); next.id = 'app';
    build(tpl, vals, next);
    window.morphdom(root, next, { onBeforeElUpdated: function (from, to) { return from.tagName !== 'VIDEO'; } });
    if (comp.didRender) comp.didRender();
  }
  function schedule() { if (!queued) { queued = true; Promise.resolve().then(render); } }
  window.DCLogic = function () {};
  window.DCLogic.prototype.setState = function (o) { this.state = Object.assign({}, this.state || {}, o); schedule(); };
  function fire(attr, e) {
    for (var t = e.target; t && t !== document; t = t.parentNode) {
      if (t.getAttribute && t.getAttribute(attr)) { var f = H[t.getAttribute(attr)]; if (f && !t.disabled) f(e); return; }
    }
  }
  var special = function (t) { return t.type === 'checkbox' || t.type === 'radio' || t.type === 'file' || t.tagName === 'SELECT'; };
  window.EWARI = {
    start: function (Comp) {
      root = document.getElementById('app');
      tpl = document.getElementById('tpl').content;
      root.addEventListener('click', function (e) { fire('data-onclick', e); });
      root.addEventListener('input', function (e) { if (!special(e.target)) fire('data-onchange', e); });
      root.addEventListener('change', function (e) { if (special(e.target)) fire('data-onchange', e); });
      comp = new Comp(); comp.props = {}; comp.state = {}; window.EWARI.comp = comp;
      if (comp.init) comp.init();
      render();
    }
  };
  if (!window.EWARI_NATIVE && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
})();
