import fs from "node:fs";
import path from "node:path";

const PACKAGE_ROOT = process.cwd();
const WORKSPACE_ROOT = path.basename(PACKAGE_ROOT) === "api" && path.basename(path.dirname(PACKAGE_ROOT)) === "packages"
  ? path.resolve(PACKAGE_ROOT, "../..")
  : PACKAGE_ROOT;
const IS_VERCEL = process.env.VERCEL === "1";
const CACHE_ROOT = process.env.NORMIES_CACHE_DIR || (
  IS_VERCEL ? path.join("/tmp", "normies-builder-cache") : path.join(WORKSPACE_ROOT, "cache")
);
const CACHE_PATH = path.join(CACHE_ROOT, "normies-miner-cache.json");
const LISTINGS_CACHE_PATH = path.join(CACHE_ROOT, "normies-opensea-listings.json");
const LISTINGS_CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_OPENSEA_PAGES = parseEnvInt("MAX_OPENSEA_PAGES", IS_VERCEL ? 5 : 25, 1, 25);
const MAX_LISTED_TOKEN_IDS = parseEnvInt("MAX_LISTED_TOKEN_IDS", IS_VERCEL ? 500 : 5000, 1, 5000);
const MAX_OWNER_RPC_SCAN_RANGE = parseEnvInt("MAX_OWNER_RPC_SCAN_RANGE", IS_VERCEL ? 500 : 10000, 1, 10000);

export const NORMIES_ADDRESS = "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438";
const STORAGE_ADDRESS = "0x1B976bAf51cF51F0e369C070d47FBc47A706e602";
const CANVAS_ADDRESS = "0x64951d92e345C50381267380e2975f66810E869c";
const OPENSEA_BASE = `https://opensea.io/item/ethereum/${NORMIES_ADDRESS.toLowerCase()}`;
const OPENSEA_API_BASE = "https://api.opensea.io";
const OPENSEA_COLLECTION_SLUG = "normies";
const NORMIES_API_BASE = "https://api.normies.art";

