/* ============================================================
   plant_pid.sim — soil-moisture control with a real PID loop
   1 real second = 1 simulated minute; a full day passes in 24 s.
   The pump duty cycle is the PID output, clamped to [0, 1],
   with clamping anti-windup on the integrator.
   ============================================================ */
(function () {
  "use strict";

  var canvas = document.getElementById("watering-canvas");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");

  /* ---------------- process parameters ---------------- */
  var SPEED = 1;            // sim-minutes per real second
  var DAY_LEN = 24;         // sim-minutes per day
  var PUMP_MAX = 3.0;       // max inflow [%/min]
  var LOSS_BASE = 0.5;      // evaporation at night [%/min]
  var LOSS_SUN = 1.7;       // extra loss at full sun [%/min]

  /* ---------------- state ---------------- */
  var M = 45;               // soil moisture [%]
  var t = 6;                // sim time [min] — start at sunrise
  var pid = { kp: 0.06, ki: 0.010, kd: 0.10, sp: 55, integ: 0, prevM: M, dMf: 0 };
  var duty = 0;
  var heatUntil = -1;
  var paused = false;
  var visible = true;
  var droplets = [];
  var vigor = 1;            // smoothed plant health for drawing

  var TRACE_N = 360;
  var trM = new Array(TRACE_N).fill(M);
  var trSP = new Array(TRACE_N).fill(pid.sp);
  var trU = new Array(TRACE_N).fill(0);
  var trI = 0;

  function dayPhase() { return (t % DAY_LEN) / DAY_LEN; }          // 0..1
  function sunFactor() {
    var p = dayPhase();
    return p < 0.5 ? Math.pow(Math.sin(Math.PI * p * 2), 1.2) : 0; // day = first half
  }
  function lossRate() {
    var loss = LOSS_BASE + LOSS_SUN * sunFactor();
    if (t < heatUntil) loss *= 2.3;
    return loss;
  }

  /* ---------------- PID (dt in sim-minutes) ---------------- */
  function pidStep(dt) {
    var err = pid.sp - M;
    var P = pid.kp * err;

    // derivative on measurement, first-order filtered
    var dM = (M - pid.prevM) / dt;
    pid.prevM = M;
    pid.dMf += (dM - pid.dMf) * Math.min(1, dt / 0.15);
    var D = -pid.kd * pid.dMf;

    var unsat = P + pid.ki * pid.integ + D;
    // clamping anti-windup: only integrate if not pushing further into saturation
    var saturated = (unsat >= 1 && err > 0) || (unsat <= 0 && err < 0);
    if (!saturated) pid.integ += err * dt;
    var I = pid.ki * pid.integ;

    return Math.max(0, Math.min(1, P + I + D));
  }

  function step(dt) {
    duty = pidStep(dt);
    M += (duty * PUMP_MAX - lossRate()) * dt;
    M = Math.max(0, Math.min(100, M));
    t += dt;

    // plant "health" target for drawing
    var target;
    if (M < 18) target = 0.05;
    else if (M < 35) target = (M - 18) / 17;
    else if (M <= 75) target = 1;
    else if (M <= 88) target = 1 - (M - 75) / 13 * 0.5;
    else target = 0.35;
    vigor += (target - vigor) * Math.min(1, dt * 0.8);
  }

  function reset() {
    M = 45; t = 6; duty = 0; heatUntil = -1;
    pid.integ = 0; pid.prevM = M; pid.dMf = 0;
    droplets.length = 0;
    vigor = 1;
    for (var i = 0; i < TRACE_N; i++) { trM[i] = M; trSP[i] = pid.sp; trU[i] = 0; }
  }

  /* ---------------- UI ---------------- */
  function bind(id, key, fmt) {
    var el = document.getElementById(id);
    var out = document.getElementById(id + "-out");
    el.addEventListener("input", function () {
      pid[key] = parseFloat(el.value);
      out.textContent = fmt(pid[key]);
    });
  }
  bind("wsp", "sp", function (v) { return v.toFixed(0) + "%"; });
  bind("wkp", "kp", function (v) { return v.toFixed(3); });
  bind("wki", "ki", function (v) { return v.toFixed(3); });
  bind("wkd", "kd", function (v) { return v.toFixed(2); });

  document.getElementById("heatwave").addEventListener("click", function () {
    heatUntil = t + 10;
  });
  document.getElementById("rain").addEventListener("click", function () {
    M = Math.min(100, M + 18);
  });
  document.getElementById("watering-reset").addEventListener("click", reset);

  var pauseBtn = document.getElementById("watering-pause");
  pauseBtn.addEventListener("click", function () {
    paused = !paused;
    pauseBtn.textContent = paused ? "run" : "pause";
    pauseBtn.setAttribute("aria-pressed", String(paused));
  });

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

  var HUD_H = 84;

  var C = {
    text: "#8b96a5",
    bright: "#dbe2ea",
    accent: "#f6a821",
    green: "#5fd68b",
    blue: "#62aef5",
    red: "#f06a5f",
    grid: "rgba(139,150,165,0.10)",
    gridSoft: "rgba(139,150,165,0.05)"
  };

  function lerp(a, b, k) { return a + (b - a) * k; }
  function lerpColor(c1, c2, k) {
    return "rgb(" + Math.round(lerp(c1[0], c2[0], k)) + "," +
                    Math.round(lerp(c1[1], c2[1], k)) + "," +
                    Math.round(lerp(c1[2], c2[2], k)) + ")";
  }

  function statusText() {
    if (M < 18) return ["wilting :(", C.red];
    if (M < 35) return ["thirsty", C.accent];
    if (M <= 75) return ["happy", C.green];
    if (M <= 88) return ["soggy", C.accent];
    return ["drowning!", C.red];
  }

  function draw() {
    var sun = sunFactor();
    var sceneH = Hpx - HUD_H;

    /* sky — brightens with the sun */
    var bg = ctx.createLinearGradient(0, 0, 0, sceneH);
    bg.addColorStop(0, lerpColor([13, 17, 23], [26, 34, 46], sun));
    bg.addColorStop(1, "#0d1117");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, Hpx);

    /* sun / moon on an arc */
    var p = dayPhase();
    var arcX = W * 0.5, arcR = Math.min(W * 0.38, sceneH * 0.85);
    var ang = Math.PI * (p < 0.5 ? p * 2 : (p - 0.5) * 2);   // 0..π across the sky
    var bx = arcX - Math.cos(ang) * arcR;
    var by = sceneH * 0.92 - Math.sin(ang) * arcR * 0.75;
    if (p < 0.5) {
      var heat = t < heatUntil;
      ctx.fillStyle = heat ? C.red : C.accent;
      ctx.beginPath(); ctx.arc(bx, by, heat ? 13 : 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = heat ? "rgba(240,106,95,0.5)" : "rgba(246,168,33,0.4)";
      ctx.lineWidth = 1.5;
      for (var r = 0; r < 8; r++) {
        var ra = r * Math.PI / 4 + t * 0.05;
        ctx.beginPath();
        ctx.moveTo(bx + Math.cos(ra) * 15, by + Math.sin(ra) * 15);
        ctx.lineTo(bx + Math.cos(ra) * 21, by + Math.sin(ra) * 21);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = "#aeb9c8";
      ctx.beginPath(); ctx.arc(bx, by, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#141a23";
      ctx.beginPath(); ctx.arc(bx + 4, by - 3, 7, 0, Math.PI * 2); ctx.fill();
    }

    /* ground line */
    var gy = sceneH - 18;
    ctx.strokeStyle = C.grid;
    ctx.beginPath(); ctx.moveTo(0, gy + 0.5); ctx.lineTo(W, gy + 0.5); ctx.stroke();

    /* ---------------- pot & soil ---------------- */
    var potW = Math.min(W * 0.22, 150), potH = potW * 0.62;
    var potX = W * 0.34, potY = gy - potH;   // pot center-x, top-y
    ctx.fillStyle = "#3a2d24";
    ctx.beginPath();
    ctx.moveTo(potX - potW / 2, potY);
    ctx.lineTo(potX + potW / 2, potY);
    ctx.lineTo(potX + potW * 0.38, potY + potH);
    ctx.lineTo(potX - potW * 0.38, potY + potH);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#57443a";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    /* soil — darker when wetter */
    var wet = M / 100;
    ctx.fillStyle = lerpColor([120, 92, 60], [42, 30, 20], wet);
    ctx.beginPath();
    ctx.moveTo(potX - potW / 2 + 5, potY + 4);
    ctx.lineTo(potX + potW / 2 - 5, potY + 4);
    ctx.lineTo(potX + potW / 2 - 9, potY + 16);
    ctx.lineTo(potX - potW / 2 + 9, potY + 16);
    ctx.closePath();
    ctx.fill();
    /* puddle when drowning */
    if (M > 88) {
      ctx.fillStyle = "rgba(98,174,245,0.35)";
      ctx.beginPath();
      ctx.ellipse(potX, potY + 5, potW * 0.42, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(potX + potW * 0.55, gy - 3, potW * 0.28, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    /* ---------------- plant ---------------- */
    var droop = 1 - vigor;                 // 0 = upright, 1 = fully wilted
    var stemH = potH * 1.9 * (0.55 + 0.45 * vigor);
    var sway = Math.sin(t * 0.7) * 2 * vigor;
    var tipX = potX + sway + droop * 26;
    var tipY = potY + 4 - stemH;
    var green = lerpColor([70, 130, 70], [95, 214, 139], vigor);
    if (M < 18) green = lerpColor([139, 106, 60], [70, 130, 70], M / 18);

    ctx.strokeStyle = green;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(potX, potY + 8);
    ctx.quadraticCurveTo(potX + droop * 14, potY - stemH * 0.5, tipX, tipY);
    ctx.stroke();

    /* leaves along the stem */
    ctx.fillStyle = green;
    for (var li = 0; li < 4; li++) {
      var f = 0.3 + li * 0.2;                       // fraction along stem
      var lx = lerp(potX, tipX, f * f);
      var ly = lerp(potY + 8, tipY, f);
      var side = (li % 2 === 0) ? -1 : 1;
      var leafAng = side * (0.9 - 0.5 * droop) + droop * 1.1;
      var leafLen = potW * 0.30 * (0.7 + 0.3 * vigor);
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(leafAng * side < 0 ? -leafAng : leafAng);
      ctx.rotate(side === -1 ? Math.PI - leafAng * 2 : 0);
      ctx.beginPath();
      ctx.ellipse(leafLen / 2, 0, leafLen / 2, leafLen * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    /* flower at the tip when thriving */
    if (vigor > 0.85) {
      ctx.fillStyle = C.accent;
      ctx.beginPath(); ctx.arc(tipX, tipY, 4.5, 0, Math.PI * 2); ctx.fill();
    }

    /* ---------------- pump, pipe, droplets ---------------- */
    var pumpX = W * 0.68, pumpW = Math.min(W * 0.13, 90), pumpH = 46;
    var pumpY = gy - pumpH;
    ctx.fillStyle = "#2a323d";
    ctx.strokeStyle = "#39424f";
    ctx.lineWidth = 1.5;
    ctx.fillRect(pumpX, pumpY, pumpW, pumpH);
    ctx.strokeRect(pumpX, pumpY, pumpW, pumpH);
    ctx.fillStyle = C.text;
    ctx.font = "10px ui-monospace, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText("PUMP", pumpX + pumpW / 2, pumpY + pumpH - 8);
    /* duty gauge on the pump */
    ctx.fillStyle = "rgba(98,174,245,0.25)";
    ctx.fillRect(pumpX + 6, pumpY + 6, pumpW - 12, 8);
    ctx.fillStyle = C.blue;
    ctx.fillRect(pumpX + 6, pumpY + 6, (pumpW - 12) * duty, 8);
    /* pipe from pump over the pot */
    var pipeY = Math.max(26, potY - stemH - 26);
    var nozX = potX + potW * 0.1;
    ctx.strokeStyle = "#4a5563";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(pumpX + pumpW / 2, pumpY);
    ctx.lineTo(pumpX + pumpW / 2, pipeY);
    ctx.lineTo(nozX, pipeY);
    ctx.lineTo(nozX, pipeY + 8);
    ctx.stroke();

    /* droplets */
    if (duty > 0.04 && !paused) {
      if (Math.random() < duty * 0.9) {
        droplets.push({ x: nozX + (Math.random() - 0.5) * 4, y: pipeY + 10, vy: 30 });
      }
    }
    ctx.fillStyle = C.blue;
    for (var d = droplets.length - 1; d >= 0; d--) {
      var dp = droplets[d];
      dp.vy += 220 / 60;
      dp.y += dp.vy / 60;
      if (dp.y >= potY + 2) { droplets.splice(d, 1); continue; }
      ctx.beginPath();
      ctx.arc(dp.x, dp.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    /* ---------------- readouts ---------------- */
    ctx.font = "11px ui-monospace, Consolas, monospace";
    ctx.textAlign = "right";
    ctx.fillStyle = C.text;
    ctx.fillText("moisture " + M.toFixed(1) + "%", W - 14, 22);
    ctx.fillText("pump duty " + (duty * 100).toFixed(0) + "%", W - 14, 38);
    ctx.fillText("loss " + lossRate().toFixed(2) + "%/min", W - 14, 54);
    ctx.textAlign = "left";
    var st = statusText();
    ctx.fillStyle = st[1];
    ctx.fillText("plant: " + st[0], 14, 22);
    ctx.fillStyle = C.text;
    ctx.fillText(p < 0.5 ? "☀ day" : "☾ night", 14, 38);
    if (t < heatUntil) {
      ctx.fillStyle = C.red;
      ctx.fillText("HEAT WAVE", 14, 54);
    }

    drawChart();
  }

  function drawChart() {
    var top = Hpx - HUD_H;
    ctx.fillStyle = "rgba(9,12,16,0.72)";
    ctx.fillRect(0, top, W, HUD_H);
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, top + 0.5); ctx.lineTo(W, top + 0.5); ctx.stroke();

    var pad = 10;
    var y0 = top + HUD_H - pad, y1 = top + pad;
    function yOf(val) { return y0 - (val / 100) * (y0 - y1); }

    /* setpoint (dashed) */
    ctx.strokeStyle = "rgba(246,168,33,0.55)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i < TRACE_N; i++) {
      var idx = (trI + i) % TRACE_N;
      var vx = i / (TRACE_N - 1) * W;
      var vy = yOf(trSP[idx]);
      if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    /* pump duty (0..1 → 0..100 scale) */
    ctx.strokeStyle = "rgba(98,174,245,0.8)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (i = 0; i < TRACE_N; i++) {
      idx = (trI + i) % TRACE_N;
      vx = i / (TRACE_N - 1) * W;
      vy = yOf(trU[idx] * 100);
      if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
    }
    ctx.stroke();

    /* moisture */
    ctx.strokeStyle = C.green;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (i = 0; i < TRACE_N; i++) {
      idx = (trI + i) % TRACE_N;
      vx = i / (TRACE_N - 1) * W;
      vy = yOf(trM[idx]);
      if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
    }
    ctx.stroke();

    ctx.font = "10px ui-monospace, Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = C.green;
    ctx.fillText("moisture", 14, top + 15);
    ctx.fillStyle = C.accent;
    ctx.fillText("setpoint", 76, top + 15);
    ctx.fillStyle = C.blue;
    ctx.fillText("pump duty", 138, top + 15);
  }

  /* ---------------- main loop ---------------- */
  var last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (paused || !visible) return;

    step(dt * SPEED);   // dt in sim-minutes

    trM[trI] = M;
    trSP[trI] = pid.sp;
    trU[trI] = duty;
    trI = (trI + 1) % TRACE_N;

    draw();
  }
  requestAnimationFrame(frame);

  /* console tinkering hook (also used for testing) */
  window.__watering = {
    state: function () { return { M: M, t: t, duty: duty, sp: pid.sp, integ: pid.integ }; },
    step: function (minutes) {
      var dt = 1 / 60;
      for (var i = 0; i < minutes * 60; i++) step(dt);
    },
    reset: reset
  };
})();
