/* ==========================================================
   ALEXA
   File : js/reward-spin-fx.js
   Description : Premium Gold Soft Emerald Lucky Spin FX Engine
========================================================== */

const THEME = Object.freeze({
    gold: "#D4AF37",
    goldLight: "#F8E9A1",
    emerald: "#18C37E",
    dark: "#0B1320",
    white: "#FFFFFF"
});

const SELECTORS = Object.freeze({
    page: ".reward-spin-page",
    sparkleLayer: "#sparkleLayer",
    confettiLayer: "#confettiLayer",
    fxLayer: "#fxLayer",
    wheelSection: ".spin-wheel-section",
    wheelShell: ".wheel-shell",
    wheelCanvas: "#spinWheel",
    wheelFx: "#wheelFx",
    wheelReflection: ".wheel-reflection",
    wheelRingShine: ".wheel-ring-shine",
    wheelOverlay: ".wheel-overlay",
    wheelPointer: ".wheel-pointer",
    centerGlow: ".center-glow",
    availableSpin: "#availableSpin",
    btnSpin: "#btnSpin",
    runtimeHost: "#rewardSpinRuntime",
    modal: ".rewardspin-modal",
    modalBody: ".rewardspin-modal-body",
    resultIcon: ".spinfx-result-icon",
    ticketCard: ".spinfx-ticket-card"
});

const DEFAULTS = Object.freeze({
    spinDuration: 5200,
    sectorCount: 7,
    sparklePoolSize: 46,
    confettiPoolSize: 140,
    ambientParticlePoolSize: 34,
    reducedMotionQuery: "(prefers-reduced-motion: reduce)"
});

const EASING = Object.freeze({
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    outQuart: (t) => 1 - Math.pow(1 - t, 4)
});

const dom = {
    body: null,
    page: null,
    sparkleLayer: null,
    confettiLayer: null,
    fxLayer: null,
    wheelSection: null,
    wheelShell: null,
    wheelCanvas: null,
    wheelFx: null,
    wheelReflection: null,
    wheelRingShine: null,
    wheelOverlay: null,
    wheelPointer: null,
    centerGlow: null,
    availableSpin: null,
    btnSpin: null,
    runtimeHost: null
};

const state = {
    initialized: false,
    idleRunning: false,
    spinRunning: false,
    sectorCount: DEFAULTS.sectorCount,
    reducedMotion: false,
    visible: true,
    lastCounterValue: 0,
    pointerSector: -1,
    spinToken: 0,
    idleToken: 0,
    controller: null,
    mediaQuery: null,
    geometry: {
        wheel: null,
        viewportWidth: 0,
        viewportHeight: 0
    }
};

const nodeState = new WeakMap();

class RafTimeline {
    constructor() {
        this.items = new Map();
        this.nextId = 1;
    }

    add({ duration, onFrame, onComplete, easing = EASING.outCubic, name = "timeline" }) {
        if (state.reducedMotion || duration <= 0) {
            onFrame?.(1, performance.now(), 1);
            onComplete?.();
            return 0;
        }

        const id = this.nextId++;
        const startTime = performance.now();
        let raf = 0;
        let stopped = false;

        const tick = (now) => {
            if (stopped) return;
            const raw = clamp((now - startTime) / duration, 0, 1);
            const eased = easing(raw);
            onFrame?.(eased, now, raw);

            if (raw < 1) {
                raf = requestAnimationFrame(tick);
                this.items.set(id, { raf, stop, name });
                return;
            }

            this.items.delete(id);
            onComplete?.();
        };

        const stop = () => {
            if (stopped) return;
            stopped = true;
            cancelAnimationFrame(raf);
            this.items.delete(id);
        };

        raf = requestAnimationFrame(tick);
        this.items.set(id, { raf, stop, name });
        return id;
    }

    cancelByName(name) {
        Array.from(this.items.values())
            .filter((item) => item.name === name)
            .forEach((item) => item.stop());
    }

    cancelAll() {
        Array.from(this.items.values()).forEach((item) => item.stop());
        this.items.clear();
    }
}

class ParticlePool {
    constructor({ className, size, layerResolver }) {
        this.className = className;
        this.size = size;
        this.layerResolver = layerResolver;
        this.available = [];
        this.active = new Set();
    }

    warm() {
        while (this.available.length < this.size) {
            this.available.push(this.create());
        }
    }

