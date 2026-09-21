# jontofant.github.io

Personal/academic site of Jon Tofant — PhD researcher in Automation & Robotics
at FERI, University of Maribor. Hybrid RL + classical control for wheeled-biped
and legged robots.

Plain HTML, CSS and JavaScript. No framework, no build step, no dependencies.
Deployed via GitHub Pages from `main`.

## Structure

```
index.html            — the whole site (single page)
css/style.css         — all styling
js/pendulum.js        — hero simulation: cart-pole + full-state feedback (240 Hz)
js/watering.js        — playground simulation: soil-moisture PID loop
js/main.js            — nav toggle, footer year, lazy video loading
assets/img/           — photos & renders
assets/video/         — 13 clips from the Retzhof 2026 talk (~28 MB)
```

## Theme

Light theme, defined entirely by custom properties in `:root` at the top of
`css/style.css`. Two things to know before changing colours:

- `--accent` (`#a85f00`) is the **text** orange and clears AA contrast on the
  page background. `--accent-bright` (`#f6a821`) is the orange from the robot
  renders — it sits at 1.9:1 on white, so it is for fills, dots and canvas
  marks only, never for text.
- The canvas simulations keep their own palettes (`var C = {...}` near the top
  of each `js/*.js`). The robot itself is drawn dark on purpose — it is an
  object on a light field, not a themed surface.

## Video

The clips are lazy. Each `<video>` ships with `data-src` and no `src`; the
IntersectionObserver in `js/main.js` swaps it in when the clip nears the
viewport and plays it only while it is on screen, so the page does not pull
28 MB on load. Where IntersectionObserver is missing, everything loads eagerly —
slow, but not broken. Under `prefers-reduced-motion` the clips get controls and
do not autoplay.

**Aspect ratios matter here.** Each `<video>` box declares an `aspect-ratio`
that must match its source file, or `object-fit: cover` silently crops:

| clip | source | class |
|---|---|---|
| most clips | 1280×720 (16:9) | *(default)* |
| `slip-test`, `slip-test-slowmo` | 1280×2276 (9:16, shot portrait) | `.clip-portrait` |
| `walker-sim` | 1680×490 | `.clip-ultrawide` |

## Editing

Everything is hand-editable. To add a publication, edit the `#publications`
list in `index.html`. Simulation physics and default gains live at the top of
the respective `js/*.js` files.

To preview locally, serve the folder with any static server, e.g.:

```
python -m http.server 8000
```