function parseEnvInt(name: string, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

const SELECTORS = {
  ownerOf: "0x6352211e",
  getTokenRawImageData: "0x6985bf3c",
  actionPoints: "0x5c5c3021",
  paused: "0x5c975abb",
  maxBurnPercent: "0xc3d74026",
  tierThresholds: "0xa100d69d",
  tierMinPercents: "0x5366de54",
} as const;

type RpcResult = {
  kind?: "image" | "owner" | "ap";
  tokenId?: number;
  key?: string;
  to: string;
  data: string;
  result?: string;
  error?: { message?: string };
};

export type CanvasStatus = {
  paused: boolean;
  maxBurnPercent: number;
  tierThresholds: [number, number];
  tierMinPercents: [number, number, number];
};

export type CachedToken = {
  tokenId: number;
  owner: string | null;
  originalHex?: string;
  originalPixelCount?: number;
  actionPoints: number;
  imageError?: string;
};

export type CollectionCache = {
  generatedAt: string;
  rpcUrl: string;
  range: { from: number; to: number };
  completeRange?: boolean;
  addresses: {
    normies: string;
    storage: string;
    canvas: string;
  };
  canvasStatus: CanvasStatus;
  tokens: CachedToken[];
};

export type MineRequest = {
  targetBits: string;
  targetMask?: string;
  owner?: string;
  ownedWallet?: string;
  top?: number;
  from?: number;
  to?: number;
  batchSize?: number;
  refresh?: boolean;
  includeBurned?: boolean;
  requireListed?: boolean;
  refreshListings?: boolean;
};

export type BurnYield = {
  minPercent: number;
  maxPercent: number;
  min: number;
  expected: number;
  max: number;
};

export type PixelCoord = {
  x: number;
  y: number;
};

export type ListingInfo = {
  tokenId: number;
  status: string;
  price: string;
  currency: string;
  rawValue: string;
  decimals: number;
  orderHash: string;
  orderCreatedAt?: number;
};

export type RankedCandidate = {
  tokenId: number;
  owner: string | null;
  opensea: string;
  imageUrl: string;
  originalPixelCount: number;
  actionCost: number;
  currentActionPoints: number;
  additionalActionsNeeded: number;
  added: number;
  removed: number;
  netPixelChange: number;
  overlayHex: string;
  overlayBits?: string;
  baseBits?: string;
  addedPixels?: PixelCoord[];
  removedPixels?: PixelCoord[];
  burnYield: BurnYield;
  listing: ListingInfo | null;
  basePrice: number | null;
  donorPrice: number;
  totalPrice: number | null;
  priceCurrency: string;
  pathDonorCount: number;
  pathCoveredMin: number;
  pathComplete: boolean;
  owned: boolean;
};

export type DonorCandidate = {
  tokenId: number;
  owner: string | null;
  opensea: string;
  imageUrl: string;
  originalPixelCount: number;
  currentActionPoints: number;
  burnYield: BurnYield;
  guaranteedActionPoints: number;
  expectedActionPoints: number;
  maxActionPoints: number;
  apPerCurrency: number | null;
  listing: ListingInfo | null;
  owned: boolean;
};

export type DonorPlan = {
  needed: number;
  coveredMin: number;
  coveredExpected: number;
  coveredMax: number;
  donorPrice: number;
  totalPrice: number | null;
  priceCurrency: string;
  donors: DonorCandidate[];
};

export type MineResult = {
  targetPixelCount: number;
  targetWildcardCount: number;
  generatedAt: string;
  scanned: number;
  liveCandidates: number;
  canvasStatus: CanvasStatus;
  saleMode: {
    requireListed: boolean;
    listingsChecked: boolean;
    listedTokenCount: number;
    ownedTokenCount: number;
  };
  best: RankedCandidate | null;
  ranked: RankedCandidate[];
  donorPlan: DonorPlan | null;
  donorPlans: Record<number, DonorPlan | null>;
};

export function loadRootEnv() {
  const envFiles = [path.join(PACKAGE_ROOT, ".env"), path.join(WORKSPACE_ROOT, ".env")];

  for (const filePath of envFiles) {
    if (!fs.existsSync(filePath)) continue;

    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;

      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;

      let value = rawValue.trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function getRpcUrl() {
  return (
    process.env.ETH_RPC_URL ||
    process.env.RPC_URL ||
    (process.env.ALCHEMY_API_KEY
      ? `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
      : "https://ethereum.publicnode.com")
  );
}

function encodeUint256(value: number | bigint) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function callData(selector: string, arg: number | bigint) {
  return `${selector}${encodeUint256(arg)}`;
}

function wait(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function isRetryableRpcResult(result: RpcResult) {
  if (!result.result && !result.error) return true;
  const message = result.error?.message ?? "";
  return /missing|timeout|temporar|rate|limit|too many|server|gateway|502|503|504/i.test(message);
}

async function rpcBatchOnce(rpcUrl: string, calls: RpcResult[], blockTag: string) {
  const body = calls.map((call, index) => ({
    jsonrpc: "2.0",
    id: index,
    method: "eth_call",
    params: [{ to: call.to, data: call.data }, blockTag],
  }));

  let res: Response;
  try {
    res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : "";
    throw new Error(`RPC request failed${cause}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RPC HTTP ${res.status}: ${text.slice(0, 280)}`);
  }

  const payload = (await res.json()) as Array<{ id: number; result?: string; error?: { message?: string } }>;
  if (!Array.isArray(payload)) throw new Error("Unexpected non-batch RPC response");

  const byId = new Map(payload.map((item) => [item.id, item]));
  return calls.map((call, index) => {
    const item = byId.get(index);
    if (!item) return { ...call, error: { message: "Missing RPC response" } };
    return item.error ? { ...call, error: item.error } : { ...call, result: item.result };
  });
}

async function rpcBatch(rpcUrl: string, calls: RpcResult[], blockTag = "latest", attempts = 3) {
  const results = new Array<RpcResult>(calls.length);
  let pending = calls.map((call, index) => ({ call, index }));

  for (let attempt = 1; attempt <= attempts && pending.length > 0; attempt++) {
    const batch = await rpcBatchOnce(
      rpcUrl,
      pending.map((item) => item.call),
      blockTag,
    );
    const retry: typeof pending = [];

    for (let i = 0; i < batch.length; i++) {
      const result = batch[i];
      const original = pending[i];
      if (attempt < attempts && isRetryableRpcResult(result)) {
        retry.push(original);
      } else {
        results[original.index] = result;
      }
    }

    pending = retry;
    if (pending.length > 0) await wait(150 * attempt);
  }

  return results;
}

async function fetchCurrentBlockTag(rpcUrl: string) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  if (!res.ok) return "latest";
  const payload = (await res.json().catch(() => null)) as { result?: string } | null;
  return payload?.result ?? "latest";
}

function decodeUint(result?: string) {
  if (!result || result === "0x") return 0n;
  return BigInt(result);
}

function decodeAddress(result?: string) {
  if (!result || result === "0x" || result.length < 66) return null;
  return `0x${result.slice(-40)}`.toLowerCase();
}

function decodeDynamicBytes(result?: string) {
  if (!result || result === "0x") throw new Error("Empty bytes result");
  const hex = result.slice(2);
  const offset = Number(BigInt(`0x${hex.slice(0, 64)}`));
  const lengthOffset = offset * 2;
  const length = Number(BigInt(`0x${hex.slice(lengthOffset, lengthOffset + 64)}`));
  const dataOffset = lengthOffset + 64;
  return `0x${hex.slice(dataOffset, dataOffset + length * 2)}`;
}

function bitsToBytes(bits: string) {
  if (!/^[01]{1600}$/.test(bits)) {
    throw new Error("Target must be exactly 1600 binary pixels");
  }

  const bytes = new Uint8Array(200);
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === "1") bytes[i >> 3] |= 1 << (7 - (i & 7));
  }
  return bytes;
}

function targetMaskToBytes(mask?: string) {
  if (mask === undefined) {
    return new Uint8Array(200).fill(0xff);
  }
  if (!/^[01]{1600}$/.test(mask)) {
    throw new Error("Target mask must be exactly 1600 binary pixels");
  }
  return bitsToBytes(mask);
}

function hexToBytes(hex: string) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array) {
  let out = "0x";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function bytesToBits(bytes: Uint8Array) {
  const chars = new Array<string>(1600);
  for (let i = 0; i < 1600; i++) {
    const byteIndex = i >> 3;
    const bitPos = 7 - (i & 7);
    chars[i] = ((bytes[byteIndex] >> bitPos) & 1) === 1 ? "1" : "0";
  }
  return chars.join("");
}

function popcountByte(value: number) {
  let count = 0;
  let v = value;
  while (v !== 0) {
    v &= v - 1;
    count++;
  }
  return count;
}

function popcountBytes(bytes: Uint8Array) {
  let count = 0;
  for (const byte of bytes) count += popcountByte(byte);
  return count;
}

function xorBytes(a: Uint8Array, b: Uint8Array, mask?: Uint8Array) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] ^ b[i]) & (mask?.[i] ?? 0xff);
  return out;
}

function maskedPopcount(bytes: Uint8Array, mask: Uint8Array) {
  let count = 0;
  for (let i = 0; i < bytes.length; i++) count += popcountByte(bytes[i] & mask[i]);
  return count;
}

function diffStats(original: Uint8Array, target: Uint8Array, mask: Uint8Array) {
  let added = 0;
  let removed = 0;

  for (let i = 0; i < 1600; i++) {
    const byteIndex = i >> 3;
    const bitPos = 7 - (i & 7);
    const maskBit = (mask[byteIndex] >> bitPos) & 1;
    if (maskBit === 0) continue;
    const origBit = (original[byteIndex] >> bitPos) & 1;
    const targetBit = (target[byteIndex] >> bitPos) & 1;

    if (origBit === 0 && targetBit === 1) added++;
    else if (origBit === 1 && targetBit === 0) removed++;
  }

  return { added, removed, net: added - removed };
}

function diffDetail(original: Uint8Array, target: Uint8Array, mask: Uint8Array) {
  const addedPixels: PixelCoord[] = [];
  const removedPixels: PixelCoord[] = [];

  for (let i = 0; i < 1600; i++) {
    const byteIndex = i >> 3;
    const bitPos = 7 - (i & 7);
    const maskBit = (mask[byteIndex] >> bitPos) & 1;
    if (maskBit === 0) continue;
    const origBit = (original[byteIndex] >> bitPos) & 1;
    const targetBit = (target[byteIndex] >> bitPos) & 1;
    if (origBit === targetBit) continue;

    const coord = { x: i % 40, y: Math.floor(i / 40) };
    if (origBit === 0) addedPixels.push(coord);
    else removedPixels.push(coord);
  }

  return { addedPixels, removedPixels };
}

function formatTokenAmount(value: string, decimals: number) {
  if (!/^\d+$/.test(value)) return value;
  const base = 10n ** BigInt(decimals);
  const raw = BigInt(value);
  const whole = raw / base;
  const fraction = raw % base;
  if (fraction === 0n) return whole.toString();

  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  const trimmed = fractionText.slice(0, 5).replace(/0+$/, "");
  return trimmed ? `${whole.toString()}.${trimmed}` : whole.toString();
}

function listingPriceNumber(listing: ListingInfo | null) {
  if (!listing || !/^\d+$/.test(listing.rawValue)) return null;
  const amount = Number(listing.rawValue) / 10 ** listing.decimals;
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

type OpenSeaListing = {
  order_hash?: string;
  status?: string;
  order_created_at?: number;
  asset?: {
    identifier?: string;
  };
  protocol_data?: {
    parameters?: {
      offer?: Array<{
        token?: string;
        identifierOrCriteria?: string;
      }>;
    };
  };
  price?: {
    current?: {
      currency?: string;
      decimals?: number;
      value?: string;
    };
  };
};

type ListingsCache = {
  generatedAt: string;
  listings: ListingInfo[];
};

function listingTokenId(listing: OpenSeaListing) {
  const assetIdentifier = listing.asset?.identifier;
  if (assetIdentifier !== undefined && /^\d+$/.test(assetIdentifier)) return Number(assetIdentifier);

  const offer = listing.protocol_data?.parameters?.offer?.find(
    (item) => item.token?.toLowerCase() === NORMIES_ADDRESS.toLowerCase(),
  );
  const identifier = offer?.identifierOrCriteria;
  return identifier && /^\d+$/.test(identifier) ? Number(identifier) : undefined;
}

function normalizeListing(listing: OpenSeaListing): ListingInfo | null {
  const tokenId = listingTokenId(listing);
  const value = listing.price?.current?.value;
  const decimals = listing.price?.current?.decimals ?? 18;
  const currency = listing.price?.current?.currency ?? "ETH";
  if (tokenId === undefined || !value || !listing.order_hash) return null;

  return {
    tokenId,
    status: listing.status ?? "ACTIVE",
    price: formatTokenAmount(value, decimals),
    currency,
    rawValue: value,
    decimals,
    orderHash: listing.order_hash,
    orderCreatedAt: listing.order_created_at,
  };
}

function readListingsCache(allowStale = false) {
  try {
    if (!fs.existsSync(LISTINGS_CACHE_PATH)) return null;
    const cache = JSON.parse(fs.readFileSync(LISTINGS_CACHE_PATH, "utf8")) as ListingsCache;
    if (allowStale) return cache;
    const age = Date.now() - Date.parse(cache.generatedAt);
    return Number.isFinite(age) && age < LISTINGS_CACHE_TTL_MS ? cache : null;
  } catch (err) {
    console.warn("[normies-miner] Unable to read listings cache", err);
    return null;
  }
}

function writeListingsCache(listings: ListingInfo[]) {
  try {
    fs.mkdirSync(path.dirname(LISTINGS_CACHE_PATH), { recursive: true });
    fs.writeFileSync(
      LISTINGS_CACHE_PATH,
      `${JSON.stringify({ generatedAt: new Date().toISOString(), listings } satisfies ListingsCache)}\n`,
    );
  } catch (err) {
    console.warn("[normies-miner] Unable to write listings cache", err);
  }
}

async function fetchOpenSeaListings(refreshListings: boolean) {
  const cached = refreshListings ? null : readListingsCache();
  if (cached) {
    return new Map(cached.listings.slice(0, MAX_LISTED_TOKEN_IDS).map((listing) => [listing.tokenId, listing]));
  }

  const apiKey = process.env.OPENSEA_API_KEY;
  if (!apiKey) {
    throw new Error("OPENSEA_API_KEY is required for sale-aware mining.");
  }

  const listings = new Map<number, ListingInfo>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_OPENSEA_PAGES; page++) {
    const url = new URL(`/api/v2/listings/collection/${OPENSEA_COLLECTION_SLUG}/best`, OPENSEA_API_BASE);
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("next.value", cursor);

    const res = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const stale = readListingsCache(true);
      if (stale) {
        return new Map(stale.listings.slice(0, MAX_LISTED_TOKEN_IDS).map((listing) => [listing.tokenId, listing]));
      }
      throw new Error(`OpenSea listings request failed (${res.status}): ${text.slice(0, 220)}`);
    }

    const body = (await res.json()) as { listings?: OpenSeaListing[]; next?: string };
    for (const raw of body.listings ?? []) {
      const listing = normalizeListing(raw);
      if (!listing || listing.status !== "ACTIVE") continue;
      if (!listings.has(listing.tokenId)) listings.set(listing.tokenId, listing);
    }

    if (!body.next) break;
    cursor = body.next;
  }

  const values = [...listings.values()].slice(0, MAX_LISTED_TOKEN_IDS);
  writeListingsCache(values);
  return new Map(values.map((listing) => [listing.tokenId, listing]));
}

async function fetchCanvasStatus(rpcUrl: string, blockTag = "latest"): Promise<CanvasStatus> {
  const calls: RpcResult[] = [
    { to: CANVAS_ADDRESS, data: SELECTORS.paused, key: "paused" },
    { to: CANVAS_ADDRESS, data: SELECTORS.maxBurnPercent, key: "maxBurnPercent" },
    { to: CANVAS_ADDRESS, data: callData(SELECTORS.tierThresholds, 0), key: "tierThreshold0" },
    { to: CANVAS_ADDRESS, data: callData(SELECTORS.tierThresholds, 1), key: "tierThreshold1" },
    { to: CANVAS_ADDRESS, data: callData(SELECTORS.tierMinPercents, 0), key: "tierMin0" },
    { to: CANVAS_ADDRESS, data: callData(SELECTORS.tierMinPercents, 1), key: "tierMin1" },
    { to: CANVAS_ADDRESS, data: callData(SELECTORS.tierMinPercents, 2), key: "tierMin2" },
  ];
  const results = await rpcBatch(rpcUrl, calls, blockTag);
  const values = Object.fromEntries(results.map((result) => [result.key, decodeUint(result.result)]));

  return {
    paused: values.paused === 1n,
    maxBurnPercent: Number(values.maxBurnPercent),
    tierThresholds: [Number(values.tierThreshold0), Number(values.tierThreshold1)],
    tierMinPercents: [Number(values.tierMin0), Number(values.tierMin1), Number(values.tierMin2)],
  };
}

async function fetchCollection(
  options: Required<Pick<MineRequest, "from" | "to" | "batchSize">> & {
    tokenIds?: number[];
    blockTag?: string;
    useCachedDynamic?: boolean;
  },
) {
  const rpcUrl = getRpcUrl();
  const tokenIds = options.tokenIds ?? [];
  if (!options.tokenIds) {
    for (let tokenId = options.from; tokenId <= options.to; tokenId++) tokenIds.push(tokenId);
  }

  const cached = readCache();
  const cachedById = new Map(cached?.tokens.map((token) => [token.tokenId, token]) ?? []);
  const tokens = new Map<number, CachedToken>();
  const status = await fetchCanvasStatus(rpcUrl, options.blockTag);
  const totalBatches = Math.ceil(tokenIds.length / options.batchSize);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batch = tokenIds.slice(batchIndex * options.batchSize, (batchIndex + 1) * options.batchSize);
    const calls: RpcResult[] = [];

    for (const tokenId of batch) {
      const cachedToken = cachedById.get(tokenId);
      const token: CachedToken = {
        tokenId,
        owner: options.useCachedDynamic ? cachedToken?.owner ?? null : null,
        originalHex: cachedToken?.originalHex,
        originalPixelCount: cachedToken?.originalPixelCount,
        actionPoints: options.useCachedDynamic ? cachedToken?.actionPoints ?? 0 : 0,
        imageError: cachedToken?.imageError,
      };
      tokens.set(tokenId, token);

      if (!token.originalHex || token.originalPixelCount === undefined) {
        calls.push({
          kind: "image",
          tokenId,
          to: STORAGE_ADDRESS,
          data: callData(SELECTORS.getTokenRawImageData, tokenId),
        });
      }
      calls.push({
        kind: "owner",
        tokenId,
        to: NORMIES_ADDRESS,
        data: callData(SELECTORS.ownerOf, tokenId),
      });
      calls.push({ kind: "ap", tokenId, to: CANVAS_ADDRESS, data: callData(SELECTORS.actionPoints, tokenId) });
    }

    const results = await rpcBatch(rpcUrl, calls, options.blockTag);
    for (const result of results) {
      if (result.tokenId === undefined || result.kind === undefined) continue;
      const token = tokens.get(result.tokenId) || {
        tokenId: result.tokenId,
        owner: null,
        actionPoints: 0,
      };

      if (result.kind === "image") {
        if (result.error) {
          if (!token.originalHex) token.imageError = result.error.message || "image call failed";
        } else {
          try {
            token.originalHex = decodeDynamicBytes(result.result);
            token.originalPixelCount = popcountBytes(hexToBytes(token.originalHex));
            delete token.imageError;
          } catch (err) {
            if (!token.originalHex) token.imageError = err instanceof Error ? err.message : "image decode failed";
          }
        }
      } else if (result.kind === "owner") {
        if (!result.error) token.owner = decodeAddress(result.result);
      } else if (result.kind === "ap") {
        if (!result.error) token.actionPoints = Number(decodeUint(result.result));
      }

      tokens.set(result.tokenId, token);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    rpcUrl,
    range: { from: options.from, to: options.to },
    completeRange: !options.tokenIds,
    addresses: {
      normies: NORMIES_ADDRESS,
      storage: STORAGE_ADDRESS,
      canvas: CANVAS_ADDRESS,
    },
    canvasStatus: status,
    tokens: [...tokens.values()].sort((a, b) => a.tokenId - b.tokenId),
  } satisfies CollectionCache;
}

async function fetchOwnedTokenIdsFromNormiesApi(ownedWallet: string, from: number, to: number) {
  const url = new URL(`/holders/${ownedWallet}`, NORMIES_API_BASE);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 404) return [];
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Normies holder API failed (${res.status}): ${text.slice(0, 160)}`);
  }

  const body = (await res.json()) as { tokenIds?: Array<string | number> };
  return (body.tokenIds ?? [])
    .map((tokenId) => Number(tokenId))
    .filter((tokenId) => Number.isInteger(tokenId) && tokenId >= from && tokenId <= to)
    .sort((a, b) => a - b);
}

async function fetchOwnedTokenIdsByRpc(
  options: Required<Pick<MineRequest, "from" | "to" | "batchSize">> & { ownedWallet: string; blockTag?: string },
) {
  const rpcUrl = getRpcUrl();
  const ownedWallet = options.ownedWallet.toLowerCase();
  const scanBatchSize = Math.min(500, Math.max(100, options.batchSize));
  const tokenIds: number[] = [];

  for (let tokenId = options.from; tokenId <= options.to; tokenId++) tokenIds.push(tokenId);

  const ownedTokenIds: number[] = [];
  const totalBatches = Math.ceil(tokenIds.length / scanBatchSize);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batch = tokenIds.slice(batchIndex * scanBatchSize, (batchIndex + 1) * scanBatchSize);
    const calls = batch.map((tokenId) => ({
      kind: "owner" as const,
      tokenId,
      to: NORMIES_ADDRESS,
      data: callData(SELECTORS.ownerOf, tokenId),
    }));

    const results = await rpcBatch(rpcUrl, calls, options.blockTag);
    for (const result of results) {
      if (result.tokenId === undefined || result.error) continue;
      if (decodeAddress(result.result) === ownedWallet) ownedTokenIds.push(result.tokenId);
    }
  }

  return ownedTokenIds;
}

async function fetchOwnedTokenIds(
  options: Required<Pick<MineRequest, "from" | "to" | "batchSize">> & { ownedWallet: string; blockTag?: string },
) {
  try {
    return await fetchOwnedTokenIdsFromNormiesApi(options.ownedWallet, options.from, options.to);
  } catch {
    if (options.to - options.from + 1 > MAX_OWNER_RPC_SCAN_RANGE) {
      throw new Error(
        `Owned wallet fallback scan is limited to ${MAX_OWNER_RPC_SCAN_RANGE} tokens. Try again later or narrow the range.`,
      );
    }
    return fetchOwnedTokenIdsByRpc(options);
  }
}

function cacheCoversRange(collection: CollectionCache, from: number, to: number) {
  return collection.completeRange !== false && collection.range.from <= from && collection.range.to >= to;
}

function readCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as CollectionCache;
  } catch (err) {
    console.warn("[normies-miner] Unable to read collection cache", err);
    return null;
  }
}

