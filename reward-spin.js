/* ==========================================================
   ALEXA
   File : reward-spin.js
   Description : Lucky Spin Controller
========================================================== */

import {
    auth,
    db,
    onAuthStateChanged
} from "./firebase.js";

import {
    collection,
    query,
    where,
    getDocs
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

/* ==========================================================
   CONFIG
========================================================== */

const LOGIN_PAGE = "login.html";
const INVITE_PAGE = "invite.html";
const DAILY_PAGE = "daily.html";

const API_BASE =
    window.ALEXA_SPIN_API_BASE ||
    "https://alexachain.lexanet-chain.workers.dev";

const APP_VERSION = "v1.0.0";
const SPIN_EXCHANGE_PRICE = 0.1;
const SPIN_ANIMATION_MS = 5200;
const SPIN_FULL_TURNS = 6;
const TAU = Math.PI * 2;

const DEFAULT_WHEEL_SECTORS = [
    {
        label: "0.05 LEXA",
        amount: 0.05,
        type: "lexa",
        color: "#E3B23C"
    },
    {
        label: "0.50 LEXA",
        amount: 0.5,
        type: "lexa",
        color: "#B88A1E"
    },
    {
        label: "1.5 LEXA",
        amount: 1.5,
        type: "lexa",
        color: "#1FAE63"
    },
    {
        label: "5 LEXA",
        amount: 5,
        type: "lexa",
        color: "#6E59FF"
    },
    {
        label: "7 LEXA",
        amount: 7,
        type: "lexa",
        color: "#D97706"
    },
    {
        label: "Mystery Box",
        type: "mystery",
        color: "#3A4D70"
    },
    {
        label: "70 LEXA",
        amount: 70,
        type: "jackpot",
        color: "#D4AF37"
    }
];

const DEFAULT_TASKS = {
    referral: {
        current: 0,
        target: 2,
        rewardSpins: 1
    },
    daily: {
        current: 0,
        target: 7,
        rewardSpins: 1
    },
    exchange: {
        price: SPIN_EXCHANGE_PRICE,
        rewardSpins: 1
    }
};

const DEFAULT_RULES = [
    "New users get 1 welcome spin.",
    "Every 2 successful referrals earn +1 spin.",
    "Daily check-in can earn +1 spin.",
    "Exchange 0.1 LEXA for +1 spin.",
    "Rewards are determined by the server."
];

/* ==========================================================
   STATE
========================================================== */

const state = {
    initialized: false,
    loading: false,
    backendReady: false,
    authenticated: false,
    firebaseUser: null,
    profile: null,

    spins: 0,
    tasks: structuredClone(DEFAULT_TASKS),
    rewardPool: [],
    history: [],
    wheelSectors: [...DEFAULT_WHEEL_SECTORS],

    wheelCanvasSize: 360,
    wheelRotation: 0,
    spinning: false,
    currentSpinResult: null
};

/* ==========================================================
   DOM
========================================================== */

const $ = (id) => document.getElementById(id);

const dom = {
    body: null,
    page: null,

    btnBack: null,
    btnHistory: null,
    btnSpin: null,
    btnExchangeSpin: null,

    availableSpin: null,
    spinWheel: null,

    taskItems: [],
    rewardGrid: null,
    spinRules: null,

    loadingOverlay: null,
    loadingText: null,

    toastContainer: null,
    runtimeHost: null,

    spinInfoCard: null,
    wheelSection: null
};

/* ==========================================================
   INIT
========================================================== */

document.addEventListener("DOMContentLoaded", init);

async function init() {
    if (state.initialized) return;
    state.initialized = true;

    cacheDom();
    ensureRuntimeNodes();
    bindEvents();
    bindTaskActions();
    setupCanvas();
    drawWheel();

    observeResize();
    observeConnection();

    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            location.replace(LOGIN_PAGE);
            return;
        }

        state.firebaseUser = user;
        state.authenticated = true;

        try {
            showLoading("Loading Lucky Spin...");
            await loadPageData();
        } catch (error) {
            console.error(error);
            state.backendReady = false;
            showToast("error", "Lucky Spin", error.message || "Failed to load spin data.");
            renderAll();
        } finally {
            hideLoading();
        }
    });
}

/* ==========================================================
   DOM CACHE
========================================================== */

function cacheDom() {
    dom.body = document.body;
    dom.page = document.querySelector(".reward-spin-page") || document.body;

    dom.btnBack = $("btnBack");
    dom.btnHistory = $("btnHistory");
    dom.btnSpin = $("btnSpin");
    dom.btnExchangeSpin = $("btnExchangeSpin");

    dom.availableSpin = $("availableSpin");
    dom.spinWheel = $("spinWheel");

    dom.taskItems = Array.from(document.querySelectorAll(".task-item"));
    dom.rewardGrid = document.querySelector(".reward-grid");
    dom.spinRules = document.querySelector(".spin-rules");

    dom.loadingOverlay = $("loadingOverlay");
    dom.loadingText = $("loadingText");

    dom.toastContainer = $("toastContainer");
    dom.runtimeHost = $("rewardSpinRuntime");

    dom.spinInfoCard = document.querySelector(".spin-info");
    dom.wheelSection = document.querySelector(".spin-wheel-section");
}

