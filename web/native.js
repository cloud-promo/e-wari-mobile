/* e-Wari · pont natif Android / iOS (Capacitor).
   Chargé AVANT logic.js. Il déclare window.EWARI_NATIVE, que la logique de l'application utilise pour :
   - joindre l'API distante (origine publique) ;
   - la biométrie native (empreinte, Face ID) à la place de WebAuthn ;
   - ouvrir la page de paiement par carte dans une fenêtre intégrée, puis revenir dans l'app ;
   - le partage natif, les liens externes, le bouton retour Android et les liens ewari://.
   Hors application native (navigateur), ce fichier ne fait rien. */
(function () {
  var C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  var P = C.Plugins || {};
  var ORIGIN = '__EWARI_API_ORIGIN__'; // remplacé à la compilation (scripts/build-www.mjs)
  var abs = function (u) { return /^https?:\/\//.test(u) ? u : ORIGIN + (u.charAt(0) === '/' ? '' : '/') + u; };
  var comp = function () { return window.EWARI && window.EWARI.comp; };

  /* Biométrie : le téléphone vérifie l'empreinte ou le visage ; le PIN reste toujours possible. */
  var BIO = P.BiometricAuthNative;
  var bioOpts = { reason: 'Confirmez votre identité pour e-Wari', cancelTitle: 'Utiliser le code PIN', androidTitle: 'e-Wari', androidSubtitle: 'Empreinte ou visage', iosFallbackTitle: '', allowDeviceCredential: false };
  var bioMsg = function (e) { var c = e && e.code; return c === 'userCancel' || c === 'appCancel' || c === 'systemCancel' ? 'Biométrie annulée. Utilisez le code PIN.' : c === 'biometryLockout' ? 'Trop d’essais : la biométrie est bloquée. Utilisez le code PIN.' : 'Empreinte ou visage non reconnu. Utilisez le code PIN.'; };
  function bioAvailable() {
    if (!BIO) return Promise.resolve(false);
    return BIO.checkBiometry().then(function (r) { return !!(r && r.isAvailable); }, function () { return false; });
  }
  function bioEnable(done) {
    bioAvailable().then(function (ok) {
      if (!ok) { done('Aucune empreinte ni visage n’est enregistré sur ce téléphone. Activez-les dans les réglages du téléphone.'); return; }
      BIO.internalAuthenticate(bioOpts).then(function () { try { localStorage.setItem('ewari_bio', 'natif'); } catch (e) {} done(''); }, function () { done('Biométrie non activée (annulée ou non reconnue).'); });
    });
  }
  function bioCheck(done) {
    bioAvailable().then(function (ok) {
      if (!ok) { done('La biométrie n’est plus disponible sur ce téléphone. Utilisez le code PIN.'); return; }
      BIO.internalAuthenticate(bioOpts).then(function () { done(''); }, function (e) { done(bioMsg(e)); });
    });
  }

  /* Paiement par carte : page sécurisée ouverte dans une fenêtre intégrée.
     Quand le prestataire renvoie vers « /app#carte=<id> », la fenêtre se ferme et l'app affiche le résultat. */
  var IAB = P.InAppBrowser;
  function openCard(url, back) {
    var m = /\/paiement\/carte\/([^/?#]+)/.exec(url), cid = m ? decodeURIComponent(m[1]) : '', fired = false, hs = [];
    var finish = function () {
      if (fired) return; fired = true;
      hs.forEach(function (h) { try { h.remove(); } catch (e) {} });
      back(cid);
    };
    if (!IAB) { if (P.Browser) { P.Browser.addListener('browserFinished', finish).then(function (h) { hs.push(h); }); P.Browser.open({ url: abs(url), presentationStyle: 'fullscreen' }); } return; }
    IAB.addListener('urlChangeEvent', function (ev) {
      var u = String((ev && ev.url) || '');
      if (/\/app\/?#carte=/.test(u) || /\/app\/?$/.test(u)) { IAB.close().catch(function () {}); finish(); }
    }).then(function (h) { hs.push(h); });
    IAB.addListener('closeEvent', finish).then(function (h) { hs.push(h); });
    IAB.openWebView({ url: abs(url), title: 'Paiement sécurisé', toolbarType: 'compact', toolbarColor: '#15171C', showArrow: true, isPresentAfterPageLoad: true }).catch(function () { finish(); });
  }

  /* Liens externes (quittances, Wave, diaspora…) : navigateur du système. */
  window.open = function (u) {
    if (!u) return null;
    if (P.Browser) P.Browser.open({ url: abs(String(u)) }); return null;
  };
  /* Partage : feuille de partage native (Android n'a pas navigator.share dans une WebView). */
  if (P.Share) navigator.share = function (d) { d = d || {}; return P.Share.share({ title: d.title, text: d.text, url: d.url, dialogTitle: 'Partager' }).then(function () {}); };

  /* Liens ewari:// (QR de paiement, retour de paiement) et liens https://…/app#pay=… */
  function deep(url) {
    var u = String(url || ''), c = comp(); if (!c) return;
    var i = u.indexOf('#'), q = i >= 0 ? u.slice(i + 1) : (u.split('?')[1] || '');
    var o = {}; q.split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) o[p[0]] = decodeURIComponent(p[1] || ''); });
    if (o.carte || o.id && /carte/.test(u)) { c.setState({ busy: false, screen: 'home', cardBack: o.carte || o.id }); return; }
    if (o.p || o.pay) { if (c.state && c.state.token) c.openPayLink(o); else c.setState({ deeplink: o }); }
  }

  /* Bouton retour Android : revient à l'accueil, puis quitte l'app depuis l'accueil. */
  var EXIT = { home: 1, country: 1 };
  // Écrans de sécurité : le retour ne doit jamais contourner le PIN, la biométrie ou la création du PIN.
  var STAY = { loading: 1, lock: 1, pinset: 1, pinconfirm: 1, pinold: 1, bio: 1, bioSet: 1 };
  function onBack() {
    var c = comp(), s = c && c.state || {};
    if (s.busy || STAY[s.screen]) return;
    if (s.screen && !EXIT[s.screen]) { c.stopCam && c.stopCam(); c.setState({ screen: s.token ? 'home' : 'country', srvErr: '' }); return; }
    if (P.App) (P.App.minimizeApp ? P.App.minimizeApp() : Promise.reject()).catch(function () { P.App.exitApp(); });
  }

  if (P.App) {
    P.App.addListener('backButton', onBack);
    P.App.addListener('appUrlOpen', function (e) { deep(e && e.url); });
    P.App.getLaunchUrl().then(function (r) { if (r && r.url) setTimeout(function () { deep(r.url); }, 600); }, function () {});
  }
  if (P.StatusBar) { P.StatusBar.setStyle({ style: 'LIGHT' }).catch(function () {}); }
  document.documentElement.classList.add('natif', 'natif-' + C.getPlatform());
  window.addEventListener('load', function () { if (P.SplashScreen) setTimeout(function () { P.SplashScreen.hide().catch(function () {}); }, 150); });

  window.EWARI_NATIVE = { origin: ORIGIN, platform: C.getPlatform(), bioEnable: bioEnable, bioCheck: bioCheck, openCard: openCard };
})();
