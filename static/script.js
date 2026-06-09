/* ─── CALCULAIRE™ ELITE · script.js ─── */
"use strict";

// ─── GSAP plugin registration ───
gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

// ─── STATE ───
const STATE = {
  expr: '',
  result: null,
  mode: 'standard',
  computing: false,
};

// ─── DOM REFS ───
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

const loader         = $('loader');
const loaderBar      = $('loaderBar');
const loaderStatus   = $('loaderStatus');
const cursorDot      = $('cursorDot');
const cursorRing     = $('cursorRing');
const ambientCanvas  = $('ambientCanvas');
const heroCta        = $('heroCta');
const displayExpr    = $('displayExpr');
const processingOverlay = $('processingOverlay');
const procStatus     = $('procStatus');
const procBar        = $('procBar');
const mNodes         = $('mNodes');
const mTflops        = $('mTflops');
const mLatency       = $('mLatency');
const paywallSection = $('paywall');
const rcExpr         = $('rcExpr');
const rcResultBlur   = $('rcResultBlur');
const blurValue      = $('blurValue');
const rcModeLabel    = $('rcModeLabel');
const payBtn         = $('payBtn');
const paymentAmount = $('paymentAmount');
paymentAmount.addEventListener('wheel', function(e){
    e.preventDefault();
});
const revealOverlay  = $('revealOverlay');
const revealCanvas   = $('revealCanvas');
const revealAnswer   = $('revealAnswer');
const revealExpr     = $('revealExpr');
const revealModeText = $('revealModeText');
const revealAgain    = $('revealAgain');

// ─── MODE COPY ───
const MODE_LABELS = {
  standard: "STANDARD COMPUTATION",
  scientific: "SCIENTIFIC COMPUTATION"
};

const MODE_REVEAL = {
  standard: "Processed through CALCULAIRE™ Standard Engine",
  scientific: "Processed through CALCULAIRE™ Scientific Engine"
};

// ═══════════════════════════════════════════════════════
// CURSOR
// ═══════════════════════════════════════════════════════
let mx = 0, my = 0, rx = 0, ry = 0;
document.addEventListener('mousemove', e => {
  mx = e.clientX; my = e.clientY;
  cursorDot.style.left = mx + 'px';
  cursorDot.style.top  = my + 'px';
});

(function animateCursor() {
  rx += (mx - rx) * 0.62;
  ry += (my - ry) * 0.62;
  cursorRing.style.left = rx + 'px';
  cursorRing.style.top  = ry + 'px';
  requestAnimationFrame(animateCursor);
})();

document.addEventListener('mouseover', e => {
  if (e.target.matches('a, button, .key')) cursorRing.classList.add('hovered');
});
document.addEventListener('mouseout', e => {
  if (e.target.matches('a, button, .key')) cursorRing.classList.remove('hovered');
});

// ═══════════════════════════════════════════════════════
// AMBIENT PARTICLE CANVAS (Three.js)
// ═══════════════════════════════════════════════════════
let scene, camera, renderer, particles, particleMat;

