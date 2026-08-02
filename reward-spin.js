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

import { SpinFX } from "./reward-spin-fx.js";

/* ==========================================================
   CONFIG
========================================================== */

const LOGIN_PAGE = "login.html";
const INVITE_PAGE = "invite.html";
const DAILY_PAGE = "calendar.html";

const API_BASE =
    window.ALEXA_SPIN_API_BASE ||
    "https://alexachain.lexanet-chain.workers.dev";

const APP_VERSION = "v1.0.0";
const SPIN_EXCHANGE_PRICE = 0.7;
const SPIN_ANIMATION_MS =  7000;
const SPIN_FULL_TURNS = 6;
const TAU = Math.PI * 2;

const DEFAULT_WHEEL_SECTORS = [
    { label: "0.05 LEXA", amount: 0.05, type: "lexa", color: "#E3B23C" },
    { label: "0.50 LEXA", amount: 0.5, type: "lexa", color: "#B88A1E" },
    { label: "1.5 LEXA", amount: 1.5, type: "lexa", color: "#1FAE63" },
    { label: "5 LEXA", amount: 5, type: "lexa", color: "#6E59FF" },
    { label: "7 LEXA", amount: 7, type: "lexa", color: "#D97706" },
    { label: "Mystery Box", type: "mystery", color: "#3A4D70" },
    { label: "70 LEXA", amount: 70, type: "jackpot", color: "#D4AF37" }
];

const DEFAULT_TASKS = {
    referral: { current: 0, target: 2, rewardSpins: 3 },
    daily: { current: 0, target: 7, rewardSpins: 7 },
    exchange: { price: SPIN_EXCHANGE_PRICE, rewardSpins: 1 }
};

const DEFAULT_RULES = [
    "New users get 1 welcome spin.",
    "Every 2 successful referrals earn +3 spin.",
    "Daily check-in can earn +7 spin.",
    "Exchange 0.7 LEXA for +1 spin.",
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
    SpinFX.init({ sectorCount: state.wheelSectors.length });

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
        dom.loadingOverlay.innerHTML = `
            <div class="loading-card">
                <div class="loading-spinner"></div>
                <p id="loadingText">Loading...</p>
            </div>
        `;
        document.body.appendChild(dom.loadingOverlay);
        dom.loadingText = $("loadingText");
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
        if (e.key === "Escape") closeRuntimeModal();
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

    const sectors = payload?.wheel?.sectors || payload?.sectors;
    state.wheelSectors = normalizeSectors(sectors && sectors.length ? sectors : DEFAULT_WHEEL_SECTORS);
    state.history = Array.isArray(payload.history) ? payload.history : state.history;

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
    renderRules();
    renderWheel();
    renderIdentity();
}

function renderSpinInfo() {
    if (dom.availableSpin) {
        SpinFX.result({ remainingSpins: state.spins });
    }
}