function ensureRuntimeNodes() {
    if (!dom.toastContainer) {
        dom.toastContainer = document.createElement("div");
        dom.toastContainer.id = "toastContainer";
        dom.toastContainer.style.cssText = `
            position: fixed;
            left: 50%;
            bottom: 22px;
            transform: translateX(-50%);
            width: min(92vw, 420px);
            z-index: 1000000;
            pointer-events: none;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;
        document.body.appendChild(dom.toastContainer);
    }

    if (!dom.runtimeHost) {
        dom.runtimeHost = document.createElement("div");
        dom.runtimeHost.id = "rewardSpinRuntime";
        document.body.appendChild(dom.runtimeHost);
    }

    if (!dom.loadingOverlay) {
        dom.loadingOverlay = document.createElement("div");
        dom.loadingOverlay.id = "loadingOverlay";
        dom.loadingOverlay.className = "loading-overlay";
        dom.loadingOverlay.hidden = true;
        dom.loadingOverlay.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 999999;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0,0,0,.6);
            backdrop-filter: blur(10px);
        `;

        dom.loadingOverlay.innerHTML = `
            <div class="loading-card" style="
                width: min(320px, 86vw);
                padding: 22px;
                border-radius: 22px;
                background: linear-gradient(180deg, rgba(22,31,49,.98), rgba(10,16,28,.98));
                border: 1px solid rgba(255,255,255,.08);
                box-shadow: 0 18px 48px rgba(0,0,0,.35);
                text-align: center;
            ">
                <div class="loading-spinner" style="
                    width: 40px;
                    height: 40px;
                    margin: 0 auto 14px;
                    border-radius: 50%;
                    border: 4px solid rgba(255,255,255,.12);
                    border-top-color: #D4AF37;
                    animation: rewardSpinLoader 1s linear infinite;
                "></div>
                <p id="loadingText" style="
                    margin: 0;
                    color: #a3afc2;
                    font-size: 14px;
                ">Loading...</p>
            </div>
        `;

        document.body.appendChild(dom.loadingOverlay);
        dom.loadingText = $("loadingText");
    }

    if (!document.getElementById("rewardSpinInlineStyle")) {
        const style = document.createElement("style");
        style.id = "rewardSpinInlineStyle";
        style.textContent = `
            @keyframes rewardSpinLoader { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            @keyframes rewardToastIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes rewardToastOut { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(8px); } }
            @keyframes rewardPopIn { from { opacity: 0; transform: translateY(18px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
            @keyframes rewardPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.04); } }
        `;
        document.head.appendChild(style);
    }
}

/* ==========================================================
   EVENTS
========================================================== */

function bindEvents() {
    dom.btnBack?.addEventListener("click", () => history.back());
    dom.btnHistory?.addEventListener("click", openHistoryModal);
    dom.btnSpin?.addEventListener("click", handleSpinClick);
    dom.btnExchangeSpin?.addEventListener("click", handleExchangeSpin);

    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeRuntimeModal();
        }
    });
}

function bindTaskActions() {
    if (dom.taskItems[0]) {
        dom.taskItems[0].style.cursor = "pointer";
        dom.taskItems[0].addEventListener("click", () => {
            location.href = INVITE_PAGE;
        });
    }

    if (dom.taskItems[1]) {
        dom.taskItems[1].style.cursor = "pointer";
        dom.taskItems[1].addEventListener("click", () => {
            location.href = DAILY_PAGE;
        });
    }
}

/* ==========================================================
   AUTH + DATA
========================================================== */

async function loadPageData() {
    const token = await getIdToken();

    const [dashboard, profile] = await Promise.all([
        apiGet("/api/spin", token),
        loadUserProfile().catch(() => null)
    ]);

    applyDashboard(dashboard);
    applyProfile(profile);
    renderAll();
}

async function loadUserProfile() {
    const user = state.firebaseUser || auth.currentUser;
    if (!user) return null;

    const q = query(
        collection(db, "users"),
        where("firebaseUid", "==", user.uid)
    );

    const snap = await getDocs(q);

    if (snap.empty) {
        return {
            displayName: user.displayName || "Unknown",
            username: user.displayName || "Unknown",
            email: user.email || "-",
            uid: "-"
        };
    }

    return snap.docs[0].data();
}

function applyDashboard(payload = {}) {
    state.backendReady = true;

    state.spins = toNumber(payload.spins ?? payload.availableSpins ?? 0, 0);

    state.tasks = {
        referral: {
            current: toNumber(payload?.tasks?.referral?.current, DEFAULT_TASKS.referral.current),
            target: toNumber(payload?.tasks?.referral?.target, DEFAULT_TASKS.referral.target),
            rewardSpins: toNumber(payload?.tasks?.referral?.rewardSpins, DEFAULT_TASKS.referral.rewardSpins)
        },
        daily: {
            current: toNumber(payload?.tasks?.daily?.current, DEFAULT_TASKS.daily.current),
            target: toNumber(payload?.tasks?.daily?.target, DEFAULT_TASKS.daily.target),
            rewardSpins: toNumber(payload?.tasks?.daily?.rewardSpins, DEFAULT_TASKS.daily.rewardSpins)
        },
        exchange: {
            price: toNumber(payload?.tasks?.exchange?.price, DEFAULT_TASKS.exchange.price),
            rewardSpins: toNumber(payload?.tasks?.exchange?.rewardSpins, DEFAULT_TASKS.exchange.rewardSpins)
        }
    };

    const sectors = payload?.wheel?.sectors || payload?.sectors || payload?.rewardPool;
    state.wheelSectors = normalizeSectors(sectors && sectors.length ? sectors : DEFAULT_WHEEL_SECTORS);

    state.rewardPool = state.wheelSectors.map((sector) => ({
        label: sector.label,
        chance: sector.chance ?? null,
        type: sector.type
    }));

    if (Array.isArray(payload.history)) {
        state.history = payload.history;
    }

    if (typeof payload.rotation === "number") {
        state.wheelRotation = payload.rotation;
    }
}

