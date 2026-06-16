import { mineNormies, type MineRequest } from "./normiesMiner";

type BunServer = {
  port: number;
  hostname: string;
};

declare const Bun: {
  serve(options: {
    port: number;
    hostname: string;
    fetch(request: Request): Response | Promise<Response>;
  }): BunServer;
};

const DEFAULT_RATE_LIMIT = 10;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_MAX_TOP = 25;
const DEFAULT_MAX_BATCH_SIZE = 100;
const DEFAULT_MAX_UNLISTED_SCAN_RANGE = 250;
const DEFAULT_PORT = 3001;

const recentRequests = new Map<string, number[]>();

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const allowedOrigins = (process.env.API_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const allowOrigin = allowedOrigins.length === 0
    ? "*"
    : origin && allowedOrigins.includes(origin)
      ? origin
      : allowedOrigins[0];

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function parseEnvNumber(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumber(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function json(request: Request, body: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(request),
      ...headers,
    },
  });
}

function jsonError(request: Request, message: string, status: number) {
  return json(request, { error: message }, status);
}

function clientKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.headers.get("x-real-ip") || "local";
}

function isRateLimited(request: Request) {
  const limit = parseEnvNumber("API_RATE_LIMIT", DEFAULT_RATE_LIMIT);
  const windowMs = parseEnvNumber("API_RATE_LIMIT_WINDOW_MS", DEFAULT_RATE_LIMIT_WINDOW_MS);
  const now = Date.now();
  const key = clientKey(request);
  const hits = (recentRequests.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);

  if (hits.length >= limit) {
    recentRequests.set(key, hits);
    return true;
  }

  hits.push(now);
  recentRequests.set(key, hits);

  if (recentRequests.size > 1000) {
    for (const [entryKey, timestamps] of recentRequests) {
      if (timestamps.every((timestamp) => now - timestamp >= windowMs)) recentRequests.delete(entryKey);
    }
  }

  return false;
}

async function parseMineRequest(request: Request) {
  try {
    return (await request.json()) as Partial<MineRequest>;
  } catch {
    return null;
  }
}

async function handleMine(request: Request) {
  if (isRateLimited(request)) {
    return jsonError(request, "Too many build requests. Wait a minute and try again.", 429);
  }

  const body = await parseMineRequest(request);
  if (!body) return jsonError(request, "Request body must be valid JSON.", 400);

  const targetBits = typeof body.targetBits === "string" ? body.targetBits.replace(/\s+/g, "") : "";
  const targetMask = typeof body.targetMask === "string" ? body.targetMask.replace(/\s+/g, "") : undefined;
  const addressPattern = /^0x[0-9a-f]{40}$/;
  const allowFullCollectionScan = process.env.ALLOW_FULL_COLLECTION_SCAN === "true";
  const allowManualRefresh = process.env.ALLOW_MANUAL_REFRESH === "true";
  const requireListed = body.requireListed !== false;
  const from = clamp(parseNumber(body.from, 0), 0, 9999);
  const to = clamp(parseNumber(body.to, 9999), 0, 9999);
  const maxTop = clamp(parseEnvNumber("MAX_TOP", DEFAULT_MAX_TOP), 1, 100);
  const maxBatchSize = clamp(parseEnvNumber("MAX_BATCH_SIZE", DEFAULT_MAX_BATCH_SIZE), 1, 1000);
  const maxUnlistedRange = clamp(
    parseEnvNumber("MAX_UNLISTED_SCAN_RANGE", DEFAULT_MAX_UNLISTED_SCAN_RANGE),
    1,
    10000,
  );

  if (!/^[01]{1600}$/.test(targetBits)) {
    return jsonError(request, "Target must contain exactly 1600 binary pixels.", 400);
  }

  if (targetMask !== undefined && !/^[01]{1600}$/.test(targetMask)) {
    return jsonError(request, "Target mask must contain exactly 1600 binary pixels.", 400);
  }

  if (to < from) {
    return jsonError(request, "Token range is invalid.", 400);
  }

  if (!requireListed && !allowFullCollectionScan) {
    return jsonError(request, "Full collection scans are disabled on this hosted app.", 400);
  }

  if (!requireListed && to - from + 1 > maxUnlistedRange) {
    return jsonError(request, `Full collection scans are limited to ${maxUnlistedRange} tokens.`, 400);
  }

  if ((body.refresh || body.refreshListings) && !allowManualRefresh) {
    return jsonError(request, "Manual cache refresh is disabled on this hosted app.", 400);
  }

  const owner = typeof body.owner === "string" && body.owner.trim()
    ? body.owner.trim().toLowerCase()
    : undefined;

  const ownedWallet = typeof body.ownedWallet === "string" && body.ownedWallet.trim()
    ? body.ownedWallet.trim().toLowerCase()
    : undefined;

  if (owner && !addressPattern.test(owner)) {
    return jsonError(request, "Owner filter must be a valid 0x address.", 400);
  }

  if (ownedWallet && !addressPattern.test(ownedWallet)) {
    return jsonError(request, "Owned wallet must be a valid 0x address.", 400);
  }

  try {
    const result = await mineNormies({
      targetBits,
      targetMask,
      owner,
      ownedWallet,
      top: clamp(parseNumber(body.top, 25), 1, maxTop),
      from,
      to,
      batchSize: clamp(parseNumber(body.batchSize, 25), 1, maxBatchSize),
      refresh: allowManualRefresh && Boolean(body.refresh),
      includeBurned: !requireListed && Boolean(body.includeBurned),
      requireListed,
      refreshListings: allowManualRefresh && Boolean(body.refreshListings),
    });

    return json(request, result, 200, { "Cache-Control": "private, no-store" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown mining error";
    console.error("[mine]", message);
    return jsonError(request, message, 500);
  }
}

function handleOptions(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

function handleHealth(request: Request) {
  return json(request, {
    ok: true,
    service: "normies-api",
    generatedAt: new Date().toISOString(),
  });
}

async function handleRequest(request: Request) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") return handleOptions(request);
  if (request.method === "GET" && url.pathname === "/api/health") return handleHealth(request);
  if (request.method === "POST" && url.pathname === "/api/mine") return handleMine(request);

  return jsonError(request, "Not found.", 404);
}

const port = clamp(parseEnvNumber("PORT", DEFAULT_PORT), 1, 65535);
const hostname = process.env.HOSTNAME || "0.0.0.0";
const server = Bun.serve({ port, hostname, fetch: handleRequest });

console.log(`Normies Builder API listening on http://${server.hostname}:${server.port}`);
