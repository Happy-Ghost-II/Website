# Happy Ghost II — Website

A full-viewport Three.js experience. The entire UI is rendered in 3D — 
panel frames, screens, buttons, all modeled in Blender and lit in Three.js.

## Stack

- **Three.js** — 3D rendering, lighting, model loading
- **Vite** — dev server + build tool
- **GitHub Pages** — hosting via CI/CD on push to `main`
- **Porkbun** — domain (happyghostii.com)

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build    # outputs to dist/
npm run preview  # preview the build locally
```

## Project Structure

```
src/
  index.html     — entry point (minimal, just a canvas)
  style.css      — base styles (full viewport, no scroll)
  main.js        — Three.js scene setup, render loop

public/
  models/        — GLB/GLTF from Blender (panel frames, screens, etc.)
  textures/      — texture maps, normal maps, bump maps
  audio/         — music tracks for the player
  CNAME          — custom domain config for GitHub Pages
```

## Deployment

Push to `main` → GitHub Actions builds → deploys to GitHub Pages.

Custom domain configured via CNAME + Porkbun DNS.