function applyProfile(profile) {
    state.profile = profile || null;
}

/* ==========================================================
   RENDER
========================================================== */

function renderAll() {
    renderSpinInfo();
    renderSpinButton();
    renderTasks();
    renderRewardPool();
    renderRules();
    renderWheel();
    renderIdentity();
}

function renderSpinInfo() {
    if (dom.availableSpin) {
        dom.availableSpin.textContent = `🎟️ x${state.spins}`;
    }
}

function renderSpinButton() {
    if (!dom.btnSpin) return;

    if (state.spinning) {
        dom.btnSpin.disabled = true;
        dom.btnSpin.innerHTML = `<span>SPINNING...</span>`;
        return;
    }

    if (!state.backendReady) {
        dom.btnSpin.disabled = true;
        dom.btnSpin.innerHTML = `<span>CONNECTING...</span>`;
        return;
    }

    dom.btnSpin.disabled = false;

    if (state.spins > 0) {
        dom.btnSpin.innerHTML = `<span>SPIN NOW</span>`;
    } else {
        dom.btnSpin.innerHTML = `<span>GET MORE SPINS</span>`;
    }
}

function renderTasks() {
    const referral = state.tasks.referral;
    const daily = state.tasks.daily;
    const exchange = state.tasks.exchange;

    if (dom.taskItems[0]) {
        dom.taskItems[0].innerHTML = `
            <div class="task-left">
                <strong>👥 Referral Task</strong>
                <small>${referral.current} / ${referral.target} Referral</small>
            </div>
            <div class="task-right">
                🎡 +${referral.rewardSpins} Spin
            </div>
        `;
        dom.taskItems[0].title = "Invite friends";
    }

    if (dom.taskItems[1]) {
        dom.taskItems[1].innerHTML = `
            <div class="task-left">
                <strong>📅 Daily Check-in</strong>
                <small>Day ${daily.current} / ${daily.target}</small>
            </div>
            <div class="task-right">
                🎡 +${daily.rewardSpins} Spin
            </div>
        `;
        dom.taskItems[1].title = "Daily check-in";
    }

    if (dom.taskItems[2]) {
        dom.taskItems[2].innerHTML = `
            <div class="task-left">
                <strong>🪙 Exchange LEXA</strong>
                <small>${formatLexa(exchange.price)} LEXA → +${exchange.rewardSpins} Spin</small>
            </div>
            <button type="button" class="small-gold-btn" id="btnExchangeSpin">
                +1 Spin
            </button>
        `;
        const newBtn = dom.taskItems[2].querySelector("#btnExchangeSpin");
        if (newBtn) {
            dom.btnExchangeSpin = newBtn;
            dom.btnExchangeSpin.addEventListener("click", handleExchangeSpin);
        }
    }
}

function renderRewardPool() {
    if (!dom.rewardGrid) return;

    dom.rewardGrid.innerHTML = state.wheelSectors.map((sector) => {
        const chance = sector.chance != null ? `<small>${formatChance(sector.chance)}</small>` : "";
        return `
            <div class="reward-pill">
                <strong>${escapeHtml(sector.label)}</strong>
                ${chance}
            </div>
        `;
    }).join("");
}

function renderRules() {
    if (!dom.spinRules) return;

    dom.spinRules.innerHTML = DEFAULT_RULES.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("");
}

function renderWheel() {
    fitWheelCanvas();
    drawWheel();
}

function renderIdentity() {
    // Optional hooks if later you add username / UID / avatar on this page
    const nameNode = $("spinUsername");
    const uidNode = $("spinUid");
    const avatarNode = $("spinAvatar");

    if (nameNode) {
        nameNode.textContent =
            state.profile?.displayName ||
            state.profile?.username ||
            state.firebaseUser?.displayName ||
            "User";
    }

    if (uidNode) {
        uidNode.textContent =
            `UID : ${state.profile?.uid || "-"}`;
    }

    if (avatarNode && state.firebaseUser) {
        avatarNode.src =
            state.profile?.avatar ||
            state.firebaseUser.photoURL ||
            "assets/avatar/default.png";
    }
}

/* ==========================================================
   CANVAS WHEEL
========================================================== */

let wheelCtx = null;

function setupCanvas() {
    if (!dom.spinWheel) return;

    wheelCtx = dom.spinWheel.getContext("2d");
    fitWheelCanvas();
}

