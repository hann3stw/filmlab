> **Moved:** FilmLab now lives at https://filmlab-app.github.io/ — repository [filmlab-app/filmlab-app.github.io](https://github.com/filmlab-app/filmlab-app.github.io). This repository is no longer maintained.

# FilmLab

A Progressive Web App for Fujifilm cameras (built for the X-T30 III) that runs in
Chrome on Android. RAW files are converted **inside the camera** over WebUSB —
the same principle as Fujifilm X RAW Studio — and film recipes can be managed
and loaded onto the camera's custom slots.

**Status: complete — Phases 0–3 (connection, editor, library, recipes, camera slots), installable as an offline PWA.**

## Project structure

```
src/
├── main.ts                 app entry: routes, camera service, service worker
├── diagnostics.ts          entry of diagnostics.html (Phase 0 test page)
├── app/                    shell (bottom nav + router), shared components
├── views/                  screens: home, library, recipes, camera, editor
├── camera/
│   ├── camera-service.ts   the one shared camera connection (auto-reconnect)
│   ├── ptp/  profile/  util/   ← ported from FilmKit (MIT)
├── recipes/recipe.ts       Recipe model, X-T30 III value tables, EXIF → recipe,
│                           recipe → camera profile patch
├── raw/raf.ts              RAF header + EXIF/MakerNote reader
├── library/photos.ts       import, thumbnails, results (OPFS + IndexedDB)
├── storage/                OPFS + IndexedDB helpers
├── i18n/                   German / English texts
└── ui/                     DOM helpers, icons, debug log
sw/sw.template.js           service worker (offline) — filled in at build time
```

## Credits & license

The camera communication (`src/camera/`) is based on
[FilmKit](https://github.com/eggricesoy/filmkit) by eggricesoy, MIT License —
see [`LICENSE-FilmKit`](LICENSE-FilmKit). Changes are marked with `FilmLab:` comments.

## Develop

```bash
npm install
npm run dev        # local dev server (WebUSB works on localhost)
npm run build      # type-check + production build into dist/
npm run icons      # re-render PNG icons from public/icons/*.svg
```

## Install on your phone (no APK needed)

1. Open the site in **Chrome on Android** (with internet).
2. Home screen of FilmLab → **Install FilmLab** (or Chrome menu ⋮ → *Install app*).
3. FilmLab now has its own icon, runs full screen and works **offline** — the
   service worker stores the whole app on the phone, and WebUSB works inside
   the installed app.

Good to know: updates arrive the next time you open the app while online.
Photos and recipes live in Chrome's storage for this site — "clear site data"
deletes them, so save important renders to the gallery and export recipes.
(An Android APK via Trusted Web Activity was planned as Phase 4 but dropped:
the installed PWA does the same without a signing key.)

## Deploy (GitHub Pages)

1. GitHub → repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push. The workflow `.github/workflows/deploy.yml` builds and publishes.
3. The site appears at `https://<user>.github.io/filmlab/` (HTTPS — needed for WebUSB).

## How it works

See [docs/how-it-works.md](docs/how-it-works.md).
