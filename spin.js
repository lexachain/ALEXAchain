/* ==========================================================
   ALEXA API
   File : routes/spin.js
   Description : Lucky Spin Routes
========================================================== */

import { success, error } from "../helpers/response.js";
import { requireUser } from "../helpers/security.js";
import {
    getDashboard,
    startSpin,
    exchangeSpin,
    getSpinHistory
} from "../helpers/spin.js";

/* ==========================================================
   PATH
========================================================== */

function normalizePath(pathname = "") {
    let path = String(pathname || "").split("?")[0].trim();

    if (!path.startsWith("/")) {
        path = `/${path}`;
    }

    if (path.length > 1) {
        path = path.replace(/\/+$/, "");
    }

    return path || "/";
}


/* ==========================================================
   BODY
========================================================== */

async function readJsonBody(request) {
    try {
        const text = await request.text();
        if (!text) return {};
        return JSON.parse(text);
    } catch {
        return {};
    }
}

/* ==========================================================
   ROUTE
========================================================== */

/**
 * Lucky Spin route handler.
 * @param {object} env Cloudflare Worker env
 * @param {Request} request Incoming request
 * @param {string} path Request path from router
 * @returns {Promise<Response>}
 */
export async function spinRoute(env, request, path = "") {
    try {
        const method = String(request.method || "GET").toUpperCase();
        const pathname = normalizePath(path || new URL(request.url).pathname);

        if (!pathname.startsWith("/api/spin")) {
            return error(env, "Endpoint Not Found", 404);
        }

        const user = await requireUser(env, request);

        if (method === "GET" && pathname === "/api/spin") {
            const dashboard = await getDashboard(env, user.uid);
            return success(env, dashboard);
        }

        if (method === "POST" && pathname === "/api/spin/start") {
            const body = await readJsonBody(request);
            const result = await startSpin(env, user.uid, body);
            return success(env, result);
        }

        if (method === "POST" && pathname === "/api/spin/exchange") {
            const body = await readJsonBody(request);
            const result = await exchangeSpin(env, user.uid, body);
            return success(env, result);
        }

        if (method === "GET" && pathname === "/api/spin/history") {
            const url = new URL(request.url);
            const limit = Number(url.searchParams.get("limit") || 20);
            const result = await getSpinHistory(env, user.uid, limit);
            return success(env, result);
        }

        return error(env, "Endpoint Not Found", 404);
    } catch (err) {
        return error(env, err?.message || "Internal Error", 500);
    }
}

export default { spinRoute };