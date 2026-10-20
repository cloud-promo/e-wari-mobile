/* e-Wari · application mobile (pilote) : logique branchée sur l'API. Même écrans que le prototype. */
var NATIVE = window.EWARI_NATIVE || null; // application Android/iOS (Capacitor) : API distante, biométrie et pages externes natives
var API = (NATIVE ? NATIVE.origin : '') + '/api';
var LS = { get: function (k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, set: function (k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} } };
function call(path, body, token) {
  var o = { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' } };
  if (token) o.headers.Authorization = 'Bearer ' + token;
  if (body) o.body = JSON.stringify(body);
  return fetch(API + path, o).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) { var e = new Error(j.error || 'Erreur réseau, réessayez.'); e.status = r.status; e.data = j; if (r.status === 423 && j.blocked && window.__onBlocked) window.__onBlocked(j); throw e; }
      return j;
    });
  }, function () { throw new Error('Pas de connexion internet. Réessayez.'); });
}
function shrink(file, cb) {
  var rd = new FileReader();
  rd.onload = function () {
    var img = new Image();
    img.onload = function () {
      var s = Math.min(1, 1280 / Math.max(img.width, img.height));
      var cv = document.createElement('canvas');
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      cb(cv.toDataURL('image/jpeg', 0.8));
    };
    img.src = rd.result;
  };
  rd.readAsDataURL(file);
}
function b64u(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
function rnd(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return a; }

class Component extends DCLogic {
  init() {
    var self = this;
    var tok = LS.get('ewari_user');
    var hash = location.hash.slice(1);
    var q = {}; hash.split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[p[0]] = decodeURIComponent(p[1] || ''); });
    this.state = { token: tok, screen: tok ? 'loading' : 'country', deeplink: (q.p || q.pay) ? q : null, cardBack: q.carte || '', country: LS.get('ewari_country') || 'SN' };
    if (hash) history.replaceState(null, '', location.pathname);
    // Compte inactif (3 essais incorrects) : écran de demande de réactivation, quelle que soit l'opération en cours
    window.__onBlocked = function (j) { LS.set('ewari_user', ''); self.stopCam && self.stopCam(); self.setState({ token: '', screen: 'lock', acctLocked: true, busy: false, pinEntry: '', lockErr: '', lbPhone: '', lbCode: '', lbSent: false, lbDone: '', lbCh: 'sms' }); };
    if (tok) this.refresh(true);
    document.addEventListener('visibilitychange', function () {
      var s = self.state;
      if (document.hidden) self._hiddenAt = Date.now();
      else if (s.token && s.srv && s.srv.hasPin && self._hiddenAt && Date.now() - self._hiddenAt > 120000 && ['lock', 'country', 'phone', 'otp'].indexOf(s.screen) < 0) self.setState({ screen: 'lock', lockMethod: LS.get('ewari_bio') ? 'bio' : 'pin', pinEntry: '', lockErr: '' });
    });
  }
  refresh(boot) {
    var self = this, s = this.state;
    return call('/app/state', null, s.token).then(function (srv) {
      LS.set('ewari_country', srv.country);
      var o = { srv: srv, country: srv.country };
      if (boot) {
        if (!srv.hasPin) o.screen = 'pinset';
        else o.screen = 'lock', o.lockMethod = LS.get('ewari_bio') ? 'bio' : 'pin';
      }
      self.setState(o);
      return srv;
    }).catch(function (e) {
      if (e.status === 401) { LS.set('ewari_user', ''); self.setState({ token: '', srv: null, screen: 'country' }); }
      else if (boot) self.setState({ screen: 'country', bootErr: e.message });
    });
  }
  didRender() {
    var s = this.state, self = this;
    if (s.screen !== this._lastScreen) {
      this._lastScreen = s.screen;
      var sc = document.getElementById('scroller'); if (sc) sc.scrollTop = 0;
      if (s.screen === 'insCard') { clearInterval(this._insT); this._insT = setInterval(function () { if (self.state.screen !== 'insCard') { clearInterval(self._insT); return; } self.setState({ insTick: Date.now() }); }, 1000); }
      if (s.screen === 'chat') { clearInterval(this._poll); this._poll = setInterval(function () { if (self.state.screen === 'chat') self.refresh(); else clearInterval(self._poll); }, 8000); }
      if (s.screen === 'mmwait') { clearInterval(this._mmT); var n = 0; this._mmT = setInterval(function () { if (self.state.screen !== 'mmwait') { clearInterval(self._mmT); return; } n++; self.setState({ mmTick: Date.now() }); if (n % 3 === 0) self.mmCheck(); }, 1000); }
      if (s.screen === 'home' && s.cardBack) { var cid = s.cardBack; this.setState({ cardBack: '' }); call('/card/' + encodeURIComponent(cid), null, s.token).then(function (r) { self.setState({ screen: 'done', last: { title: r.title, text: r.text } }); self.refresh(); }, function () { self.refresh(); }); }
      if (s.screen === 'home' && s.deeplink) { var d = s.deeplink; this.setState({ deeplink: null }); this.openPayLink(d); }
    }
    var wantCam = s.screen === 'scan' && s.scanTab !== 'myqr';
    if (wantCam && !this._cam) this.startCam();
    if (!wantCam && this._cam) this.stopCam();
    var kWant = s.screen === 'kycPhoto' ? 'doc' : (s.screen === 'kycSelfie' ? 'self' : '');
    if (this._kcam && this._kcam !== kWant) this.kycCamStop();
    if (this._kstream) { var kv = document.getElementById('kycVideo'); if (kv && kv.srcObject !== this._kstream) { kv.srcObject = this._kstream; kv.play().catch(function () {}); } }
    if (this._cam && this._stream) { var v = document.getElementById('scanVideo'); if (v && v.srcObject !== this._stream) { v.srcObject = this._stream; v.play().catch(function () {}); } }
  }
  mmFinish(m) {
    var s = this.state, self = this;
    if (!m || m.status === 'pending') { this.setState({ mm: m || s.mm, busy: false }); return; }
    var amt = Math.round(m.amount).toLocaleString('fr-FR').replace(/[\u00a0\u202f\s]/g, ' ') + ' F';
    var last = m.status === 'succeeded'
      ? { title: 'Dépôt réussi', text: amt + ' ajoutés à votre solde depuis ' + m.op + '.' + (m.demo ? ' (Démo : validation simulée, aucun argent réel n’a été prélevé.)' : ''), txId: m.txId }
      : { title: m.status === 'cancelled' ? 'Dépôt annulé' : m.status === 'expired' ? 'Demande expirée' : 'Dépôt non abouti', text: (m.error ? m.error.charAt(0).toUpperCase() + m.error.slice(1) + '. ' : '') + 'Aucun montant n’a été prélevé sur votre compte ' + m.op + '.', fail: true };
    this.setState({ busy: false, screen: 'done', pending: '', mm: null, mmCode: '', mmPin: '', mmSms: '', mmErr: '', amount: '', dAmount: '', last: last });
    self.refresh();
  }
  mmCheck() {
    var s = this.state, self = this;
    if (s.screen !== 'mmwait' || !s.mm || this._mmBusy) return;
    this._mmBusy = true;
    call('/mm/' + encodeURIComponent(s.mm.id), null, s.token).then(function (m) { self._mmBusy = false; if (self.state.screen === 'mmwait') self.mmFinish(m); }, function () { self._mmBusy = false; });
  }
  startCam() {
    var self = this;
    this._cam = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this.setState({ camErr: 'Caméra indisponible sur ce navigateur : choisissez un commerce dans la liste.' }); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (st) {
      if (!self._cam) { st.getTracks().forEach(function (t) { t.stop(); }); return; }
      self._stream = st; self.setState({ camErr: '' });
      var det = ('BarcodeDetector' in window) ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
      var cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
      var tick = function () {
        if (!self._cam) return;
        var v = document.getElementById('scanVideo');
        if (v && v.readyState >= 2) {
          var done = function (txt) { if (txt && self._cam) { self.stopCam(); self.handleQr(txt); } else setTimeout(tick, 250); };
          if (det) { det.detect(v).then(function (r) { done(r[0] && r[0].rawValue); }, function () { setTimeout(tick, 400); }); return; }
          if (window.jsQR) {
            cv.width = v.videoWidth; cv.height = v.videoHeight; cx.drawImage(v, 0, 0);
            var r = window.jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
            done(r && r.data); return;
          }
        }
        setTimeout(tick, 300);
      };
      if (!det && !window.jsQR) { var sc = document.createElement('script'); sc.src = NATIVE ? 'vendor/jsQR.js' : 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'; document.head.appendChild(sc); }
      tick();
    }, function () { self.setState({ camErr: 'Accès à la caméra refusé. Autorisez la caméra ou choisissez un commerce dans la liste.' }); });
  }
  stopCam() {
    this._cam = false;
    if (this._stream) { this._stream.getTracks().forEach(function (t) { t.stop(); }); this._stream = null; }
  }
  kycCamStart(kind) {
    var self = this;
    this.kycCamStop();
    if (window.isSecureContext === false) { this.setState({ kycCamErr: 'La caméra exige une connexion sécurisée (https). Choisissez une photo depuis l’appareil.' }); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this.setState({ kycCamErr: 'Ce navigateur ne donne pas accès à la caméra. Ouvrez e-Wari dans Chrome ou Safari, ou choisissez une photo depuis l’appareil.' }); return; }
    this._kcam = kind;
    this.setState({ kycCam: kind, kycCamErr: '' });
    var want = { video: { facingMode: kind === 'self' ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false };
    navigator.mediaDevices.getUserMedia(want).catch(function (e) {
      if (e && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError' || e.name === 'NotReadableError')) return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      throw e;
    }).then(function (st) {
      if (self._kcam !== kind) { st.getTracks().forEach(function (t) { t.stop(); }); return; }
      self._kstream = st; self.setState({ kycCam: kind });
    }, function (e) {
      if (self._kcam !== kind) return;
      self._kcam = '';
      var n = e && e.name, m;
      if (n === 'NotAllowedError' || n === 'SecurityError') m = 'Accès à la caméra refusé. Autorisez la caméra pour ce site (icône du cadenas à côté de l’adresse, ou Réglages du téléphone › navigateur › Caméra), puis réessayez. Vous pouvez aussi choisir une photo depuis l’appareil.';
      else if (n === 'NotFoundError' || n === 'OverconstrainedError') m = 'Aucune caméra détectée sur cet appareil. Choisissez une photo depuis l’appareil.';
      else if (n === 'NotReadableError' || n === 'AbortError') m = 'La caméra est déjà utilisée par une autre application (visio, appareil photo…). Fermez-la puis réessayez.';
      else m = 'Impossible d’ouvrir la caméra. Choisissez une photo depuis l’appareil.';
      self.setState({ kycCam: '', kycCamErr: m });
    });
  }
  kycCamStop() {
    this._kcam = '';
    if (this._kstream) { this._kstream.getTracks().forEach(function (t) { t.stop(); }); this._kstream = null; }
    if (this.state.kycCam) this.setState({ kycCam: '' });
  }
  kycSnap() {
    var v = document.getElementById('kycVideo'), kind = this._kcam;
    if (!v || !v.videoWidth) { this.setState({ kycCamErr: 'La caméra démarre… réessayez dans une seconde.' }); return; }
    var k = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
    var cv = document.createElement('canvas');
    cv.width = Math.round(v.videoWidth * k); cv.height = Math.round(v.videoHeight * k);
    cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
    var d = cv.toDataURL('image/jpeg', 0.85);
    this.kycCamStop();
    if (kind === 'doc') this.setState({ kycDocImg: d, kycCamErr: '' }); else this.setState({ kycSelfImg: d, kycCamErr: '' });
  }
  handleQr(txt) {
    var q = {};
    var h = String(txt).split('#')[1] || '';
    h.split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[p[0]] = decodeURIComponent(p[1] || ''); });
    if (!q.p && !q.pay) { this.setState({ screen: 'scan', camErr: 'Ce QR code n’est pas un QR de paiement e-Wari.' }); return; }
    this.openPayLink(q);
  }
  openPayLink(q) {
    if (q.p) this.setState({ screen: 'qrpay', merchant: q.p, qrTo: '', qrAmount: q.a || '', qrFixed: q.a ? Number(q.a) : 0 });
    else if (q.pay) this.setState({ screen: 'qrpay', merchant: '', qrTo: q.pay, qrAmount: q.a || '', qrFixed: q.a ? Number(q.a) : 0 });
  }
  bioCreate(done) {
    var self = this, srv = this.state.srv || {};
    if (NATIVE) { NATIVE.bioEnable(done); return; }
    if (!window.PublicKeyCredential || !navigator.credentials) { done('La biométrie n’est pas disponible sur ce navigateur.'); return; }
    navigator.credentials.create({ publicKey: {
      rp: { name: 'e-Wari' }, user: { id: rnd(16), name: srv.phone || 'e-Wari', displayName: srv.phone || 'e-Wari' },
      challenge: rnd(32), pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' }, timeout: 60000
    } }).then(function (cred) { LS.set('ewari_bio', b64u(cred.rawId)); done(''); }, function () { done('Biométrie non activée (annulée ou non disponible sur ce téléphone).'); });
  }
  bioCheck(done) {
    var id = LS.get('ewari_bio');
    if (NATIVE) { NATIVE.bioCheck(done); return; }
    if (!id || !navigator.credentials) { done('La biométrie n’est pas activée sur ce téléphone.'); return; }
    navigator.credentials.get({ publicKey: { challenge: rnd(32), allowCredentials: [{ type: 'public-key', id: unb64u(id) }], userVerification: 'required', timeout: 60000 } })
      .then(function () { done(''); }, function () { done('Empreinte ou visage non reconnu. Utilisez le code PIN.'); });
  }

  renderVals() {
    var self = this;
    var s = Object.assign({ screen: 'country', otp: '', regPhone: '', pinNew: '', pinConf: '', pinEntry: '', mode: 'buy', asset: 'BTC', amount: '', dir: 'in', method: '', phone: '', dAmount: '', xAsset: '', recipient: '', xAmount: '', xDest: 'user', xCountry: '', xOp: '', scanTab: 'scan', merchant: '', qrAmount: '', billCat: 'eau', billPartner: '', billRef: '', billAmount: '', invParts: 5, invProfile: 'client', invCode: '', invRisk: false, usePts: true, kycDoc: 'cni', ddOpen: '', pinMode: '', bioPick: '', claimOp: -1, claimMotif: '', claimDesc: '', chatInput: '', contactMsg: '', payout: 'wallet', payPhone: '', lockMethod: 'pin', payOtp: '', last: null }, this.state || {});
    var srv = s.srv || { balances: {}, rates: { BTC: 60000000, ETH: 2000000, USDT: 600 }, caps: { capMain: 100000, capCrypto: 200000 }, fees: { trade: 1, withdraw: 1, momoSame: 1, momoIntl: 2 }, points: { bal: 0, value: 500, perPart: 20, step: 100000 }, round: {}, hist: [], claims: [], msgs: [], partners: [], kyc: 'none' };
    var P = srv.rates;
    var D = { BTC: 8, ETH: 6, USDT: 2 };
    var N = { BTC: 'Bitcoin', ETH: 'Ethereum', USDT: 'Tether (dollar)' };
    var C = { BTC: '#A85600', ETH: '#4A55B8', USDT: '#0E7560' };
    var FEE = (srv.fees.trade || 1) / 100;
    var CRYPTOS = ['BTC', 'ETH', 'USDT'];
    var COUNTRIES = [
      { code: 'SN', city: 'Dakar', len: [9], name: 'Sénégal', dial: '+221', ph: '77 123 45 67', zone: 'UEMOA', ops: ['Wave', 'Orange Money', 'Free Money'] },
      { code: 'CI', city: 'Abidjan', len: [10], name: 'Côte d’Ivoire', dial: '+225', ph: '07 12 34 56 78', zone: 'UEMOA', ops: ['Wave', 'Orange Money', 'MTN MoMo', 'Moov Money'] },
      { code: 'ML', city: 'Bamako', len: [8], name: 'Mali', dial: '+223', ph: '70 12 34 56', zone: 'UEMOA', ops: ['Orange Money', 'Moov Money', 'Wave'] },
      { code: 'BF', city: 'Ouagadougou', len: [8], name: 'Burkina Faso', dial: '+226', ph: '70 12 34 56', zone: 'UEMOA', ops: ['Orange Money', 'Moov Money', 'Wave'] },
      { code: 'BJ', city: 'Cotonou', len: [10], name: 'Bénin', dial: '+229', ph: '01 97 12 34 56', zone: 'UEMOA', ops: ['MTN MoMo', 'Moov Money'] },
      { code: 'TG', city: 'Lomé', len: [8], name: 'Togo', dial: '+228', ph: '90 12 34 56', zone: 'UEMOA', ops: ['Moov Money', 'Mixx by Yas'] },
      { code: 'NE', city: 'Niamey', len: [8], name: 'Niger', dial: '+227', ph: '90 12 34 56', zone: 'UEMOA', ops: ['Airtel Money', 'Moov Money'] },
      { code: 'GW', city: 'Bissau', len: [9], name: 'Guinée-Bissau', dial: '+245', ph: '955 123 456', zone: 'UEMOA', ops: ['Orange Money', 'MTN MoMo'] },
      { code: 'CM', city: 'Douala', len: [9], name: 'Cameroun', dial: '+237', ph: '6 71 23 45 67', zone: 'CEMAC', ops: ['MTN MoMo', 'Orange Money'] },
      { code: 'GA', city: 'Libreville', len: [8, 9], name: 'Gabon', dial: '+241', ph: '07 12 34 56', zone: 'CEMAC', ops: ['Airtel Money', 'Moov Money'] },
      { code: 'CG', city: 'Brazzaville', len: [9], name: 'Congo', dial: '+242', ph: '06 123 45 67', zone: 'CEMAC', ops: ['MTN MoMo', 'Airtel Money'] },
      { code: 'GN', city: 'Conakry', len: [9], name: 'Guinée', dial: '+224', ph: '621 12 34 56', zone: 'GN', ops: ['Orange Money', 'MTN MoMo'] },
      { code: 'TD', city: 'N’Djamena', len: [8], name: 'Tchad', dial: '+235', ph: '66 12 34 56', zone: 'CEMAC', ops: ['Airtel Money', 'Moov Money'] },
      { code: 'CF', city: 'Bangui', len: [8], name: 'Centrafrique', dial: '+236', ph: '75 12 34 56', zone: 'CEMAC', ops: ['Orange Money'] }
    ];
    var byCode = function (code) { return COUNTRIES.filter(function (c) { return c.code === code; })[0]; };
    var ctry = byCode(s.country) || COUNTRIES[0];
    var CUR = ctry.zone === 'CEMAC' ? 'XAF' : ctry.zone === 'GN' ? 'GNF' : 'XOF';
    var cryptoOn = ctry.zone === 'UEMOA';
    var bal = { XOF: 0, XAF: 0, GNF: 0, BTC: 0, ETH: 0, USDT: 0 };
    Object.keys(srv.balances || {}).forEach(function (k) { bal[k] = CRYPTOS.indexOf(k) >= 0 ? srv.balances[k] / 1e8 : Number(srv.balances[k]); });
    var phoneOk = function (d, c) { return (c || ctry).len.indexOf(d.length) >= 0; };
    var lenText = function (c) { return c.len.join(' ou ') + ' chiffres'; };
    var fmtNum = function (d) {
      var g = d.length === 10 ? [2, 2, 2, 2, 2] : d.length === 9 ? [2, 3, 2, 2] : [2, 2, 2, 2];
      var out = [], i = 0;
      g.forEach(function (n) { if (i < d.length) { out.push(d.substr(i, n)); i += n; } });
      if (i < d.length) out.push(d.substr(i));
      return out.join(' ');
    };
    var intl = function (c, d) { return c.dial + ' ' + fmtNum(d); };
    var parsePhone = function (raw, defC) {
      var r = String(raw || '').replace(/[\s.\-()]/g, '');
      if (r.indexOf('00') === 0) r = '+' + r.slice(2);
      if (r.charAt(0) === '+') {
        var all = r.slice(1).replace(/\D/g, '');
        var c = COUNTRIES.filter(function (k) { return all.indexOf(k.dial.slice(1)) === 0; })[0];
        return c ? { c: c, d: all.slice(c.dial.length - 1), explicit: true } : { c: null, d: all, explicit: true };
      }
      return { c: defC || ctry, d: r.replace(/\D/g, ''), explicit: false };
    };
    var e164Intl = function (e) { var p = parsePhone(e); return p.c ? intl(p.c, p.d) : e; };
    var userC = byCode(srv.country) || ctry;
    var userE164 = srv.phone || '';
    var userIntl = userE164 ? e164Intl(userE164) : '';
    var userDigits = userE164 ? parsePhone(userE164).d : '';
    var set = function (o) { if (!('srvErr' in o)) o.srvErr = ''; self.setState(o); };
    var go = function (screen, extra) { return function () { set(Object.assign({ screen: screen }, extra || {})); }; };
    var srvErr = function (k) { return s.srvFor === k ? (s.srvErr || '') : ''; };

    var fx = function (n) { return Math.round(n).toLocaleString('fr-FR').replace(/[  \s]/g, ' ') + (CUR === 'GNF' ? ' GNF' : ' F'); };
    var fc = function (n, a) {
      var t = Number(n).toFixed(D[a]);
      if (t.indexOf('.') >= 0) t = t.replace(/0+$/, '').replace(/\.$/, '');
      return t.replace('.', ',') + ' ' + a;
    };
    var num = function (v) {
      var x = parseFloat(String(v || '').replace(/[\s  ]/g, '').replace(',', '.'));
      return isFinite(x) && x > 0 ? x : 0;
    };
    var chip = function (on) {
      return 'flex-grow: 1; min-height: 44px; border-radius: 12px; font-weight: 600; font-size: 14px; ' +
        (on ? 'background: #15171C; color: #FFFFFF; border: 1px solid #15171C;' : 'background: #FFFFFF; color: #15171C; border: 1px solid #CFE2D0;');
    };
    var tab = function (on) {
      return 'min-height: 44px; border: 0; border-radius: 11px; font-weight: 600; font-size: 15px; ' +
        (on ? 'background: #FFFFFF; color: #15171C; box-shadow: 0 1px 2px rgba(0,0,0,0.08);' : 'background: transparent; color: #4A4E56;');
    };
    var cta = function (ok) {
      return 'width: 100%; height: 54px; border: 0; border-radius: 16px; font-weight: 600; font-size: 16px; ' +
        (ok && !s.busy ? 'background: #13894A; color: #FFFFFF;' : 'background: #D9D5CB; color: #5A5E66;');
    };
    var nav = function (on) {
      return 'display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border: 0; background: transparent; font-size: 12px; font-weight: 600; ' +
        (on ? 'color: #13894A;' : 'color: #5A5E66;');
    };
    var dd = function (id, items, label, sub, noun) {
      var top = items.slice(0, 3), rest = items.slice(3), open = s.ddOpen === id;
      var selRest = rest.filter(function (r) { return r.on; })[0];
      return {
        top: top, hasRest: rest.length > 0, open: open, expanded: open ? 'true' : 'false',
        toggle: function () { set({ ddOpen: open ? '' : id }); },
        ddLabel: selRest ? label(selRest) + ' · sélectionné' : noun + ' (' + rest.length + ')',
        chev: open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6',
        ddStyle: 'display: flex; align-items: center; gap: 8px; width: 100%; min-height: 46px; padding: 0 14px; border-radius: 12px; font-weight: 600; font-size: 14px; ' + (selRest ? 'background: #E6F7EA; border: 1px solid #13894A; color: #0B5C31;' : 'background: #FFFFFF; border: 1px solid #CFE2D0; color: #15171C;'),
        rest: rest.map(function (r) {
          var sb = sub ? sub(r) : '';
          return { label: label(r), sub: sb, hasSub: !!sb, on: !!r.on,
            pick: function () { r.pick(); set({ ddOpen: '' }); },
            style: 'display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 10px 14px; border: 0; border-bottom: 1px solid #E7F1E6; text-align: left; color: #15171C; background: ' + (r.on ? '#E6F7EA' : '#FFFFFF') };
        })
      };
    };
    var PT = srv.points;
    var PT_VAL = PT.value, PTS_PER_PART = PT.perPart;
    var ptsBal = PT.bal;

    /* Envoi d'une opération : intention (contrôles serveur + code SMS) puis validation */
    var askPay = function (kind, ok, body) {
      return function () {
        if (!ok || s.busy) return;
        set({ busy: true });
        call('/payments/intent', body(), s.token).then(function (r) {
          if (r.card) { self.setState({ busy: true, cardGo: r.card.url }); if (NATIVE) NATIVE.openCard(r.card.url, function (cid) { self.setState({ busy: false, screen: 'home', cardBack: cid }); }); else location.href = r.card.url; return; }
          if (r.mm) { self.setState({ busy: false, screen: 'mmwait', pending: kind, payId: r.id, payLinesSrv: r.lines, mm: r.mm, mmCode: '', mmPin: '', mmErr: '', mmSms: '', srvErr: '' }); return; }
          self.setState({ busy: false, screen: 'payotp', pending: kind, payId: r.id, payLinesSrv: r.lines, payHint: r.hint || 'Code envoyé par SMS au ' + userIntl, payOtp: '', payErr: '', srvErr: '' });
        }, function (e) { self.setState({ busy: false, srvErr: e.message, srvFor: kind }); if (e.status === 401) self.refresh(true); });
      };
    };

    /* Accueil */
    var cryptoTotalN = 0;
    CRYPTOS.forEach(function (a) { cryptoTotalN += bal[a] * P[a]; });
    var CAP = srv.caps.capMain, CAP_C = srv.caps.capCrypto;
    var kyc = srv.kyc || 'none';
    var kycOk = kyc === 'verified';
    var capRoom = Math.max(0, CAP - bal[CUR]);
    var capRoomC = Math.max(0, CAP_C - cryptoTotalN);
    var cryptoRows = CRYPTOS.map(function (a) {
      return {
        sym: a, name: N[a], bal: fc(bal[a], a), val: '≈ ' + fx(bal[a] * P[a]),
        price: '1 ' + a + ' = ' + fx(P[a]),
        badge: 'width: 44px; height: 44px; flex-shrink: 0; border-radius: 22px; display: flex; align-items: center; justify-content: center; color: #FFFFFF; font-size: 11px; font-weight: 700; background: ' + C[a],
        pick: go('wallet', { wAsset: a, wRecv: false })
      };
    });

    /* Crypto : acheter, vendre, convertir — cours Binance + marge, prix garanti après validation */
    var CX = srv.crypto || { mode: 'sim', src: '', quoteSec: 60, convertFee: 0.5, minTrade: 1000, spreadBuy: 1, spreadSell: 1, prices: {}, nets: {} };
    CRYPTOS.forEach(function (a) { if (!CX.prices[a]) CX.prices[a] = { buy: P[a], sell: P[a], mid: P[a], usd: 1, usdBid: 1 }; if (!CX.nets[a]) CX.nets[a] = []; });
    var MIN_T = CX.minTrade || 1000, QSEC = CX.quoteSec || 60;
    var pctS = function (v) { return String(v).replace('.', ',') + ' %'; };
    var fq = function (n, a) { var f = Math.pow(10, D[a]); var t = (Math.floor(n * f + 1e-6) / f).toFixed(D[a]); if (t.indexOf('.') >= 0) t = t.replace(/0+$/, '').replace(/\.$/, ''); return t; };
    var tmode = s.mode === 'sell' ? 'sell' : s.mode === 'convert' ? 'convert' : 'buy';
    var isBuy = tmode === 'buy', isConv = tmode === 'convert';
    var price = isBuy ? CX.prices[s.asset].buy : CX.prices[s.asset].sell;
    var amt = num(s.amount);
    var sellQty = !isBuy && !isConv ? (s.sellAll ? bal[s.asset] : amt / price) : 0;
    var tErr = '';
    if (!isConv && amt > 0) {
      if (amt < MIN_T) tErr = 'Montant minimum : ' + fx(MIN_T);
      else if (isBuy && amt > bal[CUR]) tErr = 'Solde F CFA insuffisant';
      else if (!isBuy && sellQty > bal[s.asset] + 1e-8) tErr = 'Solde ' + s.asset + ' insuffisant';
      else if (!kycOk && isBuy && amt > capRoomC) tErr = 'Compte non vérifié : cumul crypto plafonné à ' + fx(CAP_C) + '. Achat possible jusqu’à ' + fx(Math.floor(capRoomC)) + '.';
    }
    var OPS = ctry.ops;
    var payout = (s.payout === 'wallet' || OPS.indexOf(s.payout) >= 0) ? s.payout : 'wallet';
    var isCash = !isBuy && !isConv && payout !== 'wallet';
    var WFEE = (srv.fees.withdraw || 1) / 100;
    var payDigits = String(s.payPhone || userDigits || '').replace(/\D/g, '');
    if (!tErr && isCash && payDigits.length > 0 && !phoneOk(payDigits)) tErr = 'Le numéro doit contenir ' + lenText(ctry) + ' (' + ctry.name + ')';
    if (!tErr && !kycOk && !isBuy && !isConv && !isCash && amt > 0 && amt > capRoom) tErr = capRoom < MIN_T ? 'Compte non vérifié : compte principal au plafond de ' + fx(CAP) + '. Choisissez « Recevoir sur » un compte mobile money.' : 'Compte non vérifié : le compte principal ne peut dépasser ' + fx(CAP) + '. Choisissez « Recevoir sur » mobile money ou vendez au plus ' + fx(Math.floor(capRoom)) + '.';
    tErr = tErr || srvErr('trade');
    var tradeOk = !isConv && amt >= MIN_T && !tErr && (!isCash || phoneOk(payDigits));
    var gotCrypto = amt / price;
    var gotXof = isCash ? amt * (1 - WFEE) : amt;
    var maxVal = isBuy ? Math.floor(bal[CUR]) : Math.floor(bal[s.asset] * price);
    var quick = [5000, 10000, 25000].map(function (v) {
      return { label: fx(v), pick: function () { set({ amount: String(v), sellAll: false }); } };
    }).concat([{ label: 'Max', pick: function () { set({ amount: String(maxVal), sellAll: !isBuy }); } }]);
    var confirmTrade = askPay('trade', tradeOk, function () {
      var b = { kind: 'trade', mode: isBuy ? 'buy' : 'sell', asset: s.asset, amount: Math.floor(amt), payout: payout, payPhone: payDigits };
      if (!isBuy && s.sellAll) b.qty = (Math.round(bal[s.asset] * 1e8) / 1e8).toFixed(8);
      return b;
    });
    /* Convertir crypto ↔ crypto */
    var cFrom = CRYPTOS.indexOf(s.cFrom) >= 0 ? s.cFrom : 'USDT';
    var cTo = (CRYPTOS.indexOf(s.cTo) >= 0 && s.cTo !== cFrom) ? s.cTo : (cFrom === 'BTC' ? 'USDT' : 'BTC');
    var cAmt = num(s.cAmount);
    var cRate = CX.prices[cFrom].usdBid / CX.prices[cTo].usd * (1 - CX.convertFee / 100);
    var cOutN = cAmt * cRate;
    var cErr = '';
    if (cAmt > 0) {
      if (cAmt > bal[cFrom] + 1e-9) cErr = 'Solde ' + cFrom + ' insuffisant';
      else if (cAmt * CX.prices[cFrom].sell < MIN_T * 0.99) cErr = 'Montant minimum : l’équivalent de ' + fx(MIN_T);
    }
    cErr = cErr || srvErr('swap');
    var swapOk = cAmt > 0 && !cErr;
    var confirmConv = askPay('swap', swapOk, function () { return { kind: 'swap', from: cFrom, to: cTo, qty: String(cAmt) }; });
    var assetChip = function (list, cur, pick) { return list.map(function (a) { return { sym: a, pick: function () { pick(a); }, style: chip(cur === a) }; }); };

    /* Wallet crypto : solde, prix, actions, adresse de dépôt dédiée */
    var wA = CRYPTOS.indexOf(s.wAsset) >= 0 ? s.wAsset : 'BTC';
    var wNets = CX.nets[wA] || [];
    var wNet = wNets.filter(function (n) { return n.id === s.wNet; })[0] || wNets[0] || { id: '', name: '', min: 0, eta: '', fee: 0 };
    var addrKey = wA + ':' + wNet.id;
    var wAd = (s.addrs || {})[addrKey] || null;
    var putAddr = function (v) { var a = Object.assign({}, self.state.addrs || {}); a[addrKey] = v; return a; };
    var loadAddr = function () {
      if (s.busy) return;
      set({ busy: true });
      call('/crypto/address?asset=' + wA + '&network=' + wNet.id, null, s.token).then(function (r) { self.setState({ busy: false, addrs: putAddr(r) }); },
        function (e) { self.setState({ busy: false, addrs: putAddr({ error: e.message }) }); });
    };
    var wAddrTxt = wAd && wAd.address ? wAd.address : '';
    var wQr = (function () {
      if (!wAddrTxt || !window.qrcode) return { path: '', n: 25 };
      if (self._aq && self._aq.t === wAddrTxt) return self._aq;
      var q = window.qrcode(0, 'M'); q.addData(wAddrTxt); q.make();
      var n = q.getModuleCount(), d = '';
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (q.isDark(y, x)) d += 'M' + (x + 2) + ' ' + (y + 2) + 'h1v1h-1z';
      self._aq = { t: wAddrTxt, path: d, n: n + 4 };
      return self._aq;
    })();
    var SIMDEP = { BTC: 0.001, ETH: 0.05, USDT: 100 };
    var simDeposit = function () {
      if (s.busy) return;
      set({ busy: true });
      call('/crypto/sim-deposit', { asset: wA, network: wNet.id, amount: String(SIMDEP[wA]) }, s.token).then(function (r) {
        self.setState({ busy: false, screen: 'done', last: { title: r.title, text: r.text } }); self.refresh();
      }, function (e) { self.setState({ busy: false, addrs: putAddr(Object.assign({}, wAd, { error: e.message })) }); });
    };

    /* Dépôt / retrait */
    var isIn = s.dir === 'in';
    var method = (OPS.indexOf(s.method) >= 0 || (isIn && s.method === 'Carte bancaire')) ? s.method : OPS[0];
    var needPhone = method !== 'Carte bancaire';
    var digits = String(s.phone || userDigits || '').replace(/\D/g, '');
    var dAmt = num(s.dAmount);
    var dFeeN = Math.round(dAmt * (srv.fees.withdraw || 1) / 100);
    var dErr = '';
    if (dAmt > 0 && dAmt < 500) dErr = 'Montant minimum : 500 F';
    else if (!isIn && dAmt > bal[CUR]) dErr = 'Solde F CFA insuffisant';
    else if (isIn && !kycOk && dAmt > capRoom) dErr = 'Compte non vérifié : compte principal plafonné à ' + fx(CAP) + '. Vous pouvez encore déposer ' + fx(capRoom) + '. Vérifiez votre identité pour lever la limite.';
    else if (needPhone && digits.length > 0 && !phoneOk(digits)) dErr = 'Le numéro doit contenir ' + lenText(ctry) + ' (' + ctry.name + ')';
    dErr = dErr || srvErr('deposit');
    var depOk = dAmt >= 500 && !dErr && (!needPhone || phoneOk(digits));
    var methodNames = isIn ? OPS.concat(['Carte bancaire']) : OPS;
    var methods = methodNames.map(function (m) {
      return { label: m, on: method === m, pick: function () { set({ method: m }); }, style: chip(method === m) };
    });
    var confirmDeposit = askPay('deposit', depOk, function () { return { kind: isIn ? 'deposit' : 'withdraw', amount: Math.floor(dAmt), method: method, phone: digits }; });

    /* Envoyer */
    var xDest = s.xDest === 'momo' ? 'momo' : 'user';
    var zoneCs = COUNTRIES.filter(function (c) { return c.zone === ctry.zone; }).sort(function (a, b) { return (b.code === ctry.code) - (a.code === ctry.code); });
    var xC = byCode(s.xCountry);
    if (!xC || xC.zone !== ctry.zone) xC = ctry;
    var xa = xDest === 'momo' ? CUR : ((s.xAsset === CUR || (cryptoOn && CRYPTOS.indexOf(s.xAsset) >= 0)) ? s.xAsset : CUR);
    var xAmt = num(s.xAmount);
    var rawRec = String(s.recipient || '').trim();
    var isAddr = xDest === 'user' && xa !== CUR && /[a-zA-Z]/.test(rawRec) && rawRec.replace(/\s/g, '').length >= 26;
    var pr = parsePhone(rawRec, xC);
    var rc = (pr.c && pr.c.zone === ctry.zone) ? pr.c : xC;
    var xOp = rc.ops.indexOf(s.xOp) >= 0 ? s.xOp : rc.ops[0];
    var feeRate = xDest === 'momo' ? (rc.code === ctry.code ? srv.fees.momoSame : srv.fees.momoIntl) / 100 : 0;
    var xFeeN = Math.round(xAmt * feeRate);
    var xDebitN = xAmt + xFeeN;
    var xNets = (xa !== CUR && CX.nets[xa]) ? CX.nets[xa] : [];
    var xNet = xNets.filter(function (n) { return n.id === s.xNet; })[0] || xNets[0] || null;
    if (isAddr && xNet) { xFeeN = xNet.fee; xDebitN = xAmt + xFeeN; }
    var recOk = false, recErr = '', recWho = '';
    if (rawRec) {
      if (isAddr) { recOk = true; recWho = rawRec.slice(0, 6) + '…' + rawRec.slice(-4); }
      else if (!pr.c) recErr = 'Indicatif pays non pris en charge';
      else if (pr.c.zone !== ctry.zone) recErr = 'Envoi vers la zone ' + pr.c.zone + ' pas encore disponible';
      else if (!phoneOk(pr.d, pr.c)) { if (pr.explicit || pr.d.length > Math.max.apply(null, pr.c.len)) recErr = 'Numéro ' + pr.c.name + ' : ' + lenText(pr.c); }
      else if (pr.c.dial + pr.d === userE164) recErr = xDest === 'momo' ? 'Pour votre propre compte, utilisez « Retirer »' : 'C’est votre propre numéro';
      else { recOk = true; recWho = (xDest === 'momo' ? xOp + ' ' : '') + intl(pr.c, pr.d); }
    }
    var xErr = '';
    if (xAmt > 0 && xDebitN > bal[xa] + 1e-9) xErr = 'Solde ' + (xa === CUR ? 'F CFA' : xa) + ' insuffisant';
    else if (xDest === 'momo' && xAmt > 0 && xAmt < 500) xErr = 'Montant minimum : 500 F';
    else if (xa === CUR && xDest === 'user' && xAmt > 0 && xAmt < 100) xErr = 'Montant minimum : 100 F';
    if (!xErr && recErr) xErr = recErr;
    if (!xErr && isAddr && xNet && xAmt > 0 && xAmt < xNet.min) xErr = 'Minimum d’envoi sur ' + xNet.name + ' : ' + fc(xNet.min, xa);
    if (!xErr && isAddr && !kycOk) xErr = 'Vérifiez votre identité pour envoyer vers une adresse externe. Entre abonnés e-Wari, envoyez au numéro : c’est gratuit.';
    xErr = xErr || srvErr('send');
    var sendOk = xAmt > 0 && !xErr && recOk;
    var fmtX = function (n) { return xa === CUR ? fx(n) : fc(n, xa); };
    var sendChips = [CUR].concat(cryptoOn ? CRYPTOS : []).map(function (a) {
      return { sym: a, on: xa === a, pick: function () { set({ xAsset: a, xAmount: '' }); }, style: chip(xa === a) };
    });
    var xCountries = zoneCs.map(function (c) {
      var on = c.code === rc.code;
      return {
        on: on, code: c.code, name: c.name, short: c.name.replace('Côte d’Ivoire', 'Côte d’Iv.').replace('Burkina Faso', 'Burkina').replace('Guinée-Bissau', 'G.-Bissau').replace('Centrafrique', 'Centrafr.'),
        pick: function () { set({ xCountry: c.code, recipient: String(s.recipient || '').trim().charAt(0) === '+' ? '' : s.recipient }); },
        style: 'display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 52px; padding: 4px 2px; border-radius: 12px; ' +
          (on ? 'background: #15171C; color: #FFFFFF; border: 1px solid #15171C;' : 'background: #FFFFFF; color: #15171C; border: 1px solid #CFE2D0;')
      };
    });
    var xOps = rc.ops.map(function (o) { return { label: o, on: o === xOp, pick: function () { set({ xOp: o }); }, style: chip(o === xOp) }; });
    var confirmSend = askPay('send', sendOk, function () {
      var to = isAddr ? rawRec : (pr.c ? pr.c.dial + pr.d : rawRec);
      return xDest === 'momo' ? { kind: 'momo', to: to, country: rc.code, op: xOp, amount: Math.floor(xAmt) } : { kind: 'send', to: to, country: rc.code, asset: xa, network: isAddr && xNet ? xNet.id : undefined, amount: xa === CUR ? Math.floor(xAmt) : String(xAmt) };
    });

    /* Scanner et payer : commerces partenaires (QR) */
    var partners = srv.partners || [];
    var shopTypes = ['commerce', 'resto', 'livraison'];
    var shops = partners.filter(function (p) { return shopTypes.indexOf(p.type) >= 0; });
    var mer = partners.filter(function (m) { return m.code === s.merchant; })[0];
    var qrToUser = !mer && !!s.qrTo;
    var merName = mer ? mer.name : (qrToUser ? e164Intl(s.qrTo) : 'Marchand');
    var mFixed = (s.qrFixed || 0) > 0;
    var qrAmt = mFixed ? s.qrFixed : num(s.qrAmount);
    var qrErr = '';
    if (!mer && !qrToUser && s.screen === 'qrpay') qrErr = 'Marchand introuvable ou pas encore actif.';
    else if (qrToUser && s.qrTo === userE164) qrErr = 'C’est votre propre QR code.';
    else if (qrAmt > 0 && qrAmt > bal[CUR]) qrErr = 'Solde F CFA insuffisant';
    else if (!mFixed && qrAmt > 0 && qrAmt < 100) qrErr = 'Montant minimum : 100 F';
    qrErr = qrErr || srvErr('qr');
    var qrOk = qrAmt >= 100 && !qrErr;
    var TYPE_LBL = { immo: 'Immobilier', hotel: 'Hôtel', commerce: 'Commerce', resto: 'Restaurant', livraison: 'Livraison', ecole: 'École', eau: 'Eau', electricite: 'Électricité' };
    var merchants = shops.map(function (m) {
      return { name: m.name, sub: (TYPE_LBL[m.type] || 'Partenaire') + ' · ' + (m.city || ctry.name), amountText: 'Montant libre',
        pick: function () { set({ screen: 'qrpay', merchant: m.code, qrTo: '', qrAmount: '', qrFixed: 0 }); } };
    });
    var confirmQr = askPay('qr', qrOk, function () { return mer ? { kind: 'qr', partner: mer.code, amount: Math.floor(qrAmt) } : { kind: 'qr', to: s.qrTo, amount: Math.floor(qrAmt) }; });
    var myQrLink = (NATIVE ? NATIVE.origin : location.origin) + '/app#pay=' + encodeURIComponent(userE164);
    var qr = (function () {
      if (!window.qrcode || !userE164) return { path: '', n: 25 };
      if (self._qr && self._qr.link === myQrLink) return self._qr;
      var q = window.qrcode(0, 'M'); q.addData(myQrLink); q.make();
      var n = q.getModuleCount(), d = '';
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (q.isDark(y, x)) d += 'M' + (x + 2) + ' ' + (y + 2) + 'h1v1h-1z';
      self._qr = { link: myQrLink, path: d, n: n + 4 };
      return self._qr;
    })();

    /* Payer : factures et achats (partenaires réels de l'API) */
    var CITY = ctry.city;
    var BILLS = [
      { id: 'eau', type: 'eau', name: 'Eau', sub: 'Facture', color: '#1D5FA8', bg: '#E1ECF8', icon: 'M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z',
        ref: { label: 'N° de contrat', ph: '12345678', len: [6, 12], required: true, hint: 'Indiqué sur votre facture' },
        fixed: true, fixedLabel: 'Montant de la facture', foundTitle: 'Facture trouvée', benef: 'Société des eaux', lookup: true },
      { id: 'courant', type: 'electricite', name: 'Courant', sub: 'Crédit prépayé', color: '#9A5B00', bg: '#FBEBD3', icon: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
        ref: { label: 'N° de compteur', ph: '14123456789', len: [11, 11], required: true, hint: 'Inscrit sur votre compteur prépayé' },
        quick: [2000, 5000, 10000, 20000], foundTitle: 'Compteur reconnu', benef: 'Électricité prépayée' },
      { id: 'ecole', type: 'ecole', name: 'École', sub: 'Frais scolaires', color: '#6B3FA0', bg: '#EDE4F7', icon: 'M2 9l10-5 10 5-10 5-10-5zM6 11v5c3 2 9 2 12 0v-5',
        partnerLabel: 'Choisissez l’établissement', list: true,
        ref: { label: 'Matricule de l’élève', ph: 'EL-20458', len: [3, 14], alnum: true, required: true, hint: 'Donné par l’établissement' },
        fixed: true, fixedLabel: 'Montant à payer', foundTitle: 'Élève trouvé', lookup: true },
      { id: 'resto', type: 'resto', name: 'Resto', sub: 'Repas', color: '#A12A1E', bg: '#F6DEDA', icon: 'M7 2v8a2 2 0 0 0 2 2v10M11 2v8a2 2 0 0 1-2 2M17 2c-2 0-3 2-3 6s1 5 3 5v9',
        partnerLabel: 'Choisissez le restaurant', list: true,
        ref: { label: 'N° de table ou de ticket (facultatif)', ph: '12', len: [1, 10], alnum: true, required: false, hint: 'Aide le restaurant à retrouver votre commande' },
        quick: [2500, 5000, 10000], foundTitle: 'Restaurant partenaire' },
      { id: 'courses', type: 'commerce', name: 'Courses', sub: 'Alimentation', color: '#13894A', bg: '#D3F2DC', icon: 'M3 9h18l-2 11H5L3 9zM8 9l4-6 4 6',
        partnerLabel: 'Choisissez le commerce', list: true,
        ref: { label: 'N° de ticket de caisse (facultatif)', ph: 'T-0412', len: [1, 12], alnum: true, required: false, hint: 'Imprimé sur votre ticket' },
        quick: [5000, 10000, 25000], foundTitle: 'Commerce partenaire' },
      { id: 'loyer', type: 'immo', name: 'Loyer', sub: 'Agence, bailleur', color: '#7A4B12', bg: '#F5E9D8', icon: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6',
        partnerLabel: 'Choisissez votre agence ou votre bailleur', list: true,
        ref: { label: 'Identifiant locataire', ph: 'LOC-SN1001', len: [4, 14], alnum: true, required: true, hint: 'Remis par votre agence ou votre bailleur (figure sur votre bail)' },
        fixed: true, fixedLabel: 'Loyer du mois', foundTitle: 'Logement trouvé', lookup: true, rent: true },
      { id: 'hotel', type: 'hotel', name: 'Hôtel', sub: 'Séjour', color: '#1F5E73', bg: '#DDEFF3', icon: 'M2 19V6M2 15h20v4M22 15v-2a3 3 0 0 0-3-3h-8v5M6.5 12.5a1.5 1.5 0 1 0 0-.01',
        partnerLabel: 'Choisissez l’hôtel', list: true,
        ref: { label: 'N° de réservation', ph: 'RES-1024', len: [3, 14], alnum: true, required: true, hint: 'Indiqué sur votre confirmation de réservation ou à la réception' },
        lookup: true, lookSoft: true, fixed: true, fixedLabel: 'Montant du séjour', quick: [25000, 50000, 100000], foundTitle: 'Réservation trouvée' }
    ];
    var bc = BILLS.filter(function (b) { return b.id === s.billCat; })[0] || BILLS[0];
    var badgeStyle = function (b, size) { return 'width: ' + size + 'px; height: ' + size + 'px; flex-shrink: 0; border-radius: ' + (size / 2) + 'px; display: flex; align-items: center; justify-content: center; color: ' + b.color + '; background: ' + b.bg; };
    var bcPartners = partners.filter(function (p) { return p.type === bc.type; }).map(function (p) { return { id: p.code, name: p.name, sub: (TYPE_LBL[p.type] || '') + ' · ' + (p.city || CITY) }; });
    if (bc.indep) bcPartners = bcPartners.concat([{ id: 'indep', name: 'Livreur indépendant', sub: 'Payer avec son numéro', indep: true }]);
    var bp = bc.list ? bcPartners.filter(function (x) { return x.id === s.billPartner; })[0] : bcPartners[0];
    var partnerOk = !!bp;
    var usePhone = !!(bp && bp.indep);
    var refCfg = usePhone ? { label: 'Numéro du livreur (' + ctry.dial + ')', ph: ctry.ph, required: true, hint: 'Le livreur reçoit l’argent sur son compte e-Wari' } : bc.ref;
    var refRaw = String(s.billRef || '').trim();
    var refClean = usePhone ? refRaw.replace(/\D/g, '') : (refCfg.alnum ? refRaw.replace(/\s/g, '').toUpperCase() : refRaw.replace(/\D/g, ''));
    var refValid = false, billErr = '';
    if (!bc.list && !bp) billErr = 'Aucune compagnie partenaire ' + bc.name.toLowerCase() + ' dans votre pays pour l’instant.';
    if (usePhone) {
      if (refClean && phoneOk(refClean)) {
        if (ctry.dial + refClean === userE164) billErr = 'C’est votre propre numéro';
        else refValid = true;
      } else if (refClean.length > Math.max.apply(null, ctry.len)) billErr = 'Numéro ' + ctry.name + ' : ' + lenText(ctry);
    } else if (refClean) {
      if (refClean.length >= refCfg.len[0] && refClean.length <= refCfg.len[1]) refValid = true;
      else if (refClean.length > refCfg.len[1]) billErr = refCfg.label.replace(' (facultatif)', '') + ' : ' + (refCfg.len[0] === refCfg.len[1] ? refCfg.len[0] : refCfg.len[0] + ' à ' + refCfg.len[1]) + ' caractères';
    }
    var refOk = refCfg.required ? refValid : (!refClean || refValid);
    var lk = s.billLook || {};
    var lookKey = bp && !usePhone && bc.lookup && refValid ? bp.id + '|' + refClean : '';
    if (lookKey && lk.key !== lookKey && self._lookKey !== lookKey) {
      self._lookKey = lookKey;
      fetch(API + '/partners/' + encodeURIComponent(bp.id) + '/items/' + encodeURIComponent(refClean)).then(function (r) { return r.json(); }).then(function (j) {
        self.setState({ billLook: { key: lookKey, ok: !j.error, label: j.label || '', amount: j.amount || 0, paid: !!j.paid, period: j.periodLabel || '', err: j.error || '' } });
      }, function () { self.setState({ billLook: { key: lookKey, ok: false, err: 'Recherche impossible, réessayez.' } }); });
    }
    var looked = lk.key === lookKey && !!lookKey;
    if (!billErr && bc.lookup && looked && !lk.ok && !bc.lookSoft) billErr = lk.err;
    else if (!billErr && bc.lookup && looked && lk.paid) billErr = bc.rent ? 'Le loyer de ' + (lk.period || 'ce mois') + ' est déjà payé pour ce logement.' : 'Cette référence est déjà payée.';
    var billFound = partnerOk && refOk && (!bc.lookup || (looked && (lk.ok || bc.lookSoft) && !lk.paid));
    /* ---- Loyer : mandat de prélèvement automatique le 25 (service gov) ---- */
    var RT = s.rent || null;
    var rentKeyOk = !!(bc.rent && bp && refValid && looked && lk.ok);
    if (bc.rent && s.token && !RT && !self._rentLoading) {
      self._rentLoading = true;
      call('/gov/loyer', null, s.token).then(function (d) { self._rentLoading = false; self.setState({ rent: d }); }, function () { self._rentLoading = false; self.setState({ rent: { mandates: [], consent: '' } }); });
    }
    var rentM = rentKeyOk && RT ? (RT.mandates || []).filter(function (m) { return m.status === 'active' && m.partnerCode === bp.id && String(m.ref).toUpperCase() === refClean; })[0] || null : null;
    var rentPinOk = /^\d{4}$/.test(s.rentPin || '');
    var rentReload = function (msg) { call('/gov/loyer', null, s.token).then(function (d) { self.setState({ rent: d, rentMsg: msg || '', busy: false, rentPin: '', rentAccept: false }); }, function () { self.setState({ busy: false }); }); };
    var rentActivate = function () {
      if (s.busy || !rentKeyOk || !s.rentAccept || !rentPinOk) return;
      set({ busy: true, rentMsg: '' });
      call('/gov/loyer/mandat', { partner: bp.id, ref: refClean, pin: s.rentPin, accept: true }, s.token).then(function (r) { rentReload(r.message); }, function (e) { self.setState({ busy: false, rentPin: '', rentMsg: e.message }); });
    };
    var rentStop = function () {
      if (!rentPinOk) { set({ rentMsg: 'Saisissez votre code PIN pour arrêter le prélèvement.' }); return; }
      if (s.busy || !rentM) return;
      set({ busy: true, rentMsg: '' });
      call('/gov/loyer/mandat/' + encodeURIComponent(rentM.id) + '/stop', { pin: s.rentPin }, s.token).then(function () { rentReload('Prélèvement automatique arrêté.'); }, function (e) { self.setState({ busy: false, rentPin: '', rentMsg: e.message }); });
    };
    var benef = bp ? bp.name : bc.benef;
    var foundText = '';
    if (bc.lookup && looked && lk.ok) foundText = lk.label + ' · ' + bp.name;
    else if (bc.lookSoft && looked && bp) foundText = bp.name + ' · réservation ' + refClean + ' · saisissez le montant indiqué par l’hôtel';
    else if (bc.id === 'courant') foundText = 'Compteur prépayé · le code de recharge s’affichera après paiement';
    else if (usePhone) foundText = intl(ctry, refClean) + ' · paiement direct sur son compte';
    else if (bp) foundText = bp.name + ' · ' + bp.sub + (refClean ? ' · réf. ' + refClean : '');
    var billFixed = !!bc.fixed;
    var fixedAmt = looked && lk.ok ? Number(lk.amount) || 0 : 0;
    var billAmt = billFixed && fixedAmt ? (billFound ? fixedAmt : 0) : num(s.billAmount);
    if (!billErr && billAmt > bal[CUR]) billErr = 'Solde F CFA insuffisant';
    else if (!billErr && billAmt > 0 && billAmt < 100) billErr = 'Montant minimum : 100 F';
    billErr = billErr || srvErr('bill');
    var billOk = billFound && billAmt >= 100 && !billErr;
    var initialsOf = function (n) { return n.replace(/\(.*?\)/g, '').split(/[\s-]+/).filter(function (w) { return w.length > 2; }).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase(); };
    var billCats = BILLS.map(function (b) {
      return { name: b.name, sub: b.sub, icon: b.icon, badge: badgeStyle(b, 48), pick: function () { set({ screen: 'bill', billCat: b.id, billPartner: '', billRef: '', billAmount: '' }); } };
    });
    var billPartners = (bc.list ? bcPartners : []).map(function (x) {
      var on = bp && bp.id === x.id;
      return {
        on: !!on, name: x.name, sub: x.sub, initials: initialsOf(x.name),
        badge: 'width: 40px; height: 40px; flex-shrink: 0; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: ' + bc.color + '; background: ' + bc.bg,
        radio: 'width: 20px; height: 20px; flex-shrink: 0; border-radius: 10px; box-sizing: border-box; ' + (on ? 'border: 6px solid #13894A; background: #FFFFFF;' : 'border: 2px solid #8A8E96;'),
        style: 'display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 14px; border: 0; border-bottom: 1px solid #E7F1E6; text-align: left; color: #15171C; background: ' + (on ? '#E6F7EA' : '#FFFFFF'),
        pick: function () { set({ billPartner: x.id, billRef: (bp && !!bp.indep) !== !!x.indep ? '' : s.billRef }); }
      };
    });
    var confirmBill = askPay('bill', billOk, function () {
      if (usePhone) return { kind: 'send', to: ctry.dial + refClean, asset: CUR, amount: Math.floor(billAmt) };
      return { kind: 'bill', partner: bp.id, ref: refClean, amount: Math.floor(billAmt) };
    });

    /* e-Wari Assurances : RC auto et moto, attestation électronique, rappels */
    var INS = srv.ins || { on: false, products: [], policies: [], durations: [] };
    var insPols = INS.policies || [];
    var insTab = s.insTab || (insPols.length ? 'mine' : 'new');
    var insCat = s.insCat || 'auto';
    var insProd = (INS.products || []).filter(function (p) { return p.id === s.insProd; })[0] || null;
    var insMonths = Number(s.insMonths) || 12;
    var insCoef = ((INS.durations || []).filter(function (d) { return d.months === insMonths; })[0] || { coef: 1 }).coef;
    var insPrem = insProd ? Math.round(insProd.annual * insCoef / 100) * 100 : 0;
    var plateRe = /^([A-Z]{2})(\d{3,4})([A-Z]{1,2})$/;
    var plateClean = String(s.insPlate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    var plateOk = plateRe.test(plateClean);
    var plateFmt = plateOk ? plateClean.replace(plateRe, '$1-$2-$3') : '';
    var insHolder = String(s.insHolder || '').trim();
    var insVehicle = String(s.insVehicle || '').trim();
    var insErr = '';
    if (plateClean && !plateOk) insErr = 'Immatriculation : format AA-123-BC ou DK-1234-AB';
    else if (insPrem > (bal[CUR] || 0)) insErr = 'Solde F CFA insuffisant pour la prime (' + fx(insPrem) + ')';
    insErr = insErr || srvErr('insurance');
    var insOk = !!insProd && plateOk && insHolder.indexOf(' ') > 0 && insVehicle.length >= 2 && insPrem > 0 && insPrem <= (bal[CUR] || 0) && !insErr;
    var confirmIns = askPay('insurance', insOk, function () { return { kind: 'insurance', product: insProd.id, months: insMonths, plate: plateFmt, vehicle: insVehicle, holder: insHolder, start: s.insStart || '' }; });
    var frD = function (d) { var x = new Date(d + 'T00:00:00Z'); return isNaN(x) ? '' : x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
    var addDay = function (d, n) { var x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    var todayIso = new Date().toISOString().slice(0, 10);
    var insPill = function (st) {
      var c = st === 'valid' ? ['#D3F2DC', '#0B5C31'] : st === 'upcoming' ? ['#FBEBD3', '#7A4A00'] : ['#F6DEDA', '#A12A1E'];
      return 'align-self: flex-start; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; background: ' + c[0] + '; color: ' + c[1];
    };
    var insRows = insPols.map(function (p) {
      var soon = p.status === 'valid' && p.daysLeft <= (INS.remindDays || 30) && !p.renewed;
      return {
        plate: p.plate, product: p.productLabel + ' · ' + p.vehicle, period: 'Du ' + frD(p.start) + ' au ' + frD(p.end),
        statusTxt: p.status === 'valid' ? (p.daysLeft === 0 ? 'Valide · expire ce soir' : 'Valide · ' + p.daysLeft + ' j restants') : p.statusTxt + (p.renewed ? ' · renouvelée' : ''),
        pill: insPill(p.status), soon: soon || (p.status === 'expired' && !p.renewed),
        soonTxt: p.status === 'expired' ? 'Expirée : renouvelez pour rouler assuré.' : 'Rappel : expire le ' + frD(p.end) + '. Renouvelez dès maintenant.',
        show: function () { set({ screen: 'insCard', insShow: p.id }); },
        canRenew: !p.renewed && p.status !== 'upcoming',
        renew: function () {
          set({ insTab: 'new', insCat: p.category, insProd: p.product, insMonths: p.months, insPlate: p.plate, insVehicle: p.vehicle, insHolder: p.holder,
            insStart: p.status === 'valid' && p.end >= todayIso ? addDay(p.end, 1) : '' });
        }
      };
    });
    var insAlert = insRows.filter(function (r) { return r.soon; })[0] || null;
    var insProdRows = (INS.products || []).filter(function (p) { return p.cat === insCat; }).map(function (p) {
      var on = insProd && insProd.id === p.id;
      return { on: on, label: p.label, price: fx(Math.round(p.annual * insCoef / 100) * 100) + ' / ' + insMonths + ' mois',
        style: 'display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; padding: 12px 14px; border: 0; border-bottom: 1px solid #E7F1E6; text-align: left; color: #15171C; background: ' + (on ? '#E6F7EA' : '#FFFFFF'),
        radio: 'width: 20px; height: 20px; flex-shrink: 0; border-radius: 10px; box-sizing: border-box; ' + (on ? 'border: 6px solid #13894A; background: #FFFFFF;' : 'border: 2px solid #8A8E96;'),
        pick: function () { set({ insProd: p.id }); } };
    });
    var insDurRows = (INS.durations || []).map(function (d) { return { label: d.months + ' mois', style: chip(d.months === insMonths), pick: function () { set({ insMonths: d.months }); } }; });
    var insCard = insPols.filter(function (p) { return p.id === s.insShow; })[0] || null;
    var insQr = (function () {
      if (!insCard || !window.qrcode) return { path: '', n: 25 };
      if (self._insQr && self._insQr.link === insCard.verifyUrl) return self._insQr;
      var q = window.qrcode(0, 'M'); q.addData(insCard.verifyUrl); q.make();
      var n = q.getModuleCount(), d = '';
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (q.isDark(y, x)) d += 'M' + (x + 2) + ' ' + (y + 2) + 'h1v1h-1z';
      self._insQr = { link: insCard.verifyUrl, path: d, n: n + 4 };
      return self._insQr;
    })();
    var nowD = new Date(), sec = nowD.getSeconds();
    var insClock = nowD.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + nowD.toLocaleTimeString('fr-FR');
    var insValid = !!insCard && insCard.status === 'valid';
    var insCardBg = insValid ? 'linear-gradient(160deg, #13894A 0%, #0B5C31 100%)' : insCard && insCard.status === 'upcoming' ? 'linear-gradient(160deg, #7A4A00 0%, #4F3000 100%)' : 'linear-gradient(160deg, #A12A1E 0%, #6E1A12 100%)';

    /* Paiements à l'État : impôts, taxes, contraventions, documents */
    var ET = srv.etat || { on: false, cats: [], items: [] };
    var etCat = (ET.cats || []).filter(function (c) { return c.id === s.etCat; })[0] || null;
    var etItem = (ET.items || []).filter(function (x) { return x.id === s.etItem; })[0] || null;
    var ETICO = { impots: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5', taxes: 'M12 2l3 6 6 .9-4.5 4.3 1 6.3L12 16.8 6.5 19.5l1-6.3L3 8.9 9 8z', amendes: 'M12 3l9 16H3zM12 10v4M12 17h.01', documents: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6' };
    var etCatRows = (ET.cats || []).map(function (c) { return { label: c.label, sub: c.sub, icon: ETICO[c.id] || ETICO.documents, pick: function () { set({ etCat: c.id, etItem: '', etRef: '', etAmt: '' }); } }; });
    var etItemRows = (ET.items || []).filter(function (x) { return etCat && x.cat === etCat.id; }).map(function (x) {
      return { label: x.label, price: x.amount ? fx(x.amount) : (x.hint || 'Montant de votre avis'), pick: function () { set({ etItem: x.id, etRef: '', etAmt: '' }); } };
    });
    var etFixed = !!(etItem && etItem.amount);
    var etAmt = etItem ? (etFixed ? Number(etItem.amount) : num(s.etAmt)) : 0;
    var etRefOk = String(s.etRef || '').replace(/[^A-Za-z0-9]/g, '').length >= 4;
    var etErr = '';
    if (etItem && etAmt > (bal[CUR] || 0)) etErr = 'Solde F CFA insuffisant';
    else if (etItem && !etFixed && etAmt > 0 && etAmt < 100) etErr = 'Montant minimum : 100 F';
    etErr = etErr || srvErr('etat');
    var etOk = !!etItem && etRefOk && etAmt >= 100 && !etErr;
    var confirmEtat = askPay('etat', etOk, function () { return { kind: 'etat', item: etItem.id, ref: String(s.etRef || '').trim(), amount: Math.floor(etAmt) }; });
    var etQuick = (etItem && etItem.quick ? etItem.quick : []).map(function (v) { return { label: fx(v), pick: function () { set({ etAmt: String(v) }); } }; });
    var etBack = function () { if (s.etItem) set({ etItem: '' }); else if (s.etCat) set({ etCat: '' }); else set({ screen: 'pay' }); };
    if (INS.on) billCats.push({ name: 'Assurance', sub: 'Auto et moto', icon: 'M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z', badge: badgeStyle({ color: '#13894A', bg: '#D3F2DC' }, 48), pick: function () { set({ screen: 'ins', insTab: '', srvErr: '' }); } });
    if (ET.on) billCats.push({ name: 'État', sub: 'Impôts, amendes…', icon: 'M3 21h18M4 10h16M12 3l9 5H3zM6 10v8M10 10v8M14 10v8M18 10v8', badge: badgeStyle({ color: '#15171C', bg: '#E7F1E6' }, 48), pick: function () { set({ screen: 'etat', etCat: '', etItem: '', srvErr: '' }); } });

    /* Investir */
    var R = srv.round || {};
    var INV = { price: Math.max(100, Number(R.price) || 10000), goal: Math.max(1, Number(R.goal) || 500000000), pre: Math.max(0, Number(R.pre) || 2000000000), raised: Number(R.raised) || 0, investors: Number(R.investors) || 0, min: Number(R.min) || 1, max: Number(R.max) || 500 };
    var roundOpen = R.status === 'published';
    var postVal = INV.pre + INV.goal;
    var pct = function (r) {
      var v = r * 100, d = v >= 1 ? 2 : v >= 0.1 ? 3 : v >= 0.01 ? 4 : v >= 0.001 ? 5 : 6;
      return v.toFixed(d).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',') + ' %';
    };
    var big = function (n) {
      if (n >= 1e9) return String(Math.round(n / 1e7) / 100).replace('.', ',') + ' Md F';
      if (n >= 1e6) return String(Math.round(n / 1e5) / 10).replace('.', ',') + ' M F';
      return fx(n);
    };
    var myParts = Number(R.myParts) || 0, myInvested = Number(R.myInvested) || 0;
    var invParts = Math.max(INV.min, Math.min(INV.max, parseInt(s.invParts, 10) || 1));
    var invAmt = invParts * INV.price;
    var raisedN = INV.raised;
    var invPctN = Math.min(100, Math.round(raisedN / INV.goal * 1000) / 10);
    var isPartnerInv = s.invProfile === 'partner';
    var codeClean = String(s.invCode || '').replace(/\s/g, '').toUpperCase();
    var codeOk = /^P-?\d{5}$/.test(codeClean);
    var ptsUse = s.usePts ? Math.min(ptsBal, Math.floor(invAmt / PT_VAL)) : 0;
    var invCashN = invAmt - ptsUse * PT_VAL;
    var invErr = '';
    if (!roundOpen) invErr = 'La levée de fonds n’est pas encore ouverte : elle sera publiée par e-Wari.';
    else if (!kycOk) invErr = 'Vérifiez votre identité pour investir.';
    else if (invCashN > bal[CUR]) invErr = 'Solde F CFA insuffisant pour ' + invParts + ' part' + (invParts > 1 ? 's' : '');
    else if (myParts + invParts > INV.max) invErr = 'Maximum ' + INV.max + ' parts par investisseur';
    invErr = invErr || srvErr('invest');
    var invOk = roundOpen && kycOk && !invErr && !!s.invRisk && (!isPartnerInv || codeOk);
    var setParts = function (n) { return function () { set({ invParts: Math.max(INV.min, Math.min(INV.max, n)) }); }; };
    var plural = function (n, w) { return n + ' ' + w + (n > 1 ? 's' : ''); };
    var convParts = Math.min(Math.floor(ptsBal / PTS_PER_PART), INV.max - myParts);
    var convPts = convParts * PTS_PER_PART;
    var convOk = roundOpen && kycOk && convParts > 0;
    var confirmInvest = askPay('invest', invOk, function () { return { kind: 'invest', parts: invParts, usePts: !!s.usePts, profile: isPartnerInv ? 'partner' : 'client', code: codeClean }; });
    var confirmConvert = askPay('convert', convOk, function () { return { kind: 'convert' }; });
    var closeTxt = (function () { var d = new Date(R.close || ''); return isNaN(d) ? '' : 'Clôture ' + d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); })();

    /* Vérification d'identité (photos réelles, validation par un agent sous 24 h) */
    var KDOCS = [
      { id: 'passport', name: 'Passeport', sub: 'Page avec votre photo', code: 'Passeport' },
      { id: 'cni', name: 'Carte nationale d’identité (CNI)', sub: 'Recto avec votre photo', code: 'CNI' },
      { id: 'bio', name: 'Carte biométrique', sub: 'Carte CEDEAO, carte consulaire…', code: 'Carte biométrique' }
    ];
    var kd = KDOCS.filter(function (d) { return d.id === s.kycDoc; })[0] || KDOCS[1];
    var frame = function (state) { return state === 'ok' ? '#3FD39B' : state === 'bad' ? '#F07A6A' : '#FFFFFF'; };
    var kycStart = function () { set({ screen: 'kycType', kycPhoto: '', kycSelfie: '', kycDocImg: '', kycSelfImg: '' }); };
    /* Âge minimum de 18 ans pour un compte vérifié : un mineur garde son compte non vérifié (plafonds) */
    var KYC_MIN_AGE = 18;
    var kycAge = (function (t) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t || '')) return null;
      var p = t.split('-'), n = new Date(), a = n.getFullYear() - Number(p[0]);
      if (n.getMonth() + 1 < Number(p[1]) || (n.getMonth() + 1 === Number(p[1]) && n.getDate() < Number(p[2]))) a--;
      return a >= 0 && Number(p[0]) >= 1900 ? a : null;
    })(s.kycBirth);
    var kycMinor = kycAge !== null && kycAge < KYC_MIN_AGE;
    var kycBirthOk = kycAge !== null && !kycMinor;
    var todayIso = (function () { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); })();
    var capPctN = Math.min(100, Math.round(bal[CUR] / CAP * 100));
    var capPctC = Math.min(100, Math.round(cryptoTotalN / CAP_C * 100));
    var pickFile = function (id) { return function () { var el = document.getElementById(id); if (el) { el.value = ''; el.click(); } }; };
    var sendKyc = function () {
      if (s.busy || !s.kycDocImg || !s.kycSelfImg) return;
      set({ busy: true });
      call('/kyc', { docType: kd.code, docImage: s.kycDocImg, selfieImage: s.kycSelfImg, birthDate: s.kycBirth || '' }, s.token).then(function () {
        self.setState({ busy: false, screen: 'done', kycDocImg: '', kycSelfImg: '', last: { title: 'Dossier envoyé', text: 'Un agent compare votre pièce et votre photo : réponse sous 24 h. Les plafonds restent actifs en attendant.' } });
        self.refresh();
      }, function (e) { self.setState({ busy: false, screen: 'done', last: { title: 'Envoi impossible', text: e.message, fail: true } }); });
    };

    /* Sécurité et aide */
    var ICO = {
      pin: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
      bio: 'M12 11v3M8.5 8.6A5 5 0 0 1 17 12v2M7 12a5 5 0 0 1 .4-2M16.8 16.5a11 11 0 0 1-.9 3M12 17a13 13 0 0 1-1.4 4M9 14.5a15 15 0 0 1-1.8 5M4.6 9.3A8.5 8.5 0 0 1 20.5 12v1.5',
      claim: 'M12 3l9 16H3zM12 10v4M12 17h.01',
      chat: 'M4 5h16v11H9l-5 4z'
    };
    var bioOn = !!LS.get('ewari_bio');
    var bioType = LS.get('ewari_biotype') || 'finger';
    var badgeIco = function (bg, fg) { return 'width: 40px; height: 40px; flex-shrink: 0; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: ' + bg + '; color: ' + fg; };
    var bioName = !bioOn ? 'Désactivée' : bioType === 'face' ? 'Reconnaissance faciale activée' : 'Empreinte digitale activée';
    var claimsView = srv.claims || [];
    var openClaims = claimsView.filter(function (c) { return c.status === 'En cours'; }).length;
    var secuItems = [
      { title: 'Changer de code PIN', sub: 'Code actuel, puis nouveau code', icon: ICO.pin, badge: badgeIco('#E1ECF8', '#1D5FA8'), pick: function () { set({ screen: 'pinold', pinMode: 'change', pinEntry: '', pinNew: '', pinConf: '', pinErr: '', pinOld: '' }); } },
      { title: 'Changer de biométrie', sub: bioName, icon: ICO.bio, badge: badgeIco('#D3F2DC', '#13894A'), pick: function () { set({ screen: 'bioSet', bioPick: bioOn ? bioType : 'none' }); } },
      { title: 'Faire une réclamation', sub: openClaims ? openClaims + ' réclamation' + (openClaims > 1 ? 's' : '') + ' en cours' : 'Argent non reçu, montant incorrect…', icon: ICO.claim, badge: badgeIco('#FBEBD3', '#9A5B00'), pick: function () { set({ screen: 'claim', claimOp: -1, claimMotif: '', claimDesc: '' }); } },
      { title: 'Parler à un conseiller', sub: 'Chat, appel ou WhatsApp · 7 j/7', icon: ICO.chat, badge: badgeIco('#EDE4F7', '#6B3FA0'), pick: function () { set({ screen: 'chat', contactMsg: '' }); self.refresh(); } }
    ];
    var radio = function (on) { return 'width: 20px; height: 20px; flex-shrink: 0; border-radius: 10px; box-sizing: border-box; ' + (on ? 'border: 6px solid #13894A; background: #FFFFFF;' : 'border: 2px solid #8A8E96;'); };
    var rowSel = function (on) { return 'display: flex; align-items: center; gap: 12px; width: 100%; padding: 14px 16px; border: 0; border-bottom: 1px solid #E7F1E6; text-align: left; color: #15171C; background: ' + (on ? '#E6F7EA' : '#FFFFFF'); };
    var BIO = [['finger', 'Empreinte digitale', 'Toucher le capteur du téléphone'], ['face', 'Reconnaissance faciale', 'Regarder la caméra avant'], ['none', 'Désactivée', 'Code PIN ou code SMS uniquement']];
    var bioPick = s.bioPick || (bioOn ? bioType : 'none');
    var bioOptions = BIO.map(function (b) { return { title: b[1], sub: b[2], style: rowSel(b[0] === bioPick), radio: radio(b[0] === bioPick), pick: function () { set({ bioPick: b[0] }); } }; });
    var saveBio = function () {
      if (bioPick === 'none') { LS.set('ewari_bio', ''); set({ screen: 'done', last: { title: 'Biométrie mise à jour', text: 'Biométrie désactivée : l’application s’ouvre avec le code PIN ou un code SMS.' } }); return; }
      self.bioCreate(function (err) {
        if (err) { self.setState({ screen: 'done', last: { title: 'Biométrie non activée', text: err, fail: true } }); return; }
        LS.set('ewari_biotype', bioPick);
        self.setState({ screen: 'done', last: { title: 'Biométrie mise à jour', text: (bioPick === 'face' ? 'Reconnaissance faciale' : 'Empreinte digitale') + ' activée pour ouvrir l’application sur ce téléphone.' } });
      });
    };
    var relDate = function (iso) {
      var d = new Date(iso), now = new Date(), diff = (now - d) / 60000;
      var hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      if (diff < 2) return 'À l’instant';
      if (d.toDateString() === now.toDateString()) return 'Aujourd’hui, ' + hm;
      var y = new Date(now); y.setDate(now.getDate() - 1);
      if (d.toDateString() === y.toDateString()) return 'Hier, ' + hm;
      return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    };
    var hist = (srv.hist || []).map(function (h) { return { id: h.id, t: h.t, d: relDate(h.d), a: h.a.replace(/ /g, ' '), pos: h.pos, cx: h.cx || '', left: h.left || 0, asset: h.asset || '', quit: h.quit || '', quitUrl: h.quitUrl || '', insId: h.insId || '' }; });
    /* Annulation (0-2 mn) ou suspension (2-10 mn) d'un envoi vers un autre compte e-Wari : deux appuis pour confirmer */
    var cxAct = function (h) {
      if (s.busy) return;
      if (s.cxArm !== h.id) { set({ cxArm: h.id }); return; }
      set({ busy: true, cxArm: '' });
      call('/transactions/' + encodeURIComponent(h.id) + '/cancel', {}, s.token).then(function (r) {
        self.setState({ busy: false, screen: 'done', last: { title: r.title, text: r.text } });
        self.refresh();
      }, function (e) { self.setState({ busy: false, screen: 'done', last: { title: 'Demande impossible', text: e.message, fail: true } }); self.refresh(); });
    };
    var cxView = function (h) {
        var docBtn = 'flex-shrink: 0; min-height: 36px; padding: 0 14px; border-radius: 999px; font-size: 13px; font-weight: 700; background: #FFFFFF; color: #13894A; border: 1px solid #13894A;';
        if (!h.cx && h.quitUrl) return { t: h.t, d: h.d, a: h.a, style: 'font-weight: 700; font-size: 14px; color: #15171C', can: true, cxNote: 'Quittance électronique ' + h.quit, cxLabel: 'Voir la quittance', cxStyle: docBtn, act: function () { window.open(h.quitUrl, '_blank', 'noopener'); } };
        if (!h.cx && h.insId) return { t: h.t, d: h.d, a: h.a, style: 'font-weight: 700; font-size: 14px; color: #15171C', can: true, cxNote: 'Attestation d’assurance', cxLabel: 'Afficher', cxStyle: docBtn, act: function () { set({ screen: 'insCard', insShow: h.insId }); } };
        var armed = s.cxArm === h.id, mins = Math.max(1, Math.ceil(h.left / 60));
        return { t: h.t, d: h.d, a: h.a, style: 'font-weight: 700; font-size: 14px; color: ' + (h.pos ? '#13894A' : '#15171C'),
          can: !!h.cx,
          cxNote: h.cx === 'cancel' ? 'Erreur ? Annulation possible encore ' + (h.left < 60 ? h.left + ' s' : mins + ' mn') : 'Suspension possible encore ' + mins + ' mn (vérifiée par un agent)',
          cxLabel: armed ? (h.cx === 'cancel' ? 'Confirmer l’annulation' : 'Confirmer la suspension') : (h.cx === 'cancel' ? 'Annuler l’envoi' : 'Suspendre l’envoi'),
          cxStyle: 'flex-shrink: 0; min-height: 36px; padding: 0 14px; border-radius: 999px; font-size: 13px; font-weight: 700; ' + (armed ? 'background: #B3261E; color: #FFFFFF; border: 1px solid #B3261E;' : 'background: #FFFFFF; color: #B3261E; border: 1px solid #B3261E;'),
          act: function () { cxAct(h); } };
    };
    var doneH = null;
    var lastTx = (s.last || {}).txId;
    if (lastTx) hist.forEach(function (h) { if (h.id === lastTx && (h.cx || h.quitUrl || h.insId)) doneH = cxView(h); });
    var claimOps = hist.slice(0, 5).map(function (h, i) { return { on: i === s.claimOp, t: h.t, d: h.d, a: h.a, style: rowSel(i === s.claimOp), radio: radio(i === s.claimOp), pick: function () { set({ claimOp: i }); } }; });
    var MOTIFS = ['Argent débité, non reçu', 'Montant incorrect', 'Opération non reconnue', 'Double débit', 'Autre'];
    var claimMotifs = MOTIFS.map(function (m) { var on = m === s.claimMotif; return { on: on, label: m, pick: function () { set({ claimMotif: m }); }, style: 'min-height: 38px; padding: 0 12px; border-radius: 999px; font-size: 13px; font-weight: 600; ' + (on ? 'background: #15171C; color: #FFFFFF; border: 1px solid #15171C;' : 'background: #FFFFFF; color: #15171C; border: 1px solid #CFE2D0;') }; });
    var claimOk = s.claimOp >= 0 && !!s.claimMotif && !!hist[s.claimOp] && !s.busy;
    var submitClaim = function () {
      if (!claimOk) return;
      set({ busy: true });
      call('/claims', { txId: hist[s.claimOp].id, motif: s.claimMotif, desc: s.claimDesc }, s.token).then(function (r) {
        self.setState({ busy: false, screen: 'done', last: { title: 'Réclamation enregistrée', text: 'Réclamation ' + r.id + ' envoyée. Un conseiller vous répond sous 48 h par SMS et dans l’app. Suivi : cadenas › Sécurité et aide.' } });
        self.refresh();
      }, function (e) { self.setState({ busy: false, screen: 'done', last: { title: 'Réclamation non envoyée', text: e.message, fail: true } }); });
    };
    var pushChat = function (txt) {
      txt = String(txt || '').trim();
      if (!txt) return;
      var cur = srv.msgs || [];
      self.setState({ chatInput: '', srv: Object.assign({}, srv, { msgs: cur.concat([{ me: true, text: txt }]) }) });
      call('/support', { text: txt }, s.token).then(function () { self.refresh(); }, function () {});
    };
    var welcome = [{ me: false, text: 'Bonjour, je suis votre conseillère e-Wari. Comment puis-je vous aider ?' }];
    var chatMsgs = welcome.concat(srv.msgs || []).map(function (m) {
      return { text: m.text, who: m.me ? 'Vous' : 'Conseiller e-Wari',
        wrap: 'display: flex; flex-direction: column; gap: 2px; align-items: ' + (m.me ? 'flex-end' : 'flex-start'),
        bubble: 'max-width: 80%; padding: 10px 12px; border-radius: 14px; font-size: 14px; line-height: 1.4; ' + (m.me ? 'background: #13894A; color: #FFFFFF; border-bottom-right-radius: 4px;' : 'background: #F3FAF2; color: #15171C; border-bottom-left-radius: 4px;') };
    });

    /* Validation par code SMS */
    var row = function (k, v, strong) { return { k: k, v: v, style: 'display: flex; justify-content: space-between; gap: 12px' + (strong ? '; padding-top: 10px; border-top: 1px solid #E7F1E6' : '') }; };
    var payLines = (s.payLinesSrv || []).map(function (l) { return row(l[0], String(l[1]).replace(/ /g, ' '), l[2]); });
    var backOf = { trade: 'trade', swap: 'trade', deposit: 'deposit', send: 'send', qr: 'qrpay', bill: 'bill', invest: 'invest', convert: 'invest', pispi: 'pispi', insurance: 'ins', etat: 'etat' };
    var verifyPay = function () {
      if (String(s.payOtp || '').length !== 6 || s.busy) return;
      set({ busy: true });
      call('/payments/confirm', { id: s.payId, code: s.payOtp }, s.token).then(function (r) {
        self.setState({ busy: false, screen: 'done', pending: '', payOtp: '', amount: '', dAmount: '', xAmount: '', recipient: '', qrAmount: '', qrFixed: 0, billRef: '', billAmount: '', invRisk: false, psAmt: '', psDest: null, psTo: '', psInfo: '', etRef: '', etAmt: '', insTab: r.insId ? 'mine' : s.insTab, insStart: '', last: { title: r.title, text: r.text, txId: r.id } });
        self.refresh();
      }, function (e) {
        if (e.data && e.data.cancelled) self.setState({ busy: false, screen: 'done', pending: '', payOtp: '', last: { title: 'Opération annulée', text: e.message + ' Aucun montant n’a été débité.', fail: true } });
        else self.setState({ busy: false, payOtp: '', payErr: e.message });
      });
    };

    /* Dépôt mobile money : validation par l'opérateur (code, appli ou demande sur le téléphone) */
    var mm = s.mm || null;
    var mmLeftS = mm && mm.expiresAt ? Math.max(0, Math.round((new Date(mm.expiresAt).getTime() - Date.now()) / 1000)) : 0;
    var mmCall = function (path, b) {
      if (!mm || s.busy) return;
      set({ busy: true, mmErr: '' });
      call('/mm/' + encodeURIComponent(mm.id) + path, b, s.token).then(function (r) {
        if (r.sms) { self.setState({ busy: false, mm: r, mmSms: r.sms }); return; }
        self.mmFinish(r);
      }, function (e) { self.setState({ busy: false, mmErr: e.message }); });
    };
    var mmCodeOk = String(s.mmCode || '').length >= 4, mmPinOk = /^\d{4}$/.test(String(s.mmPin || ''));

    /* PI-SPI : virements instantanés vers toutes les banques et portefeuilles de l'UEMOA */
    var PS = srv.pispi || { on: false, rtp: [] };
    var psTab = s.psTab || 'send';
    var psDest = s.psDest || null;
    var psAmt = num(s.psAmt);
    var psFee = Math.round(psAmt * (PS.feePct || 0) / 100);
    var psErr = s.psErr || srvErr('pispi');
    var psOk = !!psDest && psAmt >= 100 && psAmt + psFee <= (bal[CUR] || 0);
    if (psDest && psAmt > 0 && psAmt + psFee > (bal[CUR] || 0)) psErr = psErr || 'Solde F CFA insuffisant';
    var psLookup = function () {
      if (s.busy || !String(s.psTo || '').trim()) return;
      set({ busy: true, psErr: '', psDest: null, psInfo: '' });
      call('/pispi/lookup', { to: s.psTo }, s.token).then(function (r) {
        if (r.found) self.setState({ busy: false, psDest: r });
        else self.setState({ busy: false, psErr: r.message || 'Bénéficiaire introuvable.' });
      }, function (e) { self.setState({ busy: false, psErr: e.message }); });
    };
    var psSim = function (path, msg) {
      return function () {
        if (s.busy) return;
        set({ busy: true, psErr: '', psInfo: '' });
        call(path, {}, s.token).then(function (r) { self.setState({ busy: false, psInfo: msg(r) }); self.refresh(); }, function (e) { self.setState({ busy: false, psErr: e.message }); });
      };
    };
    var psRtp = (PS.rtp || []).map(function (r) {
      return { name: r.name, inst: r.institution, label: r.label, amt: fx(r.amount),
        pay: function () { askPay('pispi', true, function () { return { kind: 'pispi', rtp: r.id }; })(); },
        refuse: function () { if (s.busy) return; set({ busy: true }); call('/pispi/rtp/' + encodeURIComponent(r.id) + '/refuse', {}, s.token).then(function () { self.setState({ busy: false, psInfo: 'Demande de ' + r.name + ' refusée.' }); self.refresh(); }, function (e) { self.setState({ busy: false, psErr: e.message }); }); } };
    });
    var confirmPispi = askPay('pispi', psOk, function () { return { kind: 'pispi', to: s.psTo, amount: Math.floor(psAmt) }; });

    /* ---- PARI (tontine) : catégories, éligibilité, adhésion avec mandat de prélèvement + PIN, suivi anonyme ---- */
    var PR = s.pari || null;
    var prSel = PR && s.pariSel ? PR.cats.filter(function (c) { return c.id === s.pariSel; })[0] || null : null;
    var pariLoad = function (extra) {
      call('/gov/pari', null, s.token).then(function (d) { self.setState(Object.assign({ pari: d, pariLoading: false }, extra || {})); },
        function (e) { self.setState({ pariLoading: false, pariErr: e.message }); });
    };
    var goPari = function () { set({ screen: 'pari', pariSel: '', pariErr: '', pariInfo: '', pariPin: '', pariAccept: false, pariLoading: !s.pari }); pariLoad(); };
    var prPinOk = /^\d{4}$/.test(s.pariPin || '');
    var prJoinOk = !!prSel && prSel.eligible && !prSel.member && !!s.pariAccept && prPinOk && !s.busy;
    var pariJoin = function () {
      if (!prJoinOk) return;
      set({ busy: true, pariErr: '' });
      call('/gov/pari/join', { cat: prSel.id, pin: s.pariPin, accept: true }, s.token).then(function (r) {
        self.setState({ busy: false, pariPin: '', pariAccept: false, pariSel: '', pariInfo: r.message }); pariLoad(); self.refresh();
      }, function (e) { self.setState({ busy: false, pariPin: '', pariErr: e.message }); if (e.data && e.data.checks) pariLoad(); });
    };
    var pariGroups = (PR ? PR.groups : []).map(function (g) {
      var r = g.round || null, me = g.me || null;
      var pct = r && r.expectedTotal ? Math.round(100 * r.paidCount / r.expectedTotal) : 0;
      return {
        label: 'PARI ' + g.label, kind: g.kind, statusTxt: g.statusTxt, forming: g.status === 'forming', note: g.note || '',
        hasRound: !!r && g.status !== 'done', taker: r ? r.taker : '',
        takerStyle: 'font-size: 14px; font-weight: 700; color: ' + (r && r.iAmTaker ? '#0B5C31' : '#15171C'),
        roundTxt: r ? 'Tour ' + r.n + ' / ' + g.size + ' · versement ' + r.payTxt : '',
        roundPay: r ? 'Paiements des membres : ' + r.paidCount + ' / ' + r.expectedNow + ' attendus à ce jour (' + r.expectedTotal + ' sur le tour)' : '',
        bar: 'height: 6px; background: #13894A; width: ' + pct + '%',
        cyclePay: g.cycle ? 'Cycle : ' + g.cycle.paidCount + ' / ' + g.cycle.expectedNow + ' paiements à ce jour · ' + g.cycle.roundsPaid + ' / ' + g.size + ' tours versés' : '',
        hasMe: !!me, meTxt: me ? 'Mes cotisations : ' + me.paid + ' / ' + me.total + ' payées' : '',
        hasLate: !!(me && me.pending), lateTxt: me && me.pending ? me.pending + ' cotisation' + (me.pending > 1 ? 's' : '') + ' non prélevée' + (me.pending > 1 ? 's' : '') + ' : alimentez votre compte, nouvel essai automatique chaque jour à 20 h.' : '',
        hasWon: !!(me && me.won), wonTxt: me && me.won ? (me.won.paid ? 'Vous avez reçu ' + fx(me.won.net) + ' au tour ' + me.won.n + '.' : 'Vous êtes le preneur du tour ' + me.won.n + ' : versement ' + me.won.payTxt + '.') : '',
        leave: function () {
          if (s.busy) return; set({ busy: true, pariErr: '' });
          call('/gov/pari/leave', { group: g.id }, s.token).then(function () { self.setState({ busy: false, pariInfo: 'Vous avez quitté le PARI ' + g.label + '.' }); pariLoad(); },
            function (e) { self.setState({ busy: false, pariErr: e.message }); });
        }
      };
    });
    var pariCats = (PR ? PR.cats : []).map(function (c) {
      var col = c.member ? '#D3F2DC;color:#0B5C31' : c.eligible ? '#E1ECF8;color:#0E2F55' : '#E7F1E6;color:#5A5E66';
      return {
        label: c.label, kind: c.kind, cycleTxt: c.cycleTxt, payTxt: c.payTxt,
        potTxt: 'À votre tour : ' + fx(c.potNet) + ' (' + fx(c.potGross) + ' moins ' + String(c.commission).replace('.', ',') + ' % de commission)',
        badge: c.member ? 'Membre' : c.eligible ? 'Éligible' : 'Non qualifié',
        badgeStyle: 'flex-shrink: 0; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; background: ' + col,
        open: function () { set({ pariSel: c.id, pariErr: '', pariInfo: '', pariPin: '', pariAccept: false }); }
      };
    });
    var pcNotQ = !!prSel && !prSel.eligible && !prSel.member;
    var pcNoKyc = !!prSel && !prSel.checks[0].ok;
    var RM = srv.remit || { link: '' };
    var rmCopy = function () {
      var done = function () { set({ rmInfo: 'Lien copié : envoyez-le à vos proches.' }); };
      try { navigator.clipboard.writeText(RM.link).then(done, function () { set({ rmInfo: RM.link }); }); } catch (e) { set({ rmInfo: RM.link }); }
    };
    var rmShare = function () {
      var t = 'Pour m\u2019envoyer de l\u2019argent depuis l\u2019étranger (carte bancaire ou USDT), utilisez ce lien e-Wari : ';
      if (navigator.share) navigator.share({ title: 'e-Wari', text: t, url: RM.link }).catch(function () {});
      else rmCopy();
    };

    /* Code PIN, biométrie, SMS */
    var scr = s.screen;
    var pinTarget = scr === 'pinset' ? 'pinNew' : scr === 'pinconfirm' ? 'pinConf' : 'pinEntry';
    var pinCur = String(s[pinTarget] || '');
    var unlocked = function () { self.setState({ screen: s.mm && s.mm.status === 'pending' ? 'mmwait' : 'home', pinEntry: '', lockErr: '', lockOtp: '', lockOtpSent: false, busy: false }); self.refresh(); };
    var pressKey = function (k) {
      return function () {
        if (s.busy) return;
        var o = { pinErr: '', lockErr: '' };
        if (k === 'del') { o[pinTarget] = pinCur.slice(0, -1); set(o); return; }
        if (!k || pinCur.length >= 4) return;
        var nv = pinCur + k;
        o[pinTarget] = nv;
        if (nv.length === 4) {
          if (scr === 'pinold') {
            o.busy = true; set(o);
            call('/auth/check-pin', { pin: nv }, s.token).then(function () { self.setState({ busy: false, screen: 'pinset', pinOld: nv, pinEntry: '', pinNew: '' }); },
              function (e) { if (e.data && e.data.locked) { LS.set('ewari_user', ''); self.setState({ busy: false, token: '', screen: 'lock', lockMethod: 'sms', lockOtpSent: false, lockErr: e.message, pinMode: '' }); } else self.setState({ busy: false, pinEntry: '', pinErr: e.message }); });
            return;
          } else if (scr === 'pinset') {
            if (/^(\d)\1{3}$/.test(nv) || nv === '1234' || nv === '4321') { o.pinNew = ''; o.pinErr = 'Code trop simple. Choisissez-en un autre.'; }
            else { o.screen = 'pinconfirm'; o.pinConf = ''; }
          } else if (scr === 'pinconfirm') {
            if (nv !== s.pinNew) { o.pinNew = ''; o.pinConf = ''; o.screen = 'pinset'; o.pinErr = 'Les deux codes ne correspondent pas. Recommencez.'; }
            else {
              o.busy = true; set(o);
              var change = s.pinMode === 'change';
              call('/auth/pin', { pin: nv, oldPin: s.pinOld || '' }, s.token).then(function () {
                self.setState(change ? { busy: false, pinMode: '', pinOld: '', screen: 'done', last: { title: 'Code PIN modifié', text: 'Votre nouveau code PIN est actif. Si ce n’est pas vous, contactez un conseiller.' } } : { busy: false, screen: 'bio' });
                self.refresh();
              }, function (e) { self.setState({ busy: false, pinNew: '', pinConf: '', screen: change ? 'secu' : 'pinset', pinErr: e.message }); });
              return;
            }
          } else {
            o.busy = true; set(o);
            call('/auth/check-pin', { pin: nv }, s.token).then(unlocked, function (e) {
              if (e.data && e.data.locked) { LS.set('ewari_user', ''); self.setState({ busy: false, token: '', pinEntry: '', lockMethod: 'sms', lockOtpSent: false, lockErr: e.message }); }
              else if (e.status === 401) { LS.set('ewari_user', ''); self.setState({ busy: false, token: '', pinEntry: '', lockMethod: 'sms', lockOtpSent: false, lockErr: 'Session expirée : confirmez votre identité par SMS.' }); }
              else self.setState({ busy: false, pinEntry: '', lockErr: e.message });
            });
            return;
          }
        }
        set(o);
      };
    };
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map(function (k) {
      return {
        label: k === 'del' ? '⌫' : k,
        aria: k === 'del' ? 'Effacer' : (k || 'vide'),
        pick: pressKey(k),
        style: 'height: 60px; border: 0; border-radius: 16px; font-family: \'Space Grotesk\', sans-serif; font-size: 24px; font-weight: 500; color: #15171C; ' + (k ? (k === 'del' ? 'background: transparent;' : 'background: #FFFFFF;') : 'background: transparent; visibility: hidden;')
      };
    });
    var pinDots = [0, 1, 2, 3].map(function (i) {
      var on = i < pinCur.length;
      return { style: 'width: 16px; height: 16px; border-radius: 8px; box-sizing: border-box; ' + (on ? 'background: #15171C; border: 2px solid #15171C;' : 'background: transparent; border: 2px solid #8A8E96;') };
    });
    var lockOtpOk = String(s.lockOtp || '').length === 6;
    var regDigits = String(s.regPhone || '').replace(/\D/g, '');
    var regOk = phoneOk(regDigits) && !s.busy;
    var regErr = regDigits.length > Math.max.apply(null, ctry.len) ? 'Trop de chiffres : un numéro ' + ctry.name + ' contient ' + lenText(ctry) : (s.srvFor === 'reg' ? s.srvErr : '');
    var last = s.last || { title: '', text: '' };
    var logout = function () { LS.set('ewari_user', ''); self.stopCam(); self.setState({ token: '', srv: null, screen: 'country', regPhone: '', otp: '' }); };
    var smsLogin = function (phone, country, code, onOk, onErr) {
      call('/auth/verify', { phone: phone, country: country, code: code }).then(function (r) { LS.set('ewari_user', r.token); self.state.token = r.token; onOk(r); }, onErr);
    };
    var otpHintTxt = s.otpHint || 'Code envoyé par SMS';

    /* ---- Accueil (nouveau design) : recherche, actions rapides, transactions récentes ---- */
    var hNorm = function (x) { return String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
    var hq = hNorm(String(s.homeQ || '').trim());
    var QA = [
      { label: 'Envoyer de l’argent', icon: 'M7 17L17 7M9 7h8v8', act: go('send') },
      { label: 'Déposer', icon: 'M12 5v14M5 12h14', act: go('deposit', { dir: 'in', method: OPS[0] }) },
      { label: 'Retirer', icon: 'M7 10l5 5 5-5M12 15V3M5 21h14', act: go('deposit', { dir: 'out', method: OPS[0] }) },
      { label: 'Payer une facture', icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2z', act: go('pay') },
      { label: 'Scanner et payer', icon: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3', act: go('scan', { scanTab: 'scan', camErr: '' }) },
      { label: 'Mon QR code', icon: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2z', act: go('scan', { scanTab: 'myqr' }) },
      { label: 'Relevé et historique', icon: 'M7 3h7l5 5v13H7zM10 13h6M10 17h6', act: function () { set({ screen: 'history' }); self.refresh(); } },
      { label: 'PARI (tontine)', icon: 'M12 6v3M17.3 14l-2.6-1M6.7 14l2.6-1', act: goPari },
      { label: 'Investir', icon: 'M3 20h18M6 16v-4M11 16V8M16 16v-6', act: function () { set({ screen: 'invest' }); self.refresh(); } },
      { label: 'Recevoir de l’étranger', icon: 'M3 12h18M12 3a14 14 0 0 1 0 18', act: go('abroad', { rmInfo: '' }) },
      { label: 'Parler à un conseiller', icon: 'M21 12a8 8 0 0 1-12 7l-5 1 1-4a8 8 0 1 1 16-4z', act: go('chat', { contactMsg: '' }) },
      { label: 'Sécurité et code PIN', icon: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4', act: go('secu') }
    ].concat(billCats.map(function (b) { return { label: 'Payer › ' + b.name + ' (' + b.sub + ')', icon: b.icon, act: b.pick }; }));
    var quickHits = hq ? QA.filter(function (q) { return hNorm(q.label).indexOf(hq) >= 0; }).slice(0, 8) : [];
    var homeTx = hist.filter(function (h) { return !hq || hNorm(h.t + ' ' + h.d + ' ' + h.a).indexOf(hq) >= 0; }).slice(0, hq ? 15 : 6).map(function (h) {
      return { t: h.t, d: h.d, a: h.a,
        amt: 'font-weight: 700; font-size: 15px; white-space: nowrap; color: ' + (h.pos ? '#13894A' : '#0E1F15'),
        ic: 'flex-shrink: 0; width: 40px; height: 40px; border-radius: 20px; display: flex; align-items: center; justify-content: center; ' + (h.pos ? 'background: #D3F2DC; color: #13894A' : 'background: #FCE4EC; color: #B0285E'),
        path: h.pos ? 'M17 7L7 17M15 17H7V9' : 'M7 17L17 7M9 7h8v8' };
    });
    /* ---- Retrait chez un agent payeur : demande à confirmer avec le code PIN (service gov) ---- */
    if (scr === 'home' && s.token && (!self._rtAt || Date.now() - self._rtAt > 8000)) {
      self._rtAt = Date.now();
      call('/gov/retrait', null, s.token).then(function (d) { var ids = (d || []).map(function (x) { return x.id; }).join(','); if (ids !== (self._rtIds || '')) { self._rtIds = ids; self.setState({ retraits: d || [] }); } }, function () {});
      if (!self._rtTimer) self._rtTimer = setInterval(function () { if ((self.state || {}).screen === 'home') self.setState({ rtTick: Date.now() }); }, 9000);
    }
    var RTL = (s.retraits || []).filter(function (r) { return new Date(r.expiresAt).getTime() > Date.now(); });
    var rtPinOk = /^\d{4}$/.test(s.rtPin || '');
    var rtDecide = function (r, decision) { return function () {
      if (s.busy) return;
      if (decision === 'approve' && !rtPinOk) { set({ rtMsg: 'Saisissez votre code PIN pour confirmer le retrait.' }); return; }
      set({ busy: true, rtMsg: '' });
      call('/gov/retrait/' + encodeURIComponent(r.id), { decision: decision, pin: s.rtPin }, s.token).then(function (x) {
        self._rtIds = ''; self.setState({ busy: false, rtPin: '', rtMsg: x.message, retraits: (s.retraits || []).filter(function (y) { return y.id !== r.id; }) }); self.refresh();
      }, function (e) { self.setState({ busy: false, rtPin: '', rtMsg: e.message }); });
    }; };
    var rtRows = RTL.map(function (r) { return { title: 'Retrait chez ' + r.agent + (r.city ? ' (' + r.city + ')' : ''), text: 'L’agent vous remet ' + fx(r.amount) + ' en espèces. Débité : ' + fx(r.total) + ' (frais ' + fx(r.fee) + ').', ok: rtDecide(r, 'approve'), no: rtDecide(r, 'refuse') }; });
    return {
      isHome: scr === 'home', isTrade: scr === 'trade' && cryptoOn, isWallet: scr === 'wallet' && cryptoOn, isCountry: scr === 'country', isDeposit: scr === 'deposit',
      isSend: scr === 'send', isHistory: scr === 'history', isDone: scr === 'done', isLoading: scr === 'loading',
      showNav: scr === 'home' || scr === 'pay' || scr === 'invest' || (scr === 'trade' && cryptoOn) || (scr === 'wallet' && cryptoOn) || scr === 'history',
      rtRows: rtRows, hasRt: rtRows.length > 0, rtPin: s.rtPin || '', onRtPin: function (e) { set({ rtPin: String(e.target.value || '').replace(/\D/g, '').slice(0, 4) }); }, rtHasMsg: !!s.rtMsg, rtMsg: s.rtMsg || '', rtMsgOut: !!s.rtMsg && !rtRows.length,
      goHome: go('home'), goHelp: go('chat', { contactMsg: '' }),
      homeQ: s.homeQ || '', onHomeQ: function (e) { set({ homeQ: e.target.value }); }, quickHits: quickHits, hasQuickHits: quickHits.length > 0,
      homeTx: homeTx, noHomeTx: !homeTx.length, homeTxTitle: hq ? 'Résultats de la recherche' : 'Transactions récentes', noHomeTxText: hq ? 'Aucune transaction ne correspond à votre recherche.' : 'Aucune opération pour l’instant : faites un dépôt pour commencer.',
      goTrade: go('trade'), goHistory: function () { set({ screen: 'history' }); self.refresh(); },
      goDeposit: go('deposit', { dir: 'in', method: OPS[0] }),
      goWithdraw: go('deposit', { dir: 'out', method: OPS[0] }),
      goSend: go('send'),
      goCountry: go('country'),
      goScan: go('scan', { scanTab: 'scan', camErr: '' }),
      goMyQr: go('scan', { scanTab: 'myqr' }),
      goPay: go('pay'),
      logout: logout,
      ddCountry: dd('country', COUNTRIES.map(function (c) {
        return { code: c.code, name: c.name, on: c.code === ctry.code,
          sub: (c.zone === 'CEMAC' ? 'XAF · zone CEMAC · transferts' : c.zone === 'GN' ? 'GNF · Guinée · paiements locaux' : 'XOF · zone UEMOA · crypto') + ' · ' + c.dial,
          style: 'display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 14px; border: 0; border-bottom: 1px solid #E7F1E6; text-align: left; color: #15171C; background: ' + (c.code === ctry.code ? '#E6F7EA' : '#FFFFFF'),
          pick: function () { set({ country: c.code, screen: (s.token && srv.country === c.code) ? 'home' : 'phone', regPhone: '', otp: '', otpErr: '', method: c.ops[0], payout: 'wallet', xAsset: c.zone === 'CEMAC' ? 'XAF' : 'XOF', amount: '', dAmount: '', xAmount: '' }); } };
      }), function (r) { return r.name + ' (' + r.code + ')'; }, function (r) { return r.sub; }, 'Autres pays'),
      ddPayout: dd('payout', [{ key: 'wallet', label: 'Mon solde F CFA' }].concat(OPS.map(function (o) { return { key: o, label: o }; })).map(function (p) {
        return { label: p.label, on: payout === p.key, pick: function () { set({ payout: p.key }); }, style: chip(payout === p.key) };
      }), function (r) { return r.label; }, null, 'Autres opérateurs'),
      ddMethod: dd('method', methods, function (r) { return r.label; }, null, 'Autres moyens'),
      ddSend: dd('send', sendChips, function (r) { return r.sym; }, null, 'Autres monnaies'),
      ddXCountry: dd('xcountry', xCountries, function (r) { return r.name; }, null, 'Autres pays ' + ctry.zone),
      ddXOps: dd('xops', xOps, function (r) { return r.label; }, null, 'Autres opérateurs'),
      ddBillPartner: dd('billp', billPartners, function (r) { return r.name; }, function (r) { return r.sub; }, 'Autres ' + (bc.id === 'ecole' ? 'établissements' : bc.id === 'hotel' ? 'hôtels' : bc.id === 'resto' ? 'restaurants' : bc.id === 'courses' ? 'commerces' : 'services')),
      ddClaimOp: dd('claimop', claimOps, function (r) { return r.t; }, function (r) { return r.d + ' · ' + r.a; }, 'Opérations plus anciennes'),
      ddMotif: dd('motif', claimMotifs, function (r) { return r.label; }, null, 'Autres motifs'),
      goSecu: go('secu'),
      isSecu: scr === 'secu', isBioSet: scr === 'bioSet', isClaim: scr === 'claim', isChat: scr === 'chat',
      secuItems: secuItems,
      hasClaims: claimsView.length > 0, claimsView: claimsView.map(function (c) { return { id: c.id, op: c.op, motif: c.motif, date: relDate(c.date), status: c.status }; }),
      pinChanging: s.pinMode === 'change' && (scr === 'pinold' || scr === 'pinset' || scr === 'pinconfirm'),
      cancelPinChange: function () { set({ screen: 'secu', pinMode: '', pinEntry: '', pinNew: '', pinConf: '', pinErr: '', pinOld: '' }); },
      bioOptions: bioOptions, saveBio: saveBio,
      claimOps: claimOps, claimMotifs: claimMotifs,
      claimDesc: s.claimDesc, onClaimDesc: function (e) { set({ claimDesc: e.target.value }); },
      claimBlocked: !claimOk, claimBtn: cta(claimOk), submitClaim: submitClaim,
      chatMsgs: chatMsgs, chatInput: s.chatInput, onChatInput: function (e) { set({ chatInput: e.target.value }); },
      sendChat: function () { pushChat(s.chatInput); },
      chatQuick: ['Je n’ai pas reçu mon argent', 'Débloquer mon compte', 'Vérification d’identité'].map(function (q) { return { label: q, pick: function () { pushChat(q); } }; }),
      callAdvisor: function () { set({ contactMsg: 'Appel du service client : numéro à venir · 7 j/7, 8 h – 22 h. En attendant, écrivez-nous ici.' }); },
      waAdvisor: function () { set({ contactMsg: 'WhatsApp e-Wari : numéro à venir. En attendant, écrivez-nous ici.' }); },
      contactMsg: s.contactMsg, hasContactMsg: !!s.contactMsg,
      kycVerified: kycOk, kycNotVerified: !kycOk, kycPending: kyc === 'pending',
      kycNeedsAction: kyc === 'none' || kyc === 'rejected' || kyc === 'retake',
      kycBannerTitle: kyc === 'rejected' ? 'Vérification refusée' : kyc === 'retake' ? 'Nouvelle photo demandée' : 'Compte non vérifié',
      kycBannerText: kyc === 'rejected' || kyc === 'retake' ? 'Recommencez avec une photo nette de votre pièce. Les plafonds restent actifs.' : (cryptoOn ? 'Compte principal limité à ' + fx(CAP) + ' et cumul crypto à ' + fx(CAP_C) + '.' : 'Compte principal limité à ' + fx(CAP) + '.') + ' Vérifiez votre identité (pièce + visage) pour lever les limites et investir.',
      capMainPct: capPctN, capMainBar: 'height: 100%; border-radius: 4px; width: ' + capPctN + '%; background: ' + (capPctN >= 90 ? '#A12A1E' : '#9A5B00'),
      capMainText: fx(bal[CUR]) + ' / ' + fx(CAP),
      capCryptoPct: capPctC, capCryptoBar: 'height: 100%; border-radius: 4px; width: ' + capPctC + '%; background: ' + (capPctC >= 90 ? '#A12A1E' : '#9A5B00'),
      capCryptoText: fx(cryptoTotalN) + ' / ' + fx(CAP_C),
      kycCta: kyc === 'pending' ? 'Vérification en cours (24 h)' : 'Vérifier mon identité',
      startKyc: function () { if (kyc !== 'pending') kycStart(); },
      isKycType: scr === 'kycType', isKycPhoto: scr === 'kycPhoto', isKycSelfie: scr === 'kycSelfie',
      kycStepLabel: scr === 'kycType' ? 'Étape 1 sur 3' : scr === 'kycPhoto' ? 'Étape 2 sur 3 · ' + kd.name : 'Étape 3 sur 3',
      kycDocs: KDOCS.map(function (d) {
        var on = d.id === kd.id;
        return { name: d.name, sub: d.sub, pick: function () { set({ kycDoc: d.id }); },
          radio: 'width: 20px; height: 20px; flex-shrink: 0; border-radius: 10px; box-sizing: border-box; ' + (on ? 'border: 6px solid #13894A; background: #FFFFFF;' : 'border: 2px solid #8A8E96;'),
          style: 'display: flex; align-items: center; gap: 12px; width: 100%; padding: 14px 16px; border: 0; border-bottom: 1px solid #E7F1E6; text-align: left; color: #15171C; background: ' + (on ? '#E6F7EA' : '#FFFFFF') };
      }),
      kycDocName: kd.name,
      kycToPhoto: function () { if (kycBirthOk) set({ screen: 'kycPhoto' }); },
      kycBirth: s.kycBirth || '', kycBirthMax: todayIso,
      onKycBirth: function (e) { set({ kycBirth: e.target.value }); },
      kycMinor: kycMinor,
      kycMinorText: 'La vérification d’identité est réservée aux personnes de ' + KYC_MIN_AGE + ' ans et plus. Votre compte reste utilisable avec les plafonds d’un compte non vérifié (solde jusqu’à ' + fx(CAP) + ').',
      kycTypeBlocked: !kycBirthOk,
      kycContStyle: kycBirthOk ? '' : 'opacity: .45',
      kycBackType: go('kycType'),
      kycBackPhoto: go('kycPhoto'),
      docFrameStyle: 'position: relative; z-index: 1; width: 250px; height: 158px; box-sizing: border-box; border: 3px ' + (s.kycDocImg ? 'solid ' : 'dashed ') + frame(s.kycDocImg ? 'ok' : '') + '; border-radius: 14px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; overflow: hidden; background: center / cover no-repeat ' + (s.kycDocImg ? 'url(' + s.kycDocImg + ')' : 'transparent'),
      docFrameText: s.kycDocImg ? '' : 'Placez la pièce dans le cadre',
      docIconShow: !s.kycDocImg && s.kycCam !== 'doc',
      docInstruction: kd.id === 'passport' ? 'Ouvrez le passeport à la page avec votre photo, posé à plat.' : 'Photographiez le recto de la carte, posée à plat, en entier et sans reflet.',
      photoNone: !s.kycDocImg, photoOk: !!s.kycDocImg,
      camOnDoc: s.kycCam === 'doc', camOffDoc: s.kycCam !== 'doc',
      camOnSelf: s.kycCam === 'self', camOffSelf: s.kycCam !== 'self',
      kycCamErr: s.kycCamErr || '', hasKycCamErr: !!s.kycCamErr,
      openDocCam: function () { self.kycCamStart('doc'); },
      openSelfCam: function () { self.kycCamStart('self'); },
      snapPhoto: function () { self.kycSnap(); },
      cancelCam: function () { self.kycCamStop(); },
      pickDocFile: function () { self.kycCamStop(); pickFile('kycDocIn')(); },
      pickSelfFile: function () { self.kycCamStop(); pickFile('kycSelfIn')(); },
      onDocFile: function (e) { var f = e.target.files && e.target.files[0]; if (f) shrink(f, function (d) { self.setState({ kycDocImg: d, kycCamErr: '' }); }); },
      retakeDoc: function () { self.setState({ kycDocImg: '' }); self.kycCamStart('doc'); },
      kycToSelfie: function () { set({ screen: 'kycSelfie' }); },
      faceFrameStyle: 'position: relative; z-index: 1; width: 180px; height: 220px; box-sizing: border-box; border-radius: 50%; overflow: hidden; border: 4px ' + (s.kycSelfImg ? 'solid #3FD39B' : 'dashed #8A8E96') + '; display: flex; align-items: center; justify-content: center; background: center / cover no-repeat ' + (s.kycSelfImg ? 'url(' + s.kycSelfImg + ')' : 'transparent'),
      faceIconShow: !s.kycSelfImg && s.kycCam !== 'self',
      selfieNone: !s.kycSelfImg, selfieDone: !!s.kycSelfImg,
      retakeSelfie: function () { self.setState({ kycSelfImg: '' }); self.kycCamStart('self'); },
      onSelfieFile: function (e) { var f = e.target.files && e.target.files[0]; if (f) shrink(f, function (d) { self.setState({ kycSelfImg: d, kycCamErr: '' }); }); },
      finishKyc: sendKyc, kycSendBtn: cta(!!s.kycSelfImg), kycSendBlocked: !s.kycSelfImg || !!s.busy,
      goInvest: function () { set({ screen: 'invest' }); self.refresh(); }, isInvest: scr === 'invest',
      invPortalOpen: function () { window.open((NATIVE ? NATIVE.origin : location.origin) + '/investir', '_blank', 'noopener'); },
      invTitle: R.title || 'Levée de fonds', invClose: closeTxt, invStatusText: roundOpen ? 'Levée ouverte' : 'Levée pas encore ouverte',
      invMin: plural(INV.min, 'part'), invMax: plural(INV.max, 'part'),
      invRaised: fx(raisedN), invGoal: fx(INV.goal), invPct: String(invPctN).replace('.', ',') + ' %', invPctNum: invPctN,
      invBar: 'height: 100%; border-radius: 5px; background: #3FD39B; width: ' + invPctN + '%',
      invCount: INV.investors.toLocaleString('fr-FR').replace(/[ \s]/g, ' '),
      invPrice: fx(INV.price),
      valoPre: fx(INV.pre), valoPreShort: big(INV.pre), valoPost: fx(postVal),
      pctCompany1: pct(INV.price / postVal), pctRound1: pct(INV.price / INV.goal),
      totalParts: Math.round(postVal / INV.price).toLocaleString('fr-FR').replace(/[ \s]/g, ' '),
      pctCompanyN: pct(invAmt / postVal), pctInvestors: pct(INV.goal / postVal),
      scenarios: [0.5, 1, 2, 5].map(function (k) {
        var on = (s.scen || 2) === k;
        return { label: '×' + String(k).replace('.', ','), pick: function () { set({ scen: k }); },
          style: 'min-height: 40px; border-radius: 10px; font-weight: 600; font-size: 14px; ' + (on ? 'background: #15171C; color: #FFFFFF; border: 1px solid #15171C;' : 'background: #FFFFFF; color: #15171C; border: 1px solid #CFE2D0;') };
      }),
      scenarioText: big(postVal * (s.scen || 2)) + ' → vos ' + invParts + ' parts vaudraient',
      scenarioValue: fx(invAmt * (s.scen || 2)),
      hasParts: myParts > 0, myParts: myParts, myInvested: fx(myInvested),
      invIsPartner: isPartnerInv,
      invClientTab: tab(!isPartnerInv), invPartnerTab: tab(isPartnerInv),
      setInvClient: function () { set({ invProfile: 'client' }); },
      setInvPartner: function () { set({ invProfile: 'partner' }); },
      invCode: s.invCode, onInvCode: function (e) { set({ invCode: e.target.value }); },
      invCodeHint: codeOk ? 'Code au bon format · vérifié à la validation' : 'Format : P- suivi de 5 chiffres (votre code partenaire e-Wari)',
      invCodeHintStyle: 'font-size: 12px; ' + (codeOk ? 'color: #13894A; font-weight: 600' : 'color: #5A5E66'),
      invParts: invParts, invAmount: fx(invAmt),
      partsMinus: setParts(invParts - 1), partsPlus: setParts(invParts + 1),
      partsQuick: [1, 5, 10, 50].map(function (n) {
        return { label: n + (n > 1 ? ' parts' : ' part'), pick: setParts(n),
          style: 'padding: 6px 12px; min-height: 36px; border-radius: 999px; font-size: 13px; ' + (n === invParts ? 'background: #15171C; color: #FFFFFF; border: 1px solid #15171C;' : 'background: #FFFFFF; color: #15171C; border: 1px solid #CFE2D0;') };
      }),
      invRiskOk: !!s.invRisk, toggleRisk: function (e) { set({ invRisk: !!e.target.checked }); },
      invErr: invErr, hasInvErr: !!invErr,
      invBlocked: !invOk, invBtn: cta(invOk),
      invCta: ptsUse ? 'Investir · payer ' + fx(invCashN) : 'Investir ' + fx(invAmt),
      ptsBal: ptsBal, ptsValue: fx(ptsBal * PT_VAL), hasPts: ptsBal > 0,
      usePts: !!s.usePts, toggleUsePts: function (e) { set({ usePts: !!e.target.checked }); },
      ptsUseText: ptsUse ? '−' + ptsUse + ' pts (−' + fx(ptsUse * PT_VAL) + ')' : '—',
      invCash: fx(invCashN),
      convBlocked: !convOk, convBtn: cta(convOk),
      convCta: convOk ? 'Convertir ' + convPts + ' pts en ' + plural(convParts, 'part') : (ptsBal >= PTS_PER_PART ? 'Conversion indisponible pour l’instant' : 'Encore ' + (PTS_PER_PART - ptsBal % PTS_PER_PART) + ' pts pour 1 part'),
      confirmConvert: confirmConvert,
      confirmInvest: confirmInvest,
      isPay: scr === 'pay', isBill: scr === 'bill',
      billCats: billCats,
      billName: bc.name, billSub: bc.sub, billIcon: bc.icon, billBadge: badgeStyle(bc, 44),
      billHasPartners: !!bc.list, billPartners: billPartners, billPartnerLabel: bc.partnerLabel || '',
      billShowRef: partnerOk,
      billRefLabel: refCfg.label, billRefPh: refCfg.ph,
      billRef: s.billRef, onBillRef: function (e) { set({ billRef: e.target.value }); },
      billRefHint: refCfg.hint,
      rentShow: rentKeyOk, rentCanOn: rentKeyOk && !rentM, rentCanOff: !!rentM,
      rentText: rentM ? 'Actif depuis le ' + new Date(rentM.consentAt).toLocaleDateString('fr-FR') + ' : votre loyer est prélevé automatiquement à partir du 25 de chaque mois (nouvel essai chaque jour jusqu’au 5 si le solde est insuffisant).' : 'Ne vous souciez plus de la date : e-Wari prélève votre loyer à partir du 25 de chaque mois et le verse directement à votre agence ou à votre bailleur.',
      rentConsent: (RT && RT.consent) || 'J’autorise e-Wari à prélever mon loyer à partir du 25 de chaque mois, conformément à la clause de prélèvement de mon contrat de bail.',
      rentAccept: !!s.rentAccept, rentToggle: function (e) { set({ rentAccept: !!e.target.checked }); },
      rentPin: s.rentPin || '', onRentPin: function (e) { set({ rentPin: String(e.target.value || '').replace(/\D/g, '').slice(0, 4) }); },
      rentActivate: rentActivate, rentStop: rentStop, rentBlocked: !(s.rentAccept && rentPinOk) || !!s.busy,
      rentBtn: 'min-height:48px;border:0;border-radius:12px;font-size:15px;font-weight:700;color:#FFFFFF;background:' + (s.rentAccept && rentPinOk && !s.busy ? '#13894A' : '#9CA3AF'),
      rentHasMsg: !!s.rentMsg, rentMsg: s.rentMsg || '',
      billFound: billFound, billFoundTitle: bc.lookSoft && !(looked && lk.ok) ? 'Hôtel partenaire' : bc.foundTitle, billFoundText: foundText,
      billFixedShow: billFixed && billFound && fixedAmt > 0, billFreeShow: partnerOk && !(billFixed && fixedAmt > 0) && (!bc.lookup || billFound),
      billFixedLabel: bc.fixedLabel || '', billFixedText: fixedAmt ? fx(fixedAmt) : '',
      billAmount: s.billAmount, onBillAmount: function (e) { set({ billAmount: e.target.value }); },
      billQuick: (bc.quick || []).map(function (v) { return { label: fx(v), pick: function () { set({ billAmount: String(v) }); } }; }),
      billTotal: billAmt > 0 ? fx(billAmt) : '—',
      billErr: billErr, hasBillErr: !!billErr,
      billBlocked: !billOk, billBtn: cta(billOk),
      billCta: billAmt > 0 && billFound ? 'Payer ' + fx(billAmt) : 'Payer',
      confirmBill: confirmBill,
      isScan: scr === 'scan', isQrPay: scr === 'qrpay',
      scanIsScan: s.scanTab !== 'myqr', scanIsMyQr: s.scanTab === 'myqr',
      scanTabStyle: tab(s.scanTab !== 'myqr'), myQrTabStyle: tab(s.scanTab === 'myqr'),
      setScanTab: function () { set({ scanTab: 'scan', camErr: '' }); },
      setMyQrTab: function () { set({ scanTab: 'myqr' }); },
      camErr: s.camErr || '', hasCamErr: !!s.camErr, hasMerchants: merchants.length > 0,
      merchants: merchants, qrPath: qr.path, qrView: '0 0 ' + qr.n + ' ' + qr.n, qrN: qr.n,
      shareQr: function () { if (navigator.share) navigator.share({ title: 'Payez-moi avec e-Wari', url: myQrLink }).catch(function () {}); else if (navigator.clipboard) navigator.clipboard.writeText(myQrLink).then(function () { set({ camErr: '' }); }); },
      mName: merName, mSub: mer ? (TYPE_LBL[mer.type] || 'Partenaire') + ' · ' + (mer.city || ctry.name) : (qrToUser ? 'Utilisateur e-Wari' : ''), mInitials: initialsOf(merName) || 'E',
      mFixed: mFixed, mFree: !mFixed, mAmountText: fx(s.qrFixed || 0),
      qrAmount: s.qrAmount, onQrAmount: function (e) { set({ qrAmount: e.target.value }); },
      qrTotal: qrAmt > 0 ? fx(qrAmt) : '—',
      qrErr: qrErr, hasQrErr: !!qrErr,
      qrBlocked: !qrOk, qrBtn: cta(qrOk),
      qrCta: qrAmt > 0 ? 'Payer ' + fx(qrAmt) : 'Payer',
      confirmQr: confirmQr,
      isPinSet: scr === 'pinset' || scr === 'pinconfirm' || scr === 'pinold', isBio: scr === 'bio', isLock: scr === 'lock', isPayOtp: scr === 'payotp',
      pinTitle: scr === 'pinold' ? 'Code PIN actuel' : scr === 'pinconfirm' ? 'Confirmez votre code PIN' : (s.pinMode === 'change' ? 'Nouveau code PIN' : 'Créez votre code PIN'),
      pinSub: scr === 'pinold' ? 'Pour votre sécurité, saisissez d’abord votre code PIN actuel.' : scr === 'pinconfirm' ? 'Saisissez à nouveau les 4 chiffres.' : '4 chiffres pour ouvrir l’application. Évitez 1234 ou 0000.',
      pinDots: pinDots, pinDotsLabel: pinCur.length + ' chiffre(s) sur 4 saisis',
      pinErr: s.pinErr, hasPinErr: !!s.pinErr,
      showKeypad: scr === 'pinset' || scr === 'pinconfirm' || scr === 'pinold' || (scr === 'lock' && s.lockMethod === 'pin' && !s.acctLocked),
      keys: keys,
      enableBio: function () { self.bioCreate(function (err) { if (err) self.setState({ screen: 'home', last: null }); else { LS.set('ewari_biotype', 'finger'); self.setState({ screen: 'home' }); } }); },
      skipBio: function () { set({ screen: 'home' }); },
      lockApp: function () { set({ screen: 'lock', lockMethod: bioOn ? 'bio' : 'pin', pinEntry: '', lockErr: '', lockOtpSent: false, lockOtp: '' }); },
      lockIsPin: s.lockMethod === 'pin', lockIsBio: s.lockMethod === 'bio', lockIsSms: s.lockMethod === 'sms',
      lockPinTab: tab(s.lockMethod === 'pin'), lockBioTab: tab(s.lockMethod === 'bio'), lockSmsTab: tab(s.lockMethod === 'sms'),
      setLockPin: function () { if (!s.token) { set({ lockErr: 'Confirmez d’abord votre identité par SMS.' }); return; } set({ lockMethod: 'pin', lockErr: '', pinEntry: '' }); },
      setLockBio: function () { set({ lockMethod: 'bio', lockErr: '' }); },
      setLockSms: function () { set({ lockMethod: 'sms', lockErr: '' }); },
      bioHint: bioOn ? (bioType === 'face' ? 'Regardez la caméra pour ouvrir' : 'Touchez le capteur pour ouvrir') : 'Biométrie non activée : utilisez le code PIN ou le code SMS',
      bioLabel: bioType === 'face' ? 'Visage' : 'Empreinte',
      bioUnlock: function () {
        if (!s.token) { set({ lockErr: 'Confirmez d’abord votre identité par SMS.' }); return; }
        self.bioCheck(function (err) { if (err) self.setState({ lockErr: err }); else unlocked(); });
      },
      lockOtpSent: !!s.lockOtpSent, lockOtpNotSent: !s.lockOtpSent,
      sendLockOtp: function () {
        if (s.busy) return;
        set({ busy: true });
        call('/auth/otp', { phone: userE164 || LS.get('ewari_phone'), country: srv.country || s.country }).then(function (r) { self.setState({ busy: false, lockOtpSent: true, lockOtp: '', lockErr: '', otpHint: r.hint || 'Code envoyé par SMS' }); }, function (e) { self.setState({ busy: false, lockErr: e.message }); });
      },
      lockOtp: s.lockOtp, onLockOtp: function (e) { set({ lockOtp: e.target.value.replace(/\D/g, '').slice(0, 6), lockErr: '' }); },
      lockOtpBlocked: !lockOtpOk, lockOtpBtn: cta(lockOtpOk),
      verifyLockOtp: function () {
        if (!lockOtpOk || s.busy) return;
        set({ busy: true });
        smsLogin(userE164 || LS.get('ewari_phone'), srv.country || s.country, s.lockOtp, function () { unlocked(); }, function (e) { self.setState({ busy: false, lockOtp: '', lockErr: e.message }); });
      },
      lockErr: s.lockErr, hasLockErr: !!s.lockErr, otpHint: otpHintTxt,
      /* demande de réactivation d'un compte inactif */
      acctLocked: !!s.acctLocked, lockNormal: !s.acctLocked, lbFormShown: !!s.acctLocked && !s.lbDone, lbDone: !!s.lbDone, lbDoneMsg: s.lbDone || '',
      lbPhone: s.lbPhone || '', onLbPhone: function (e) { set({ lbPhone: e.target.value.replace(/[^\d+ ]/g, '').slice(0, 20), lockErr: '' }); },
      lbSmsTab: tab((s.lbCh || 'sms') === 'sms'), lbWaTab: tab(s.lbCh === 'whatsapp'),
      setLbSms: function () { set({ lbCh: 'sms' }); }, setLbWa: function () { set({ lbCh: 'whatsapp' }); },
      lbSendBlocked: String(s.lbPhone || '').replace(/\D/g, '').length < 8 || !!s.busy, lbSendBtn: cta(String(s.lbPhone || '').replace(/\D/g, '').length >= 8 && !s.busy),
      sendLbCode: function () {
        if (s.busy || String(s.lbPhone || '').replace(/\D/g, '').length < 8) return;
        set({ busy: true, lockErr: '' });
        call('/unlock/request', { kind: 'user', id: s.lockId || userE164 || LS.get('ewari_phone'), country: srv.country || s.country, phone: s.lbPhone, channel: s.lbCh || 'sms' }).then(function (r) { self.setState({ busy: false, lbSent: true, lbCode: '', lbInfo: r.message + (r.hint ? ' ' + r.hint + '.' : '') }); }, function (e) { self.setState({ busy: false, lockErr: e.message }); });
      },
      lbCodeShown: !!s.lbSent, lbInfo: s.lbInfo || '', lbCode: s.lbCode || '', onLbCode: function (e) { set({ lbCode: e.target.value.replace(/\D/g, '').slice(0, 6), lockErr: '' }); },
      lbVerifyBlocked: String(s.lbCode || '').length !== 6 || !!s.busy, lbVerifyBtn: cta(String(s.lbCode || '').length === 6 && !s.busy),
      verifyLb: function () {
        if (s.busy || String(s.lbCode || '').length !== 6) return;
        set({ busy: true });
        call('/unlock/verify', { kind: 'user', id: s.lockId || userE164 || LS.get('ewari_phone'), country: srv.country || s.country, phone: s.lbPhone, code: s.lbCode, channel: s.lbCh || 'sms' }).then(function (r) { self.setState({ busy: false, lbDone: r.message, lockErr: '' }); }, function (e) { self.setState({ busy: false, lbCode: '', lockErr: e.message }); });
      },
      lbRetry: function () { self.setState({ acctLocked: false, lbDone: '', lockErr: '', lockMethod: 'sms', lockOtpSent: false }); },
      payLines: payLines, payHint: s.payHint || '',
      payOtp: s.payOtp, onPayOtp: function (e) { set({ payOtp: e.target.value.replace(/\D/g, '').slice(0, 6), payErr: '' }); },
      payErr: s.payErr, hasPayErr: !!s.payErr,
      payBlocked: String(s.payOtp || '').length !== 6 || !!s.busy, payBtn: cta(String(s.payOtp || '').length === 6),
      verifyPay: verifyPay,
      isMmWait: scr === 'mmwait', isMmOtp: !!mm && mm.flow === 'otp', isMmApp: !!mm && mm.flow === 'app', isMmPush: !!mm && mm.flow === 'push',
      mmDemo: !!mm && !!mm.demo, mmTitle: mm ? mm.title : '', mmOp: mm ? mm.op : '', mmUssd: mm ? mm.ussd : '', mmAmt: mm ? fx(mm.amount) : '', mmPhone: mm ? mm.phone : '', mmRef: mm ? mm.id : '',
      mmSteps: (mm ? mm.steps : []).map(function (t, i) { return { n: String(i + 1), t: t }; }),
      mmLeft: Math.floor(mmLeftS / 60) + ' min ' + ('0' + (mmLeftS % 60)).slice(-2) + ' s', mmLow: mmLeftS < 60,
      mmLeftStyle: 'font-weight:700;color:' + (mmLeftS < 60 ? '#A12A1E' : '#0B5C31'),
      mmSms: s.mmSms || '', hasMmSms: !!s.mmSms, mmErr: s.mmErr || '', hasMmErr: !!s.mmErr,
      mmCode: s.mmCode || '', onMmCode: function (e) { set({ mmCode: e.target.value.replace(/\D/g, '').slice(0, 8), mmErr: '' }); },
      mmPin: s.mmPin || '', onMmPin: function (e) { set({ mmPin: e.target.value.replace(/\D/g, '').slice(0, 4), mmErr: '' }); },
      mmCodeBlocked: !mmCodeOk || !!s.busy, mmCodeBtn: cta(mmCodeOk && !s.busy), mmPinBlocked: !mmPinOk || !!s.busy, mmPinBtn: cta(mmPinOk && !s.busy),
      mmDialUssd: function () { mmCall('/sim', { action: 'ussd' }); },
      mmSubmitOtp: function () { if (mmCodeOk) mmCall('/otp', { code: s.mmCode }); },
      mmOpenApp: function () { if (mm && mm.launchUrl) window.open(mm.launchUrl, '_blank'); },
      mmApprove: function () { if (mmPinOk) mmCall('/sim', { action: 'approve', pin: s.mmPin }); },
      mmDecline: function () { mmCall('/sim', { action: 'decline' }); },
      mmCheckNow: function () { self.mmCheck(); },
      mmCancel: function () { mmCall('/cancel', {}); },
      pispiOn: !!PS.on, isPispi: scr === 'pispi', isAbroad: scr === 'abroad',
      isIns: scr === 'ins', isInsCard: scr === 'insCard' && !!insCard, isEtat: scr === 'etat',
      insDemo: !INS.live, insInsurer: INS.insurer || 'e-Wari Assurances', insNote: INS.note || '',
      insIsMine: insTab === 'mine', insIsNew: insTab !== 'mine', insMineTab: tab(insTab === 'mine'), insNewTab: tab(insTab !== 'mine'),
      insToMine: function () { set({ insTab: 'mine' }); }, insToNew: function () { set({ insTab: 'new', insProd: '', insPlate: '', insVehicle: '', insStart: '' }); },
      insRows: insRows, insNone: insRows.length === 0, insAlert: !!insAlert, insAlertTxt: insAlert ? insAlert.plate + ' · ' + insAlert.soonTxt : '', insAlertGo: function () { set({ screen: 'ins', insTab: 'mine' }); },
      insCatAuto: chip(insCat === 'auto'), insCatMoto: chip(insCat === 'moto'), insPickAuto: function () { set({ insCat: 'auto', insProd: '' }); }, insPickMoto: function () { set({ insCat: 'moto', insProd: '' }); },
      insProdRows: insProdRows, insDurRows: insDurRows,
      insPlate: s.insPlate || '', onInsPlate: function (e) { set({ insPlate: e.target.value }); },
      insVehicle: s.insVehicle || '', onInsVehicle: function (e) { set({ insVehicle: e.target.value }); },
      insHolder: s.insHolder || '', onInsHolder: function (e) { set({ insHolder: e.target.value }); },
      insStart: s.insStart || todayIso, onInsStart: function (e) { set({ insStart: e.target.value }); }, insStartMin: todayIso,
      insPremTxt: insPrem ? fx(insPrem) : '—', insPeriodTxt: insProd ? 'Du ' + frD(s.insStart || todayIso) + ', ' + insMonths + ' mois' : 'Choisissez le véhicule', insPlateFmt: plateFmt || '—',
      hasInsErr: !!insErr, insErr: insErr, insCta: cta(insOk), confirmIns: confirmIns,
      icPlate: insCard ? insCard.plate : '', icVehicle: insCard ? insCard.vehicle : '', icHolder: insCard ? insCard.holder : '', icProduct: insCard ? insCard.productLabel : '',
      icFrom: insCard ? frD(insCard.start) : '', icTo: insCard ? frD(insCard.end) : '', icId: insCard ? insCard.id : '', icStatus: insCard ? insCard.statusTxt.toUpperCase() : '',
      icStatusStyle: 'align-self: flex-start; display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 999px; font-size: 20px; font-weight: 800; letter-spacing: 0.04em; background: #FFFFFF; color: ' + (insValid ? '#0B5C31' : '#A12A1E'),
      icBg: 'display: flex; flex-direction: column; gap: 14px; padding: 22px 20px; border-radius: 24px; color: #FFFFFF; background: ' + insCardBg,
      icClock: insClock, icBar: 'height: 4px; border-radius: 2px; background: #FFFFFF; opacity: 0.85; width: ' + Math.round(((sec % 10) + 1) * 10) + '%',
      icQrPath: insQr.path, icQrBox: '0 0 ' + insQr.n + ' ' + insQr.n, icCode: insCard ? insCard.certCode : '', icUrl: insCard ? insCard.verifyUrl : '',
      icBack: function () { set({ screen: 'ins', insTab: 'mine' }); },
      etHasCat: !!etCat && !etItem, etNoCat: !etCat, etHasItem: !!etItem, etCatRows: etCatRows, etItemRows: etItemRows, etBack: etBack,
      etTitle: etItem ? etItem.label : etCat ? etCat.label : 'Services de l’État', etPartner: ET.partner || '',
      etFixed: etFixed, etFree: !!etItem && !etFixed, etFixedTxt: etFixed ? fx(etItem.amount) : '', etSrc: etItem ? (etItem.src ? 'Montant : ' + etItem.src : '') : '',
      etRefLabel: etItem ? etItem.ref : '', etRef: s.etRef || '', onEtRef: function (e) { set({ etRef: e.target.value }); },
      etAmt: s.etAmt || '', onEtAmt: function (e) { set({ etAmt: e.target.value }); }, etQuick: etQuick, etHasQuick: etQuick.length > 0,
      etTotal: etAmt ? fx(etAmt) : '—', hasEtErr: !!etErr, etErr: etErr, etCta: cta(etOk), confirmEtat: confirmEtat,
      goPari: goPari, isPari: scr === 'pari' && !prSel, isPariCat: scr === 'pari' && !!prSel,
      pariBack: function () { if (prSel) set({ pariSel: '', pariErr: '' }); else set({ screen: 'home' }); },
      pariLoading: !!s.pariLoading && !PR, pariInfo: s.pariInfo || '', hasPariInfo: !!s.pariInfo, pariErr: s.pariErr || '', hasPariErr: !!s.pariErr,
      pariGroups: pariGroups, hasPariGroups: pariGroups.length > 0, pariCats: pariCats,
      pcLabel: prSel ? prSel.label : '', pcKind: prSel ? prSel.kind : '', pcCycle: prSel ? prSel.cycleTxt : '', pcPer: prSel ? prSel.perTxt : '', pcPay: prSel ? prSel.payTxt : '',
      pcPot: prSel ? 'À votre tour, vous recevez ' + fx(prSel.potNet) + ' (' + fx(prSel.potGross) + ' collectés, commission e-Wari ' + String(prSel.commission).replace('.', ',') + ' %).' : '',
      pcChecks: (prSel ? prSel.checks : []).map(function (k) { return { label: k.label, have: k.have, need: k.need, ico: k.ok ? '✓' : '✗', icoStyle: 'flex-shrink: 0; width: 24px; height: 24px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-weight: 800; ' + (k.ok ? 'background: #D3F2DC; color: #0B5C31;' : 'background: #F6DEDA; color: #A12A1E;') }; }),
      pcMember: !!prSel && !!prSel.member, pcNotQ: pcNotQ,
      pcNotQTxt: pcNoKyc ? 'Votre compte doit d’abord être identifié et validé : envoyez votre pièce d’identité depuis l’accueil.' : 'Vous n’êtes pas encore qualifié pour ce PARI. Merci d’augmenter vos opérations.',
      pcCanJoin: !!prSel && prSel.eligible && !prSel.member,
      pcMandate: prSel ? 'J’autorise e-Wari à prélever automatiquement ' + prSel.perTxt.replace('prélevés', '') + ' sur mon solde jusqu’à la fin du cycle (' + prSel.cycleTxt + '). Je ne peux plus quitter le PARI une fois démarré.' : '',
      pcAccept: !!s.pariAccept, pcToggle: function (e) { set({ pariAccept: !!e.target.checked }); },
      pcPin: s.pariPin || '', onPcPin: function (e) { set({ pariPin: e.target.value.replace(/\D/g, '').slice(0, 4), pariErr: '' }); },
      pcBlocked: !prJoinOk, pcBtn: cta(prJoinOk), pariJoin: pariJoin,
      goPispi: go('pispi', { psTab: 'send', psErr: '', psInfo: '' }), goAbroad: go('abroad', { rmInfo: '' }),
      psSendTab: chip(psTab === 'send'), psRecvTab: chip(psTab === 'recv'), psRtpTab: chip(psTab === 'rtp'),
      psIsSend: psTab === 'send', psIsRecv: psTab === 'recv', psIsRtp: psTab === 'rtp',
      psToSend: function () { set({ psTab: 'send', psErr: '', psInfo: '' }); }, psToRecv: function () { set({ psTab: 'recv', psErr: '', psInfo: '' }); }, psToRtp: function () { set({ psTab: 'rtp', psErr: '', psInfo: '' }); },
      psRtpCount: (PS.rtp || []).length ? ' (' + PS.rtp.length + ')' : '',
      psTo: s.psTo || '', onPsTo: function (e) { set({ psTo: e.target.value, psDest: null, psErr: '' }); },
      psLookup: psLookup, psLookBtn: cta(!!String(s.psTo || '').trim() && !s.busy),
      hasPsDest: !!psDest, psName: psDest ? psDest.name : '', psInst: psDest ? psDest.institution : '', psDisp: psDest ? psDest.display : '', psDispLbl: psDest && psDest.kind === 'compte' ? 'Compte' : 'Alias (téléphone)',
      psAmt: s.psAmt || '', onPsAmt: function (e) { set({ psAmt: e.target.value.replace(/[^0-9]/g, ''), psErr: '' }); },
      psFeeTxt: fx(psFee) + ' (' + String(PS.feePct || 0).replace('.', ',') + ' %)', psTotal: fx(psAmt + psFee),
      psErr: psErr, hasPsErr: !!psErr, psInfo: s.psInfo || '', hasPsInfo: !!s.psInfo,
      psBlocked: !psOk || !!s.busy, psBtn: cta(psOk), confirmPispi: confirmPispi,
      psDemo: !!PS.demo, psAlias: PS.alias ? e164Intl(PS.alias) : '',
      psSimIn: psSim('/pispi/sim/incoming', function (r) { return 'Virement de ' + fx(r.amount) + ' reçu par PI-SPI : votre solde est crédité.'; }),
      psSimRtp: psSim('/pispi/sim/rtp', function () { return 'Nouvelle demande de paiement reçue.'; }),
      psRtp: psRtp, psNoRtp: psRtp.length === 0,
      rmLink: RM.link, rmCopy: rmCopy, rmShare: rmShare, rmOpen: function () { window.open(RM.link, '_blank'); },
      rmInfo: s.rmInfo || '', hasRmInfo: !!s.rmInfo, rmDemo: !!RM.demo,
      cancelPay: function () { set({ screen: backOf[s.pending] || 'home', pending: '', payOtp: '', payErr: '' }); },
      doneOk: !(s.last && s.last.fail), doneFail: !!(s.last && s.last.fail),
      isPhone: scr === 'phone', isOtp: scr === 'otp',
      goPhone: go('phone', { otp: '', otpErr: '' }),
      userIntl: userIntl,
      regPhone: s.regPhone, onRegPhone: function (e) { set({ regPhone: e.target.value }); },
      regHint: 'Format : ' + ctry.dial + ' + ' + lenText(ctry) + (regDigits.length && phoneOk(regDigits) ? '  →  ' + ctry.dial + regDigits : ''),
      regErr: regErr, hasRegErr: !!regErr,
      regBlocked: !regOk, regBtn: cta(regOk),
      sendCode: function () {
        if (!regOk) return;
        set({ busy: true });
        call('/auth/otp', { phone: regDigits, country: ctry.code }).then(function (r) { LS.set('ewari_phone', r.phone); self.setState({ busy: false, screen: 'otp', otp: '', otpErr: '', otpHint: r.hint || 'Code envoyé par SMS au ' + intl(ctry, regDigits) }); },
          function (e) { self.setState({ busy: false, srvErr: e.message, srvFor: 'reg' }); });
      },
      regIntl: intl(ctry, regDigits),
      otp: s.otp, onOtp: function (e) { set({ otp: e.target.value.replace(/\D/g, '').slice(0, 6), otpErr: '' }); },
      otpErr: s.otpErr, hasOtpErr: !!s.otpErr,
      otpBlocked: String(s.otp).length !== 6 || !!s.busy, otpBtn: cta(String(s.otp).length === 6),
      verifyOtp: function () {
        if (String(s.otp).length !== 6 || s.busy) return;
        set({ busy: true });
        smsLogin(regDigits, ctry.code, s.otp, function (r) {
          self.setState({ busy: false, token: r.token, otp: '', screen: r.hasPin ? 'home' : 'pinset', pinNew: '', pinConf: '', pinErr: '', pinMode: '' });
          self.refresh();
        }, function (e) { self.setState({ busy: false, otpErr: e.message }); });
      },
      countryCode: ctry.code, countryName: ctry.name, cur: CUR, dial: ctry.dial, phPlaceholder: ctry.ph,
      cryptoOn: cryptoOn, cryptoOff: !cryptoOn,
      actionGrid: 'display: grid; grid-template-columns: repeat(' + (cryptoOn ? 4 : 3) + ', minmax(0, 1fr)); gap: 8px',
      navGrid: 'flex-shrink: 0; display: grid; grid-template-columns: repeat(' + (cryptoOn ? 5 : 4) + ', minmax(0, 1fr)); min-height: 72px; padding-bottom: env(safe-area-inset-bottom); border-top: 1px solid #DCEBDC; background: #FFFFFF',
      zones: [
        { title: 'Zone UEMOA · XOF · crypto disponible', z: 'UEMOA' },
        { title: 'Zone CEMAC · XAF · transferts uniquement', z: 'CEMAC' },
        { title: 'Guinée · GNF · paiements locaux (sans envoi vers les zones UEMOA et CEMAC)', z: 'GN' }
      ].map(function (zn) {
        return {
          title: zn.title,
          items: COUNTRIES.filter(function (c) { return c.zone === zn.z; }).map(function (c) {
            return {
              code: c.code, name: c.name, on: c.code === ctry.code,
              sub: (c.zone === 'CEMAC' ? 'XAF' : c.zone === 'GN' ? 'GNF' : 'XOF') + ' · ' + c.dial + ' · ' + c.ops.join(', '),
              style: 'display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 14px; border: 0; border-bottom: 1px solid #E7F1E6; text-align: left; color: #15171C; background: ' + (c.code === ctry.code ? '#E6F7EA' : '#FFFFFF'),
              pick: function () { set({ country: c.code, screen: (s.token && srv.country === c.code) ? 'home' : 'phone', regPhone: '', otp: '', otpErr: '' }); }
            };
          })
        };
      }),
      navHome: nav(scr === 'home'), navPay: nav(scr === 'pay'), navInvest: nav(scr === 'invest'), navTrade: nav(scr === 'trade' || scr === 'wallet'), navHist: nav(scr === 'history'),

      xofBal: fx(bal[CUR]), cryptoTotal: fx(cryptoTotalN), cryptoRows: cryptoRows,

      setBuy: function () { set({ mode: 'buy', amount: '', sellAll: false }); },
      setSell: function () { set({ mode: 'sell', amount: '', sellAll: false }); },
      setConv: function () { set({ mode: 'convert', cAmount: '' }); },
      buyTab: tab(isBuy), sellTab: tab(tmode === 'sell'), convTab: tab(isConv),
      tabs3: 'display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; padding: 4px; background: #E2F0E1; border-radius: 14px',
      notConv: !isConv, isConv: isConv,
      cxSim: CX.mode === 'sim',
      cxSimText: 'Mode test : cours réels ' + (CX.src || 'Binance') + ', exécution simulée (aucune vraie crypto).',
      assetChips: CRYPTOS.map(function (a) { return { sym: a, pick: function () { set({ asset: a, sellAll: false }); }, style: chip(s.asset === a) }; }),
      tradeLabel: isBuy ? 'Je paie' : 'Je vends pour',
      amount: s.amount,
      onAmount: function (e) { set({ amount: e.target.value, sellAll: false }); },
      quick: quick,
      available: isBuy ? fx(bal[CUR]) : fc(bal[s.asset], s.asset) + ' (≈ ' + fx(bal[s.asset] * price) + ')',
      priceLabel: isBuy ? 'Cours d’achat' : 'Cours de vente',
      priceLine: '1 ' + s.asset + ' = ' + fx(price),
      tradeFee: 'Inclus dans le cours (' + pctS(isBuy ? CX.spreadBuy : CX.spreadSell) + ')',
      isSell: tmode === 'sell', isCashPayout: isCash, payout: payout,
      payouts: [{ key: 'wallet', label: 'Mon solde F CFA' }].concat(OPS.map(function (o) { return { key: o, label: o }; })).map(function (p) {
        return { label: p.label, on: payout === p.key, pick: function () { set({ payout: p.key }); }, style: chip(payout === p.key) };
      }),
      payPhone: s.payPhone || userDigits, onPayPhone: function (e) { set({ payPhone: e.target.value }); },
      cashFeeLabel: 'Frais de retrait (' + pctS(srv.fees.withdraw || 1) + ')',
      cashFee: amt > 0 ? fx(amt * WFEE) : '—',
      receive: amt > 0 ? (isBuy ? '≈ ' + fc(gotCrypto, s.asset) : (s.sellAll ? '≈ ' : '') + fx(gotXof)) : '—',
      quoteNote: 'Prix garanti ' + QSEC + ' s après validation · cours ' + (CX.src || 'Binance') + ' en direct.',
      tErr: tErr, hasTErr: !!tErr,
      tradeBlocked: !tradeOk, tradeBtn: cta(tradeOk),
      tradeCta: isBuy ? 'Acheter ' + s.asset : (isCash ? 'Vendre et envoyer sur ' + payout : 'Vendre ' + s.asset),
      confirmTrade: confirmTrade,
      convFrom: assetChip(CRYPTOS, cFrom, function (a) { set({ cFrom: a, cTo: a === cTo ? cFrom : cTo, cAmount: '' }); }),
      convTo: assetChip(CRYPTOS.filter(function (a) { return a !== cFrom; }), cTo, function (a) { set({ cTo: a }); }),
      cFrom: cFrom, cTo: cTo, cAmount: s.cAmount || '',
      onCAmount: function (e) { set({ cAmount: e.target.value }); },
      cAvail: fc(bal[cFrom], cFrom),
      cMax: function () { set({ cAmount: fq(bal[cFrom], cFrom) }); },
      cFlip: function () { set({ cFrom: cTo, cTo: cFrom, cAmount: '' }); },
      cOut: cAmt > 0 ? '≈ ' + fc(cOutN, cTo) : '—',
      cRateLine: '1 ' + cFrom + ' ≈ ' + fc(cRate, cTo),
      cFeeLine: pctS(CX.convertFee) + ' (inclus)',
      cErr: cErr, hasCErr: !!cErr,
      swapBlocked: !swapOk, swapBtn: cta(swapOk),
      swapCta: 'Convertir ' + cFrom + ' → ' + cTo,
      confirmConv: confirmConv,

      wName: N[wA], wSym: wA,
      wBadge: 'width: 52px; height: 52px; border-radius: 26px; display: flex; align-items: center; justify-content: center; color: #FFFFFF; font-size: 12px; font-weight: 700; background: ' + C[wA],
      wBal: fc(bal[wA], wA), wVal: '≈ ' + fx(bal[wA] * CX.prices[wA].mid),
      wBuy: fx(CX.prices[wA].buy), wSell: fx(CX.prices[wA].sell),
      wSrcLine: 'Prix pour 1 ' + wA + ' · cours ' + (CX.src || 'Binance') + (CX.mode === 'sim' ? ' · mode test' : ''),
      wGoBuy: go('trade', { mode: 'buy', asset: wA, amount: '', sellAll: false }),
      wGoSell: go('trade', { mode: 'sell', asset: wA, amount: '', sellAll: false }),
      wGoConv: go('trade', { mode: 'convert', cFrom: wA, cAmount: '' }),
      wGoSend: go('send', { xDest: 'user', xAsset: wA, xAmount: '', recipient: '' }),
      wToggleRecv: function () { set({ wRecv: !s.wRecv }); },
      wRecv: !!s.wRecv, wNeedKyc: !kycOk, wKycOk: kycOk,
      wNetMulti: wNets.length > 1, wNetName: wNet.name,
      wNetChips: wNets.map(function (n) { return { label: n.name, pick: function () { set({ wNet: n.id }); }, style: chip(n.id === wNet.id) }; }),
      wNoAddr: !wAddrTxt, wHasAddr: !!wAddrTxt, wAddr: wAddrTxt,
      wAddrErr: wAd && wAd.error ? wAd.error : '', hasWAddrErr: !!(wAd && wAd.error),
      wLoadAddr: loadAddr,
      wCopy: function () { if (navigator.clipboard) navigator.clipboard.writeText(wAddrTxt).then(function () { set({ copied: addrKey }); }, function () {}); },
      wCopyLabel: s.copied === addrKey ? 'Adresse copiée ✓' : 'Copier l’adresse',
      wQrPath: wQr.path, wQrView: '0 0 ' + wQr.n + ' ' + wQr.n, wQrN: wQr.n,
      wNetWarn: 'Envoyez uniquement du ' + wA + ' via le réseau ' + wNet.name + '. Un autre actif ou un autre réseau serait définitivement perdu.',
      wMinLine: 'Dépôt minimum ' + fc(wNet.min, wA) + ' · crédité après confirmation du réseau (' + wNet.eta + ').',
      wSimAddr: !!(wAd && wAd.sim),
      wSimDep: simDeposit, wSimDepLabel: 'Simuler la réception de ' + fc(SIMDEP[wA], wA),
      wHist: hist.filter(function (h) { return h.asset === wA; }).slice(0, 8).map(function (h) { return { t: h.t, d: h.d, a: h.a, style: 'font-weight: 700; font-size: 14px; color: ' + (h.pos ? '#13894A' : '#15171C') }; }),
      wNoHist: !hist.some(function (h) { return h.asset === wA; }),

      dTitle: isIn ? 'Déposer des F CFA' : 'Retirer des F CFA',
      setIn: function () { set({ dir: 'in' }); },
      setOut: function () { set({ dir: 'out', method: method === 'Carte bancaire' ? OPS[0] : method }); },
      inTab: tab(isIn), outTab: tab(!isIn),
      methodLabel: isIn ? 'Depuis' : 'Vers',
      methods: methods, method: method, needPhone: needPhone, isCardDep: isIn && method === 'Carte bancaire',
      phone: s.phone || userDigits, onPhone: function (e) { set({ phone: e.target.value }); },
      dAmount: s.dAmount, onDAmount: function (e) { set({ dAmount: e.target.value }); },
      dFee: isIn ? 'Gratuit' : (dAmt > 0 ? fx(dFeeN) + ' (' + (srv.fees.withdraw || 1) + ' %)' : (srv.fees.withdraw || 1) + ' %'),
      dNetLabel: isIn ? 'Crédité sur votre solde' : 'Vous recevez',
      dNet: dAmt > 0 ? fx(isIn ? dAmt : dAmt - dFeeN) : '—',
      dErr: dErr, hasDErr: !!dErr,
      depBlocked: !depOk, depBtn: cta(depOk),
      dCta: isIn ? (method === 'Carte bancaire' ? 'Continuer vers le paiement sécurisé' : 'Déposer') : 'Retirer',
      confirmDeposit: confirmDeposit,

      sendChips: sendChips,
      destIsUser: xDest === 'user', destIsMomo: xDest === 'momo',
      destUserTab: tab(xDest === 'user'), destMomoTab: tab(xDest === 'momo'),
      setDestUser: function () { set({ xDest: 'user' }); },
      setDestMomo: function () { set({ xDest: 'momo', xAsset: CUR }); },
      zoneName: ctry.zone, xCountries: xCountries, xCountryName: rc.name, xOps: xOps, xDial: rc.dial,
      recLabel: xDest === 'momo' ? 'Numéro mobile money du destinataire' : (xa === CUR ? 'Numéro du destinataire' : 'Numéro d’un utilisateur ou adresse ' + xa),
      recPlaceholder: xa === CUR ? rc.ph : rc.ph + ' ou adresse',
      recHint: recOk && !isAddr ? '→ ' + recWho + ' · ' + pr.c.name : (recOk ? '→ adresse ' + xa + (xNet ? ' · réseau ' + xNet.name : '') : 'Numéro ' + rc.name + ' : ' + lenText(rc)),
      xShowNet: isAddr && xNets.length > 0,
      xNetChips: xNets.map(function (n) { return { label: n.name, pick: function () { set({ xNet: n.id }); }, style: chip(xNet && n.id === xNet.id) }; }),
      xNetHint: xNet ? 'Vérifiez que l’adresse est bien sur ' + xNet.name + ' · délai habituel ' + xNet.eta + ' · minimum ' + fc(xNet.min, xa) : '',
      recHintStyle: 'font-size: 12px; ' + (recOk ? 'color: #13894A; font-weight: 600' : 'color: #5A5E66'),
      recipient: s.recipient, onRecipient: function (e) { set({ recipient: e.target.value }); },
      xAmtLabel: 'Montant à envoyer (' + (xa === CUR ? 'F CFA' : xa) + ')',
      xAmount: s.xAmount, onXAmount: function (e) { set({ xAmount: e.target.value }); },
      xAvailable: fmtX(bal[xa]),
      xEquiv: (xa !== CUR && xAmt > 0) ? '· envoi ≈ ' + fx(xAmt * P[xa]) : '',
      xFeeLabel: xDest === 'momo' ? 'Frais (' + Math.round(feeRate * 100) + ' %' + (rc.code === ctry.code ? '' : ', autre pays') + ')' : (isAddr && xNet ? 'Frais réseau (' + xNet.name + ')' : 'Frais'),
      xFee: xDest === 'momo' ? (xAmt > 0 ? fx(xFeeN) : '—') : (isAddr && xNet ? fc(xNet.fee, xa) : (xa === CUR ? 'Gratuit' : 'Gratuit entre abonnés e-Wari')),
      xReceives: xAmt > 0 ? fmtX(xAmt) : '—',
      xDebit: xAmt > 0 ? fmtX(xDebitN) : '—',
      xErr: xErr, hasXErr: !!xErr,
      sendBlocked: !sendOk, sendBtn: cta(sendOk),
      confirmSend: confirmSend,

      hist: hist.map(cxView),
      noHist: hist.length === 0,

      doneTitle: last.title, doneText: last.text,
      doneCx: !!doneH, doneCxNote: doneH ? doneH.cxNote : '', doneCxLabel: doneH ? doneH.cxLabel : '', doneCxStyle: doneH ? doneH.cxStyle : '', doneCxAct: function () { if (doneH) doneH.act(); }
    };
  }
}