function writeCache(data: CollectionCache) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, `${JSON.stringify(data)}\n`);
  } catch (err) {
    console.warn("[normies-miner] Unable to write collection cache", err);
  }
}

function mergeCollectionIntoCache(update: CollectionCache) {
  const existing = readCache();
  if (!existing) {
    writeCache(update);
    return;
  }

  const tokens = new Map(existing.tokens.map((token) => [token.tokenId, token]));
  for (const token of update.tokens) {
    const prior = tokens.get(token.tokenId);
    tokens.set(token.tokenId, {
      ...prior,
      ...token,
      originalHex: token.originalHex ?? prior?.originalHex,
      originalPixelCount: token.originalPixelCount ?? prior?.originalPixelCount,
      imageError: token.originalHex ? undefined : token.imageError ?? prior?.imageError,
    });
  }

  writeCache({
    ...existing,
    generatedAt: new Date().toISOString(),
    rpcUrl: update.rpcUrl,
    addresses: update.addresses,
    canvasStatus: update.canvasStatus,
    tokens: [...tokens.values()].sort((a, b) => a.tokenId - b.tokenId),
  });
}

function burnPercentForPixelCount(pixelCount: number, status: CanvasStatus) {
  if (pixelCount < status.tierThresholds[0]) return status.tierMinPercents[0];
  if (pixelCount < status.tierThresholds[1]) return status.tierMinPercents[1];
  return status.tierMinPercents[2];
}