    create() {
        const node = document.createElement("span");
        node.className = this.className;
        node.setAttribute("aria-hidden", "true");
        return node;
    }

    acquire() {
        const node = this.available.pop() || this.create();
        this.active.add(node);
        return node;
    }

    release(node) {
        if (!node) return;
        node.remove();
        node.removeAttribute("style");
        node.className = this.className;
        this.active.delete(node);
        if (this.available.length < this.size) {
            this.available.push(node);
        }
    }

    append(node) {
        const layer = this.layerResolver();
        if (!layer || !node) return;
        layer.appendChild(node);
    }

    releaseAll() {
        Array.from(this.active).forEach((node) => this.release(node));
    }
}

const timeline = new RafTimeline();
const timers = new Set();
let sparklePool;
let confettiPool;
let ambientPool;

function query(selector, root = document) {
    return root.querySelector(selector);
}

function cacheDom() {
    dom.body = document.body;
    dom.page = query(SELECTORS.page) || document.body;
    dom.sparkleLayer = query(SELECTORS.sparkleLayer) || ensureLayer("sparkleLayer", "sparkle-layer");
    dom.confettiLayer = query(SELECTORS.confettiLayer) || ensureLayer("confettiLayer", "confetti-layer");
    dom.fxLayer = query(SELECTORS.fxLayer) || ensureLayer("fxLayer", "fx-layer");
    dom.wheelSection = query(SELECTORS.wheelSection);
    dom.wheelShell = query(SELECTORS.wheelShell);
    dom.wheelCanvas = query(SELECTORS.wheelCanvas);
    dom.wheelFx = query(SELECTORS.wheelFx);
    dom.wheelReflection = query(SELECTORS.wheelReflection);
    dom.wheelRingShine = query(SELECTORS.wheelRingShine);
    dom.wheelOverlay = query(SELECTORS.wheelOverlay);
    dom.wheelPointer = query(SELECTORS.wheelPointer);
    dom.centerGlow = query(SELECTORS.centerGlow);
    dom.availableSpin = query(SELECTORS.availableSpin);
    dom.btnSpin = query(SELECTORS.btnSpin);
    dom.runtimeHost = query(SELECTORS.runtimeHost);
}

function ensureLayer(id, className) {
    const node = document.createElement("div");
    node.id = id;
    node.className = className;
    node.setAttribute("aria-hidden", "true");
    document.body.appendChild(node);
    return node;
}

function ensurePools() {
    sparklePool ||= new ParticlePool({
        className: "sparkle spinfx-sparkle",
        size: DEFAULTS.sparklePoolSize,
        layerResolver: () => dom.sparkleLayer
    });
    confettiPool ||= new ParticlePool({
        className: "confetti-piece spinfx-confetti-piece",
        size: DEFAULTS.confettiPoolSize,
        layerResolver: () => dom.confettiLayer
    });
    ambientPool ||= new ParticlePool({
        className: "spinfx-ambient-orb",
        size: DEFAULTS.ambientParticlePoolSize,
        layerResolver: () => dom.fxLayer
    });

    sparklePool.warm();
    confettiPool.warm();
    ambientPool.warm();
}

function measureGeometry() {
    state.geometry.viewportWidth = window.innerWidth || document.documentElement.clientWidth || 360;
    state.geometry.viewportHeight = window.innerHeight || document.documentElement.clientHeight || 640;
    state.geometry.wheel = dom.wheelShell?.getBoundingClientRect() || null;
}

function schedule(callback, delay) {
    const id = window.setTimeout(() => {
        timers.delete(id);
        callback();
    }, delay);
    timers.add(id);
    return id;
}

function clearTimers() {
    timers.forEach((id) => window.clearTimeout(id));
    timers.clear();
}

