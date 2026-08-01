/* ==========================================================
   ALEXA API
   File : helpers/spin.js
   Description : Lucky Spin Business Logic
========================================================== */

import { getDocument, setDocument } from "./firestore.js";
import { getNow, uuid } from "./request.js";
import { addSystemHistory, getHistoryByUid } from "./history.js";
import {
    addPendingLexa,
    subtractPendingLexa,
    getPendingLexa
} from "./pendingLexa.js";

/* ==========================================================
   CONSTANTS
========================================================== */

const SPIN_CONFIG_PATH = "spin/config";
const SPIN_STATE_COLLECTION = "spin";

const DEFAULT_WELCOME_SPINS = 1;
const DEFAULT_SPIN_COST = 1;
const DEFAULT_EXCHANGE_PRICE = 0.1;
const DEFAULT_EXCHANGE_REWARD_SPINS = 1;

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
        price: DEFAULT_EXCHANGE_PRICE,
        rewardSpins: DEFAULT_EXCHANGE_REWARD_SPINS
    }
};

const DEFAULT_RULES = [
    "New users get 1 welcome spin.",
    "Every 2 successful referrals earn +1 spin.",
    "Daily check-in can earn +1 spin.",
    "Exchange 0.1 LEXA for +1 spin.",
    "Rewards are determined by the server."
];

const DEFAULT_REWARD_POOL = [
    { label: "0.05 LEXA", amount: 0.05, type: "lexa", chance: 66, color: "#E3B23C" },
    { label: "0.50 LEXA", amount: 0.5, type: "lexa", chance: 15, color: "#B88A1E" },
    { label: "1.5 LEXA", amount: 1.5, type: "lexa", chance: 10, color: "#1FAE63" },
    { label: "5 LEXA", amount: 5, type: "lexa", chance: 5, color: "#6E59FF" },
    { label: "7 LEXA", amount: 7, type: "lexa", chance: 2.5, color: "#D97706" },
    { label: "Mystery Box", type: "mystery", chance: 1, minAmount: 1, maxAmount: 20, color: "#3A4D70" },
    { label: "70 LEXA", amount: 70, type: "jackpot", chance: 0.5, color: "#D4AF37" }
];

/* ==========================================================
   INTERNAL HELPERS
========================================================== */

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, extra) {
    const out = clone(base) || {};
    if (!isObject(extra)) return out;

    for (const [key, value] of Object.entries(extra)) {
        if (Array.isArray(value)) {
            out[key] = clone(value);
            continue;
        }

        if (isObject(value) && isObject(out[key])) {
            out[key] = deepMerge(out[key], value);
            continue;
        }

        out[key] = clone(value);
    }

    return out;
}

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function roundAmount(value, digits = 8) {
    const n = safeNumber(value, 0);
    const factor = 10 ** digits;
    return Math.round(n * factor) / factor;
}