function burnYield(pixelCount: number, status: CanvasStatus): BurnYield {
  const minPercent = burnPercentForPixelCount(pixelCount, status);
  const yields = [];
  for (let pct = minPercent; pct <= status.maxBurnPercent; pct++) {
    yields.push(Math.floor((pixelCount * pct) / 100));
  }
  const expected = yields.reduce((sum, value) => sum + value, 0) / yields.length;
  return {
    minPercent,
    maxPercent: status.maxBurnPercent,
    min: yields[0] ?? 0,
    max: yields[yields.length - 1] ?? 0,
    expected,
  };
}

function isCandidateToken(token: CachedToken, owner: string | undefined, includeBurned: boolean) {
  if (!token.originalHex || token.originalPixelCount === undefined) return false;
  if (!includeBurned && !token.owner) return false;
  if (owner && token.owner !== owner) return false;
  return true;
}

function isOwnedBy(token: { owner: string | null }, ownedWallet: string | undefined) {
  return Boolean(ownedWallet && token.owner?.toLowerCase() === ownedWallet.toLowerCase());
}

function buildDonorCandidates(
  collection: CollectionCache,
  request: MineRequest,
  listings: Map<number, ListingInfo>,
) {
  const from = request.from ?? 0;
  const to = request.to ?? 9999;
  const owner = request.owner?.toLowerCase();
  const donors: DonorCandidate[] = [];

  for (const token of collection.tokens) {
    if (token.tokenId < from || token.tokenId > to) continue;
    if (!isCandidateToken(token, owner, Boolean(request.includeBurned))) continue;
    const listing = listings.get(token.tokenId) ?? null;
    const owned = isOwnedBy(token, request.ownedWallet);
    if (request.requireListed && !listing && !owned) continue;

    const yieldInfo = burnYield(token.originalPixelCount!, collection.canvasStatus);
    const guaranteedActionPoints = yieldInfo.min + (token.actionPoints || 0);
    const expectedActionPoints = yieldInfo.expected + (token.actionPoints || 0);
    const maxActionPoints = yieldInfo.max + (token.actionPoints || 0);
    const price = owned ? 0 : listingPriceNumber(listing);

    donors.push({
      tokenId: token.tokenId,
      owner: token.owner,
      opensea: `${OPENSEA_BASE}/${token.tokenId}`,
      imageUrl: `https://api.normies.art/normie/${token.tokenId}/original/image.svg`,
      originalPixelCount: token.originalPixelCount!,
      currentActionPoints: token.actionPoints || 0,
      burnYield: yieldInfo,
      guaranteedActionPoints,
      expectedActionPoints,
      maxActionPoints,
      apPerCurrency: price ? guaranteedActionPoints / price : null,
      listing,
      owned,
    });
  }

  donors.sort((a, b) => {
    if (request.requireListed) {
      if (a.owned !== b.owned) return a.owned ? -1 : 1;
      const aEfficiency = a.apPerCurrency ?? 0;
      const bEfficiency = b.apPerCurrency ?? 0;
      const aPrice = listingPriceNumber(a.listing) ?? Number.POSITIVE_INFINITY;
      const bPrice = listingPriceNumber(b.listing) ?? Number.POSITIVE_INFINITY;
      return (
        bEfficiency - aEfficiency ||
        b.guaranteedActionPoints - a.guaranteedActionPoints ||
        aPrice - bPrice ||
        a.tokenId - b.tokenId
      );
    }

    return (
      b.guaranteedActionPoints - a.guaranteedActionPoints ||
      b.expectedActionPoints - a.expectedActionPoints ||
      b.originalPixelCount - a.originalPixelCount ||
      a.tokenId - b.tokenId
    );
  });

  return donors;
}

