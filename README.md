# FilmLab

A Progressive Web App for Fujifilm cameras (built for the X-T30 III) that runs in
Chrome on Android. RAW files are converted **inside the camera** over WebUSB —
the same principle as Fujifilm X RAW Studio — and film recipes can be managed
and loaded onto the camera's custom slots.

**Status: Phase 3 — recipes (save, edit, share, batch apply) and camera custom slots (read, write + verify, backup, restore).**

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

## Deploy (GitHub Pages)

1. GitHub → repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push. The workflow `.github/workflows/deploy.yml` builds and publishes.
3. The site appears at `https://<user>.github.io/filmlab/` (HTTPS — needed for WebUSB).

## How it works

See [docs/how-it-works.md](docs/how-it-works.md).
