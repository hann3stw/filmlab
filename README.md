# FilmLab

A Progressive Web App for Fujifilm cameras (built for the X-T30 III) that runs in
Chrome on Android. RAW files are converted **inside the camera** over WebUSB —
the same principle as Fujifilm X RAW Studio — and film recipes can be managed
and loaded onto the camera's custom slots.

**Status: Phase 0.1 — connection check + diagnostics.**

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
