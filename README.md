# Start Player

Who starts the board game? Everyone puts a finger on the screen and plays a mini game that lasts a few seconds.

**Quick Draw:** hold until the screen shouts NOW!, then lift fast. Fast reactions improve your odds a little, lifting too early lowers them, and a weighted random draw picks the winner.

- Plain HTML + JS + canvas, no build step, no dependencies.
- PWA: installable, works offline, keeps the screen awake, fullscreen when installed.
- Supports as many fingers as the device reports (about 10 on most Android phones).

## Run locally

```sh
python3 -m http.server 8000
```

Open http://localhost:8000. Multi-touch needs a real phone; use Chrome remote debugging or deploy to GitHub Pages.

## Deploy

GitHub Pages: Settings → Pages → Deploy from a branch → `main` / root.

When you change assets, bump `CACHE` in `sw.js` so installed copies refresh.