function donorPrice(donor: DonorCandidate) {
  if (donor.owned) return 0;
  return listingPriceNumber(donor.listing) ?? 0;
}

function buildDonorPlanFromPool(
  needed: number,
  donors: DonorCandidate[],
  excludedTokenId: number,
  basePrice: number | null,
  priceCurrency: string,
) {
  if (needed <= 0) return null;

  type DonorPathNode = {
    donor: DonorCandidate;
    previous: DonorPathNode | null;
  };

  const eligible = donors.filter(
    (donor) =>
      donor.tokenId !== excludedTokenId &&
      donor.guaranteedActionPoints > 0 &&
      (donor.owned || listingPriceNumber(donor.listing) !== null),
  );

  const costs = Array.from({ length: needed + 1 }, () => Number.POSITIVE_INFINITY);
  const counts = Array.from({ length: needed + 1 }, () => Number.POSITIVE_INFINITY);
  const paths: Array<DonorPathNode | null> = Array.from({ length: needed + 1 }, () => null);
  costs[0] = 0;
  counts[0] = 0;

  for (const donor of eligible) {
    const price = donorPrice(donor);
    for (let covered = needed; covered >= 0; covered--) {
      if (!Number.isFinite(costs[covered])) continue;
      const nextCovered = Math.min(needed, covered + donor.guaranteedActionPoints);
      const nextCost = costs[covered] + price;
      const nextCount = counts[covered] + 1;
      if (
        nextCost + 1e-12 < costs[nextCovered] ||
        (Math.abs(nextCost - costs[nextCovered]) <= 1e-12 && nextCount < counts[nextCovered])
      ) {
        costs[nextCovered] = nextCost;
        counts[nextCovered] = nextCount;
        paths[nextCovered] = { donor, previous: paths[covered] };
      }
    }
  }

  let plan: DonorCandidate[] = [];
  let node = paths[needed];
  while (node) {
    plan.push(node.donor);
    node = node.previous;
  }
  plan = plan.reverse();

  if (plan.length === 0 && !Number.isFinite(costs[needed])) {
    let coveredMin = 0;
    for (const donor of eligible) {
      if (coveredMin >= needed) break;
      plan.push(donor);
      coveredMin += donor.guaranteedActionPoints;
    }
  }

  const coveredMin = plan.reduce((sum, donor) => sum + donor.guaranteedActionPoints, 0);
  const coveredExpected = plan.reduce((sum, donor) => sum + donor.expectedActionPoints, 0);
  const coveredMax = plan.reduce((sum, donor) => sum + donor.maxActionPoints, 0);
  const donorCost = plan.reduce((sum, donor) => sum + donorPrice(donor), 0);

  return {
    needed,
    coveredMin,
    coveredExpected,
    coveredMax,
    donorPrice: donorCost,
    totalPrice: basePrice === null ? null : basePrice + donorCost,
    priceCurrency,
    donors: plan,
  } satisfies DonorPlan;
}