function formatLexa(value) {
    const n = safeNumber(value, 0);
    if (Number.isInteger(n)) return String(n);
    return roundAmount(n, 2).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function now() {
    return getNow?.() ?? Date.now();
}

function makeId() {
    return String(uuid?.() || crypto.randomUUID());
}

function normalizeType(type) {
    const value = String(type || "").trim().toLowerCase();
    if (["lexa", "mystery", "jackpot", "nothing"].includes(value)) return value;
    if (value.includes("jackpot")) return "jackpot";
    if (value.includes("mystery")) return "mystery";
    if (value.includes("nothing")) return "nothing";
    return "lexa";
}

function defaultColor(index) {
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

function inferSectorType(label) {
    const text = String(label || "").toLowerCase();
    if (text.includes("mystery")) return "mystery";
    if (text.includes("jackpot") || text.includes("70")) return "jackpot";
    if (text.includes("nothing") || text.includes("no reward")) return "nothing";
    return "lexa";
}

function normalizeSector(item, index = 0) {
    const label = String(
        item?.label ??
        item?.name ??
        item?.title ??
        item?.rewardLabel ??
        item?.reward ??
        "Reward"
    );

    const amount = item?.amount ?? item?.value ?? null;

    return {
        label,
        amount: amount == null ? null : safeNumber(amount, null),
        type: normalizeType(item?.type || inferSectorType(label)),
        chance: item?.chance ?? item?.probability ?? item?.weight ?? null,
        minAmount: item?.minAmount ?? item?.min ?? 1,
        maxAmount: item?.maxAmount ?? item?.max ?? 20,
        color: String(item?.color || item?.hex || defaultColor(index)),
        sectorIndex: Number.isInteger(item?.sectorIndex) ? item.sectorIndex : index,
        description: String(item?.description || "")
    };
}

function normalizeRewardPool(input) {
    const pool = Array.isArray(input) && input.length ? input : DEFAULT_REWARD_POOL;
    return pool.map((item, index) => normalizeSector(item, index));
}

function normalizeTasks(input = {}) {
    const source = isObject(input) ? input : {};
    return {
        referral: {
            current: safeNumber(source?.referral?.current, DEFAULT_TASKS.referral.current),
            target: Math.max(1, safeNumber(source?.referral?.target, DEFAULT_TASKS.referral.target)),
            rewardSpins: Math.max(1, safeNumber(source?.referral?.rewardSpins, DEFAULT_TASKS.referral.rewardSpins))
        },
        daily: {
            current: safeNumber(source?.daily?.current, DEFAULT_TASKS.daily.current),
            target: Math.max(1, safeNumber(source?.daily?.target, DEFAULT_TASKS.daily.target)),
            rewardSpins: Math.max(1, safeNumber(source?.daily?.rewardSpins, DEFAULT_TASKS.daily.rewardSpins))
        },
        exchange: {
            price: Math.max(0, safeNumber(source?.exchange?.price, DEFAULT_TASKS.exchange.price)),
            rewardSpins: Math.max(1, safeNumber(source?.exchange?.rewardSpins, DEFAULT_TASKS.exchange.rewardSpins))
        }
    };
}

function normalizeRules(input) {
    return Array.isArray(input) && input.length ? input.map(String) : clone(DEFAULT_RULES);
}

function normalizeConfig(doc = {}) {
    const source = isObject(doc) ? doc : {};
    const wheelSource = source.wheel && isObject(source.wheel) ? source.wheel : source;
    const sectors =
        wheelSource.sectors ||
        wheelSource.rewardPool ||
        source.sectors ||
        source.rewardPool ||
        DEFAULT_REWARD_POOL;

    return {
        spinCost: Math.max(0, safeNumber(source.spinCost ?? source.cost, DEFAULT_SPIN_COST)),
        welcomeSpinCount: Math.max(0, safeNumber(source.welcomeSpinCount ?? source.welcomeSpins, DEFAULT_WELCOME_SPINS)),
        exchange: {
            price: Math.max(0, safeNumber(source?.exchange?.price, DEFAULT_EXCHANGE_PRICE)),
            rewardSpins: Math.max(1, safeNumber(source?.exchange?.rewardSpins, DEFAULT_EXCHANGE_REWARD_SPINS))
        },
        tasks: normalizeTasks(source.tasks),
        rules: normalizeRules(source.rules),
        wheel: {
            sectors: normalizeRewardPool(sectors)
        }
    };
}

function getStatePath(uid) {
    return `${SPIN_STATE_COLLECTION}/${uid}`;
}

function normalizeState(doc = {}, config = null) {
    const source = isObject(doc) ? doc : {};
    const cfg = config || normalizeConfig();

    return {
        uid: String(source.uid || ""),
        spins: Math.max(0, Math.floor(safeNumber(source.spins ?? source.availableSpins, 0))),
        welcomeSpinGranted: Boolean(source.welcomeSpinGranted ?? source.welcomeGranted ?? false),
        referral: {
            current: Math.max(0, Math.floor(safeNumber(source?.referral?.current, cfg.tasks.referral.current))),
            target: Math.max(1, Math.floor(safeNumber(source?.referral?.target, cfg.tasks.referral.target))),
            rewardSpins: Math.max(1, Math.floor(safeNumber(source?.referral?.rewardSpins, cfg.tasks.referral.rewardSpins)))
        },

        daily: {
            current: Math.max(0, Math.floor(safeNumber(source?.daily?.current, cfg.tasks.daily.current))),
            target: Math.max(1, Math.floor(safeNumber(source?.daily?.target, cfg.tasks.daily.target))),
            rewardSpins: Math.max(1, Math.floor(safeNumber(source?.daily?.rewardSpins, cfg.tasks.daily.rewardSpins)))
        },
        exchange: {
            price: Math.max(0, safeNumber(source?.exchange?.price, cfg.exchange.price)),
            rewardSpins: Math.max(1, Math.floor(safeNumber(source?.exchange?.rewardSpins, cfg.exchange.rewardSpins)))
        },
        lastSpinAt: safeNumber(source.lastSpinAt, 0),
        lastSpinId: String(source.lastSpinId || ""),
        lastSpinReward: isObject(source.lastSpinReward) ? source.lastSpinReward : null,
        totalSpinsUsed: Math.max(0, Math.floor(safeNumber(source.totalSpinsUsed, 0))),
        totalRewardsGranted: Math.max(0, Math.floor(safeNumber(source.totalRewardsGranted, 0))),
        totalExchangeCount: Math.max(0, Math.floor(safeNumber(source.totalExchangeCount, 0))),
        updatedAt: safeNumber(source.updatedAt, 0),
        createdAt: safeNumber(source.createdAt, 0)
    };
}

function spinHistoryFilter(item = {}) {
    const type = String(item.type || "").toLowerCase();
    const title = String(item.title || "").toLowerCase();
    const description = String(item.description || "").toLowerCase();
    const feature = String(item?.metadata?.feature || "").toLowerCase();
    const action = String(item?.metadata?.action || "").toLowerCase();

    return (
        feature === "spin" ||
        action === "reward" ||
        action === "exchange" ||
        title.includes("lucky spin") ||
        title.includes("spin exchange") ||
        description.includes("lucky spin") ||
        (type === "system" && (title.includes("spin") || description.includes("spin")))
    );
}

function serializeHistoryItem(item = {}) {
    return {
        id: String(item.id || item.docId || item.uid || ""),
        uid: String(item.uid || ""),
        type: String(item.type || "system"),
        title: String(item.title || ""),
        description: String(item.description || ""),
        amount: roundAmount(item.amount ?? item.reward ?? 0, 8),
        reward: roundAmount(item.reward ?? item.amount ?? 0, 8),
        token: String(item.token || "LEXA"),
        status: String(item.status || "success"),
        metadata: isObject(item.metadata) ? item.metadata : {},
        createdAt: safeNumber(item.createdAt, now())
    };
}

function serializeReward(reward = {}, sectorIndex = 0) {
    const amount = reward.type === "nothing"
        ? 0
        : roundAmount(reward.amount ?? reward.value ?? 0, 8);

    return {
        label: String(reward.label || "Reward"),
        amount,
        value: amount,
        type: normalizeType(reward.type || "lexa"),
        chance: reward.chance ?? null,
        color: String(reward.color || defaultColor(sectorIndex)),
        sectorIndex: Number.isInteger(reward.sectorIndex) ? reward.sectorIndex : sectorIndex,
        description: String(reward.description || buildRewardDescription(reward, amount))
    };
}

function buildRewardDescription(reward, amount) {
    if (reward?.type === "mystery") {
        return `Mystery Box reward: ${formatLexa(amount)} LEXA`;
    }

    if (reward?.type === "jackpot") {
        return `Jackpot reward: ${formatLexa(amount)} LEXA`;
    }

    if (reward?.type === "nothing") {
        return "No reward.";
    }

    return `${formatLexa(amount)} LEXA reward`;
}

function buildTicketId(spinId) {
    const suffix = String(spinId || makeId()).replace(/-/g, "").slice(0, 10).toUpperCase();
    return `SPIN-${suffix}`;
}

function safeLimit(limit, fallback = 20, max = 100) {
    const n = safeNumber(limit, fallback);
    return Math.max(1, Math.min(max, Math.floor(n)));
}

async function safeGetDocument(env, path) {
    try {
        return await getDocument(env, path);
    } catch {
        return null;
    }
}

async function safeSetDocument(env, path, data) {
    return setDocument(env, path, data);
}

async function readConfig(env) {
    const raw = await safeGetDocument(env, SPIN_CONFIG_PATH);
    return normalizeConfig(raw || {});
}

async function writeConfig(env, config) {
    const normalized = normalizeConfig(config || {});
    await safeSetDocument(env, SPIN_CONFIG_PATH, normalized);
    return normalized;
}

async function ensureSpinState(env, uid, config = null) {
    const cfg = config || await readConfig(env);
    const path = getStatePath(uid);
    const raw = await safeGetDocument(env, path);

    if (!raw) {
        const createdAt = now();
        const initial = normalizeState({
            uid,
            spins: cfg.welcomeSpinCount,
            welcomeSpinGranted: cfg.welcomeSpinCount > 0,
            referral: cfg.tasks.referral,
            daily: cfg.tasks.daily,
            exchange: cfg.exchange,
            createdAt,
            updatedAt: createdAt
        }, cfg);

        await safeSetDocument(env, path, initial);
        return initial;
    }

    const normalized = normalizeState({ ...raw, uid }, cfg);
    if (!normalized.createdAt) normalized.createdAt = safeNumber(raw?.createdAt, now());
    if (!normalized.updatedAt) normalized.updatedAt = safeNumber(raw?.updatedAt, now());

    const needsWrite = JSON.stringify(normalized) !== JSON.stringify(raw);
    if (needsWrite) {
        await safeSetDocument(env, path, normalized);
    }

    return normalized;
}

async function saveSpinState(env, uid, state) {
    const cfg = await readConfig(env);
    const normalized = normalizeState({ ...state, uid }, cfg);
    await safeSetDocument(env, getStatePath(uid), normalized);
    return normalized;
}

function weightedPick(pool) {
    const items = Array.isArray(pool) && pool.length ? pool : normalizeRewardPool(DEFAULT_REWARD_POOL);
    const weights = items.map((item) => {
        const w = safeNumber(item.chance ?? item.probability ?? item.weight, 0);
        return w > 0 ? w : 1;
    });

    const total = weights.reduce((sum, value) => sum + value, 0);
    let roll = Math.random() * total;

    for (let i = 0; i < items.length; i++) {
        roll -= weights[i];
        if (roll <= 0) return { sector: items[i], index: i };
    }

    return { sector: items[items.length - 1], index: items.length - 1 };
}

function finalizeReward(sector) {
    const reward = clone(sector) || {};
    reward.type = normalizeType(reward.type || "lexa");

    if (reward.type === "mystery") {
        const min = Math.max(1, Math.floor(safeNumber(reward.minAmount, 1)));
        const max = Math.max(min, Math.floor(safeNumber(reward.maxAmount, 20)));
        reward.amount = Math.floor(min + Math.random() * (max - min + 1));
        reward.value = reward.amount;
        reward.description = `Mystery Box reward: ${formatLexa(reward.amount)} LEXA`;
    } else if (reward.type === "jackpot") {
        reward.amount = roundAmount(reward.amount ?? 70, 8);
        reward.value = reward.amount;
        reward.description = `Jackpot reward: ${formatLexa(reward.amount)} LEXA`;
    } else if (reward.type === "nothing") {
        reward.amount = 0;
        reward.value = 0;
        reward.description = "No reward.";
    } else {
        reward.amount = roundAmount(reward.amount ?? reward.value ?? 0, 8);
        reward.value = reward.amount;
        reward.description = reward.description || `${formatLexa(reward.amount)} LEXA reward`;
    }

    return reward;
}

async function appendSpinHistory(env, uid, {
    title,
    description,
    amount = 0,
    token = "LEXA",
    status = "success",
    metadata = {},
    createdAt = now()
} = {}) {
    return addSystemHistory(env, uid, {
        title: String(title || "Lucky Spin"),
        description: String(description || ""),
        amount: roundAmount(amount, 8),
        token: String(token || "LEXA"),
        status: String(status || "success"),
        metadata: {
            feature: "spin",
            ...clone(metadata)
        },
        createdAt
    });
}

/* ==========================================================
   PUBLIC API
========================================================== */

/**
 * Build the Lucky Spin dashboard payload for the frontend.
 * @param {object} env Cloudflare Worker environment
 * @param {string} uid Firebase/ALEXA user id
 * @returns {Promise<object>}
 */
export async function getDashboard(env, uid) {
    if (!uid) throw new Error("Missing uid.");

    const [config, state, history] = await Promise.all([
        readConfig(env),
        ensureSpinState(env, uid),
        getSpinHistory(env, uid, 20).catch(() => ({ items: [] }))
        
    ]);
const pending = await getPendingLexa(env, uid);
    return {
        success: true,
        uid,
        spins: state.spins,
        availableSpins: state.spins,
        pendingLexa: pending.pendingLexa,
        totalLexa: pending.totalLexa,
        tasks: clone(config.tasks),
        exchange: clone(config.exchange),
        rules: clone(config.rules),
        wheel: {
            sectors: clone(config.wheel.sectors)
        },
        rewardPool: clone(config.wheel.sectors),
        history: history.items || [],
        state: {
            welcomeSpinGranted: Boolean(state.welcomeSpinGranted),
            lastSpinAt: state.lastSpinAt || 0,
            totalSpinsUsed: state.totalSpinsUsed || 0,
            totalRewardsGranted: state.totalRewardsGranted || 0,
            totalExchangeCount: state.totalExchangeCount || 0
        }
    };
}

/**
 * Consume one spin, generate the reward, add Pending LEXA and write system history.
 * @param {object} env Cloudflare Worker environment
 * @param {string} uid User id
 * @param {object} [input]
 * @returns {Promise<object>}
 */
export async function startSpin(env, uid, input = {}) {
    if (!uid) throw new Error("Missing uid.");

    const config = await readConfig(env);
    const state = await ensureSpinState(env, uid, config);

    if (state.spins < config.spinCost) {
        throw new Error("No spins available.");
    }

    const spinId = makeId();
    const ticketId = buildTicketId(spinId);
    const rolled = weightedPick(config.wheel.sectors);
    const reward = finalizeReward(rolled.sector);
    reward.sectorIndex = rolled.index;

    const nextState = normalizeState({
    ...state,

    spins: Math.max(0, state.spins - config.spinCost),

    lastSpinAt: now(),
    lastSpinId: spinId,
    lastSpinReward: reward,

    totalSpinsUsed:
        state.totalSpinsUsed + 1,

    totalRewardsGranted:
        state.totalRewardsGranted +
        (reward.amount > 0 ? 1 : 0),

    updatedAt: now()

}, config);

await saveSpinState(env, uid, nextState);
if (reward.amount > 0) {
    await addPendingLexa(env, uid, reward.amount);
}
    await appendSpinHistory(env, uid, {
        title: "Lucky Spin",
        description: reward.description || `${reward.label} won`,
        amount: reward.amount,
        token: "LEXA",
        status: "success",
        metadata: {
            action: "reward",
            spinId,
            ticketId,
            sectorIndex: reward.sectorIndex,
            rewardType: reward.type,
            rewardLabel: reward.label,
            rewardColor: reward.color,
            appVersion: String(input?.appVersion || ""),
            timezone: String(input?.timezone || "")
        },
        createdAt: now()
    });
const pending = await getPendingLexa(env, uid);
    return {
    success: true,

    spinId,
    ticketId,

    reward: serializeReward(
        reward,
        reward.sectorIndex
    ),

    remainingSpins: nextState.spins,

    pendingLexa: pending.pendingLexa,
    totalLexa: pending.totalLexa,

    historyType: "system"
};
}

/**
 * Convert LEXA into one spin.
 * @param {object} env Cloudflare Worker environment
 * @param {string} uid User id
 * @param {object|number|string} [input]
 * @returns {Promise<object>}
 */
export async function exchangeSpin(env, uid, input = {}) {
    if (!uid) throw new Error("Missing uid.");

    const config = await readConfig(env);
    const state = await ensureSpinState(env, uid, config);
    const amount = roundAmount(
        isObject(input) ? (input.amount ?? input.price ?? config.exchange.price) : input,
        8
    );

    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Invalid exchange amount.");
    }

    const rewardSpins =
    Math.max(
        1,
        Math.floor(
            safeNumber(
                config.exchange.rewardSpins,
                1
            )
        )
    );

const pending = await getPendingLexa(env, uid);

if (pending.pendingLexa < config.exchange.price) {
    throw new Error("Insufficient Pending LEXA.");
}

await subtractPendingLexa(
    env,
    uid,
    config.exchange.price
);

const nextState = normalizeState({

    ...state,

    spins:
        state.spins + rewardSpins,

    totalExchangeCount:
        state.totalExchangeCount + 1,

    updatedAt: now()

}, config);

await saveSpinState(env, uid, nextState);

    await appendSpinHistory(env, uid, {
        title: "Spin Exchange",
        description: `${formatLexa(amount)} LEXA converted into +${rewardSpins} spin`,
        amount: rewardSpins,
        token: "SPIN",
        status: "success",
        metadata: {
            action: "exchange",
            exchangeAmount: amount,
            exchangeRewardSpins: rewardSpins
        },
        createdAt: now()
    });
const latestPending = await getPendingLexa(env, uid);
    return {

    success: true,

    remainingSpins:
        nextState.spins,

    pendingLexa: latestPending.pendingLexa,
    totalLexa: latestPending.totalLexa,

    exchangedAmount:
        amount,

    rewardSpins,

    message:
        `Converted ${formatLexa(amount)} Pending LEXA into +${rewardSpins} spin.`

};
}

/**
 * Return spin history items stored in system history with spin metadata.
 * @param {object} env Cloudflare Worker environment
 * @param {string} uid User id
 * @param {number} [limit=20]
 * @returns {Promise<object>}
 */
export async function getSpinHistory(env, uid, limit = 20) {
    if (!uid) throw new Error("Missing uid.");

    const safe = safeLimit(limit, 20, 100);
    const rows = await getHistoryByUid(env, uid, Math.max(20, safe * 4));

    const items = (Array.isArray(rows) ? rows : [])
        .filter(spinHistoryFilter)
        .slice(0, safe)
        .map(serializeHistoryItem);

    return {
        success: true,
        items,
        limit: safe
    };
}

/**
 * Grant reward into Pending LEXA.
 * Useful when another route wants to grant a spin reward without consuming a spin.
 * @param {object} env Cloudflare Worker environment
 * @param {string} uid User id
 * @param {object} reward Reward object
 * @param {object} [metadata]
 * @returns {Promise<object>}
 */
export async function grantReward(env, uid, reward = {}, metadata = {}) {
    if (!uid) throw new Error("Missing uid.");

    const cfg = await readConfig(env);

const normalized =
    finalizeReward(reward);

const spinState =
    await ensureSpinState(
        env,
        uid,
        cfg
    );

const nextState = normalizeState({

    ...spinState,

    totalRewardsGranted:
        spinState.totalRewardsGranted +
        (normalized.amount > 0 ? 1 : 0),

    updatedAt: now()

}, cfg);

await saveSpinState(
    env,
    uid,
    nextState
);
if (normalized.amount > 0) {
    await addPendingLexa(
        env,
        uid,
        normalized.amount
    );
}
    await appendSpinHistory(env, uid, {
        title: "Lucky Spin Reward",
        description: normalized.description || `${normalized.label} granted`,
        amount: normalized.amount,
        token: "LEXA",
        status: "success",
        metadata: {
            action: "reward",
            ...clone(metadata),
            rewardType: normalized.type,
            rewardLabel: normalized.label
        },
        createdAt: now()
    });

    const pending = await getPendingLexa(env, uid);

return {
    success: true,
    reward: serializeReward(normalized),
    pendingLexa: pending.pendingLexa,
    totalLexa: pending.totalLexa
};
}

/**
 * Reduce available spins by one.
 * @param {object} env Cloudflare Worker environment
 * @param {string} uid User id
 * @param {number} [count=1]
 * @returns {Promise<object>}
 */
export async function consumeSpin(env, uid, count = 1) {
    if (!uid) throw new Error("Missing uid.");

    const cfg = await readConfig(env);
    const state = await ensureSpinState(env, uid, cfg);
    const n = Math.max(1, Math.floor(safeNumber(count, 1)));

    if (state.spins < n) {
        throw new Error("No spins available.");
    }

    const nextState = normalizeState({
        ...state,
        spins: Math.max(0, state.spins - n),
        updatedAt: now()
    }, cfg);

    await saveSpinState(env, uid, nextState);

    return {
        success: true,
        remainingSpins: nextState.spins
    };
}

/**
 * Generate a reward from the configured reward pool.
 * @param {object} env Cloudflare Worker environment
 * @returns {Promise<object>}
 */
export async function generateReward(env) {
    const cfg = await readConfig(env);
    const { sector, index } = weightedPick(cfg.wheel.sectors);
    const reward = finalizeReward(sector);
    reward.sectorIndex = index;

    return {
        success: true,
        reward: serializeReward(reward, index),
        sectorIndex: index
    };
}

/**
 * Optional helper to expose the current config for admin/debug routes.
 * @param {object} env Cloudflare Worker environment
 * @returns {Promise<object>}
 */
export async function getSpinConfig(env) {
    const config = await readConfig(env);
    return {
        success: true,
        config: clone(config)
    };
}

/**
 * Optional helper to overwrite the spin config.
 * @param {object} env Cloudflare Worker environment
 * @param {object} nextConfig Config object
 * @returns {Promise<object>}
 */
export async function setSpinConfig(env, nextConfig = {}) {
    const config = await writeConfig(env, nextConfig);
    return {
        success: true,
        config: clone(config)
    };
}

/**
 * Optional helper to reset a user's spin state.
 * @param {object} env Cloudflare Worker environment
 * @param {string} uid User id
 * @returns {Promise<object>}
 */
export async function resetSpinState(env, uid) {
    if (!uid) throw new Error("Missing uid.");

    const config = await readConfig(env);
    const createdAt = now();
    const state = normalizeState({
        uid,
        spins: config.welcomeSpinCount,
        welcomeSpinGranted: config.welcomeSpinCount > 0,
        referral: config.tasks.referral,
        daily: config.tasks.daily,
        exchange: config.exchange,
        createdAt,
        updatedAt: createdAt
    }, config);

    await saveSpinState(env, uid, state);

    return {
        success: true,
        state
    };
}

export default {
    getDashboard,
    startSpin,
    exchangeSpin,
    getSpinHistory,
    grantReward,
    consumeSpin,
    generateReward,
    getSpinConfig,
    setSpinConfig,
    resetSpinState
};