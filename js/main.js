/* small site plumbing: mobile nav + footer year */
(function () {
  "use strict";

  var toggle = document.querySelector(".nav-toggle");
  var links = document.getElementById("nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    links.addEventListener("click", function (ev) {
      if (ev.target.tagName === "A") {
        links.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  /* ---------------------------------------------------------------
     Lazy clips.

     There are 13 mp4s on this page, ~28 MB in total. Loading them all
     up front would be absurd, so each <video> ships with data-src and
     no src at all: the file is only fetched once the clip is close to
     the viewport, and it plays only while it is actually on screen.

     Falls back to loading everything eagerly where IntersectionObserver
     is missing, which is the correct failure direction — slow, not broken.
     --------------------------------------------------------------- */

  var clips = [].slice.call(document.querySelectorAll("video[data-src]"));
  if (!clips.length) return;

  function load(v) {
    if (v.dataset.src) {
      v.src = v.dataset.src;
      delete v.dataset.src;
    }
  }

  function play(v) {
    var p = v.play();
    if (p && p.catch) p.catch(function () { /* autoplay refused; harmless */ });
  }

  if (!("IntersectionObserver" in window)) {
    clips.forEach(function (v) { load(v); play(v); });
    return;
  }

  /* Fetch a little before the clip is visible so it is ready on arrival. */
  var preloader = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      load(e.target);
      preloader.unobserve(e.target);
    });
  }, { rootMargin: "300px 0px" });

  /* Play only what is on screen; pause the rest so we decode one or two
     clips at a time instead of thirteen. */
  var player = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var v = e.target;
      if (e.isIntersecting) { load(v); play(v); }
      else if (!v.paused) v.pause();
    });
  }, { threshold: 0.25 });

  clips.forEach(function (v) {
    preloader.observe(v);
    player.observe(v);
  });

  /* Respect a reduced-motion preference: load the clips but leave them
     paused and give the viewer controls instead of looping them. */
  var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  if (calm && calm.matches) {
    player.disconnect();
    clips.forEach(function (v) { v.controls = true; v.loop = false; });
  }
})();