function initThree() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
  camera.position.z = 400;

  renderer = new THREE.WebGLRenderer({ canvas: ambientCanvas, alpha: true, antialias: false });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  // Particles
  const count = 280;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const scales = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * 900;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 600;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 400;
    scales[i] = Math.random();
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));

  particleMat = new THREE.PointsMaterial({
    color: 0xc8a96e, size: 1.2,
    transparent: true, opacity: 0.45,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  particles = new THREE.Points(geo, particleMat);
  scene.add(particles);

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  animateThree();
}

let threeT = 0;
function animateThree() {
  requestAnimationFrame(animateThree);
  threeT += 0.0003;
  particles.rotation.y = threeT * 0.4;
  particles.rotation.x = threeT * 0.2;
  renderer.render(scene, camera);
}

// ═══════════════════════════════════════════════════════
// LOADING SEQUENCE
// ═══════════════════════════════════════════════════════
const LOAD_MSGS = [
  'Calibrating Luxury Engines…',
  'Initializing Quantum Lattice…',
  'Polishing Computational Surface…',
  'Loading Elite Arithmetic Core…',
  'Synchronizing Gold Standard…',
  'Ready.',
];

function runLoader() {
  let progress = 0;
  let msgIdx = 0;
  const interval = setInterval(() => {
    progress += Math.random() * 18 + 4;
    if (progress > 100) progress = 100;
    loaderBar.style.width = progress + '%';

    const nextMsgAt = (msgIdx + 1) / LOAD_MSGS.length * 100;
    if (progress >= nextMsgAt && msgIdx < LOAD_MSGS.length - 1) {
      msgIdx++;
      loaderStatus.textContent = LOAD_MSGS[msgIdx];
    }

    if (progress >= 100) {
      clearInterval(interval);
      setTimeout(() => {
        loader.classList.add('gone');
        initHeroAnimations();
      }, 600);
    }
  }, 90);
}

// ═══════════════════════════════════════════════════════
// HERO ANIMATIONS (GSAP)
// ═══════════════════════════════════════════════════════
function initHeroAnimations() {
  // Title char split effect
  const titleLines = $$('.title-line');
  titleLines.forEach(line => {
    const text = line.getAttribute('data-text') || line.textContent.trim();
    line.innerHTML = [...text].map((ch, i) =>
      `<span class="char" style="display:inline-block;opacity:0;transform:translateY(40px)">${ch}</span>`
    ).join('');

    gsap.to(line.querySelectorAll('.char'), {
      opacity: 1, y: 0,
      stagger: 0.04,
      duration: 0.8,
      ease: 'power3.out',
      delay: 0.2,
    });
  });

  // Nav scroll effect
  ScrollTrigger.create({
    start: 'top -50px',
    onUpdate: self => {
      document.querySelector('.nav').classList.toggle('scrolled', self.progress > 0);
    },
  });

  // Calc section reveal
  gsap.from('.calc-wrap', {
    scrollTrigger: { trigger: '.calc-section', start: 'top 75%' },
    y: 60, opacity: 0, duration: 1.2,
    ease: 'power3.out',
  });
}

// ═══════════════════════════════════════════════════════
// NAV SMOOTH SCROLL
// ═══════════════════════════════════════════════════════
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    gsap.to(window, { scrollTo: target, duration: 1.2, ease: 'power3.inOut' });
  });
});

// ═══════════════════════════════════════════════════════
// MODE SELECTOR
// ═══════════════════════════════════════════════════════
$$('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    STATE.mode = btn.dataset.mode;
    createRipple(btn, { x: btn.offsetWidth / 2, y: btn.offsetHeight / 2 });
  });
});

// ═══════════════════════════════════════════════════════
// CALCULATOR EXPRESSION ENGINE
// ═══════════════════════════════════════════════════════
function safeEval(expr) {
  try {
    const clean = expr
      .replace(/÷/g, '/')
      .replace(/×/g, '*')
      .replace(/−/g, '-')
      .replace(/[^0-9+\-*/().%\s]/g, '');
    if (!clean.trim()) return null;
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + clean + ')')();
    if (!isFinite(result)) return null;
    return parseFloat(result.toFixed(10));
  } catch {
    return null;
  }
}

function updateDisplay() {
  displayExpr.textContent = STATE.expr || '0';
  displayExpr.style.color = STATE.expr ? 'var(--white)' : 'var(--silver-soft)';
}

function handleKey(btn) {
  const val    = btn.dataset.val;
  const action = btn.dataset.action;

  if (action === 'clear') {
    STATE.expr = '';
  } else if (action === 'backspace') {
    STATE.expr = STATE.expr.slice(0, -1);
  } else if (action === 'calculate') {
    if (!STATE.expr.trim() || STATE.computing) return;
    triggerComputation();
    return;
  } else if (val) {
    if (STATE.expr.length > 22) return;
    STATE.expr += val;
  }
  updateDisplay();
}

