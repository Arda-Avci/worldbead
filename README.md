# WorldBead: Pop the Planets

A 3D bead-shooter built with Three.js: a sphere made of instanced "beads" that
you pop away to reveal the real surface underneath, starting as Earth and
progressing through the Moon, Venus and Mars.

Play on the web: https://arda-avci.github.io/worldbead/

Design reference: [docs/GDD.md](docs/GDD.md)

## Tech stack

- TypeScript + Vite
- Three.js (instanced rendering, postprocessing bloom, procedural space FX)
- Fully procedural WebAudio (no audio files) for SFX and generative music
- Plain DOM + CSS space-glass UI (no framework)
- Real planet textures (Solar System Scope, CC BY 4.0, based on NASA
  imagery) sampled + k-means quantized into bead colors, per `docs/GDD.md` §3
- Capacitor 8 for native Android/iOS packaging
- Installable PWA (`public/manifest.webmanifest` + icons), no service worker

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # type-check + production build to dist/
```

Jump straight to a level in dev or preview by adding `?level=N` to the URL,
e.g. `http://localhost:5173/?level=360` opens the Moon chapter. Add
`&skipIntro=1` to also skip the cinematic intro (QA only).

## Getting a debug APK

Native builds run in GitHub Actions (no local Android SDK required):

1. Push to `main`, open a pull request, or run the **Android Debug Build**
   workflow manually from the Actions tab.
2. Once it finishes, open the workflow run and download the
   `worldbead-debug-apk` artifact.
3. Install the APK on a device or emulator with `adb install`.

## Deploying the web build

Pushing to `main` runs the **Deploy to GitHub Pages** workflow, which builds
and publishes `dist/` automatically. GitHub Pages must be enabled once for
this repo: Settings → Pages → Source: GitHub Actions.

## Chapters

| Chapter | Levels  |
| ------- | ------- |
| Earth   | 1–350   |
| Moon    | 351–400 |
| Venus   | 401–450 |
| Mars    | 451–550 |