function fitWheelCanvas() {
    if (!dom.spinWheel) return;

    const rect = dom.spinWheel.getBoundingClientRect();
    const size = Math.max(280, Math.min(rect.width || 360, 420));
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    state.wheelCanvasSize = size;

    dom.spinWheel.width = Math.floor(size * dpr);
    dom.spinWheel.height = Math.floor(size * dpr);
    dom.spinWheel.style.width = `${size}px`;
    dom.spinWheel.style.height = `${size}px`;

    if (wheelCtx) {
        wheelCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
}

function drawWheel() {
    if (!wheelCtx || !dom.spinWheel) return;

    const ctx = wheelCtx;
    const size = state.wheelCanvasSize;
    const center = size / 2;
    const radius = Math.min(center - 10, 170);

    ctx.clearRect(0, 0, size, size);

    // Background halo
    const halo = ctx.createRadialGradient(center, center, 8, center, center, radius + 24);
    halo.addColorStop(0, "rgba(212,175,55,.18)");
    halo.addColorStop(1, "rgba(0,0,0,0)");

    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(center, center, radius + 20, 0, TAU);
    ctx.fill();

    const sectors = state.wheelSectors.length ? state.wheelSectors : DEFAULT_WHEEL_SECTORS;
    const sectorAngle = TAU / sectors.length;
    const startBase = state.wheelRotation - Math.PI / 2;

    for (let i = 0; i < sectors.length; i++) {
        const sector = sectors[i];
        const start = startBase + i * sectorAngle;
        const end = start + sectorAngle;
        const mid = start + sectorAngle / 2;

        // Wedge
        const gradient = ctx.createLinearGradient(
            center + Math.cos(mid) * 10,
            center + Math.sin(mid) * 10,
            center + Math.cos(mid) * radius,
            center + Math.sin(mid) * radius
        );

        const baseColor = sector.color || pickSectorColor(i);
        gradient.addColorStop(0, lightenColor(baseColor, 18));
        gradient.addColorStop(1, darkenColor(baseColor, 14));

        ctx.beginPath();
        ctx.moveTo(center, center);
        ctx.arc(center, center, radius, start, end);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // Separator line
        ctx.strokeStyle = "rgba(255,255,255,.18)";
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Label
        ctx.save();
        ctx.translate(center, center);
        ctx.rotate(mid);

        const lines = wrapWheelLabel(sector.label);
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.font = "700 15px Poppins, sans-serif";
        ctx.fillStyle = "#FFF8E4";
        ctx.shadowColor = "rgba(0,0,0,.25)";
        ctx.shadowBlur = 4;

        const labelRadius = radius - 26;
        const lineHeight = 18;
        const lineCount = lines.length;
        const startY = ((lineCount - 1) * lineHeight) / -2;

        for (let j = 0; j < lines.length; j++) {
            const text = lines[j];
            let textX = labelRadius;
            let textY = startY + j * lineHeight;

            // Flip text on the left side so it's readable
            const angleDeg = (mid * 180) / Math.PI;
            if (angleDeg > 90 && angleDeg < 270) {
                ctx.rotate(Math.PI);
                textX = -labelRadius;
                ctx.textAlign = "left";
            }

            ctx.fillText(text, textX, textY);
            ctx.setTransform(
                Math.max(1, window.devicePixelRatio || 1), 0, 0,
                Math.max(1, window.devicePixelRatio || 1), 0, 0
            );
            ctx.translate(center, center);
            ctx.rotate(mid);
        }

        ctx.restore();
    }

    // Outer ring
    ctx.beginPath();
    ctx.arc(center, center, radius + 2, 0, TAU);
    ctx.strokeStyle = "rgba(255,255,255,.25)";
    ctx.lineWidth = 6;
    ctx.stroke();

    // Inner hub
    const hub = ctx.createRadialGradient(center, center, 4, center, center, 48);
    hub.addColorStop(0, "#FFF7D1");
    hub.addColorStop(0.45, "#D4AF37");
    hub.addColorStop(1, "#8A6510");

    ctx.beginPath();
    ctx.arc(center, center, 34, 0, TAU);
    ctx.fillStyle = hub;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(center, center, 22, 0, TAU);
    ctx.fillStyle = "rgba(10,16,28,.85)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(center, center, 9, 0, TAU);
    ctx.fillStyle = "#D4AF37";
    ctx.fill();

    // Hub shine
    ctx.beginPath();
    ctx.arc(center - 8, center - 8, 6, 0, TAU);
    ctx.fillStyle = "rgba(255,255,255,.45)";
    ctx.fill();
}

function normalizeRotation(angle) {
    let out = angle % TAU;
    if (out < 0) out += TAU;
    return out;
}

function getTargetRotationForSector(index) {
    const sectors = state.wheelSectors.length ? state.wheelSectors : DEFAULT_WHEEL_SECTORS;
    const sectorAngle = TAU / sectors.length;
    const desired = -((index + 0.5) * sectorAngle);
    const current = normalizeRotation(state.wheelRotation);
    const target = normalizeRotation(desired);
    const delta = (target - current + TAU) % TAU;

    return state.wheelRotation + (SPIN_FULL_TURNS * TAU) + delta;
}

async function animateWheelToSector(index) {
    const start = state.wheelRotation;
    const end = getTargetRotationForSector(index);

    return new Promise((resolve) => {
        const startTime = performance.now();

        const frame = (now) => {
            const elapsed = now - startTime;
            const t = Math.min(1, elapsed / SPIN_ANIMATION_MS);
            const eased = easeOutCubic(t);

            state.wheelRotation = start + (end - start) * eased;
            drawWheel();

            if (t < 1) {
                requestAnimationFrame(frame);
            } else {
                state.wheelRotation = end;
                drawWheel();
                resolve();
            }
        };

        requestAnimationFrame(frame);
    });
}

/* ==========================================================
   SPIN ACTION
========================================================== */

async function handleSpinClick() {
    if (state.spinning) return;

    if (!state.backendReady) {
        showToast("warning", "Lucky Spin", "Backend belum tersambung.");
        return;
    }

    if (state.spins <= 0) {
        openNoSpinModal();
        return;
    }

    state.spinning = true;
    renderSpinButton();

    try {
        const token = await getIdToken();
        const result = await apiPost("/api/spin/start", token, {
            clientVersion: APP_VERSION,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
        });

        state.currentSpinResult = result;

        const reward = result.reward || {};
        const sectorIndex = resolveSectorIndex(result, reward);

        if (typeof result.remainingSpins === "number") {
            state.spins = Math.max(0, result.remainingSpins);
        }

        renderSpinInfo();
        renderSpinButton();

        await animateWheelToSector(sectorIndex);

        playSpinStopEffects();
        showSpinResultModal(result);

        // refresh silently so tasks/spins/history stay in sync with backend
        await refreshQuietly();
    } catch (error) {
        console.error(error);
        showToast("error", "Lucky Spin", error.message || "Spin failed.");
    } finally {
        state.spinning = false;
        renderSpinButton();
    }
}

function resolveSectorIndex(result, reward) {
    const maybeIndex =
        reward?.sectorIndex ??
        reward?.sector ??
        result?.sectorIndex ??
        result?.sector ??
        result?.wheelIndex;

    if (Number.isInteger(maybeIndex)) {
        return clampIndex(maybeIndex, state.wheelSectors.length);
    }

    const label = reward?.label || reward?.name || reward?.reward || result?.rewardLabel;
    if (label) {
        const found = state.wheelSectors.findIndex((s) =>
            String(s.label).toLowerCase() === String(label).toLowerCase()
        );
        if (found >= 0) return found;
    }

    return 0;
}

function clampIndex(index, length) {
    if (!length) return 0;
    let n = Number(index) || 0;
    while (n < 0) n += length;
    while (n >= length) n -= length;
    return n;
}

async function refreshQuietly() {
    try {
        const token = await getIdToken();
        const dashboard = await apiGet("/api/spin", token);
        applyDashboard(dashboard);
        renderAll();
    } catch (error) {
        console.error(error);
    }
}

/* ==========================================================
   EXCHANGE
========================================================== */

async function handleExchangeSpin() {
    if (!state.backendReady) {
        showToast("warning", "Lucky Spin", "Backend belum tersambung.");
        return;
    }

    const price = state.tasks.exchange?.price ?? SPIN_EXCHANGE_PRICE;
    const accepted = window.confirm(
        `Tukar ${formatLexa(price)} LEXA menjadi +1 spin?`
    );

    if (!accepted) return;

    try {
        const token = await getIdToken();
        const result = await apiPost("/api/spin/exchange", token, {
            amount: price,
            appVersion: APP_VERSION
        });

        if (typeof result.remainingSpins === "number") {
            state.spins = result.remainingSpins;
        }

        showToast("success", "Exchange", result.message || "+1 spin added.");
        await refreshQuietly();
    } catch (error) {
        console.error(error);
        showToast("error", "Exchange", error.message || "Exchange failed.");
    }
}

/* ==========================================================
   HISTORY
========================================================== */

async function openHistoryModal() {
    if (!state.backendReady) {
        showToast("warning", "History", "Backend belum tersambung.");
        return;
    }

    openRuntimeModal({
        title: "Spin History",
        width: 560,
        bodyHtml: `
            <div id="historyContent" style="display:flex;flex-direction:column;gap:12px;">
                <div style="color:#a3afc2;font-size:14px;">Loading history...</div>
            </div>
        `,
        footerHtml: `<button class="runtime-primary" data-close-modal>Close</button>`
    });

    try {
        const token = await getIdToken();
        const history = await apiGet("/api/spin/history?limit=20", token);
        const items = Array.isArray(history.items) ? history.items : (Array.isArray(history.history) ? history.history : []);

        const content = $("historyContent");
        if (content) {
            content.innerHTML = renderHistoryList(items);
        }
    } catch (error) {
        console.error(error);
        const content = $("historyContent");
        if (content) {
            content.innerHTML = `
                <div style="color:#ff8e8e;font-size:14px;">
                    ${escapeHtml(error.message || "Unable to load history.")}
                </div>
            `;
        }
    }
}

function renderHistoryList(items) {
    if (!items.length) {
        return `
            <div style="
                padding: 18px;
                border-radius: 18px;
                background: rgba(255,255,255,.04);
                border: 1px solid rgba(255,255,255,.06);
                color: #a3afc2;
                font-size: 14px;
                text-align: center;
            ">
                No history yet.
            </div>
        `;
    }

    return items.map((item) => {
        const label =
            item.label ||
            item.rewardLabel ||
            item.reward ||
            item.title ||
            "Lucky Spin";

        const amount =
            item.amount != null
                ? `${formatRewardAmount(item.amount)} LEXA`
                : (item.value != null ? `${formatRewardAmount(item.value)} LEXA` : "");

        const status = item.status || "SUCCESS";
        const createdAt = item.createdAt || item.timestamp || item.time || "";

        return `
            <div style="
                display:flex;
                justify-content:space-between;
                gap:12px;
                padding: 14px 16px;
                border-radius: 18px;
                background: rgba(255,255,255,.04);
                border: 1px solid rgba(255,255,255,.06);
            ">
                <div style="min-width:0;flex:1;">
                    <div style="font-weight:800;color:#fff;line-height:1.3;">${escapeHtml(label)}</div>
                    <div style="font-size:12px;color:#a3afc2;margin-top:4px;">${escapeHtml(createdAt ? formatDateTime(createdAt) : "Unknown time")}</div>
                </div>

                <div style="text-align:right;flex-shrink:0;">
                    <div style="font-weight:800;color:#ffe8a3;">${escapeHtml(amount || status)}</div>
                    <div style="font-size:12px;color:#a3afc2;margin-top:4px;">${escapeHtml(status)}</div>
                </div>
            </div>
        `;
    }).join("");
}

/* ==========================================================
   RESULT
========================================================== */

function showSpinResultModal(result) {
    const reward = result.reward || {};
    const label = reward.label || reward.name || reward.reward || "Reward";
    const amount = reward.amount != null
        ? formatRewardAmount(reward.amount)
        : (reward.value != null ? formatRewardAmount(reward.value) : "");

    const icon =
        reward.type === "mystery"
            ? "🎁"
            : reward.type === "jackpot"
                ? "💎"
                : "🪙";

    const message =
        reward.description ||
        result.message ||
        "Your reward has been added.";

    const ticketId = result.ticketId || result.spinId || "-";
    const remaining = typeof result.remainingSpins === "number"
        ? result.remainingSpins
        : state.spins;

    openRuntimeModal({
        title: "Congratulations",
        width: 520,
        bodyHtml: `
            <div style="
                display:flex;
                flex-direction:column;
                align-items:center;
                gap:14px;
                text-align:center;
            ">
                <div style="
                    width:96px;
                    height:96px;
                    border-radius:50%;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    background: radial-gradient(circle, rgba(212,175,55,.28), rgba(212,175,55,.06));
                    border: 1px solid rgba(212,175,55,.25);
                    box-shadow: 0 0 0 8px rgba(212,175,55,.05), 0 0 34px rgba(212,175,55,.2);
                    font-size: 40px;
                    animation: rewardPopIn .35s ease;
                ">${icon}</div>

                <div style="font-size:26px;font-weight:900;letter-spacing:-.4px;background:linear-gradient(180deg,#fff,#fff0b8,#D4AF37);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
                    ${escapeHtml(label)}
                </div>

                ${
                    amount
                        ? `<div style="font-size:20px;font-weight:800;color:#fff;">${escapeHtml(amount)} LEXA</div>`
                        : ``
                }

                <div style="color:#a3afc2;font-size:14px;line-height:1.8;max-width: 32ch;">
                    ${escapeHtml(message)}
                </div>

                <div style="
                    width:100%;
                    margin-top:6px;
                    padding:16px;
                    border-radius:18px;
                    background: rgba(255,255,255,.04);
                    border:1px solid rgba(255,255,255,.06);
                ">
                    <div style="font-size:12px;color:#ffe8a3;letter-spacing:1px;text-transform:uppercase;">Ticket ID</div>
                    <div style="margin-top:6px;font-weight:800;color:#fff;word-break:break-word;">${escapeHtml(ticketId)}</div>
                </div>

                <div style="color:#a3afc2;font-size:13px;">
                    Remaining Spins: <strong style="color:#fff;">${escapeHtml(String(remaining))}</strong>
                </div>
            </div>
        `,
        footerHtml: `
            <button class="runtime-primary" data-close-modal>
                Awesome
            </button>
        `
    });

    createConfettiBurst();
}

/* ==========================================================
   NO SPIN MODAL
========================================================== */

function openNoSpinModal() {
    openRuntimeModal({
        title: "No Spins",
        width: 520,
        bodyHtml: `
            <div style="display:flex;flex-direction:column;gap:14px;">
                <div style="color:#a3afc2;line-height:1.8;font-size:14px;">
                    Kamu belum punya spin. Selesaikan task berikut untuk menambah spin.
                </div>

                <div style="
                    padding:14px 16px;
                    border-radius:18px;
                    background: rgba(255,255,255,.04);
                    border: 1px solid rgba(255,255,255,.06);
                ">
                    <div style="font-weight:800;color:#fff;">👥 Referral Task</div>
                    <div style="margin-top:4px;color:#a3afc2;font-size:13px;">2 referral aktif = +1 spin</div>
                </div>

                <div style="
                    padding:14px 16px;
                    border-radius:18px;
                    background: rgba(255,255,255,.04);
                    border: 1px solid rgba(255,255,255,.06);
                ">
                    <div style="font-weight:800;color:#fff;">📅 Daily Check-in</div>
                    <div style="margin-top:4px;color:#a3afc2;font-size:13px;">Check-in berturut-turut = +1 spin</div>
                </div>

                <div style="
                    padding:14px 16px;
                    border-radius:18px;
                    background: rgba(255,255,255,.04);
                    border: 1px solid rgba(255,255,255,.06);
                ">
                    <div style="font-weight:800;color:#fff;">🪙 Exchange</div>
                    <div style="margin-top:4px;color:#a3afc2;font-size:13px;">0.1 LEXA = +1 spin</div>
                </div>
            </div>
        `,
        footerHtml: `
            <button class="runtime-secondary" data-action="invite">Invite Friends</button>
            <button class="runtime-secondary" data-action="daily">Daily Check-in</button>
            <button class="runtime-primary" data-action="exchange">Exchange</button>
        `
    });

    dom.runtimeHost.querySelector('[data-action="invite"]')?.addEventListener("click", () => {
        closeRuntimeModal();
        location.href = INVITE_PAGE;
    });

    dom.runtimeHost.querySelector('[data-action="daily"]')?.addEventListener("click", () => {
        closeRuntimeModal();
        location.href = DAILY_PAGE;
    });

    dom.runtimeHost.querySelector('[data-action="exchange"]')?.addEventListener("click", () => {
        closeRuntimeModal();
        handleExchangeSpin();
    });
}

/* ==========================================================
   RUNTIME MODAL
========================================================== */

function openRuntimeModal({ title, bodyHtml, footerHtml = "", width = 520 }) {
    if (!dom.runtimeHost) return;

    dom.runtimeHost.hidden = false;
    dom.runtimeHost.innerHTML = `
        <div class="rewardspin-backdrop" style="
            position: fixed;
            inset: 0;
            z-index: 999998;
            background: rgba(0,0,0,.62);
            backdrop-filter: blur(12px);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
        ">
            <div class="rewardspin-modal" style="
                width: min(100%, ${width}px);
                max-height: 88vh;
                overflow: auto;
                border-radius: 24px;
                background: linear-gradient(180deg, rgba(22,31,49,.99), rgba(10,16,28,.99));
                border: 1px solid rgba(255,255,255,.08);
                box-shadow: 0 22px 60px rgba(0,0,0,.42);
                padding: 18px;
                animation: rewardPopIn .22s ease;
            ">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;">
                    <div style="font-size:20px;font-weight:900;letter-spacing:-.3px;background:linear-gradient(180deg,#fff,#fff0b8,#D4AF37);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
                        ${escapeHtml(title)}
                    </div>
                    <button data-close-modal type="button" style="
                        width:40px;height:40px;border:none;border-radius:14px;
                        background: rgba(255,255,255,.06);
                        color:#ffe8a3;cursor:pointer;
                        border:1px solid rgba(255,255,255,.08);
                    ">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div class="rewardspin-modal-body">
                    ${bodyHtml}
                </div>

                <div class="rewardspin-modal-footer" style="
                    margin-top: 16px;
                    display:flex;
                    gap:12px;
                    flex-wrap:wrap;
                    justify-content:flex-end;
                ">
                    ${footerHtml}
                </div>
            </div>
        </div>
    `;

    const closeBtn = dom.runtimeHost.querySelector("[data-close-modal]");
    closeBtn?.addEventListener("click", closeRuntimeModal);

    const backdrop = dom.runtimeHost.querySelector(".rewardspin-backdrop");
    backdrop?.addEventListener("click", (e) => {
        if (e.target === backdrop) {
            closeRuntimeModal();
        }
    });
}

function closeRuntimeModal() {
    if (!dom.runtimeHost) return;
    dom.runtimeHost.innerHTML = "";
    dom.runtimeHost.hidden = true;
}

/* ==========================================================
   CONFETTI
========================================================== */

function createConfettiBurst() {
    const colors = ["#D4AF37", "#FFE8A3", "#1FAE63", "#ffffff", "#7CFFB2"];
    const count = 28;

    for (let i = 0; i < count; i++) {
        const confetti = document.createElement("span");
        confetti.style.position = "fixed";
        confetti.style.left = `${Math.random() * 100}vw`;
        confetti.style.top = `${40 + Math.random() * 20}vh`;
        confetti.style.width = `${6 + Math.random() * 8}px`;
        confetti.style.height = `${6 + Math.random() * 8}px`;
        confetti.style.borderRadius = "2px";
        confetti.style.background = colors[i % colors.length];
        confetti.style.zIndex = "999999";
        confetti.style.pointerEvents = "none";
        confetti.style.opacity = "1";
        confetti.style.transform = `translateY(0) rotate(${Math.random() * 360}deg)`;
        confetti.style.transition = "transform 1.2s ease-out, opacity 1.2s ease-out";

        document.body.appendChild(confetti);

        requestAnimationFrame(() => {
            confetti.style.transform = `
                translateY(${120 + Math.random() * 160}px)
                translateX(${(Math.random() - 0.5) * 160}px)
                rotate(${360 + Math.random() * 720}deg)
            `;
            confetti.style.opacity = "0";
        });

        setTimeout(() => confetti.remove(), 1400);
    }

    if (navigator.vibrate) {
        navigator.vibrate([20, 30, 20]);
    }
}

function playSpinStopEffects() {
    const wheel = dom.spinWheel?.parentElement;
    if (!wheel) return;

    wheel.style.animation = "rewardPulse .35s ease";
    setTimeout(() => {
        wheel.style.animation = "";
    }, 420);
}

/* ==========================================================
   API
========================================================== */

async function apiGet(path, token = "") {
    const url = `${API_BASE}${path}`;
    const headers = new Headers();

    if (token) {
        headers.set("Authorization", `Bearer ${token}`);
    }

    const res = await fetch(url, {
        method: "GET",
        headers,
        credentials: "include"
    });

    return parseApiResponse(res);
}

async function apiPost(path, token = "", body = null) {
    const url = `${API_BASE}${path}`;
    const headers = new Headers();

    if (token) {
        headers.set("Authorization", `Bearer ${token}`);
    }

    let payload = undefined;

    if (body instanceof FormData) {
        payload = body;
    } else if (body != null) {
        headers.set("Content-Type", "application/json");
        payload = JSON.stringify(body);
    }

    const res = await fetch(url, {
        method: "POST",
        headers,
        body: payload,
        credentials: "include"
    });

    return parseApiResponse(res);
}

async function parseApiResponse(res) {
    const raw = await res.text();
    const data = raw ? safeJsonParse(raw) : {};

    if (!res.ok) {
        const message =
            data?.message ||
            data?.error ||
            data?.detail ||
            `HTTP ${res.status}`;
        throw new Error(message);
    }

    if (data && data.success === false) {
        throw new Error(data.message || "Request failed.");
    }

    return data;
}

/* ==========================================================
   AUTH TOKEN
========================================================== */

async function getIdToken() {
    const user = state.firebaseUser || auth.currentUser;
    if (!user) return "";

    try {
        return await user.getIdToken();
    } catch (error) {
        console.error(error);
        return "";
    }
}

/* ==========================================================
   UTILS
========================================================== */

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    } catch {
        return { message: text };
    }
}

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatLexa(value) {
    const n = Number(value) || 0;
    if (Number.isInteger(n)) return String(n);
    if (n < 1) return n.toFixed(2);
    return n.toFixed(1).replace(/\.0$/, "");
}