// Key ripple
function createRipple(btn, coords) {
  const rect = btn.getBoundingClientRect();
  const x = (coords?.x ?? 0);
  const y = (coords?.y ?? 0);
  const size = Math.max(btn.offsetWidth, btn.offsetHeight);
  const ripple = document.createElement('span');
  ripple.className = 'key-ripple';
  ripple.style.cssText = `
    width:${size}px; height:${size}px;
    left:${x - size / 2}px; top:${y - size / 2}px;
  `;
  btn.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}

$$('.key').forEach(btn => {
  btn.addEventListener('click', e => {
    const rect = btn.getBoundingClientRect();
    createRipple(btn, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    handleKey(btn);
  });
});

// Keyboard support
document.addEventListener('keydown', e => {
  const map = {
    '0':'0','1':'1','2':'2','3':'3','4':'4',
    '5':'5','6':'6','7':'7','8':'8','9':'9',
    '+':'+','-':'−','*':'×','/':'÷','%':'%','.':'.',
    'Backspace':'__backspace','Enter':'__calculate','Escape':'__clear',
  };
  const mapped = map[e.key];
  if (!mapped) return;
  if (mapped === '__backspace') {
    STATE.expr = STATE.expr.slice(0, -1);
  } else if (mapped === '__calculate') {
    if (!STATE.expr.trim() || STATE.computing) return;
    triggerComputation();
    return;
  } else if (mapped === '__clear') {
    STATE.expr = '';
  } else {
    if (STATE.expr.length > 22) return;
    STATE.expr += mapped;
  }
  updateDisplay();
});

// ═══════════════════════════════════════════════════════
// COMPUTATION SEQUENCE
// ═══════════════════════════════════════════════════════
const PROC_STEPS = [
  { msg: 'Initializing Quantum Engine…',      pct: 8 },
  { msg: 'Calibrating Neural Arrays…',         pct: 18 },
  { msg: 'Routing Through Lausanne Nodes…',    pct: 30 },
  { msg: 'Synchronizing Temporal Validators…', pct: 45 },
  { msg: 'Consulting ex-IMF Officials…',       pct: 58 },
  { msg: 'Validating Mathematical Integrity…', pct: 70 },
  { msg: 'Running Executive Approval Pipeline…', pct: 82 },
  { msg: 'Encrypting to Swiss Blockchain…',    pct: 92 },
  { msg: 'Calculation Complete.',              pct: 100 },
];

function triggerComputation() {
  const result = safeEval(STATE.expr);
  if (result === null) {
    shakeDisplay();
    return;
  }
  STATE.result = result;
  STATE.computing = true;

  processingOverlay.classList.add('active');

  let step = 0;
  let nodeCount = 0;
  let tflops = 0;

  const nodesInterval = setInterval(() => {
    nodeCount = Math.min(47, nodeCount + Math.floor(Math.random() * 5 + 1));
    mNodes.textContent = nodeCount;
    tflops = parseFloat((tflops + Math.random() * 2.4).toFixed(2));
    mTflops.textContent = tflops.toFixed(2);
  }, 100);

  function runStep(i) {
    if (i >= PROC_STEPS.length) {
      clearInterval(nodesInterval);
      mLatency.textContent = (Math.random() * 8 + 2).toFixed(1) + 'ms';
      mNodes.textContent = '47';

      setTimeout(() => {
        processingOverlay.classList.remove('active');
        STATE.computing = false;
        showPaywall();
      }, 700);
      return;
    }
    const s = PROC_STEPS[i];
    procStatus.textContent = s.msg;
    procBar.style.width = s.pct + '%';

    const delay = i === 0 ? 200 : 350 + Math.random() * 250;
    setTimeout(() => runStep(i + 1), delay);
  }

  setTimeout(() => runStep(0), 100);
}

function shakeDisplay() {
  gsap.to(displayExpr, {
    x: 8, duration: 0.06, yoyo: true, repeat: 7,
    ease: 'power2.inOut',
    onComplete: () => gsap.set(displayExpr, { x: 0 }),
  });
  displayExpr.style.color = '#c86060';
  setTimeout(() => { displayExpr.style.color = ''; }, 700);
}

// ═══════════════════════════════════════════════════════
// PAYWALL
// ═══════════════════════════════════════════════════════
function showPaywall() {
  const exprDisplay = STATE.expr;
  rcExpr.textContent = exprDisplay + ' =';
  blurValue.textContent = STATE.result;
  rcModeLabel.textContent = MODE_LABELS[STATE.mode] || '';

  paywallSection.style.display = 'flex';
  paywallSection.style.flexDirection = 'column';
  paywallSection.style.alignItems = 'center';

  gsap.fromTo(paywallSection,
    { opacity: 0, y: 40 },
    { opacity: 1, y: 0, duration: 1, ease: 'power3.out' }
  );

  setTimeout(() => {
    gsap.to(window, {
      scrollTo: { y: paywallSection, offsetY: 80 },
      duration: 1.2, ease: 'power3.inOut',
    });
  }, 200);
}

// ═══════════════════════════════════════════════════════
// PAYMENT FLOW
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// PAYMENT FLOW
// ═══════════════════════════════════════════════════════

payBtn.addEventListener('click', async () => {

  const amount = Number(paymentAmount.value);
if (!amount || amount < 1) {

    alert("Minimum payment is ₹1");

    return;
}
  if (amount < 1) {
    alert("Minimum payment amount is ₹1");
    return;
  }

  console.log("Pay button clicked");

  payBtn.disabled = true;
  payBtn.style.pointerEvents = 'none';

  try {

   const response = await fetch(
  `/create-order?amount=${amount}`
);
    const data = await response.json();

    const options = {
      key: data.key,
      amount: data.amount,
      currency: "INR",
      name: "CALCULAIRE™ ELITE",
      description: "Unlock Elite Insight",
      order_id: data.order_id,

      handler: async function (response) {

        try {

          const verify = await fetch('/verify-payment', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
      body: JSON.stringify({
    order_id: data.order_id,
    payment_id: response.razorpay_payment_id,
    signature: response.razorpay_signature,

    expression: STATE.expr,
    result: STATE.result,
    amount: data.amount / 100,

    mode: STATE.mode
})
          });

          const result = await verify.json();

          if (result.verified) {

            console.log("Payment Verified");

            triggerReveal();

          } else {

            alert("Payment verification failed");

            payBtn.disabled = false;
            payBtn.style.pointerEvents = 'auto';
          }

        } catch (err) {

          console.error(err);

          payBtn.disabled = false;
          payBtn.style.pointerEvents = 'auto';
        }
      },

      modal: {
        ondismiss: function () {
          payBtn.disabled = false;
          payBtn.style.pointerEvents = 'auto';
        }
      },

      theme: {
        color: "#c8a96e"
      }
    };

    const razorpay = new Razorpay(options);

    razorpay.on('payment.failed', function (response) {

      console.log(response.error);

      alert("Payment Failed");

      payBtn.disabled = false;
      payBtn.style.pointerEvents = 'auto';
    });

    razorpay.open();

  } catch (error) {

    console.error(error);

    payBtn.disabled = false;
    payBtn.style.pointerEvents = 'auto';
  }

});