function applyPathCosts(candidates: RankedCandidate[], donors: DonorCandidate[]) {
  return candidates.map((candidate) => {
    const basePrice = candidate.owned ? 0 : listingPriceNumber(candidate.listing);
    const priceCurrency = candidate.listing?.currency ?? "ETH";
    const plan = buildDonorPlanFromPool(
      candidate.additionalActionsNeeded,
      donors,
      candidate.tokenId,
      basePrice,
      priceCurrency,
    );
    const donorCost = plan?.donorPrice ?? 0;
    const pathCoveredMin = plan?.coveredMin ?? candidate.additionalActionsNeeded;
    const pathComplete = candidate.additionalActionsNeeded === 0 || pathCoveredMin >= candidate.additionalActionsNeeded;

    return {
      ...candidate,
      basePrice,
      donorPrice: donorCost,
      totalPrice: basePrice === null ? null : basePrice + donorCost,
      priceCurrency,
      pathDonorCount: plan?.donors.length ?? 0,
      pathCoveredMin,
      pathComplete,
    };
  });
}

function rankTokens(
  collection: CollectionCache,
  targetBytes: Uint8Array,
  targetMaskBytes: Uint8Array,
  request: MineRequest,
  listings: Map<number, ListingInfo>,
) {
  const from = request.from ?? 0;
  const to = request.to ?? 9999;
  const owner = request.owner?.toLowerCase();
  const ranked: RankedCandidate[] = [];

  for (const token of collection.tokens) {
    if (token.tokenId < from || token.tokenId > to) continue;
    if (!isCandidateToken(token, owner, Boolean(request.includeBurned))) continue;
    const listing = listings.get(token.tokenId) ?? null;
    const owned = isOwnedBy(token, request.ownedWallet);
    if (request.requireListed && !listing && !owned) continue;

    const original = hexToBytes(token.originalHex!);
    const overlay = xorBytes(original, targetBytes, targetMaskBytes);
    const actionCost = popcountBytes(overlay);
    const currentActionPoints = token.actionPoints || 0;
    const stats = diffStats(original, targetBytes, targetMaskBytes);

    ranked.push({
      tokenId: token.tokenId,
      owner: token.owner,
      opensea: `${OPENSEA_BASE}/${token.tokenId}`,
      imageUrl: `https://api.normies.art/normie/${token.tokenId}/original/image.svg`,
      originalPixelCount: token.originalPixelCount!,
      actionCost,
      currentActionPoints,
      additionalActionsNeeded: Math.max(0, actionCost - currentActionPoints),
      added: stats.added,
      removed: stats.removed,
      netPixelChange: stats.net,
      overlayHex: bytesToHex(overlay),
      burnYield: burnYield(token.originalPixelCount!, collection.canvasStatus),
      listing,
      basePrice: null,
      donorPrice: 0,
      totalPrice: null,
      priceCurrency: listing?.currency ?? "ETH",
      pathDonorCount: 0,
      pathCoveredMin: 0,
      pathComplete: false,
      owned,
    });
  }

  return ranked;
}