function listen(target, type, handler, options = {}) {
    if (!target || !state.controller) return;
    const listenerOptions = {
        passive: options.passive ?? true,
        capture: options.capture ?? false,
        signal: state.controller.signal
    };
    target.addEventListener(type, handler, listenerOptions);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function random(min, max) {
    return min + Math.random() * (max - min);
}

function choose(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function parseCounterText(text) {
    const match = String(text || "").match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
}

function addClass(node, ...classNames) {
    node?.classList.add(...classNames.filter(Boolean));
}

function removeClass(node, ...classNames) {
    node?.classList.remove(...classNames.filter(Boolean));
}

function restartClass(node, className) {
    if (!node) return;
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
}

function releaseLater(pool, node, delay) {
    schedule(() => pool.release(node), delay);
}

function vibrate(pattern) {
    if (navigator.vibrate && state.visible) {
        navigator.vibrate(pattern);
    }
}

function isJackpotResult(result) {
    const reward = result?.reward || result || {};
    const type = String(reward.type || "").toLowerCase();
    const label = String(reward.label || reward.name || reward.reward || "").toLowerCase();
    const amount = Number(reward.amount ?? reward.value ?? 0);
    return type === "jackpot" || label.includes("jackpot") || amount >= 70;
}

function startIdleEngines() {
    if (state.idleRunning || state.reducedMotion) return;
    state.idleRunning = true;
    const token = ++state.idleToken;

    addClass(dom.page, "spinfx-page-ready");
    addClass(dom.wheelShell, "spinfx-idle-glow");
    addClass(dom.wheelReflection, "spinfx-reflection-active");
    addClass(dom.wheelOverlay, "spinfx-glass-active");
    addClass(dom.wheelRingShine, "spinfx-ring-active");
    addClass(dom.btnSpin, "shimmer", "spinfx-button-shine");

    const idleFrame = () => {
        if (!state.idleRunning || state.reducedMotion || token !== state.idleToken) return;
        emitSparkle();
        if (Math.random() > 0.68) emitAmbientOrb();
        schedule(idleFrame, random(180, 460));
    };

    idleFrame();
}

function stopIdleEngines() {
    state.idleRunning = false;
    state.idleToken += 1;
}

function emitSparkle(originRect = null, intensity = 1) {
    if (!dom.sparkleLayer || state.reducedMotion) return;
    const rect = originRect || state.geometry.wheel || dom.wheelShell?.getBoundingClientRect();
    if (!rect) return;

    const particle = sparklePool.acquire();
    const size = random(3, 8) * intensity;
    const x = rect.left + random(rect.width * 0.08, rect.width * 0.92);
    const y = rect.top + random(rect.height * 0.08, rect.height * 0.92);
    const driftX = random(-18, 18);
    const driftY = random(-34, -10);
    const duration = random(1200, 2600);

    particle.style.cssText = `
        left:${x}px;
        top:${y}px;
        width:${size}px;
        height:${size}px;
        color:${choose([THEME.gold, THEME.goldLight, THEME.emerald, THEME.white])};
        --spinfx-drift-x:${driftX}px;
        --spinfx-drift-y:${driftY}px;
        --spinfx-scale:${random(0.85, 1.35)};
        animation-duration:${duration}ms;
    `;

    sparklePool.append(particle);
    releaseLater(sparklePool, particle, duration + 80);
}

function emitAmbientOrb() {
    if (!dom.fxLayer || state.reducedMotion) return;
    const particle = ambientPool.acquire();
    const size = random(18, 46);
    const x = random(-5, 100);
    const y = random(4, 72);
    const duration = random(2800, 5200);

    particle.style.cssText = `
        left:${x}vw;
        top:${y}vh;
        width:${size}px;
        height:${size}px;
        --spinfx-orb-x:${random(-30, 30)}px;
        --spinfx-orb-y:${random(-46, -12)}px;
        --spinfx-orb-color:${choose(["rgba(212,175,55,.36)", "rgba(248,233,161,.26)", "rgba(24,195,126,.26)"])};
        animation-duration:${duration}ms;
    `;

    ambientPool.append(particle);
    releaseLater(ambientPool, particle, duration + 100);
}

function startWheelEngine() {
    addClass(dom.wheelSection, "is-spinning", "spinfx-spinning");
    addClass(dom.wheelCanvas, "motion-blur", "spinfx-motion-blur");
    addClass(dom.wheelFx, "spinfx-wheel-active");
    addClass(dom.wheelReflection, "spinfx-reflection-fast");
    addClass(dom.wheelRingShine, "spinfx-ring-fast");
    addClass(dom.centerGlow, "spinfx-center-active");
}

function stopWheelEngine() {
    removeClass(dom.wheelSection, "is-spinning", "spinfx-spinning");
    removeClass(dom.wheelCanvas, "motion-blur", "spinfx-motion-blur");
    removeClass(dom.wheelFx, "spinfx-wheel-active");
    removeClass(dom.wheelReflection, "spinfx-reflection-fast");
    removeClass(dom.wheelRingShine, "spinfx-ring-fast");
    removeClass(dom.centerGlow, "spinfx-center-active");
}

function tickPointer(force = false) {
    if (!dom.wheelPointer) return;
    restartClass(dom.wheelPointer, "spinfx-pointer-tick");
    if (force) vibrate(12);
}

function pulseCenter() {
    restartClass(dom.wheelShell, "center-pulse");
    restartClass(dom.centerGlow, "spinfx-center-pulse");
}

function flashScreen(mode = "soft") {
    if (!dom.fxLayer || state.reducedMotion) return;
    const node = document.createElement("span");
    node.className = `spinfx-screen-flash spinfx-screen-flash-${mode}`;
    node.setAttribute("aria-hidden", "true");
    dom.fxLayer.appendChild(node);
    schedule(() => node.remove(), mode === "jackpot" ? 980 : 560);
}

function createBurst({ count = 56, originX, originY, spread = 1, jackpot = false } = {}) {
    if (!dom.confettiLayer) return;
    const viewportWidth = state.geometry.viewportWidth || window.innerWidth || 360;
    const viewportHeight = state.geometry.viewportHeight || window.innerHeight || 640;
    const x0 = originX ?? viewportWidth / 2;
    const y0 = originY ?? viewportHeight * 0.34;
    const palette = jackpot
        ? [THEME.gold, THEME.goldLight, THEME.emerald, THEME.white, "#B7FFDA", "#FFF4C7"]
        : [THEME.gold, THEME.goldLight, THEME.emerald, THEME.white, "#7CFFB2"];

    for (let i = 0; i < count; i++) {
        const node = confettiPool.acquire();
        const angle = random(Math.PI * 0.08, Math.PI * 0.92);
        const distance = random(120, jackpot ? 420 : 290) * spread;
        const x = Math.cos(angle) * distance;
        const y = Math.sin(angle) * distance + random(40, 180);
        const width = random(5, jackpot ? 13 : 10);
        const height = random(7, jackpot ? 18 : 14);
        const duration = random(950, jackpot ? 2100 : 1650);

        node.style.cssText = `
            left:${x0}px;
            top:${y0}px;
            width:${width}px;
            height:${height}px;
            background:${palette[i % palette.length]};
            --spinfx-x:${x}px;
            --spinfx-y:${y}px;
            --spinfx-rotate:${random(360, jackpot ? 1260 : 860)}deg;
            --spinfx-delay:${random(0, 90)}ms;
            animation-duration:${duration}ms;
            animation-delay:var(--spinfx-delay);
        `;

        confettiPool.append(node);
        releaseLater(confettiPool, node, duration + 180);
    }
}

function animateCounter(nextValue) {
    if (!dom.availableSpin) return;
    const next = Number(nextValue);
    if (!Number.isFinite(next)) return;

    const stored = nodeState.get(dom.availableSpin);
    const previous = Number.isFinite(stored?.counter)
        ? stored.counter
        : parseCounterText(dom.availableSpin.textContent);

    nodeState.set(dom.availableSpin, { ...stored, counter: next });
    state.lastCounterValue = next;

    timeline.cancelByName("reward-counter");
    timeline.add({
        name: "reward-counter",
        duration: 520,
        easing: EASING.outQuart,
        onFrame: (t) => {
            const value = Math.round(previous + (next - previous) * t);
            dom.availableSpin.textContent = `🎟️ x${value}`;
            addClass(dom.availableSpin, "reward-counter", "spinfx-counter-pop");
        },
        onComplete: () => {
            dom.availableSpin.textContent = `🎟️ x${next}`;
            schedule(() => removeClass(dom.availableSpin, "reward-counter", "spinfx-counter-pop"), 160);
        }
    });
}

function revealResultModal(result) {
    const modal = dom.runtimeHost?.querySelector(SELECTORS.modal);
    if (!modal) return;

    addClass(modal, "modal-show", "spinfx-premium-modal");
    restartClass(modal, "spinfx-modal-reveal");

    const icon = modal.querySelector(SELECTORS.resultIcon);
    const ticket = modal.querySelector(SELECTORS.ticketCard);
    const body = modal.querySelector(SELECTORS.modalBody);

    addClass(icon, "spinfx-result-icon-ready");
    addClass(ticket, "spinfx-ticket-card-ready");
    restartClass(icon, "spinfx-ticket-reveal");
    restartClass(ticket, "spinfx-ticket-reveal");
    restartClass(body, "spinfx-modal-content-reveal");

    if (result?.reward) {
        createBurst({
            count: isJackpotResult(result) ? 96 : 54,
            jackpot: isJackpotResult(result)
        });
    }
}

function highlightWinner(index = 0) {
    const safeIndex = Number.isFinite(Number(index)) ? Number(index) : 0;
    const sectorCount = Math.max(1, state.sectorCount || DEFAULTS.sectorCount);
    const angle = ((safeIndex + 0.5) / sectorCount) * 360;

    dom.wheelShell?.style.setProperty("--spinfx-winner-angle", `${angle}deg`);
    dom.wheelShell?.style.setProperty("--spinfx-sector-size", `${360 / sectorCount}deg`);

    restartClass(dom.wheelShell, "wheel-winning");
    restartClass(dom.wheelFx, "spinfx-winner-sweep");
    pulseCenter();
    tickPointer(true);
    emitSparkle(state.geometry.wheel, 1.45);
    flashScreen("soft");
    schedule(() => removeClass(dom.wheelFx, "spinfx-winner-sweep"), 1200);
}

function cleanupVisualState({ animateOut = false } = {}) {
    if (animateOut && dom.fxLayer && !state.reducedMotion) {
        flashScreen("cleanup");
    }

    stopWheelEngine();
    removeClass(dom.wheelShell, "wheel-winning", "center-pulse", "spinfx-idle-glow", "spinfx-jackpot-mode");
    removeClass(dom.wheelFx, "spinfx-winner-sweep", "spinfx-wheel-active");
    removeClass(dom.wheelReflection, "spinfx-reflection-active", "spinfx-reflection-fast");
    removeClass(dom.wheelRingShine, "spinfx-ring-active", "spinfx-ring-fast");
    removeClass(dom.wheelOverlay, "spinfx-glass-active");
    removeClass(dom.centerGlow, "spinfx-center-active", "spinfx-center-pulse");
    removeClass(dom.wheelPointer, "spinfx-pointer-tick");
    removeClass(dom.btnSpin, "spinfx-button-shine");
}

function handleVisibilityChange() {
    state.visible = document.visibilityState !== "hidden";
    if (!state.visible) {
        stopIdleEngines();
        return;
    }
    measureGeometry();
    startIdleEngines();
}

function handleResize() {
    timeline.cancelByName("geometry-refresh");
    timeline.add({
        name: "geometry-refresh",
        duration: 120,
        easing: EASING.outCubic,
        onFrame: () => {},
        onComplete: measureGeometry
    });
}

function handleReducedMotionChange(event) {
    state.reducedMotion = Boolean(event.matches);
    if (state.reducedMotion) {
        stopIdleEngines();
        sparklePool?.releaseAll();
        ambientPool?.releaseAll();
        confettiPool?.releaseAll();
        cleanupVisualState();
        return;
    }
    startIdleEngines();
}

/**
 * Initialize SpinFX, cache DOM nodes, warm particle pools, bind passive cleanup listeners, and start idle premium effects.
 * @param {{ sectorCount?: number }} [options] Optional initial wheel configuration.
 * @returns {void}
 */
function init(options = {}) {
    if (state.initialized) return;

    state.initialized = true;
    state.controller = new AbortController();
    state.mediaQuery = window.matchMedia(DEFAULTS.reducedMotionQuery);
    state.reducedMotion = state.mediaQuery.matches;
    state.visible = document.visibilityState !== "hidden";
    state.sectorCount = Number(options.sectorCount) || DEFAULTS.sectorCount;

    cacheDom();
    ensurePools();
    measureGeometry();

    listen(window, "resize", handleResize, { passive: true });
    listen(window, "orientationchange", handleResize, { passive: true });
    listen(document, "visibilitychange", handleVisibilityChange, { passive: true });
    listen(window, "pagehide", () => cleanup(), { passive: true });
    listen(state.mediaQuery, "change", handleReducedMotionChange, { passive: true });

    startIdleEngines();
}

/**
 * Start spin-time visual effects and run an optional frame callback through the SpinFX Animation Manager.
 * @param {{ duration?: number, sectorCount?: number, onFrame?: (progress:number, now:number, raw:number) => void }} [options] Spin animation options.
 * @returns {Promise<void>} Resolves when the spin animation timeline completes.
 */
function start(options = {}) {
    cacheDom();
    measureGeometry();

    const token = ++state.spinToken;
    const duration = Number(options.duration) || DEFAULTS.spinDuration;
    state.sectorCount = Number(options.sectorCount) || state.sectorCount || DEFAULTS.sectorCount;
    state.spinRunning = true;
    state.pointerSector = -1;

    startWheelEngine();

    return new Promise((resolve) => {
        timeline.cancelByName("wheel-spin");
        timeline.add({
            name: "wheel-spin",
            duration,
            easing: EASING.outCubic,
            onFrame: (eased, now, raw) => {
                if (token !== state.spinToken) return;
                const speed = 1 - raw;
                const sector = Math.floor((raw * state.sectorCount * 42) % state.sectorCount);

                if (sector !== state.pointerSector) {
                    state.pointerSector = sector;
                    tickPointer(false);
                }

                if (raw < 0.92 && Math.random() > 0.72) {
                    emitSparkle(state.geometry.wheel, 1 + speed * 0.8);
                }

                dom.wheelShell?.style.setProperty("--spinfx-spin-speed", String(speed));
                options.onFrame?.(eased, now, raw);
            },
            onComplete: () => {
                if (token === state.spinToken) {
                    state.spinRunning = false;
                }
                resolve();
            }
        });
    });
}

/**
 * Stop spin-time effects, clear motion blur, trigger center pulse, and return to idle glow.
 * @returns {void}
 */
function stop() {
    state.spinRunning = false;
    stopWheelEngine();
    pulseCenter();
    flashScreen("soft");
    vibrate([18, 24, 18]);
    startIdleEngines();
}

/**
 * Highlight the winning wheel sector with Gold Soft Emerald pulse and pointer tick effects.
 * @param {number} index Winning sector index.
 * @returns {void}
 */
function highlight(index = 0) {
    highlightWinner(index);
}

/**
 * Animate a completed spin result: premium modal reveal, ticket reveal, reward counter, confetti, and jackpot detection.
 * @param {{ reward?: object, remainingSpins?: number }} [resultPayload] Backend spin result payload.
 * @returns {void}
 */
function result(resultPayload = {}) {
    cacheDom();
    revealResultModal(resultPayload);

    if (typeof resultPayload.remainingSpins === "number") {
        animateCounter(resultPayload.remainingSpins);
    }

    if (isJackpotResult(resultPayload)) {
        jackpot();
    }
}

/**
 * Play jackpot celebration mode with intense glow, screen flash, confetti, particles, and haptic pulse.
 * @returns {void}
 */
function jackpot() {
    cacheDom();
    measureGeometry();
    addClass(dom.wheelShell, "spinfx-jackpot-mode");
    addClass(dom.page, "jackpot-mode");
    restartClass(dom.wheelFx, "spinfx-jackpot-sweep");
    flashScreen("jackpot");
    createBurst({ count: 128, jackpot: true, spread: 1.18 });

    for (let i = 0; i < 18; i++) {
        schedule(() => emitSparkle(state.geometry.wheel, 1.7), i * 45);
    }

    vibrate([28, 36, 28, 50, 80]);
    schedule(() => {
        removeClass(dom.wheelShell, "spinfx-jackpot-mode");
        removeClass(dom.page, "jackpot-mode");
        removeClass(dom.wheelFx, "spinfx-jackpot-sweep");
    }, 1800);
}

/**
 * Cleanup all SpinFX animations, timers, particles, listeners, transient classes, and cached lifecycle state.
 * @returns {void}
 */
function cleanup() {
    stopIdleEngines();
    state.spinRunning = false;
    state.spinToken += 1;
    timeline.cancelAll();
    clearTimers();
    sparklePool?.releaseAll();
    confettiPool?.releaseAll();
    ambientPool?.releaseAll();
    cleanupVisualState({ animateOut: false });
    state.controller?.abort();
    state.controller = null;
    state.initialized = false;
}

export const SpinFX = Object.freeze({
    init,
    start,
    stop,
    highlight,
    result,
    jackpot,
    cleanup
});
