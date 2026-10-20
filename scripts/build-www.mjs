// Construit le dossier www/ embarqué dans l'application Android/iOS à partir de la page web /app.
// Entrées : web/page.html (page /app telle que servie par le service « app »), web/logic.js, web/runtime.js,
//           web/native.js, web/logo.svg. Sortie : www/ (aucune ressource chargée depuis Internet, sauf l'API).
// Variable : EWARI_API_ORIGIN (par défaut https://api-pilote.up.railway.app).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const W = (p) => path.join(ROOT, 'web', p), O = (p) => path.join(ROOT, 'www', p), NM = (p) => path.join(ROOT, 'node_modules', p);
const ORIGIN = (process.env.EWARI_API_ORIGIN || 'https://api-pilote.up.railway.app').replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(ORIGIN) && !/^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/.test(ORIGIN)) throw new Error('EWARI_API_ORIGIN invalide : ' + ORIGIN);

fs.rmSync(O(''), { recursive: true, force: true });
fs.mkdirSync(O('vendor'), { recursive: true });
fs.mkdirSync(O('fonts'), { recursive: true });

// Bibliothèques et polices locales (au lieu de jsdelivr / Google Fonts)
fs.copyFileSync(NM('morphdom/dist/morphdom-umd.min.js'), O('vendor/morphdom.js'));
fs.copyFileSync(NM('qrcode-generator/qrcode.js'), O('vendor/qrcode.js'));
fs.copyFileSync(NM('jsqr/dist/jsQR.js'), O('vendor/jsQR.js'));
const FONTS = [['plus-jakarta-sans', 'Plus Jakarta Sans', [600, 700, 800]], ['space-grotesk', 'Space Grotesk', [500, 700]], ['ibm-plex-sans', 'IBM Plex Sans', [400, 500, 600]]];
let css = '';
for (const [pkg, , ws] of FONTS) for (const w of ws) {
  // Blocs @font-face de fontsource (avec unicode-range), limités aux alphabets latin et latin étendu
  const src = fs.readFileSync(NM(`@fontsource/${pkg}/${w}.css`), 'utf8');
  for (const blk of src.split('/* ').slice(1)) {
    const name = blk.slice(0, blk.indexOf(' */'));
    if (!/-(latin|latin-ext)-\d+-normal$/.test(name)) continue;
    const f = name + '.woff2';
    fs.copyFileSync(NM(`@fontsource/${pkg}/files/${f}`), O('fonts/' + f));
    css += blk.slice(blk.indexOf('@font-face')).replace(/src:[^;]+;/, `src: url(./${f}) format('woff2');`);
  }
}
if ((css.match(/@font-face/g) || []).length !== 16) throw new Error('polices : 16 blocs attendus');
fs.writeFileSync(O('fonts/fonts.css'), css);

fs.copyFileSync(W('logo.svg'), O('logo.svg'));
fs.copyFileSync(W('logic.js'), O('logic.js'));
fs.copyFileSync(W('runtime.js'), O('runtime.js'));
fs.writeFileSync(O('native.js'), fs.readFileSync(W('native.js'), 'utf8').replace('__EWARI_API_ORIGIN__', ORIGIN));

let h = fs.readFileSync(W('page.html'), 'utf8');
const rep = (a, b) => { if (!h.includes(a)) throw new Error('Motif absent de page.html : ' + a.slice(0, 80)); h = h.split(a).join(b); };
const CSP = `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: ${ORIGIN}; media-src 'self' blob: mediastream:; connect-src 'self' ${ORIGIN}; frame-src 'none'; object-src 'none'; base-uri 'self'`;
rep('<link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="icon" href="/icon-192.png" sizes="192x192">', `<meta http-equiv="Content-Security-Policy" content="${CSP}">`);
rep('<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/apple-touch-icon.png">', '');
rep('<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Space+Grotesk:wght@500;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">',
  '<link rel="stylesheet" href="fonts/fonts.css"><script src="native.js"></script>');
rep('src="/logo.svg"', 'src="logo.svg"');
rep('<script src="https://cdn.jsdelivr.net/npm/morphdom@2.7.4/dist/morphdom-umd.min.js"></script>', '<script src="vendor/morphdom.js"></script>');
rep('<script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js"></script>', '<script src="vendor/qrcode.js"></script>');
rep('<script src="/app/logic.js"></script>', '<script src="logic.js"></script>');
// Moteur d'affichage : fichier runtime.js (même code que la page web)
const a = h.indexOf("<script>/* Moteur d'affichage"), b = h.indexOf('</script>', a);
if (a < 0) throw new Error('moteur d’affichage introuvable dans page.html');
h = h.slice(0, a) + '<script src="runtime.js"></script>' + h.slice(b + 9);
// Zones sûres (encoche, barre de navigation) : uniquement dans l'app native
const SAFE = `<style>html.natif body{box-sizing:border-box;padding-top:var(--safe-area-inset-top,env(safe-area-inset-top,0px));padding-bottom:var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px));background:#F3FAF2}
html.natif #app>div{height:calc(100dvh - var(--safe-area-inset-top,env(safe-area-inset-top,0px)) - var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))!important}
html.natif,html.natif body{overscroll-behavior:none;-webkit-user-select:none;user-select:none}html.natif input,html.natif textarea{-webkit-user-select:text;user-select:text}</style></head>`;
rep('</head>', SAFE);
if (/https:\/\/(cdn\.jsdelivr|fonts\.g)/.test(h)) throw new Error('ressource externe restante dans index.html');
fs.writeFileSync(O('index.html'), h);
console.log('www/ prêt — API :', ORIGIN, '—', fs.readdirSync(O('')).join(', '));
