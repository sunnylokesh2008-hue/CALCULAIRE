"use strict";

function initSplashCursor() {
  const canvas = document.getElementById("splashCursor");
  if (!canvas || !window.matchMedia("(pointer: fine)").matches) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const state = {
    width: 0,
    height: 0,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    position: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    target: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    speed: 0,
    hovered: false,
    hoverProgress: 0,
    trail: [],
    particles: [],
    raf: null,
  };

  function resize() {
    state.width = window.innerWidth;
    state.height = window.innerHeight;
    canvas.width = Math.floor(state.width * state.dpr);
    canvas.height = Math.floor(state.height * state.dpr);
    canvas.style.width = `${state.width}px`;
    canvas.style.height = `${state.height}px`;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }

  function createParticle(x, y, speed) {
    const angle = Math.random() * Math.PI * 2;
    const velocity = 1.75 + Math.random() * 1.2 + speed * 0.6;
    const size = 8 + Math.random() * 10 + speed * 10;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity,
      size,
      life: 0.28 + Math.random() * 0.16,
      alpha: 1,
    });
    if (state.particles.length > 96) state.particles.splice(0, state.particles.length - 96);
  }

  function pushTrail() {
    state.trail.unshift({
      x: state.position.x,
      y: state.position.y,
      alpha: 1,
      size: 18 + state.speed * 18,
    });
    if (state.trail.length > 30) state.trail.pop();
  }

  function updateParticles(delta) {
    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const particle = state.particles[i];
      particle.x += particle.vx * delta * 40;
      particle.y += particle.vy * delta * 40;
      particle.alpha -= delta * 1.4;
      particle.size *= 0.94;
      if (particle.alpha <= 0.02 || particle.size < 0.9) {
        state.particles.splice(i, 1);
      }
    }
  }

  function drawTrail() {
    ctx.globalCompositeOperation = "source-over";
    for (let i = 0; i < state.trail.length; i += 1) {
      const point = state.trail[i];
      const t = 1 - i / state.trail.length;
      const radius = point.size * (0.5 + t * 0.7);
      const alpha = point.alpha * (0.08 + t * 0.22);
      const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
      gradient.addColorStop(0, `rgba(255, 250, 236, ${alpha})`);
      gradient.addColorStop(0.36, `rgba(212, 175, 55, ${alpha * 0.58})`);
      gradient.addColorStop(1, "rgba(212, 175, 55, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawParticles() {
    ctx.globalCompositeOperation = "lighter";
    for (const particle of state.particles) {
      const gradient = ctx.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, particle.size);
      gradient.addColorStop(0, `rgba(255, 250, 244, ${particle.alpha})`);
      gradient.addColorStop(0.3, `rgba(212, 175, 55, ${particle.alpha * 0.72})`);
      gradient.addColorStop(1, "rgba(212, 175, 55, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawCursor() {
    const outerRadius = 16 + state.speed * 18 + state.hoverProgress * 14;
    const outerAlpha = 0.12 + state.hoverProgress * 0.22;

    const ringGradient = ctx.createRadialGradient(state.position.x, state.position.y, outerRadius * 0.35, state.position.x, state.position.y, outerRadius);
    ringGradient.addColorStop(0, `rgba(255, 255, 255, ${outerAlpha * 0.18})`);
    ringGradient.addColorStop(0.6, `rgba(212, 175, 55, ${outerAlpha * 0.14})`);
    ringGradient.addColorStop(1, "rgba(212, 175, 55, 0)");
    ctx.fillStyle = ringGradient;
    ctx.beginPath();
    ctx.arc(state.position.x, state.position.y, outerRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.24 + state.hoverProgress * 0.18})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(state.position.x, state.position.y, outerRadius * 0.52, 0, Math.PI * 2);
    ctx.stroke();

    const coreRadius = 3.4 + state.speed * 1.6 + state.hoverProgress * 1.2;
    const coreGradient = ctx.createRadialGradient(state.position.x, state.position.y, 0, state.position.x, state.position.y, coreRadius * 1.1);
    coreGradient.addColorStop(0, "rgba(255, 255, 255, 0.96)");
    coreGradient.addColorStop(0.3, "rgba(255, 250, 244, 0.56)");
    coreGradient.addColorStop(1, "rgba(212, 175, 55, 0.16)");
    ctx.fillStyle = coreGradient;
    ctx.beginPath();
    ctx.arc(state.position.x, state.position.y, coreRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  let lastFrameTime = performance.now();

  function animate() {
    if (document.hidden) {
      state.raf = null;
      return;
    }

    const now = performance.now();
    const delta = Math.min(0.033, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    state.position.x += (state.target.x - state.position.x) * 0.18;
    state.position.y += (state.target.y - state.position.y) * 0.18;
    state.hoverProgress += ((state.hovered ? 1 : 0) - state.hoverProgress) * 0.14;
    state.speed += (Math.min(1.2, state.speed) - state.speed) * 0.16;

    pushTrail();
    updateParticles(delta);

    ctx.clearRect(0, 0, state.width, state.height);
    drawTrail();
    drawParticles();
    drawCursor();

    state.raf = requestAnimationFrame(animate);
  }

  function updateHover(target) {
    state.hovered = Boolean(
      target.closest("button, .key, .primary-btn, .ghost-btn, .segment, .nav-links a, input")
    );
  }

  function onPointerMove(event) {
    state.target.x = event.clientX;
    state.target.y = event.clientY;
    state.speed = Math.min(1.6, Math.hypot(event.movementX, event.movementY) * 0.03 + 0.06);
    createParticle(event.clientX, event.clientY, state.speed);
    updateHover(event.target);
  }

  function onVisibilityChange() {
    if (document.hidden) {
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = null;
      return;
    }
    if (!state.raf) {
      lastFrameTime = performance.now();
      state.raf = requestAnimationFrame(animate);
    }
  }

  resize();
  state.raf = requestAnimationFrame(animate);

  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
  document.addEventListener("pointermove", onPointerMove, { passive: true });
}

document.addEventListener("DOMContentLoaded", initSplashCursor);