function formatRewardAmount(value) {
    const n = Number(value) || 0;
    if (Number.isInteger(n)) return String(n);
    if (n < 1) return n.toFixed(2);
    return n.toFixed(1).replace(/\.0$/, "");
}

function formatChance(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return `${formatChanceNumber(n)}%`;
}

function formatChanceNumber(value) {
    const n = Number(value) || 0;
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(1).replace(/\.0$/, "");
}

function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    const hh = String(date.getHours()).padStart(2, "0");
    const mi = String(date.getMinutes()).padStart(2, "0");

    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

function observeResize() {
    window.addEventListener("resize", () => {
        fitWheelCanvas();
        drawWheel();
    });
}

function observeConnection() {
    window.addEventListener("online", () => {
        showToast("success", "Connection", "Back online.");
    });

    window.addEventListener("offline", () => {
        showToast("warning", "Connection", "You are offline.");
    });
}

function pickSectorColor(index) {
    const palette = [
        "#D4AF37",
        "#B88A1E",
        "#1FAE63",
        "#6E59FF",
        "#D97706",
        "#3A4D70",
        "#8A6510"
    ];
    return palette[index % palette.length];
}

function lightenColor(hex, amount = 16) {
    return shiftHexColor(hex, amount);
}

function darkenColor(hex, amount = 12) {
    return shiftHexColor(hex, -amount);
}