function renderSpinButton() {
    if (!dom.btnSpin) return;

    if (state.spinning) {
        dom.btnSpin.disabled = true;
        dom.btnSpin.innerHTML = `<span class="btn-shine" aria-hidden="true"></span><span>SPINNING...</span>`;
        return;
    }

    if (!state.backendReady) {
        dom.btnSpin.disabled = true;
        dom.btnSpin.innerHTML = `<span class="btn-shine" aria-hidden="true"></span><span>CONNECTING...</span>`;
        return;
    }

    dom.btnSpin.disabled = false;
    dom.btnSpin.innerHTML = state.spins > 0
        ? `<span class="btn-shine" aria-hidden="true"></span><span>SPIN NOW</span>`
        : `<span class="btn-shine" aria-hidden="true"></span><span>GET MORE SPINS</span>`;
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
            <div class="task-right">🎡 +${referral.rewardSpins} Spin</div>
        `;
        dom.taskItems[0].title = "Invite friends";
    }

    if (dom.taskItems[1]) {
        dom.taskItems[1].innerHTML = `
            <div class="task-left">
                <strong>📅 Daily Check-in</strong>
                <small>Day ${daily.current} / ${daily.target}</small>
            </div>
            <div class="task-right">🎡 +${daily.rewardSpins} Spin</div>
        `;
        dom.taskItems[1].title = "Daily check-in";
    }

    if (dom.taskItems[2]) {
        dom.taskItems[2].innerHTML = `
            <div class="task-left">
                <strong>🪙 Exchange LEXA</strong>
                <small>${formatLexa(exchange.price)} LEXA → +${exchange.rewardSpins} Spin</small>
            </div>
            <button type="button" class="small-gold-btn" id="btnExchangeSpin">+1 Spin</button>
        `;
        const newBtn = dom.taskItems[2].querySelector("#btnExchangeSpin");
        if (newBtn) {
            dom.btnExchangeSpin = newBtn;
            dom.btnExchangeSpin.addEventListener("click", handleExchangeSpin);
        }
    }
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
    const nameNode = $("spinUsername");
    const uidNode = $("spinUid");
    const avatarNode = $("spinAvatar");

    if (nameNode) {
        nameNode.textContent = state.profile?.displayName || state.profile?.username || state.firebaseUser?.displayName || "User";
    }

    if (uidNode) {
        uidNode.textContent = `UID : ${state.profile?.uid || "-"}`;
    }

    if (avatarNode && state.firebaseUser) {
        avatarNode.src = state.profile?.avatar || state.firebaseUser.photoURL || "assets/avatar/default.png";
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

    const sectors = state.wheelSectors.length ? state.wheelSectors : DEFAULT_WHEEL_SECTORS;
    const sectorAngle = TAU / sectors.length;
    const startBase = state.wheelRotation - Math.PI / 2;

    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    /* ======================================================
       OUTER AURA / SOFT GLOW
    ====================================================== */

    const aura = ctx.createRadialGradient(
        center,
        center,
        radius * 0.35,
        center,
        center,
        radius + 42
    );
    aura.addColorStop(0.00, "rgba(212,175,55,.18)");
    aura.addColorStop(0.42, "rgba(212,175,55,.10)");
    aura.addColorStop(0.70, "rgba(24,195,126,.08)");
    aura.addColorStop(1.00, "rgba(0,0,0,0)");

    ctx.beginPath();
    ctx.arc(center, center, radius + 30, 0, TAU);
    ctx.fillStyle = aura;
    ctx.fill();

    /* ======================================================
       BASE DARK DISC BEHIND SECTORS
    ====================================================== */

    ctx.beginPath();
    ctx.arc(center, center, radius + 18, 0, TAU);
    ctx.fillStyle = "#05070B";
    ctx.fill();

    /* ======================================================
       SECTORS
    ====================================================== */

    for (let i = 0; i < sectors.length; i++) {
        const sector = sectors[i];
        const label = String(sector.label || "");
        const key = label.toLowerCase();

        const start = startBase + i * sectorAngle;
        const end = start + sectorAngle;
        const mid = start + sectorAngle / 2;

        let sectorMode = "dark";
        if (key === "70 lexa" || key === "0.05 lexa") {
            sectorMode = "gold";
        } else if (key === "1.5 lexa" || key === "7 lexa") {
            sectorMode = "emerald";
        } else if (key === "mystery box") {
            sectorMode = "mystery";
        } else if (key === "5 lexa") {
            sectorMode = "violet";
        } else if (key === "0.50 lexa") {
            sectorMode = "darkGold";
        }

        let colors;
        switch (sectorMode) {
            case "gold":
                colors = ["#FFF7D8", "#F1D96D", "#D4AF37", "#9A7414", "#4D3507"];
                break;
            case "emerald":
                colors = ["#7AFFC2", "#38E2A0", "#18C37E", "#0F6E49", "#083622"];
                break;
            case "mystery":
                colors = ["#31517D", "#243A5B", "#18283E", "#0F1725", "#070B10"];
                break;
            case "violet":
                colors = ["#8D79FF", "#6F5CFF", "#5746F0", "#2B215F", "#11101C"];
                break;
            case "darkGold":
                colors = ["#3B414A", "#2E343C", "#1E2329", "#111419", "#090B0D"];
                break;
            default:
                colors = ["#3A414A", "#2B3139", "#1D222A", "#111419", "#090B0D"];
                break;
        }

        const metal = ctx.createLinearGradient(
            center + Math.cos(mid) * 8,
            center + Math.sin(mid) * 8,
            center + Math.cos(mid) * radius,
            center + Math.sin(mid) * radius
        );
        metal.addColorStop(0.00, colors[0]);
        metal.addColorStop(0.22, colors[1]);
        metal.addColorStop(0.52, colors[2]);
        metal.addColorStop(0.78, colors[3]);
        metal.addColorStop(1.00, colors[4]);

        ctx.beginPath();
        ctx.moveTo(center, center);
        ctx.arc(center, center, radius, start, end);
        ctx.closePath();
        ctx.fillStyle = metal;
        ctx.fill();

        /* ==================================================
           BEVEL / DEPTH
        ================================================== */

        ctx.save();
        ctx.clip();

        const bevel = ctx.createRadialGradient(
            center,
            center,
            radius * 0.10,
            center,
            center,
            radius
        );
        bevel.addColorStop(0.00, "rgba(255,255,255,.10)");
        bevel.addColorStop(0.32, "rgba(255,255,255,.04)");
        bevel.addColorStop(0.72, "rgba(0,0,0,.12)");
        bevel.addColorStop(1.00, "rgba(0,0,0,.28)");

        ctx.fillStyle = bevel;
        ctx.fillRect(center - radius, center - radius, radius * 2, radius * 2);

        const sheen = ctx.createLinearGradient(
            center - radius,
            center - radius,
            center + radius,
            center + radius
        );
        sheen.addColorStop(0.00, "rgba(255,255,255,.18)");
        sheen.addColorStop(0.20, "rgba(255,255,255,.08)");
        sheen.addColorStop(0.44, "rgba(255,255,255,.02)");
        sheen.addColorStop(0.70, "rgba(0,0,0,.02)");
        sheen.addColorStop(1.00, "rgba(0,0,0,.12)");

        ctx.globalAlpha = 0.95;
        ctx.fillStyle = sheen;
        ctx.fillRect(center - radius, center - radius, radius * 2, radius * 2);

        const vignette = ctx.createRadialGradient(
            center,
            center,
            radius * 0.12,
            center,
            center,
            radius
        );
        vignette.addColorStop(0.00, "rgba(0,0,0,0)");
        vignette.addColorStop(0.70, "rgba(0,0,0,.08)");
        vignette.addColorStop(1.00, "rgba(0,0,0,.24)");

        ctx.globalAlpha = 1;
        ctx.fillStyle = vignette;
        ctx.fillRect(center - radius, center - radius, radius * 2, radius * 2);

        ctx.restore();

        /* ==================================================
           THICK DIVIDER / METAL EDGE
        ================================================== */

        const divider = ctx.createLinearGradient(
            center - Math.cos(mid) * radius,
            center - Math.sin(mid) * radius,
            center + Math.cos(mid) * radius,
            center + Math.sin(mid) * radius
        );
        divider.addColorStop(0.00, "#FFF8D8");
        divider.addColorStop(0.25, "#D4AF37");
        divider.addColorStop(0.56, "#24C77A");
        divider.addColorStop(1.00, "#0F6E49");

        ctx.beginPath();
        ctx.moveTo(center, center);
        ctx.arc(center, center, radius, start, end);
        ctx.closePath();

        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.lineWidth = 6;
        ctx.strokeStyle = divider;
        ctx.shadowColor = "rgba(212,175,55,.42)";
        ctx.shadowBlur = 7;
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(255,255,255,.10)";
        ctx.stroke();

        /* ==================================================
           SMALL INNER BORDER
        ================================================== */

        ctx.beginPath();
        ctx.arc(center, center, radius - 1.5, start, end);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = "rgba(255,245,210,.10)";
        ctx.stroke();

        /* ==================================================
           SECTOR BADGE / JEWEL
        ================================================== */

        const badgeDist = radius - 68;
        const bx = center + Math.cos(mid) * badgeDist;
        const by = center + Math.sin(mid) * badgeDist;

        let badgeColors;
        if (sectorMode === "gold") {
            badgeColors = ["#FFF9DD", "#F3D86D", "#D4AF37", "#8A6510"];
        } else if (sectorMode === "emerald") {
            badgeColors = ["#CFFBE0", "#49E18D", "#18C37E", "#0E6A45"];
        } else if (sectorMode === "mystery") {
            badgeColors = ["#9BC2FF", "#60A5FA", "#3B82F6", "#18315C"];
        } else if (sectorMode === "violet") {
            badgeColors = ["#D6CCFF", "#A78BFA", "#8B5CF6", "#3B2675"];
        } else {
            badgeColors = ["#F4E3A4", "#D4AF37", "#B98A17", "#6B4A0B"];
        }

        const badge = ctx.createRadialGradient(bx - 2, by - 2, 1, bx, by, 9);
        badge.addColorStop(0.00, badgeColors[0]);
        badge.addColorStop(0.35, badgeColors[1]);
        badge.addColorStop(0.72, badgeColors[2]);
        badge.addColorStop(1.00, badgeColors[3]);

        ctx.beginPath();
        ctx.arc(bx, by, 5.5, 0, TAU);
        ctx.fillStyle = badge;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(bx - 1.2, by - 1.2, 1.9, 0, TAU);
        ctx.fillStyle = "rgba(255,255,255,.45)";
        ctx.fill();

        ctx.beginPath();
        ctx.arc(bx + 0.8, by + 0.8, 5.5, 0, TAU);
        ctx.strokeStyle = "rgba(0,0,0,.28)";
        ctx.lineWidth = 1;
        ctx.stroke();

        /* ==================================================
           LABEL
        ================================================== */

        ctx.save();
        ctx.translate(center, center);
        ctx.rotate(mid);

        const lines = wrapWheelLabel(label);

        ctx.textBaseline = "middle";
        ctx.font = "700 15px Poppins, sans-serif";

        let textColor = "#FFF7E6";
        switch (key) {
            case "0.05 lexa":
                textColor = "#FFFFFF";
                break;
            case "0.50 lexa":
                textColor = "#F8E9A1";
                break;
            case "1.5 lexa":
                textColor = "#49E18D";
                break;
            case "5 lexa":
                textColor = "#8B5CF6";
                break;
            case "7 lexa":
                textColor = "#38BDF8";
                break;
            case "mystery box":
                textColor = "#86B8FF";
                break;
            case "70 lexa":
                textColor = "#FFD86A";
                break;
        }

        const angleDeg = ((mid * 180 / Math.PI) + 360) % 360;
        const flipped = angleDeg > 90 && angleDeg < 270;

        ctx.textAlign = flipped ? "left" : "right";

        const textRadius = radius - 28;
        const drawX = flipped ? -textRadius : textRadius;
        const lineHeight = 18;
        const startY = -((lines.length - 1) * lineHeight) / 2;

        ctx.fillStyle = textColor;
        ctx.shadowColor = "rgba(0,0,0,.58)";
        ctx.shadowBlur = 7;

        for (let j = 0; j < lines.length; j++) {
            ctx.fillText(lines[j], drawX, startY + j * lineHeight);
        }

        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = "#FFF6CC";

        for (let j = 0; j < lines.length; j++) {
            ctx.fillText(lines[j], drawX, startY + j * lineHeight - 1);
        }

        ctx.globalAlpha = 1;
        ctx.restore();

        /* ==================================================
           OUTER BOUNDARY STUDS ON EACH DIVIDER
        ================================================== */

        const studAngle = start;
        const studX = center + Math.cos(studAngle) * (radius + 13);
        const studY = center + Math.sin(studAngle) * (radius + 13);

        const stud = ctx.createRadialGradient(
            studX - 2,
            studY - 2,
            1,
            studX,
            studY,
            10
        );
        if (i % 2 === 0) {
            stud.addColorStop(0.00, "#FFF9DD");
            stud.addColorStop(0.30, "#F2D66F");
            stud.addColorStop(0.68, "#D4AF37");
            stud.addColorStop(1.00, "#8A6510");
        } else {
            stud.addColorStop(0.00, "#D7FFE8");
            stud.addColorStop(0.30, "#49E18D");
            stud.addColorStop(0.68, "#18C37E");
            stud.addColorStop(1.00, "#0E6A45");
        }

        ctx.beginPath();
        ctx.arc(studX, studY, 5.8, 0, TAU);
        ctx.fillStyle = stud;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(studX - 1.2, studY - 1.2, 1.8, 0, TAU);
        ctx.fillStyle = "rgba(255,255,255,.40)";
        ctx.fill();

        ctx.beginPath();
        ctx.arc(studX + 0.8, studY + 0.8, 5.8, 0, TAU);
        ctx.strokeStyle = "rgba(0,0,0,.30)";
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    /* ======================================================
       OUTER RINGS
    ====================================================== */

    const outerRing = ctx.createLinearGradient(
        center - radius,
        center - radius,
        center + radius,
        center + radius
    );
    outerRing.addColorStop(0.00, "#FFF8D8");
    outerRing.addColorStop(0.16, "#F3D978");
    outerRing.addColorStop(0.35, "#D4AF37");
    outerRing.addColorStop(0.56, "#A97A13");
    outerRing.addColorStop(0.76, "#2ACB82");
    outerRing.addColorStop(1.00, "#4C3507");

    ctx.beginPath();
    ctx.arc(center, center, radius + 14, 0, TAU);
    ctx.strokeStyle = outerRing;
    ctx.lineWidth = 14;
    ctx.shadowColor = "rgba(212,175,55,.52)";
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;

    const darkRing = ctx.createLinearGradient(
        center - radius,
        center - radius,
        center + radius,
        center + radius
    );
    darkRing.addColorStop(0.00, "#171A20");
    darkRing.addColorStop(0.35, "#0F1216");
    darkRing.addColorStop(1.00, "#05070B");

    ctx.beginPath();
    ctx.arc(center, center, radius + 22, 0, TAU);
    ctx.strokeStyle = darkRing;
    ctx.lineWidth = 8;
    ctx.stroke();

    const emeraldRing = ctx.createLinearGradient(
        center - radius,
        center - radius,
        center + radius,
        center + radius
    );
    emeraldRing.addColorStop(0.00, "rgba(24,195,126,.10)");
    emeraldRing.addColorStop(0.40, "rgba(24,195,126,.42)");
    emeraldRing.addColorStop(0.75, "rgba(24,195,126,.16)");
    emeraldRing.addColorStop(1.00, "rgba(24,195,126,.08)");

    ctx.beginPath();
    ctx.arc(center, center, radius + 9, 0, TAU);
    ctx.strokeStyle = emeraldRing;
    ctx.lineWidth = 4;
    ctx.shadowColor = "rgba(24,195,126,.28)";
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(center, center, radius + 3, 0, TAU);
    ctx.strokeStyle = "rgba(255,246,210,.75)";
    ctx.lineWidth = 2.2;
    ctx.stroke();

    /* ======================================================
       CENTER HUB
    ====================================================== */

    const hubGold = ctx.createRadialGradient(
        center,
        center,
        4,
        center,
        center,
        46
    );
    hubGold.addColorStop(0.00, "#FFF9E0");
    hubGold.addColorStop(0.16, "#F5E0A0");
    hubGold.addColorStop(0.42, "#D4AF37");
    hubGold.addColorStop(0.70, "#A97A13");
    hubGold.addColorStop(1.00, "#5A410A");

    ctx.beginPath();
    ctx.arc(center, center, 36, 0, TAU);
    ctx.fillStyle = hubGold;
    ctx.fill();

    const hubShade = ctx.createRadialGradient(
        center - 8,
        center - 8,
        2,
        center,
        center,
        24
    );
    hubShade.addColorStop(0.00, "#2F343B");
    hubShade.addColorStop(0.45, "#171B20");
    hubShade.addColorStop(1.00, "#090B0D");

    ctx.beginPath();
    ctx.arc(center, center, 23, 0, TAU);
    ctx.fillStyle = hubShade;
    ctx.fill();

    const hubCap = ctx.createRadialGradient(
        center - 4,
        center - 4,
        1,
        center,
        center,
        11
    );
    hubCap.addColorStop(0.00, "#FFF8D8");
    hubCap.addColorStop(0.38, "#F2D66F");
    hubCap.addColorStop(0.72, "#D4AF37");
    hubCap.addColorStop(1.00, "#8A6510");

    ctx.beginPath();
    ctx.arc(center, center, 10, 0, TAU);
    ctx.fillStyle = hubCap;
    ctx.fill();

    const hubGem = ctx.createRadialGradient(
        center - 2,
        center - 2,
        1,
        center,
        center,
        7
    );
    hubGem.addColorStop(0.00, "#D7FFE8");
    hubGem.addColorStop(0.35, "#49E18D");
    hubGem.addColorStop(0.72, "#18C37E");
    hubGem.addColorStop(1.00, "#0E6A45");

    ctx.beginPath();
    ctx.arc(center + 12, center - 12, 4.5, 0, TAU);
    ctx.fillStyle = hubGem;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(center - 10, center - 10, 6, 0, TAU);
    ctx.fillStyle = "rgba(255,255,255,.48)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(center + 8, center + 8, 5, 0, TAU);
    ctx.fillStyle = "rgba(0,0,0,.18)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(center, center, 4.2, 0, TAU);
    ctx.fillStyle = "#FFF6D0";
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

    await SpinFX.start({
        duration: SPIN_ANIMATION_MS,
        sectorCount: state.wheelSectors.length,
        onFrame: (t) => {
            const eased = naturalSpinEase(t);
            state.wheelRotation = start + (end - start) * eased;
            drawWheel();
        }
    });
const settle = end + 0.01;

state.wheelRotation = settle;
drawWheel();

await new Promise(r => setTimeout(r, 35));

state.wheelRotation = end;
drawWheel();

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
        SpinFX.stop();
        SpinFX.highlight(sectorIndex);
        showSpinResultModal(result);
        SpinFX.result(result);
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
    const maybeIndex = reward?.sectorIndex ?? reward?.sector ?? result?.sectorIndex ?? result?.sector ?? result?.wheelIndex;
    if (Number.isInteger(maybeIndex)) {
        return clampIndex(maybeIndex, state.wheelSectors.length);
    }

    const label = reward?.label || reward?.name || reward?.reward || result?.rewardLabel;
    if (label) {
        const found = state.wheelSectors.findIndex((s) => String(s.label).toLowerCase() === String(label).toLowerCase());
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

const accepted = await openExchangeModal(
    price,
    state.tasks.exchange.rewardSpins
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
        bodyHtml: `<div id="historyContent" class="history-content"><div class="history-loading">Loading history...</div></div>`,
        footerHtml: `<button class="runtime-primary" data-close-modal>Close</button>`
    });

    try {
        const token = await getIdToken();
        const history = await apiGet("/api/spin/history?limit=20", token);
        const items = Array.isArray(history.items) ? history.items : (Array.isArray(history.history) ? history.history : []);
        const content = $("historyContent");
        if (content) content.innerHTML = renderHistoryList(items);
    } catch (error) {
        console.error(error);
        const content = $("historyContent");
        if (content) content.innerHTML = `<div class="history-error">${escapeHtml(error.message || "Unable to load history.")}</div>`;
    }
}

function renderHistoryList(items) {
    if (!items.length) {
        return `<div class="history-empty">No history yet.</div>`;
    }

    return items.map((item) => {
        const label = item.label || item.rewardLabel || item.reward || item.title || "Lucky Spin";
        const amount = item.amount != null
            ? `${formatRewardAmount(item.amount)} LEXA`
            : (item.value != null ? `${formatRewardAmount(item.value)} LEXA` : "");
        const status = item.status || "SUCCESS";
        const createdAt = item.createdAt || item.timestamp || item.time || "";

        return `
            <div class="history-row">
                <div class="history-left">
                    <div class="history-title">${escapeHtml(label)}</div>
                    <div class="history-time">${escapeHtml(createdAt ? formatDateTime(createdAt) : "Unknown time")}</div>
                </div>
                <div class="history-right">
                    <div class="history-amount">${escapeHtml(amount || status)}</div>
                    <div class="history-status">${escapeHtml(status)}</div>
                </div>
            </div>
        `;
    }).join("");
}

/* ==========================================================
   RESULT
========================================================== */

function showSpinResultModal(result) {
    const data = buildSpinResultData(result);
    openRuntimeModal({
        title: "🎉 CONGRATULATIONS 🎉",
        width: 320,
        showClose: false,
        modalClass: "spin-result-modal",
        bodyHtml: buildSpinResultBody(data),
        footerHtml: buildSpinResultFooter()
    });
    bindSpinResultEvents();
}

function buildSpinResultData(result = {}) {
    const reward = result.reward || {};
    const icon = reward.type === "mystery" ? "🎁" : reward.type === "jackpot" ? "💎" : "🪙";
    const label = reward.label || reward.name || reward.reward || "Reward";
    const subtitle = reward.type === "jackpot"
        ? "Jackpot Unlocked"
        : reward.type === "mystery"
            ? `${formatRewardAmount(reward.amount)} LEXA`
            : "Reward Successfully Added";

    return {
        icon,
        label,
        subtitle,
        ticketId: result.ticketId || result.spinId || "-",
        remaining: typeof result.remainingSpins === "number" ? result.remainingSpins : state.spins
    };
}

function buildSpinResultBody(data) {
    return `
        <div class="spin-result">
            <div class="spin-result-icon">${data.icon}</div>
            <div class="spin-result-label">${escapeHtml(data.label)}</div>
            <div class="spin-result-subtitle">${escapeHtml(data.subtitle)}</div>
            <div class="spin-ticket"><small>Ticket ID</small><strong>${escapeHtml(data.ticketId)}</strong></div>
            <div class="spin-remaining"><small>🎡 Remaining Spins</small><strong>${data.remaining}</strong></div>
        </div>
    `;
}

function buildSpinResultFooter() {
    return `<button class="runtime-primary" data-close-modal>Collect</button>`;
}

function bindSpinResultEvents() {
    dom.runtimeHost?.querySelectorAll("[data-close-modal]").forEach((btn) => {
        btn.addEventListener("click", closeRuntimeModal);
    });
}

function openExchangeModal(price, rewardSpins) {
    return new Promise((resolve) => {
        openRuntimeModal({
            title: "🪙 Exchange Spin",
            width: 500,
            bodyHtml: `
<div class="exchange-modal">

    <div class="exchange-emoji">
        🪙
    </div>

    <div class="exchange-title">
        Exchange Spin
    </div>

    <div class="exchange-card">

        <div class="exchange-row">
            <span class="exchange-label">
                You Pay
            </span>

            <span class="exchange-value">
                ${formatLexa(price)} LEXA
            </span>
        </div>

        <div class="exchange-arrow">
            ↓
        </div>

        <div class="exchange-row">
            <span class="exchange-label">
                You Receive
            </span>

            <span class="exchange-result">
                +${rewardSpins} Spin
            </span>
        </div>

    </div>

    <div class="exchange-copy">
        You're about to exchange
        <strong>${formatLexa(price)} LEXA</strong>
        for
        <strong>+${rewardSpins} Spin</strong>.
        <br><br>
        This action cannot be undone.
    </div>

</div>
`,
            footerHtml: `
<button
class="runtime-secondary"
id="exchangeCancel">

    Cancel

</button>

<button
class="runtime-primary"
id="exchangeConfirm">

    Confirm Exchange

</button>
`
        });

        document.getElementById("exchangeCancel")?.addEventListener("click", () => {
            closeRuntimeModal();
            resolve(false);
        });
        document.getElementById("exchangeConfirm")?.addEventListener("click", () => {
            closeRuntimeModal();
            resolve(true);
        });
    });
}

/* ==========================================================
   NO SPIN MODAL
========================================================== */

function openNoSpinModal() {
    openRuntimeModal({
        title: "No Spins",
        width: 420,
        bodyHtml: `
            <div class="no-spin-modal">
                <div class="no-spin-copy">Kamu belum punya spin. Selesaikan task berikut untuk menambah spin.</div>
                <div class="no-spin-card"><div class="no-spin-head">👥 Referral Task</div><div class="no-spin-sub">2 referral aktif = +3 spin</div></div>
                <div class="no-spin-card"><div class="no-spin-head">📅 Daily Check-in</div><div class="no-spin-sub">Check-in berturut-turut = +7 spin</div></div>
                <div class="no-spin-card"><div class="no-spin-head">🪙 Exchange</div><div class="no-spin-sub">0.7 LEXA = +1 spin</div></div>
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

function openRuntimeModal({ title, bodyHtml, footerHtml = "", width = 520, showClose = true, modalClass = "" }) {
    if (!dom.runtimeHost) return;

    dom.runtimeHost.hidden = false;
    dom.runtimeHost.innerHTML = `
        <div class="rewardspin-backdrop">
            <div class="rewardspin-modal ${modalClass}" style="width:min(100%,${width}px);">
                <div class="rewardspin-header">
                    <h2>${escapeHtml(title)}</h2>
                    ${showClose ? `<button type="button" class="runtime-close" data-close-modal><i class="fa-solid fa-xmark"></i></button>` : ""}
                </div>
                <div class="rewardspin-body">${bodyHtml}</div>
                ${footerHtml ? `<div class="rewardspin-footer">${footerHtml}</div>` : ""}
            </div>
        </div>
    `;

    dom.runtimeHost.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", closeRuntimeModal));
    const backdrop = dom.runtimeHost.querySelector(".rewardspin-backdrop");
    backdrop?.addEventListener("click", (e) => {
        if (e.target === backdrop) closeRuntimeModal();
    });
}

function closeRuntimeModal() {
    if (!dom.runtimeHost) return;
    dom.runtimeHost.innerHTML = "";
    dom.runtimeHost.hidden = true;
}

/* ==========================================================
   API
========================================================== */

async function apiGet(path, token = "") {
    const url = `${API_BASE}${path}`;
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(url, { method: "GET", headers, credentials: "include" });
    return parseApiResponse(res);
}

async function apiPost(path, token = "", body = null) {
    const url = `${API_BASE}${path}`;
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    let payload = undefined;
    if (body instanceof FormData) {
        payload = body;
    } else if (body != null) {
        headers.set("Content-Type", "application/json");
        payload = JSON.stringify(body);
    }

    const res = await fetch(url, { method: "POST", headers, body: payload, credentials: "include" });
    return parseApiResponse(res);
}

async function parseApiResponse(res) {
    const raw = await res.text();
    const data = raw ? safeJsonParse(raw) : {};

    if (!res.ok) {
        throw new Error(data?.message || data?.error || data?.detail || `HTTP ${res.status}`);
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
    try { return JSON.parse(text); } catch { return { message: text }; }
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

function naturalSpinEase(t) {

    // 3 detik pertama (≈43% dari 7 detik)
    if (t <= 0.43) {
        return t * 1.15;
    }

    // 4 detik terakhir
    const x = (t - 0.43) / 0.57;

    return (
        0.495 +
        (1 - Math.pow(1 - x, 4)) * 0.505
    );
}

function observeResize() {
    window.addEventListener("resize", () => {
        fitWheelCanvas();
        drawWheel();
    });
}

function observeConnection() {
    window.addEventListener("online", () => showToast("success", "Connection", "Back online."));
    window.addEventListener("offline", () => showToast("warning", "Connection", "You are offline."));
}

function pickSectorColor(index) {
    const palette = ["#D4AF37", "#B88A1E", "#1FAE63", "#6E59FF", "#D97706", "#3A4D70", "#8A6510"];
    return palette[index % palette.length];
}

function lightenColor(hex, amount = 16) { return shiftHexColor(hex, amount); }
function darkenColor(hex, amount = 12) { return shiftHexColor(hex, -amount); }

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
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function clampColor(v) { return Math.max(0, Math.min(255, v)); }

function wrapWheelLabel(label) {
    const text = String(label || "");
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= 1) return [text];

    const lines = [];
    let current = "";
    for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (test.length <= 8) current = test;
        else {
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
        const label = item.label || item.name || item.title || item.rewardLabel || item.reward || "Reward";
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
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="fa-solid ${icons[type] || icons.info}"></i></div>
        <div class="toast-content">
            <div class="toast-title">${escapeHtml(title || "ALEXA")}</div>
            <div class="toast-message">${escapeHtml(message || "")}</div>
        </div>
        <button type="button" class="toast-close" aria-label="Close toast"><i class="fa-solid fa-xmark"></i></button>
    `;

    const closeBtn = toast.querySelector(".toast-close");
    const removeToast = () => {
        toast.remove();
    };

    closeBtn?.addEventListener("click", removeToast);
    dom.toastContainer.appendChild(toast);
    setTimeout(removeToast, 4000);
}

/* ==========================================================
   LOADING
========================================================== */

function showLoading(text = "Loading...") {
    state.loading = true;
    if (dom.loadingOverlay) dom.loadingOverlay.hidden = false;
    if (dom.loadingText) dom.loadingText.textContent = text;
    document.body.style.overflow = "hidden";
}

function hideLoading() {
    state.loading = false;
    if (dom.loadingOverlay) dom.loadingOverlay.hidden = true;
    document.body.style.overflow = "";
}
