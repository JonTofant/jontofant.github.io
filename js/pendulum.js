/* ============================================================
   wheeled_biped.sim — inverted pendulum on a cart
   Real physics (semi-implicit Euler @ 240 Hz), real full-state
   feedback: u = k1*x + k2*x' + k3*th + k4*th'
   No easing curves pretending to be control.
   ============================================================ */
(function () {
  "use strict";

  var canvas = document.getElementById("pendulum-canvas");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");

  /* ---------------- physics parameters ---------------- */
  var G = 9.81;
  var M_CART = 1.0;      // cart + wheels [kg]
  var M_POLE = 0.35;     // body [kg]
  var L_HALF = 0.45;     // pole half-length [m]
  var U_MAX = 25;        // actuator saturation [N]
  var B_CART = 0.6;      // viscous friction on cart [N·s/m]
  var B_POLE = 0.012;    // pivot friction [N·m·s]
  var H = 1 / 240;       // physics step [s]
  var WHEEL_R = 0.14;    // wheel radius, drawing + rolling [m]

  /* ---------------- state ---------------- */
  var s = { x: 0, v: 0, th: 0.03, w: 0 };
  var gains = { k1: 3.0, k2: 6.0, k3: 55, k4: 12 };
  var mode = "linear";           // "linear" | "rl"
  var u = 0;                     // last control force
  var dist = 0;                  // external (gust) force
  var paused = false;
  var visible = true;
  var crashed = false;
  var crashTimer = 0;
  var falls = 0;
  var pokes = [];                // visual poke markers
  var interacted = false;
  var camX = 0;
  var simTime = 0;

  /* trace buffers (one sample per rendered frame) */
  var TRACE_N = 360;
  var traceTh = new Array(TRACE_N).fill(0);
  var traceU = new Array(TRACE_N).fill(0);
  var traceI = 0;

  function reset(keepFalls) {
    s.x = 0; s.v = 0;
    s.th = (Math.random() - 0.5) * 0.06;
    s.w = 0;
    u = 0; dist = 0;
    crashed = false; crashTimer = 0;
    camX = 0;
    if (!keepFalls) falls = 0;
  }

  /* ---------------- controller ---------------- */
  function control() {
    var raw = gains.k1 * s.x + gains.k2 * s.v + gains.k3 * s.th + gains.k4 * s.w;
    if (mode === "rl") {
      // saturating nonlinear policy: same states, tanh squashing —
      // mimics the saturation-riding character of trained policies.
      return U_MAX * Math.tanh(2.5 * raw / U_MAX);
    }
    return Math.max(-U_MAX, Math.min(U_MAX, raw));
  }

  /* ---------------- dynamics ---------------- */
  function step() {
    if (!crashed) u = control(); else u = 0;

    var F = u + dist - B_CART * s.v;
    var sin = Math.sin(s.th), cos = Math.cos(s.th);
    var Mtot = M_CART + M_POLE;

    var temp = (F + M_POLE * L_HALF * s.w * s.w * sin) / Mtot;
    var thAcc = (G * sin - cos * temp) /
                (L_HALF * (4 / 3 - M_POLE * cos * cos / Mtot));
    thAcc -= B_POLE * s.w / (M_POLE * L_HALF * L_HALF);
    var xAcc = temp - M_POLE * L_HALF * thAcc * cos / Mtot;

    s.v += xAcc * H;
    s.x += s.v * H;
    s.w += thAcc * H;
    s.th += s.w * H;
    simTime += H;

    // decay gust force
    dist *= Math.pow(0.02, H);
    if (Math.abs(dist) < 0.05) dist = 0;

    if (!crashed && (Math.abs(s.th) > 1.15 || Math.abs(s.x) > 60)) {
      crashed = true;
      crashTimer = 0;
      falls++;
    }
    if (crashed) {
      // let it fall until nearly flat, then hold, then reset
      if (Math.abs(s.th) > 1.45) { s.w = 0; s.th = Math.sign(s.th) * 1.45; }
      crashTimer += H;
      if (crashTimer > 1.4) reset(true);
    }
  }

  /* ---------------- disturbances ---------------- */
  function shove(dir) {
    interacted = true;
    if (crashed) return;
    s.w += dir * 1.6;
    s.v += dir * 0.5;
  }

  canvas.addEventListener("pointerdown", function (ev) {
    var rect = canvas.getBoundingClientRect();
    var px = ev.clientX - rect.left;
    var py = ev.clientY - rect.top;
    var cartPx = worldToScreenX(s.x, rect.width);
    var dir = px < cartPx ? 1 : -1;   // poke from the side you click
    shove(dir);
    pokes.push({ x: px, y: py, dir: dir, t: 0 });
  });

  /* ---------------- UI wiring ---------------- */
  function bindSlider(id, key, fmt) {
    var el = document.getElementById(id);
    var out = document.getElementById(id + "-out");
    el.addEventListener("input", function () {
      gains[key] = parseFloat(el.value);
      out.textContent = fmt(gains[key]);
    });
    return el;
  }
  var fmt1 = function (v) { return v.toFixed(1); };
  var fmt0 = function (v) { return v.toFixed(0); };
  var sK1 = bindSlider("k1", "k1", fmt1);
  var sK2 = bindSlider("k2", "k2", fmt1);
  var sK3 = bindSlider("k3", "k3", fmt0);
  var sK4 = bindSlider("k4", "k4", fmt1);

  function setGains(k1, k2, k3, k4) {
    gains.k1 = k1; gains.k2 = k2; gains.k3 = k3; gains.k4 = k4;
    sK1.value = k1; sK2.value = k2; sK3.value = k3; sK4.value = k4;
    document.getElementById("k1-out").textContent = fmt1(k1);
    document.getElementById("k2-out").textContent = fmt1(k2);
    document.getElementById("k3-out").textContent = fmt0(k3);
    document.getElementById("k4-out").textContent = fmt1(k4);
  }

  var presets = {
    tuned:   [3.0, 6.0, 55, 12],
    floppy:  [0.5, 1.5, 22, 3.5],
    nervous: [3.0, 6.0, 110, 4],
    doomed:  [3.0, 6.0, 0, 0]
  };
  document.getElementById("preset").addEventListener("change", function () {
    var p = presets[this.value];
    if (p) setGains(p[0], p[1], p[2], p[3]);
  });

  document.getElementById("shove-left").addEventListener("click", function () { shove(-1); });
  document.getElementById("shove-right").addEventListener("click", function () { shove(1); });
  document.getElementById("pendulum-reset").addEventListener("click", function () { reset(false); });

  var pauseBtn = document.getElementById("pendulum-pause");
  pauseBtn.addEventListener("click", function () {
    paused = !paused;
    pauseBtn.textContent = paused ? "run" : "pause";
    pauseBtn.setAttribute("aria-pressed", String(paused));
  });

  var modeLin = document.getElementById("mode-linear");
  var modeRl = document.getElementById("mode-rl");
  function setMode(m) {
    mode = m;
    modeLin.classList.toggle("is-active", m === "linear");
    modeRl.classList.toggle("is-active", m === "rl");
    modeLin.setAttribute("aria-pressed", String(m === "linear"));
    modeRl.setAttribute("aria-pressed", String(m === "rl"));
  }
  modeLin.addEventListener("click", function () { setMode("linear"); });
  modeRl.addEventListener("click", function () { setMode("rl"); });

  /* pause simulation while off-screen */
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
    }, { threshold: 0.05 }).observe(canvas);
  }

  /* ---------------- rendering ---------------- */
  var W = 0, Hpx = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = canvas.getBoundingClientRect();
    W = rect.width; Hpx = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(Hpx * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  var HUD_H = 76;

  function scalePx() { return Math.min(W / 4.2, (Hpx - HUD_H) / 2.4); }
  function groundY() { return Hpx - HUD_H - 34; }
  function worldToScreenX(wx, width) {
    return (width || W) / 2 + (wx - camX) * scalePx();
  }

  var C = {
    grid: "rgba(139,150,165,0.10)",
    gridSoft: "rgba(139,150,165,0.05)",
    text: "#8b96a5",
    bright: "#dbe2ea",
    accent: "#f6a821",
    blue: "#62aef5",
    red: "#f06a5f",
    body: "#2a323d",
    bodyDark: "#1b212a",
    tire: "#11151b"
  };

  function draw() {
    ctx.clearRect(0, 0, W, Hpx);
    var sc = scalePx();
    var gy = groundY();

    /* backdrop gradient */
    var bg = ctx.createLinearGradient(0, 0, 0, Hpx);
    bg.addColorStop(0, "#141a23");
    bg.addColorStop(1, "#0d1117");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, Hpx);

    /* ground */
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, gy + 0.5);
    ctx.lineTo(W, gy + 0.5);
    ctx.stroke();

    /* ground ticks every 0.5 m, labels every 1 m */
    ctx.font = "10px ui-monospace, Consolas, monospace";
    ctx.textAlign = "center";
    var mLeft = Math.floor((camX - W / 2 / sc) * 2) / 2;
    var mRight = camX + W / 2 / sc;
    for (var m = mLeft; m <= mRight; m += 0.5) {
      var tx = worldToScreenX(m);
      var isMeter = Math.abs(m - Math.round(m)) < 1e-9;
      ctx.strokeStyle = isMeter ? C.grid : C.gridSoft;
      ctx.beginPath();
      ctx.moveTo(tx, gy);
      ctx.lineTo(tx, gy + (isMeter ? 8 : 5));
      ctx.stroke();
      if (isMeter) {
        ctx.fillStyle = C.text;
        ctx.fillText(Math.round(m) + " m", tx, gy + 20);
      }
    }

    /* origin flag (home position) */
    var ox = worldToScreenX(0);
    if (ox > -20 && ox < W + 20) {
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ox, gy);
      ctx.lineTo(ox, gy - 26);
      ctx.stroke();
      ctx.fillStyle = C.accent;
      ctx.beginPath();
      ctx.moveTo(ox, gy - 26);
      ctx.lineTo(ox + 14, gy - 21);
      ctx.lineTo(ox, gy - 16);
      ctx.closePath();
      ctx.fill();
    }

    /* ---------------- robot ---------------- */
    var rw = WHEEL_R * sc;
    var cx = worldToScreenX(s.x);
    var cy = gy - rw;

    /* control force arrow (what the motor is doing) */
    if (Math.abs(u) > 0.4 && !crashed) {
      var alen = (u / U_MAX) * sc * 0.85;
      ctx.strokeStyle = C.blue;
      ctx.fillStyle = C.blue;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + alen, cy);
      ctx.stroke();
      var ah = Math.sign(alen) * 6;
      ctx.beginPath();
      ctx.moveTo(cx + alen + ah, cy);
      ctx.lineTo(cx + alen, cy - 4);
      ctx.lineTo(cx + alen, cy + 4);
      ctx.closePath();
      ctx.fill();
    }

    /* wheel (rolls with x) */
    var phi = s.x / WHEEL_R;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = C.tire;
    ctx.beginPath(); ctx.arc(0, 0, rw, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#39424f";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.rotate(phi);
    ctx.strokeStyle = "#4a5563";
    ctx.lineWidth = 2;
    for (var i = 0; i < 5; i++) {
      ctx.rotate(Math.PI * 2 / 5);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(rw * 0.72, 0);
      ctx.stroke();
    }
    ctx.restore();
    /* hub */
    ctx.fillStyle = C.accent;
    ctx.beginPath(); ctx.arc(cx, cy, rw * 0.22, 0, Math.PI * 2); ctx.fill();

    /* body — pivots at the axle by th */
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(s.th);
    var bodyL = 2 * L_HALF * sc;   // full body length in px
    /* leg */
    ctx.fillStyle = C.bodyDark;
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(4, 0);
    ctx.lineTo(7, -bodyL * 0.55);
    ctx.lineTo(-7, -bodyL * 0.55);
    ctx.closePath();
    ctx.fill();
    /* chassis */
    var chW = bodyL * 0.52, chH = bodyL * 0.42;
    var chY = -bodyL * 0.55 - chH;
    r_rect(-chW / 2, chY, chW, chH, 5);
    ctx.fillStyle = C.body;
    ctx.fill();
    ctx.strokeStyle = "#39424f";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    /* orange panel */
    r_rect(-chW / 2 + 4, chY + 4, chW - 8, chH * 0.32, 3);
    ctx.fillStyle = C.accent;
    ctx.fill();
    /* IMU LED — blinks */
    ctx.fillStyle = (Math.sin(simTime * 8) > 0) ? "#5fd68b" : "#24463a";
    ctx.beginPath();
    ctx.arc(chW / 2 - 9, chY + chH - 9, 3, 0, Math.PI * 2);
    ctx.fill();
    /* little sensor mast */
    ctx.strokeStyle = "#4a5563";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, chY);
    ctx.lineTo(0, chY - 10);
    ctx.stroke();
    ctx.fillStyle = crashed ? C.red : C.bright;
    ctx.beginPath();
    ctx.arc(0, chY - 13, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* poke markers */
    for (var p = pokes.length - 1; p >= 0; p--) {
      var pk = pokes[p];
      pk.t += 1 / 60;
      if (pk.t > 0.45) { pokes.splice(p, 1); continue; }
      var a = 1 - pk.t / 0.45;
      ctx.strokeStyle = "rgba(246,168,33," + (a * 0.9) + ")";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pk.x, pk.y, 6 + pk.t * 70, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* live readout */
    ctx.font = "11px ui-monospace, Consolas, monospace";
    ctx.textAlign = "right";
    ctx.fillStyle = C.text;
    var deg = (s.th * 180 / Math.PI);
    ctx.fillText("θ " + pad(deg.toFixed(1)) + "°", W - 14, 22);
    ctx.fillText("x " + pad(s.x.toFixed(2)) + " m", W - 14, 38);
    ctx.fillText("u " + pad(u.toFixed(1)) + " N", W - 14, 54);
    ctx.textAlign = "left";
    ctx.fillStyle = falls > 0 ? C.red : C.text;
    ctx.fillText("falls: " + falls, 14, 22);
    ctx.fillStyle = C.text;
    ctx.fillText(mode === "rl" ? "policy: tanh-saturating" : "policy: linear state feedback", 14, 38);

    /* crash banner */
    if (crashed) {
      ctx.font = "13px ui-monospace, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = C.red;
      ctx.fillText("— fell over. resetting controller —", W / 2, 74);
    } else if (!interacted) {
      var pulse = 0.55 + 0.35 * Math.sin(simTime * 3);
      ctx.font = "12px ui-monospace, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(246,168,33," + pulse + ")";
      ctx.fillText("click the robot to shove it", W / 2, 74);
    }

    drawTrace();
  }

  function pad(str) { return ("      " + str).slice(-6); }

  function r_rect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawTrace() {
    var top = Hpx - HUD_H;
    ctx.fillStyle = "rgba(9,12,16,0.72)";
    ctx.fillRect(0, top, W, HUD_H);
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, top + 0.5);
    ctx.lineTo(W, top + 0.5);
    ctx.stroke();

    var mid = top + HUD_H / 2;
    ctx.strokeStyle = C.gridSoft;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(W, mid);
    ctx.stroke();

    plotLine(traceTh, 60, C.accent, mid, HUD_H * 0.42);
    plotLine(traceU, U_MAX, C.blue, mid, HUD_H * 0.42);

    ctx.font = "10px ui-monospace, Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = C.accent;
    ctx.fillText("θ [±60°]", 14, top + 14);
    ctx.fillStyle = C.blue;
    ctx.fillText("u [±" + U_MAX + " N]", 80, top + 14);
  }

  function plotLine(buf, range, color, mid, amp) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (var i = 0; i < TRACE_N; i++) {
      var idx = (traceI + i) % TRACE_N;
      var vx = i / (TRACE_N - 1) * W;
      var vy = mid - Math.max(-1, Math.min(1, buf[idx] / range)) * amp;
      if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
    }
    ctx.stroke();
  }

  /* ---------------- main loop ---------------- */
  var last = performance.now();
  var acc = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (paused || !visible) return;

    acc += dt;
    while (acc >= H) {
      step();
      acc -= H;
    }

    /* camera loosely follows the cart */
    camX += (s.x - camX) * 0.06;

    traceTh[traceI] = s.th * 180 / Math.PI;
    traceU[traceI] = u;
    traceI = (traceI + 1) % TRACE_N;

    draw();
  }
  requestAnimationFrame(frame);

  /* console tinkering hook (also used for testing) */
  window.__pendulum = {
    state: function () { return { x: s.x, v: s.v, th: s.th, w: s.w, u: u, falls: falls, crashed: crashed }; },
    step: function (n) { for (var i = 0; i < n; i++) step(); },
    shove: shove,
    reset: reset
  };
})();