function shiftHexColor(hex, amount = 0) {
    const clean = String(hex || "").replace("#", "");
    if (clean.length !== 6) return hex || "#D4AF37";

    const num = parseInt(clean, 16);
    let r = (num >> 16) & 255;
    let g = (num >> 8) & 255;
    let b = num & 255;

    r = clampColor(r + amount);
    g = clampColor(g + amount);
    b = clampColor(b + amount);

    return `#${((1 << 24) + (r << 16) + (g << 8) + b)
        .toString(16)
        .slice(1)}`;
}

function clampColor(v) {
    return Math.max(0, Math.min(255, v));
}

function wrapWheelLabel(label) {
    const text = String(label || "");
    const words = text.split(/\s+/).filter(Boolean);

    if (words.length <= 1) return [text];

    const lines = [];
    let current = "";

    for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (test.length <= 8) {
            current = test;
        } else {
            if (current) lines.push(current);
            current = word;
        }
    }

    if (current) lines.push(current);

    return lines.slice(0, 3);
}

function normalizeSectors(rawSectors = []) {
    if (!Array.isArray(rawSectors) || !rawSectors.length) {
        return [...DEFAULT_WHEEL_SECTORS];
    }

    return rawSectors.map((item, index) => {
        const label =
            item.label ||
            item.name ||
            item.title ||
            item.rewardLabel ||
            item.reward ||
            "Reward";

        return {
            label: String(label),
            amount: item.amount ?? item.value ?? null,
            type: item.type || inferSectorType(label),
            chance: item.chance ?? item.probability ?? null,
            color: item.color || item.hex || pickSectorColor(index),
            sectorIndex: Number.isInteger(item.sectorIndex) ? item.sectorIndex : index
        };
    });
}