// ═══════════════════════════════════════════════════════
// REVEAL
// ═══════════════════════════════════════════════════════
function triggerReveal() {
  revealAnswer.textContent = STATE.result;
  revealExpr.textContent = STATE.expr + ' = ' + STATE.result;
  revealModeText.textContent = MODE_REVEAL[STATE.mode] || '';

  revealOverlay.classList.add('active');
  initRevealCanvas();
}

// Reveal particle burst
let revealAnimId;
function initRevealCanvas() {
  cancelAnimationFrame(revealAnimId);

  const rc = revealCanvas;
  const ctx = rc.getContext('2d');
  rc.width = innerWidth;
  rc.height = innerHeight;

  const cx = rc.width / 2;
  const cy = rc.height / 2;

  const GOLD = [200, 169, 110];
  const WHITE = [240, 238, 232];

  class Particle {
    constructor() { this.reset(true); }
    reset(init) {
      this.x = cx + (Math.random() - 0.5) * (init ? 10 : 2);
      this.y = cy + (Math.random() - 0.5) * (init ? 10 : 2);
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * (init ? 14 : 6) + (init ? 2 : 1);
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed - (init ? 3 : 0);
      this.life = 1;
      this.decay = 0.008 + Math.random() * 0.018;
      this.size = Math.random() * 3 + 1;
      this.color = Math.random() > 0.4 ? GOLD : WHITE;
      this.twinkle = Math.random() * Math.PI * 2;
    }
    update() {
      this.x += this.vx;
      this.y += this.vy;
      this.vy += 0.06;
      this.vx *= 0.99;
      this.life -= this.decay;
      this.twinkle += 0.15;
      if (this.life <= 0) this.reset(false);
    }
    draw() {
      const a = this.life * (0.7 + 0.3 * Math.sin(this.twinkle));
      const [r, g, b] = this.color;
      ctx.globalAlpha = a;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size * a, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const pts = Array.from({ length: 200 }, () => new Particle());

  // Light burst rings
  const rings = [
    { r: 0, maxR: 350, opacity: 0.7, width: 3, color: GOLD },
    { r: 0, maxR: 500, opacity: 0.4, width: 1.5, color: WHITE },
    { r: 0, maxR: 250, opacity: 0.5, width: 2, color: GOLD },
  ];
  rings.forEach((ring, i) => { ring.delay = i * 80; ring.started = false; ring.t = 0; });

  let t = 0;

  function revealFrame() {
    ctx.clearRect(0, 0, rc.width, rc.height);
    t++;

    // Rings
    rings.forEach(ring => {
      if (t < ring.delay / 16) return;
      if (!ring.started) ring.started = true;
      ring.r = Math.min(ring.r + 12, ring.maxR);
      const frac = ring.r / ring.maxR;
      const a = ring.opacity * (1 - frac);
      const [r, g, b] = ring.color;
      ctx.globalAlpha = a;
      ctx.strokeStyle = `rgb(${r},${g},${b})`;
      ctx.lineWidth = ring.width * (1 - frac * 0.5);
      ctx.beginPath();
      ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Central glow
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 180);
    grd.addColorStop(0, `rgba(200,169,110,${0.18 * Math.max(0, 1 - t / 120)})`);
    grd.addColorStop(1, 'transparent');
    ctx.globalAlpha = 1;
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, rc.width, rc.height);

    // Particles
    pts.forEach(p => { p.update(); p.draw(); });

    ctx.globalAlpha = 1;
    revealAnimId = requestAnimationFrame(revealFrame);
  }

  revealFrame();
}
revealAgain.addEventListener('click', () => {
  console.log("Reset complete");

  cancelAnimationFrame(revealAnimId);

  revealOverlay.classList.remove('active');
  paywallSection.style.display = 'none';

  STATE.expr = '';
  STATE.result = null;
  STATE.computing = false;

  procBar.style.width = '0';

  payBtn.disabled = false;
  payBtn.style.pointerEvents = 'auto';

  updateDisplay();

  setTimeout(() => {
    gsap.to(window, {
      scrollTo: { y: '#calculator' },
      duration: 1,
      ease: 'power3.inOut'
    });
  }, 400);

});

// ═══════════════════════════════════════════════════════
// HERO CTA → SCROLL
// ═══════════════════════════════════════════════════════
heroCta.addEventListener('click', e => {
  e.preventDefault();
  gsap.to(window, {
    scrollTo: { y: '#calculator', offsetY: 40 },
    duration: 1.4, ease: 'power3.inOut',
  });
});

// ═══════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  initThree();
  runLoader();
  updateDisplay();
});


const amountPreview = document.getElementById("amountPreview");

paymentAmount.addEventListener("input", () => {

    let value = parseFloat(paymentAmount.value);

    if (!value || value < 1) {
        value = 1;
        paymentAmount.value = 1;
    }

    amountPreview.textContent = value.toFixed(2);
});