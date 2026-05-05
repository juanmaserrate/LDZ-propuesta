/* ============================================================
   premium.js — Capa de movimiento y detalle premium
   Government-premium: smooth scroll, reveal, cursor, splittext,
   counters, tilt 3D, marquee, magnetic buttons, scroll progress.
   ============================================================ */

(function () {
  "use strict";

  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FINE_POINTER = window.matchMedia("(pointer: fine)").matches;

  /* ========== 1. Lenis smooth scroll ========== */
  function initLenis() {
    if (REDUCED || typeof Lenis === "undefined") return null;
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.5,
    });
    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);

    // No interceptar scroll dentro de Leaflet ni de elementos data-lenis-prevent
    document.addEventListener("wheel", function (e) {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest("[data-lenis-prevent]") ||
        target.closest(".leaflet-container") ||
        target.closest(".demo-map") ||
        target.closest(".hero-map") ||
        target.closest("#zoneSliderMap") ||
        target.closest("#demoComparativaMap") ||
        target.closest("#heroOverviewMap") ||
        target.closest(".ahorro-sim-slider")
      ) {
        // dejar que el navegador maneje este wheel
        e.stopPropagation();
      }
    }, { capture: true, passive: true });

    return lenis;
  }

  /* ========== 2. Reveal-on-scroll ========== */
  function initReveal() {
    const targets = [
      ".section-head",
      ".section-tag",
      ".diag-card",
      ".demo-benefit-card",
      ".cap-prov-card",
      ".cap-eficiencia",
      ".cap-eficiencia-stat",
      ".impacto-kpi-card",
      ".cierre-card",
      ".prop-card",
      ".benef-card",
      ".ahorro-sim-result",
      ".ahorro-sim-control",
      ".cap-diag",
      ".cupos-barrio-card",
    ];

    const apply = () => {
      const els = document.querySelectorAll(targets.join(","));
      els.forEach((el, i) => {
        if (el.classList.contains("reveal")) return;
        el.classList.add("reveal");
        // stagger por hijo: si es uno de muchos hermanos del mismo grupo,
        // aplica delay incremental
        const parent = el.parentElement;
        if (parent) {
          const sameSiblings = Array.from(parent.children).filter(c =>
            c.classList.contains("diag-card") ||
            c.classList.contains("demo-benefit-card") ||
            c.classList.contains("cap-prov-card") ||
            c.classList.contains("impacto-kpi-card") ||
            c.classList.contains("cierre-card") ||
            c.classList.contains("prop-card") ||
            c.classList.contains("benef-card")
          );
          const idx = sameSiblings.indexOf(el);
          if (idx > -1) {
            el.style.transitionDelay = (idx * 70) + "ms";
          }
        }
      });
    };

    if (REDUCED) {
      // sin animación: revelar todo de una
      document.querySelectorAll(targets.join(",")).forEach(el => {
        el.classList.add("reveal", "is-visible");
      });
      return;
    }

    apply();

    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });

    document.querySelectorAll(".reveal").forEach(el => io.observe(el));

    // Re-aplicar cuando React renderiza más contenido
    const mo = new MutationObserver(() => {
      apply();
      document.querySelectorAll(".reveal:not(.is-visible)").forEach(el => {
        if (!el.dataset.revealObserved) {
          io.observe(el);
          el.dataset.revealObserved = "1";
        }
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* ========== 3. Cursor custom ========== */
  function initCursor() {
    if (!FINE_POINTER || REDUCED) return;
    const dot = document.createElement("div");
    const ring = document.createElement("div");
    dot.className = "cursor-dot";
    ring.className = "cursor-ring";
    document.body.appendChild(dot);
    document.body.appendChild(ring);

    let mx = window.innerWidth / 2, my = window.innerHeight / 2;
    let rx = mx, ry = my;
    let visible = false;

    document.addEventListener("mousemove", (e) => {
      mx = e.clientX; my = e.clientY;
      if (!visible) { visible = true; document.body.classList.add("has-cursor"); }
      dot.style.transform = `translate3d(${mx}px, ${my}px, 0) translate(-50%, -50%)`;
    }, { passive: true });

    document.addEventListener("mouseleave", () => {
      visible = false;
      document.body.classList.remove("has-cursor");
    });

    function loop() {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%)`;
      requestAnimationFrame(loop);
    }
    loop();

    const hoverSel = "a, button, .clickable, .demo-benefit-card, .diag-card, .cap-prov-card, .ahorro-sim-slider, .leaflet-marker-icon";
    document.addEventListener("mouseover", (e) => {
      if (e.target instanceof Element && e.target.closest(hoverSel)) {
        ring.classList.add("is-hover");
      }
    });
    document.addEventListener("mouseout", (e) => {
      if (e.target instanceof Element && e.target.closest(hoverSel)) {
        ring.classList.remove("is-hover");
      }
    });
  }

  /* ========== 4. Scroll progress bar ========== */
  function initScrollProgress() {
    const bar = document.createElement("div");
    bar.className = "scroll-progress";
    bar.innerHTML = '<div class="scroll-progress-fill"></div>';
    document.body.appendChild(bar);
    const fill = bar.firstElementChild;
    function tick() {
      const h = document.documentElement;
      const max = (h.scrollHeight - h.clientHeight) || 1;
      const p = Math.max(0, Math.min(1, h.scrollTop / max));
      fill.style.transform = `scaleX(${p})`;
    }
    tick();
    window.addEventListener("scroll", tick, { passive: true });
    window.addEventListener("resize", tick);
  }

  /* ========== 5. SplitText reveal ========== */
  function splitText(el) {
    if (!el || el.dataset.split === "1") return;
    const text = el.textContent;
    if (!text) return;
    el.dataset.split = "1";
    el.setAttribute("aria-label", text);
    const words = text.split(/\s+/);
    el.textContent = "";
    let charIdx = 0;
    let wordIdx = 0;
    words.forEach((word, wi) => {
      const wSpan = document.createElement("span");
      wSpan.className = "split-word";
      wSpan.setAttribute("aria-hidden", "true");
      Array.from(word).forEach((ch) => {
        const cSpan = document.createElement("span");
        cSpan.className = "split-char";
        cSpan.textContent = ch;
        cSpan.style.transitionDelay = (wordIdx * 40 + charIdx * 15) + "ms";
        wSpan.appendChild(cSpan);
        charIdx++;
      });
      el.appendChild(wSpan);
      if (wi < words.length - 1) {
        const space = document.createElement("span");
        space.className = "split-space";
        space.textContent = " ";
        el.appendChild(space);
      }
      wordIdx++;
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add("split-in"));
    });
  }

  function initSplitTextWatcher() {
    const tryHero = () => {
      const candidate = document.querySelector(".hero-title-split, .hero h1.display-xl, .hero .display-xl");
      if (candidate && !candidate.dataset.split) {
        // Si el componente legacy todavía tiene Typewriter, quedarnos con el texto plano
        const tw = candidate.querySelector(".typewriter");
        if (tw) {
          candidate.textContent = tw.textContent;
        }
        if (REDUCED) {
          candidate.classList.add("split-skipped");
          return true;
        }
        splitText(candidate);
        return true;
      }
      return false;
    };
    if (tryHero()) return;
    const mo = new MutationObserver(() => {
      if (tryHero()) mo.disconnect();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* ========== 6. Counters animados ========== */
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function animateCounter(el, end, duration, suffix = "", prefix = "", decimals = 0) {
    if (REDUCED) {
      el.textContent = prefix + (end.toLocaleString("es-AR", { maximumFractionDigits: decimals })) + suffix;
      return;
    }
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const v = end * easeOutCubic(t);
      el.textContent = prefix + (decimals > 0
        ? v.toFixed(decimals)
        : Math.round(v).toLocaleString("es-AR")) + suffix;
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = prefix + (end.toLocaleString("es-AR", { maximumFractionDigits: decimals })) + suffix;
    }
    requestAnimationFrame(step);
  }

  function initCounters() {
    const ioCount = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        if (el.dataset.countDone) return;
        el.dataset.countDone = "1";
        const end = parseFloat(el.dataset.count);
        const dur = parseInt(el.dataset.countDuration || "1800", 10);
        const suffix = el.dataset.countSuffix || "";
        const prefix = el.dataset.countPrefix || "";
        const decimals = parseInt(el.dataset.countDecimals || "0", 10);
        animateCounter(el, end, dur, suffix, prefix, decimals);
        ioCount.unobserve(el);
      });
    }, { threshold: 0.4 });

    const observe = () => {
      document.querySelectorAll("[data-count]").forEach(el => {
        if (!el.dataset.countObserved) {
          el.dataset.countObserved = "1";
          ioCount.observe(el);
        }
      });
    };
    observe();

    const mo = new MutationObserver(() => observe());
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* ========== 7. Tilt 3D en cards ========== */
  function initTilt() {
    if (!FINE_POINTER || REDUCED) return;
    const sel = ".diag-card, .demo-benefit-card, .cap-prov-card, .impacto-kpi-card, .cierre-card, .prop-card, .benef-card";

    const handler = (card) => {
      if (card.dataset.tilt === "1") return;
      card.dataset.tilt = "1";
      card.classList.add("tilt-card");

      const glow = document.createElement("span");
      glow.className = "tilt-glow";
      card.appendChild(glow);

      let rect;
      const enter = () => { rect = card.getBoundingClientRect(); };
      const move = (e) => {
        if (!rect) rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        const rotY = (x - 0.5) * 8;
        const rotX = -(y - 0.5) * 8;
        card.style.transform = `perspective(1000px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateZ(0)`;
        glow.style.setProperty("--gx", (x * 100) + "%");
        glow.style.setProperty("--gy", (y * 100) + "%");
        glow.style.opacity = "1";
      };
      const leave = () => {
        card.style.transform = "";
        glow.style.opacity = "0";
        rect = null;
      };
      card.addEventListener("mouseenter", enter);
      card.addEventListener("mousemove", move);
      card.addEventListener("mouseleave", leave);
    };

    const apply = () => document.querySelectorAll(sel).forEach(handler);
    apply();
    const mo = new MutationObserver(() => apply());
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* ========== 8. Hover magnético en botones ========== */
  function initMagnetic() {
    if (!FINE_POINTER || REDUCED) return;
    const sel = ".btn-primary, .btn, .pill-status";

    const handler = (btn) => {
      if (btn.dataset.magnet === "1") return;
      btn.dataset.magnet = "1";
      let rect;
      btn.addEventListener("mouseenter", () => { rect = btn.getBoundingClientRect(); });
      btn.addEventListener("mousemove", (e) => {
        if (!rect) rect = btn.getBoundingClientRect();
        const dx = (e.clientX - (rect.left + rect.width / 2)) * 0.18;
        const dy = (e.clientY - (rect.top + rect.height / 2)) * 0.18;
        btn.style.transform = `translate(${dx}px, ${dy}px)`;
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.transform = "";
        rect = null;
      });
    };

    const apply = () => document.querySelectorAll(sel).forEach(handler);
    apply();
    const mo = new MutationObserver(() => apply());
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* ========== 9. Hero augment: editorial + counters + marquee ========== */
  function augmentHero() {
    let mo;
    const tryAugment = () => {
      const hero = document.querySelector("section.hero#inicio");
      if (!hero) return false;
      if (hero.dataset.augmented === "1") return true;
      const shell = hero.querySelector(".shell");
      const copy = hero.querySelector(".hero-copy");
      const title = hero.querySelector("h1.display-xl, .display-xl");
      if (!copy || !title) return false;
      hero.dataset.augmented = "1";

      // Editorial sub-eyebrow encima del título
      const editorial = document.createElement("div");
      editorial.className = "editorial hero-editorial";
      editorial.innerHTML = "Una propuesta institucional para Lomas de Zamora";
      copy.insertBefore(editorial, title);

      // Counters bajo el título
      const counters = document.createElement("div");
      counters.className = "hero-counters";
      counters.innerHTML = `
        <div class="hero-counter">
          <span class="hero-counter-v" data-count="289" data-count-duration="1800">0</span>
          <span class="hero-counter-l">escuelas</span>
        </div>
        <div class="hero-counter">
          <span class="hero-counter-v" data-count="6" data-count-duration="1400">0</span>
          <span class="hero-counter-l">proveedores</span>
        </div>
        <div class="hero-counter">
          <span class="hero-counter-v" data-count="1493" data-count-duration="2000">0</span>
          <span class="hero-counter-l">km/día evitables</span>
        </div>
      `;
      copy.appendChild(counters);

      // Marquee debajo del hero
      if (!document.querySelector(".gov-marquee")) {
        const marquee = document.createElement("div");
        marquee.className = "gov-marquee";
        const phrase = "289 ESCUELAS · 6 PROVEEDORES · 47% OPTIMIZACIÓN GEOGRÁFICA · $51M/AÑO POTENCIAL · ";
        marquee.innerHTML = `
          <div class="gov-marquee-track">
            <span>${phrase.repeat(6)}</span>
            <span aria-hidden="true">${phrase.repeat(6)}</span>
          </div>
        `;
        hero.insertAdjacentElement("afterend", marquee);
      }
      return true;
    };
    if (tryAugment()) return;
    mo = new MutationObserver(() => {
      if (tryAugment() && mo) mo.disconnect();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /* ========== 10. Auto-count for stats que ya están en el DOM (simulador, eficiencia) ========== */
  function autoTagCountables() {
    // Capacidad: cap-eficiencia-stat-v y cap-prov metrics. No reemplazamos texto;
    // solo agregamos data-count si vemos un número simple "X km" o "$X" sin format complicado.
    // Para no romper los textos formateados (rangos, "→", múltiples números), nos limitamos
    // a counters explicitos del hero — el resto se beneficia con reveal-on-scroll y tilt.
  }

  /* ========== INIT ========== */
  function start() {
    initLenis();
    initReveal();
    initCursor();
    initScrollProgress();
    initSplitTextWatcher();
    initCounters();
    initTilt();
    initMagnetic();
    augmentHero();
    autoTagCountables();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
