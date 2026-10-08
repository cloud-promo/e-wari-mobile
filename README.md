# e-Wari — application mobile Android et iOS

Ce projet contient uniquement l'application client (la page `/app`). Les autres espaces restent des sites web :

- l'administration ;
- Finance, Customer Care et Onboarding ;
- l'espace partenaires.

Le guide complet est dans **e-Wari_Guide_Applications_Mobiles.docx**.

## Fonctionnement

| Élément | Où il se trouve |
|---|---|
| Écrans et logique de l'app | **Embarqués** dans l'application (`www/`, construit depuis `web/`) |
| Données et opérations | **API distante** (`https://api-pilote.up.railway.app` par défaut) |
| Biométrie | Native : empreinte sur Android, Face ID / Touch ID sur iOS |
| Paiement par carte | Fenêtre sécurisée intégrée, retour automatique dans l'app |
| Liens externes (quittances, Wave…) | Navigateur du téléphone |
| QR codes de paiement | Caméra dans l'app, et liens `ewari://pay?pay=…` |

## Dossiers

| Dossier | Contenu |
|---|---|
| `web/` | Page `/app`, logique et pont natif (`native.js`). C'est la seule partie à modifier. |
| `scripts/build-www.mjs` | Construit `www/` : polices et bibliothèques locales, politique de sécurité (CSP). |
| `scripts/import-web.ts` | Recopie la page et la logique depuis les sources web e-Wari. |
| `android/`, `ios/` | Projets natifs (Capacitor 8). Identifiant : `com.ewari.app`. |
| `.github/workflows/` | Compilations automatiques : `android.yml` et `ios.yml`. |
| `assets/` | Icône et écran de lancement (sources). |

## Commandes

```bash
npm ci
bun scripts/import-web.ts ../sources/app   # après une modification de l'app web
npm run sync                                # construit www/ et met à jour android/ et ios/
EWARI_API_ORIGIN=https://autre-api.exemple npm run sync   # pointer vers une autre API
```

## Secrets GitHub

Les valeurs ne sont jamais écrites dans ce dépôt. Elles se saisissent dans GitHub › Settings › Secrets and variables › Actions.

| Secret | Usage |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Clé de signature Android, encodée en base64 |
| `ANDROID_KEYSTORE_PASSWORD` | Mot de passe de signature Android |
| `ANDROID_KEY_ALIAS` | Alias de la clé Android |
| `ANDROID_KEY_PASSWORD` | Mot de passe de signature Android |
| `APPLE_TEAM_ID` | Team ID Apple |
| `APPSTORE_API_KEY_ID` | Clé API App Store Connect (rôle Admin) |
| `APPSTORE_API_ISSUER_ID` | Clé API App Store Connect (rôle Admin) |
| `APPSTORE_API_KEY_P8_BASE64` | Clé API App Store Connect (rôle Admin), encodée en base64 |