function attachDiffDetails(
  candidates: RankedCandidate[],
  collection: CollectionCache,
  targetBytes: Uint8Array,
  targetMaskBytes: Uint8Array,
) {
  const byId = new Map(collection.tokens.map((token) => [token.tokenId, token]));
  return candidates.map((candidate) => {
    const token = byId.get(candidate.tokenId);
    if (!token?.originalHex) return candidate;

    const original = hexToBytes(token.originalHex);
    const overlay = xorBytes(original, targetBytes, targetMaskBytes);
    const { addedPixels, removedPixels } = diffDetail(original, targetBytes, targetMaskBytes);
    return {
      ...candidate,
      baseBits: bytesToBits(original),
      overlayBits: bytesToBits(overlay),
      addedPixels,
      removedPixels,
    };
  });
}

function buildDonorPlan(
  best: RankedCandidate | null,
  donors: DonorCandidate[],
) {
  if (!best || best.additionalActionsNeeded <= 0) return null;
  return buildDonorPlanFromPool(
    best.additionalActionsNeeded,
    donors,
    best.tokenId,
    best.basePrice,
    best.priceCurrency,
  );
}

export async function mineNormies(request: MineRequest): Promise<MineResult> {
  loadRootEnv();

  const from = request.from ?? 0;
  const to = request.to ?? 9999;
  const batchSize = request.batchSize ?? 25;
  if (from < 0 || to > 9999 || to < from) throw new Error("Invalid token scan range");
  if (batchSize < 1 || batchSize > 1000) throw new Error("Batch size must be between 1 and 1000");

  const targetBytes = bitsToBytes(request.targetBits);
  const targetMaskBytes = targetMaskToBytes(request.targetMask);
  const targetPixelCount = maskedPopcount(targetBytes, targetMaskBytes);
  const targetWildcardCount = 1600 - popcountBytes(targetMaskBytes);
  const requireListed = request.requireListed ?? true;
  const ownedWallet = request.ownedWallet?.toLowerCase();
  const effectiveRequest = { ...request, requireListed, ownedWallet };
  const rpcUrl = getRpcUrl();
  const blockTag = await fetchCurrentBlockTag(rpcUrl);
  const listings = requireListed ? await fetchOpenSeaListings(Boolean(request.refreshListings)) : new Map<number, ListingInfo>();
  let listedTokenCount = listings.size;
  let ownedTokenCount = 0;

  let collection = !requireListed && !request.refresh ? readCache() : null;
  if (requireListed) {
    const listedTokenIds = [...listings.keys()].filter((tokenId) => tokenId >= from && tokenId <= to);
    const ownedTokenIds = ownedWallet
      ? await fetchOwnedTokenIds({ from, to, batchSize, ownedWallet, blockTag })
      : [];
    listedTokenCount = listedTokenIds.length;
    ownedTokenCount = ownedTokenIds.length;
    const tokenIds = [...new Set([...listedTokenIds, ...ownedTokenIds])].sort((a, b) => a - b);
    collection = await fetchCollection({ from, to, batchSize, tokenIds, blockTag, useCachedDynamic: true });
    mergeCollectionIntoCache(collection);
  } else if (!collection || !cacheCoversRange(collection, from, to)) {
    collection = await fetchCollection({ from, to, batchSize, blockTag });
    writeCache(collection);
  }

  if (!requireListed && ownedWallet) {
    ownedTokenCount = collection.tokens.filter(
      (token) => token.tokenId >= from && token.tokenId <= to && isOwnedBy(token, ownedWallet),
    ).length;
  }

  const donors = buildDonorCandidates(collection, effectiveRequest, listings);
  const ranked = applyPathCosts(
    rankTokens(collection, targetBytes, targetMaskBytes, effectiveRequest, listings),
    donors,
  ).sort((a, b) => {
    if (a.pathComplete !== b.pathComplete) return a.pathComplete ? -1 : 1;

    const aTotal = a.totalPrice ?? Number.POSITIVE_INFINITY;
    const bTotal = b.totalPrice ?? Number.POSITIVE_INFINITY;
    return (
      aTotal - bTotal ||
      a.donorPrice - b.donorPrice ||
      a.additionalActionsNeeded - b.additionalActionsNeeded ||
      a.actionCost - b.actionCost ||
      b.currentActionPoints - a.currentActionPoints ||
      a.tokenId - b.tokenId
    );
  });
  const detailedRanked = attachDiffDetails(
    ranked.slice(0, request.top ?? 25),
    collection,
    targetBytes,
    targetMaskBytes,
  );
  const donorPlans: Record<number, DonorPlan | null> = {};
  for (const candidate of detailedRanked) {
    donorPlans[candidate.tokenId] = buildDonorPlan(candidate, donors);
  }
  const best = detailedRanked[0] ?? null;
  const donorPlan = best ? donorPlans[best.tokenId] ?? null : null;

  return {
    targetPixelCount,
    targetWildcardCount,
    generatedAt: new Date().toISOString(),
    scanned: to - from + 1,
    liveCandidates: ranked.length,
    canvasStatus: collection.canvasStatus,
    saleMode: {
      requireListed,
      listingsChecked: requireListed,
      listedTokenCount,
      ownedTokenCount,
    },
    best,
    ranked: detailedRanked,
    donorPlan,
    donorPlans,
  };
}