function inferSectorType(label) {
    const text = String(label || "").toLowerCase();
    if (text.includes("mystery")) return "mystery";
    if (text.includes("jackpot") || text.includes("70")) return "jackpot";
    return "lexa";
}

/* ==========================================================
   TOAST
========================================================== */

function showToast(type = "info", title = "", message = "") {
    if (!dom.toastContainer) return;

    const icons = {
        success: "fa-circle-check",
        error: "fa-circle-xmark",
        warning: "fa-triangle-exclamation",
        info: "fa-circle-info"
    };

    const toast = document.createElement("div");
    toast.style.cssText = `
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
        border-radius: 18px;
        background: rgba(20,26,40,.96);
        color: #fff;
        border: 1px solid rgba(255,255,255,.08);
        box-shadow: 0 16px 36px rgba(0,0,0,.34);
        animation: rewardToastIn .18s ease;
    `;

    toast.innerHTML = `
        <div style="width:40px;height:40px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.06);flex-shrink:0;">
            <i class="fa-solid ${icons[type] || icons.info}" style="color:${toastColor(type)};"></i>
        </div>
        <div style="flex:1;min-width:0;">
            <div style="font-weight:800;line-height:1.3;margin-bottom:2px;">${escapeHtml(title || "ALEXA")}</div>
            <div style="font-size:13px;line-height:1.5;color:#a3afc2;">${escapeHtml(message || "")}</div>
        </div>
        <button type="button" aria-label="Close toast" style="
            width:34px;height:34px;border:none;border-radius:12px;background:rgba(255,255,255,.05);color:#ffe8a3;cursor:pointer;flex-shrink:0;
        ">
            <i class="fa-solid fa-xmark"></i>
        </button>
    `;

    const closeBtn = toast.querySelector("button");
    const removeToast = () => {
        toast.style.animation = "rewardToastOut .18s ease forwards";
        setTimeout(() => toast.remove(), 180);
    };

    closeBtn?.addEventListener("click", removeToast);
    dom.toastContainer.appendChild(toast);

    setTimeout(removeToast, 4000);
}

function toastColor(type) {
    switch (type) {
        case "success":
            return "#49E18D";
        case "error":
            return "#FF6B6B";
        case "warning":
            return "#FFB020";
        default:
            return "#D4AF37";
    }
}

/* ==========================================================
   LOADING
========================================================== */

function showLoading(text = "Loading...") {
    state.loading = true;

    if (dom.loadingOverlay) {
        dom.loadingOverlay.hidden = false;
    }

    if (dom.loadingText) {
        dom.loadingText.textContent = text;
    }

    document.body.style.overflow = "hidden";
}

function hideLoading() {
    state.loading = false;

    if (dom.loadingOverlay) {
        dom.loadingOverlay.hidden = true;
    }

    document.body.style.overflow = "";
}