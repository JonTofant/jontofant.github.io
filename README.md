# jontofant.github.io

Personal/academic site of Jon Tofant — PhD researcher in Automation & Robotics
at FERI, University of Maribor. Hybrid RL + classical control for wheeled-biped
robots.

Plain HTML, CSS and JavaScript. No framework, no build step, no dependencies.
Deployed via GitHub Pages from `main`.

## Structure

```
index.html        — the whole site (single page)
css/style.css     — all styling
js/pendulum.js    — hero simulation: cart-pole + full-state feedback (240 Hz)
js/watering.js    — playground simulation: soil-moisture PID loop
js/main.js        — nav toggle, footer year
assets/img/       — photos & renders
```

## Editing

Everything is hand-editable. To add a publication, edit the `#publications`
list in `index.html`. Simulation physics and default gains live at the top of
the respective `js/*.js` files.

To preview locally, serve the folder with any static server, e.g.:

```
python -m http.server 8000
```
