"use client";

import {
  Asterisk,
  Brush,
  Clipboard,
  Copy,
  Download,
  Eraser,
  FlipHorizontal,
  FlipVertical,
  Github,
  Grid3X3,
  Loader2,
  MousePointer2,
  PaintBucket,
  RefreshCw,
  Redo2,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const GRID_SIZE = 40;
const TOTAL_PIXELS = GRID_SIZE * GRID_SIZE;
const HISTORY_LIMIT = 80;
const DEFAULT_API_BASE_URL = "https://normies-api.blockhash.xyz";
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/+$/, "");

type Tool = "draw" | "erase" | "toggle" | "wildcard";
type PixelState = "off" | "on" | "wild";

type BurnYield = {
  minPercent: number;
  maxPercent: number;
  min: number;
  expected: number;
  max: number;
};

type PixelCoord = {
  x: number;
  y: number;
};

type ListingInfo = {
  tokenId: number;
  status: string;
  price: string;
  currency: string;
  orderHash: string;
};

type Candidate = {
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

type DonorCandidate = {
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

type DonorPlan = {
  needed: number;
  coveredMin: number;
  coveredExpected: number;
  coveredMax: number;
  donorPrice: number;
  totalPrice: number | null;
  priceCurrency: string;
  donors: DonorCandidate[];
};

type MineResult = {
  targetPixelCount: number;
  targetWildcardCount: number;
  scanned: number;
  liveCandidates: number;
  canvasStatus: {
    paused: boolean;
    maxBurnPercent: number;
    tierThresholds: [number, number];
    tierMinPercents: [number, number, number];
  };
  saleMode: {
    requireListed: boolean;
    listingsChecked: boolean;
    listedTokenCount: number;
    ownedTokenCount: number;
  };
  best: Candidate | null;
  ranked: Candidate[];
  donorPlan: DonorPlan | null;
  donorPlans?: Record<number, DonorPlan | null>;
};

function blankPixels() {
  return Array.from({ length: TOTAL_PIXELS }, (): PixelState => "off");
}

function apiUrl(pathname: string) {
  return API_BASE_URL ? `${API_BASE_URL}${pathname}` : "";
}

function bitsFromPixels(pixels: PixelState[]) {
  return pixels.map((pixel) => (pixel === "on" ? "1" : "0")).join("");
}

function maskFromPixels(pixels: PixelState[]) {
  return pixels.map((pixel) => (pixel === "wild" ? "0" : "1")).join("");
}

function pixelsFromBits(bits: string) {
  return bits.slice(0, TOTAL_PIXELS).split("").map<PixelState>((char) => (char === "1" ? "on" : "off"));
}

function pixelsFromTargetText(text: string) {
  return text
    .slice(0, TOTAL_PIXELS)
    .split("")
    .map<PixelState>((char) => {
      if (char === "1") return "on";
      if (char === "0") return "off";
      return "wild";
    });
}

function pixelsEqual(a: PixelState[], b: PixelState[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((pixel, index) => pixel === b[index]);
}

function pixelClass(pixel: PixelState) {
  return pixel === "on" ? "pixel on" : pixel === "wild" ? "pixel wild" : "pixel";
}

function pixelLabel(pixel: PixelState, index: number) {
  const state = pixel === "on" ? "on" : pixel === "wild" ? "wildcard" : "off";
  return `Pixel ${index} ${state}`;
}

function finalBitsFromBase(baseBits: string | undefined, targetBits: string, targetMask: string) {
  if (!baseBits) return undefined;
  return Array.from({ length: TOTAL_PIXELS }, (_, index) => (
    targetMask[index] === "0" ? baseBits[index] ?? "0" : targetBits[index]
  )).join("");
}

function shortAddress(address: string | null) {
  if (!address) return "burned";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function overlayFileName(tokenId: number) {
  return `normie-${tokenId}-overlay.hex`;
}

function coordList(coords?: PixelCoord[]) {
  if (!coords || coords.length === 0) return "None";
  return coords.map((coord) => `(${coord.x},${coord.y})`).join(" ");
}

function priceLabel(candidate: Pick<Candidate, "listing" | "owned">) {
  if (candidate.owned) return "owned";
  return candidate.listing ? `${candidate.listing.price} ${candidate.listing.currency}` : "not listed";
}

function amountLabel(amount: number | null | undefined, currency = "ETH") {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "n/a";
  const formatted = amount >= 100 ? amount.toFixed(2) : amount >= 10 ? amount.toFixed(3) : amount.toFixed(4);
  return `${formatted.replace(/\.?0+$/, "")} ${currency}`;
}

function efficiencyLabel(donor: DonorCandidate) {
  if (donor.owned) return "zero-cost AP";
  if (!donor.apPerCurrency || !Number.isFinite(donor.apPerCurrency)) return "AP price n/a";
  const currency = donor.listing?.currency ?? "unit";
  return `${donor.apPerCurrency.toFixed(1)} AP/${currency}`;
}

function PixelPreview({
  title,
  bits,
  mask,
  mode = "plain",
}: {
  title: string;
  bits?: string;
  mask?: string;
  mode?: "plain" | "diff";
}) {
  return (
    <div className="preview-card">
      <span>{title}</span>
      <div className={mode === "diff" ? "preview-grid diff" : "preview-grid"}>
        {Array.from({ length: TOTAL_PIXELS }, (_, index) => {
          const wild = mask?.[index] === "0";
          const on = bits?.[index] === "1";
          return <i key={index} className={wild ? "wild" : on ? "on" : ""} />;
        })}
      </div>
    </div>
  );
}

export default function Home() {
  const [pixels, setPixels] = useState<PixelState[]>(() => blankPixels());
  const [tool, setTool] = useState<Tool>("draw");
  const [brushSize, setBrushSize] = useState(1);
  const [mirrorX, setMirrorX] = useState(false);
  const [mirrorY, setMirrorY] = useState(false);
  const [ownedWallet, setOwnedWallet] = useState("");
  const [top, setTop] = useState(25);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(9999);
  const [importBits, setImportBits] = useState("");
  const [result, setResult] = useState<MineResult | null>(null);
  const [selectedBaseTokenId, setSelectedBaseTokenId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [undoStack, setUndoStack] = useState<PixelState[][]>([]);
  const [redoStack, setRedoStack] = useState<PixelState[][]>([]);
  const pixelsRef = useRef<PixelState[]>(pixels);
  const isPaintingRef = useRef(false);
  const strokeStartRef = useRef<PixelState[] | null>(null);

  const targetBits = useMemo(() => bitsFromPixels(pixels), [pixels]);
  const targetMask = useMemo(() => maskFromPixels(pixels), [pixels]);
  const activeCount = useMemo(() => pixels.filter((pixel) => pixel === "on").length, [pixels]);
  const wildcardCount = useMemo(() => pixels.filter((pixel) => pixel === "wild").length, [pixels]);
  const fixedCount = TOTAL_PIXELS - wildcardCount;
  const best = useMemo(() => {
    if (!result) return null;
    if (selectedBaseTokenId === null) return result.best;
    return result.ranked.find((candidate) => candidate.tokenId === selectedBaseTokenId) ?? result.best;
  }, [result, selectedBaseTokenId]);
  const donorPlan = best
    ? result?.donorPlans?.[best.tokenId] ?? (best.tokenId === result?.best?.tokenId ? result?.donorPlan ?? null : null)
    : null;
  const planCoversMin = donorPlan ? donorPlan.coveredMin >= donorPlan.needed : false;
  const ownedDonorCount = donorPlan?.donors.filter((donor) => donor.owned).length ?? 0;
  const buyDonorCount = donorPlan ? donorPlan.donors.length - ownedDonorCount : 0;
  const finalBits = useMemo(() => finalBitsFromBase(best?.baseBits, targetBits, targetMask), [best?.baseBits, targetBits, targetMask]);
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;
  const selectedBaseIsOverride = selectedBaseTokenId !== null && selectedBaseTokenId !== result?.best?.tokenId;

  const setPixelsDirect = useCallback((next: PixelState[]) => {
    pixelsRef.current = next;
    setPixels(next);
  }, []);

  const rememberPixelChange = useCallback((previous: PixelState[], next: PixelState[]) => {
    if (pixelsEqual(previous, next)) return;
    setUndoStack((current) => [...current, previous].slice(-HISTORY_LIMIT));
    setRedoStack([]);
  }, []);

  const commitPixelChange = useCallback((makeNext: (current: PixelState[]) => PixelState[]) => {
    const previous = pixelsRef.current;
    const next = makeNext(previous);
    if (pixelsEqual(previous, next)) return;
    setPixelsDirect(next);
    rememberPixelChange(previous, next);
  }, [rememberPixelChange, setPixelsDirect]);

  const undo = useCallback(() => {
    if (!undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    const current = pixelsRef.current;
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack((future) => [current, ...future].slice(0, HISTORY_LIMIT));
    setPixelsDirect(previous);
  }, [setPixelsDirect, undoStack]);

  const redo = useCallback(() => {
    if (!redoStack.length) return;
    const next = redoStack[0];
    const current = pixelsRef.current;
    setRedoStack(redoStack.slice(1));
    setUndoStack((past) => [...past, current].slice(-HISTORY_LIMIT));
    setPixelsDirect(next);
  }, [redoStack, setPixelsDirect]);

  const finishStroke = useCallback(() => {
    if (!isPaintingRef.current) return;
    isPaintingRef.current = false;

    const previous = strokeStartRef.current;
    const next = pixelsRef.current;
    strokeStartRef.current = null;

    if (previous) rememberPixelChange(previous, next);
  }, [rememberPixelChange]);

  useEffect(() => {
    window.addEventListener("pointerup", finishStroke);
    window.addEventListener("pointercancel", finishStroke);
    return () => {
      window.removeEventListener("pointerup", finishStroke);
      window.removeEventListener("pointercancel", finishStroke);
    };
  }, [finishStroke]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      const isTextInput = tagName === "INPUT" || tagName === "TEXTAREA" || target?.isContentEditable;
      const key = event.key.toLowerCase();

      if (isTextInput || event.altKey || !(event.metaKey || event.ctrlKey)) return;

      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [redo, undo]);

  function brushIndexes(index: number) {
    const x = index % GRID_SIZE;
    const y = Math.floor(index / GRID_SIZE);
    const radius = Math.floor((brushSize - 1) / 2);
    const coords = new Set<number>();

    const addAt = (baseX: number, baseY: number) => {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nextX = baseX + dx;
          const nextY = baseY + dy;
          if (nextX >= 0 && nextX < GRID_SIZE && nextY >= 0 && nextY < GRID_SIZE) {
            coords.add(nextY * GRID_SIZE + nextX);
          }
        }
      }
    };

    addAt(x, y);
    if (mirrorX) addAt(GRID_SIZE - 1 - x, y);
    if (mirrorY) addAt(x, GRID_SIZE - 1 - y);
    if (mirrorX && mirrorY) addAt(GRID_SIZE - 1 - x, GRID_SIZE - 1 - y);

    return [...coords];
  }

  function paintedPixels(current: PixelState[], index: number) {
    const next = [...current];
    for (const targetIndex of brushIndexes(index)) {
      if (tool === "draw") next[targetIndex] = "on";
      else if (tool === "erase") next[targetIndex] = "off";
      else if (tool === "wildcard") next[targetIndex] = "wild";
      else next[targetIndex] = next[targetIndex] === "on" ? "off" : "on";
    }
    return next;
  }

  function paint(index: number) {
    const previous = pixelsRef.current;
    const next = paintedPixels(previous, index);
    if (!pixelsEqual(previous, next)) setPixelsDirect(next);
  }

  function beginStroke(index: number) {
    strokeStartRef.current = pixelsRef.current;
    isPaintingRef.current = true;
    paint(index);
  }

  function importTargetBits() {
    const compact = importBits.replace(/\s+/g, "");
    if (!/^[01xX*?.-]{1600}$/.test(compact)) {
      setError("Paste exactly 1600 pixels using 0, 1, or wildcard markers.");
      return;
    }
    commitPixelChange(() => (/^[01]{1600}$/.test(compact) ? pixelsFromBits(compact) : pixelsFromTargetText(compact)));
    setError("");
  }

  async function mine() {
    setLoading(true);
    setError("");
    setCopied(false);

    try {
      const endpoint = apiUrl("/api/mine");
      if (!endpoint) throw new Error("API URL is not configured.");

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetBits,
          targetMask,
          ownedWallet: ownedWallet || undefined,
          top,
          from,
          to,
          includeBurned: false,
          requireListed: true,
          refreshListings: false,
          refresh: false,
          batchSize: 25,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Build request failed");
      setResult(payload);
      setSelectedBaseTokenId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Build request failed");
    } finally {
      setLoading(false);
    }
  }

  async function copyOverlay() {
    if (!best) return;
    await navigator.clipboard.writeText(best.overlayHex);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function downloadOverlay() {
    if (!best) return;
    const blob = new Blob([`${best.overlayHex}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = overlayFileName(best.tokenId);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="workspace">
      <section className="masthead">
        <div className="brand-lockup">
          <p className="eyebrow">Normies NFT / Canvas Path Finder / On-Chain Data</p>
          <h1>NORMIES BUILDER</h1>
          <p className="mast-copy">Draw target / scan listings / route burn AP</p>
        </div>
        <a
          className="source-link"
          href="https://github.com/mikeahirsch/normies-builder"
          target="_blank"
          rel="noreferrer"
          aria-label="Open the normies-builder GitHub repository"
        >
          <Github size={17} />
          <span>mikeahirsch/normies-builder</span>
        </a>
      </section>

      <section className="workbench">
        <aside className="tool-rail" aria-label="Drawing tools">
          <button className="icon-button" onClick={undo} disabled={!canUndo} title="Undo" aria-label="Undo">
            <Undo2 size={18} />
          </button>
          <button className="icon-button" onClick={redo} disabled={!canRedo} title="Redo" aria-label="Redo">
            <Redo2 size={18} />
          </button>
          <div className="rail-divider" />
          <button className={tool === "draw" ? "icon-button active" : "icon-button"} onClick={() => setTool("draw")} title="Draw">
            <Brush size={18} />
          </button>
          <button className={tool === "erase" ? "icon-button active" : "icon-button"} onClick={() => setTool("erase")} title="Erase">
            <Eraser size={18} />
          </button>
          <button className={tool === "toggle" ? "icon-button active" : "icon-button"} onClick={() => setTool("toggle")} title="Toggle">
            <MousePointer2 size={18} />
          </button>
          <button className={tool === "wildcard" ? "icon-button active" : "icon-button"} onClick={() => setTool("wildcard")} title="Wildcard">
            <Asterisk size={18} />
          </button>
          <div className="rail-divider" />
          <button className={mirrorX ? "icon-button active" : "icon-button"} onClick={() => setMirrorX((value) => !value)} title="Mirror X">
            <FlipHorizontal size={18} />
          </button>
          <button className={mirrorY ? "icon-button active" : "icon-button"} onClick={() => setMirrorY((value) => !value)} title="Mirror Y">
            <FlipVertical size={18} />
          </button>
          <button
            className="icon-button"
            onClick={() => commitPixelChange((current) => current.map((pixel) => (pixel === "wild" ? "wild" : pixel === "on" ? "off" : "on")))}
            title="Invert fixed pixels"
          >
            <RotateCcw size={18} />
          </button>
          <button className="icon-button" onClick={() => commitPixelChange((current) => current.map(() => "on"))} title="All filled">
            <PaintBucket size={18} />
          </button>
          <button className="icon-button" onClick={() => commitPixelChange((current) => current.map(() => "wild"))} title="All wildcard">
            <Asterisk size={18} />
          </button>
          <button className="icon-button danger" onClick={() => commitPixelChange(() => blankPixels())} title="All unfilled">
            <Trash2 size={18} />
          </button>
        </aside>

        <div className="canvas-column">
          <div className="canvas-meta">
            <div>
              <span className="metric-label">Target Pixels</span>
              <strong>{activeCount}</strong>
            </div>
            <div>
              <span className="metric-label">Wildcards</span>
              <strong>{wildcardCount}</strong>
            </div>
            <label>
              <Grid3X3 size={16} />
              <input
                type="range"
                min="1"
                max="5"
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
              />
              <span>{brushSize}px</span>
            </label>
          </div>

          <div className="pixel-board" aria-label="40 by 40 drawing canvas">
            {pixels.map((pixel, index) => (
              <button
                key={index}
                className={pixelClass(pixel)}
                aria-label={pixelLabel(pixel, index)}
                onPointerDown={(event) => {
                  event.preventDefault();
                  beginStroke(index);
                }}
                onPointerEnter={() => {
                  if (isPaintingRef.current) paint(index);
                }}
              />
            ))}
          </div>
        </div>

        <aside className="control-panel">
          <div className="panel-section">
            <label className="field-label" htmlFor="ownedWallet">Owned Wallet</label>
            <input
              id="ownedWallet"
              value={ownedWallet}
              onChange={(event) => setOwnedWallet(event.target.value)}
              placeholder="0x... owned tokens cost 0"
              spellCheck={false}
            />
          </div>

          <div className="split-fields">
            <label>
              <span>From</span>
              <input type="number" min={0} max={9999} value={from} onChange={(event) => setFrom(Number(event.target.value))} />
            </label>
            <label>
              <span>To</span>
              <input type="number" min={0} max={9999} value={to} onChange={(event) => setTo(Number(event.target.value))} />
            </label>
            <label>
              <span>Top</span>
              <input
                type="number"
                min={1}
                max={25}
                value={top}
                onChange={(event) => setTop(Math.min(25, Math.max(1, Number(event.target.value))))}
              />
            </label>
          </div>

          <button className="mine-button" onClick={mine} disabled={loading}>
            {loading ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
            <span>{loading ? "Building" : "Build Path"}</span>
          </button>

          <div className="import-box">
            <textarea
              value={importBits}
              onChange={(event) => setImportBits(event.target.value)}
              placeholder="Paste 1600 pixels: 0 / 1 / *"
              spellCheck={false}
            />
            <button onClick={importTargetBits}>
              <Clipboard size={16} />
              <span>Load Bits</span>
            </button>
          </div>
        </aside>
      </section>

      {error ? <div className="error-bar">{error}</div> : null}

      <section className="results-grid">
        <div className="best-panel">
          <div className="section-title">
            <Sparkles size={18} />
            <h2>{selectedBaseIsOverride ? "Selected Path" : "Best Path"}</h2>
            {result?.saleMode.requireListed ? (
              <span className="result-note">
                {result.saleMode.listedTokenCount} listed
                {result.saleMode.ownedTokenCount ? ` / ${result.saleMode.ownedTokenCount} owned` : ""}
              </span>
            ) : null}
          </div>

          {best ? (
            <>
              <div className="path-strip">
                <div className="path-step">
                  <span>1</span>
                  <strong>{best.owned ? "Use owned" : "Buy"} base #{best.tokenId}</strong>
                  <em>{best.owned ? `owned / ${amountLabel(best.basePrice, best.priceCurrency)}` : amountLabel(best.basePrice, best.priceCurrency)}</em>
                </div>
                <div className="path-step">
                  <span>2</span>
                  <strong>{best.pathDonorCount ? "Assemble" : "No"} burn AP</strong>
                  <em>
                    {amountLabel(best.donorPrice, best.priceCurrency)} / {buyDonorCount} buy / {ownedDonorCount} owned / {best.additionalActionsNeeded} AP needed
                  </em>
                </div>
                <div className="path-step">
                  <span>3</span>
                  <strong>Set transform bitmap</strong>
                  <em>{best.added} add / {best.removed} remove / {wildcardCount} wild</em>
                </div>
              </div>

              <div className="best-card">
                <img src={best.imageUrl} alt={`Normie #${best.tokenId}`} />
                <div className="best-copy">
                  <div className="token-line">
                    <a href={best.opensea} target="_blank" rel="noreferrer">#{best.tokenId}</a>
                    <span>{shortAddress(best.owner)}</span>
                  </div>
                  <div className="stat-row">
                    <span>Total buy cost</span>
                    <strong>{amountLabel(best.totalPrice, best.priceCurrency)}</strong>
                  </div>
                  <div className="stat-row">
                    <span>{best.owned ? "Owned base" : "Base listing"}</span>
                    <strong>{best.owned ? `owned / ${amountLabel(best.basePrice, best.priceCurrency)}` : amountLabel(best.basePrice, best.priceCurrency)}</strong>
                  </div>
                  <div className="stat-row">
                    <span>Burn buys</span>
                    <strong>{amountLabel(best.donorPrice, best.priceCurrency)}</strong>
                  </div>
                  <div className="stat-row">
                    <span>Pixel cost</span>
                    <strong>{best.actionCost} AP</strong>
                  </div>
                  <div className="stat-row">
                    <span>Fixed pixels</span>
                    <strong>{fixedCount}</strong>
                  </div>
                  <div className="stat-row">
                    <span>Wildcards</span>
                    <strong>{wildcardCount}</strong>
                  </div>
                  <div className="stat-row">
                    <span>Held AP</span>
                    <strong>{best.currentActionPoints}</strong>
                  </div>
                  <div className="stat-row">
                    <span>Shortfall</span>
                    <strong>{best.additionalActionsNeeded}</strong>
                  </div>
                </div>
              </div>

              <div className="transform-preview">
                <PixelPreview title="Target mask" bits={targetBits} mask={targetMask} />
                <div className="preview-card image-preview">
                  <span>Base #{best.tokenId}</span>
                  <img src={best.imageUrl} alt={`Base Normie #${best.tokenId}`} />
                </div>
                <PixelPreview title="Final version" bits={finalBits} />
                <PixelPreview title={`${best.actionCost} pixel flips`} bits={best.overlayBits} mode="diff" />
              </div>

              <details className="coord-panel" open>
                <summary>Pixel diffs needed for #{best.tokenId}</summary>
                <div className="coord-grid">
                  <label>
                    <span>Add dark pixels ({best.addedPixels?.length ?? best.added})</span>
                    <textarea readOnly value={coordList(best.addedPixels)} />
                  </label>
                  <label>
                    <span>Remove dark pixels ({best.removedPixels?.length ?? best.removed})</span>
                    <textarea readOnly value={coordList(best.removedPixels)} />
                  </label>
                </div>
              </details>

              <div className="overlay-actions">
                <button onClick={copyOverlay}>
                  <Copy size={16} />
                  <span>{copied ? "Copied" : "Copy Overlay"}</span>
                </button>
                <button onClick={downloadOverlay}>
                  <Download size={16} />
                  <span>Download</span>
                </button>
              </div>

              <code className="overlay-code">{best.overlayHex}</code>
            </>
          ) : (
            <div className="empty-state">
              <PaintBucket size={24} />
              <span>No run yet.</span>
            </div>
          )}
        </div>

        <div className="path-panel">
          <div className="section-title">
            <RefreshCw size={18} />
            <h2>Burn Plan</h2>
          </div>

          {donorPlan ? (
            <>
              <div className="burn-summary">
                <div>
                  <span>Burn Buy Cost</span>
                  <strong>{amountLabel(donorPlan.donorPrice, donorPlan.priceCurrency)}</strong>
                </div>
                <div>
                  <span>Needed</span>
                  <strong>{donorPlan.needed}</strong>
                </div>
                <div>
                  <span>Min</span>
                  <strong>{donorPlan.coveredMin}</strong>
                </div>
                <div>
                  <span>Expected</span>
                  <strong>{donorPlan.coveredExpected.toFixed(1)}</strong>
                </div>
              </div>
              <div className={planCoversMin ? "coverage-note good" : "coverage-note warn"}>
                {planCoversMin
                  ? `Guaranteed covered: burn this owned/listed donor set into receiver #${best?.tokenId}.`
                  : `Not fully covered by owned/listed donors yet: minimum plan is short ${Math.max(0, donorPlan.needed - donorPlan.coveredMin)} AP.`}
              </div>
              <div className="donor-list">
                {donorPlan.donors.slice(0, 8).map((donor) => (
                  <a key={donor.tokenId} href={donor.opensea} target="_blank" rel="noreferrer" className="donor-row">
                    <img src={donor.imageUrl} alt={`Normie #${donor.tokenId}`} />
                    <span>
                      #{donor.tokenId}
                      <small>{priceLabel(donor)} / {efficiencyLabel(donor)}</small>
                    </span>
                    <strong>{donor.guaranteedActionPoints}-{donor.maxActionPoints} AP</strong>
                  </a>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <Sparkles size={24} />
              <span>{best ? "No burn needed." : "Run a target."}</span>
            </div>
          )}
        </div>
      </section>

      <section className="rank-panel">
        <div className="section-title">
          <Grid3X3 size={18} />
          <h2>Ranked Bases</h2>
          {result ? (
            <span className="result-note">
              {result.liveCandidates} candidates / {result.scanned} scanned
            </span>
          ) : null}
        </div>

        <div className="rank-table">
          <div className="rank-head">
            <span>Base</span>
            <span>Total</span>
            <span>Base</span>
            <span>Burns</span>
            <span>AP Need</span>
            <span>Diff</span>
          </div>
          {(result?.ranked ?? []).map((candidate) => (
            <button
              key={candidate.tokenId}
              type="button"
              className={candidate.tokenId === best?.tokenId ? "rank-row active" : "rank-row"}
              onClick={() => {
                setSelectedBaseTokenId(candidate.tokenId);
                setCopied(false);
              }}
              aria-pressed={candidate.tokenId === best?.tokenId}
              aria-label={`Select base ${candidate.tokenId}`}
            >
              <span className="rank-token">
                <img src={candidate.imageUrl} alt="" />
                #{candidate.tokenId}
              </span>
              <strong>{amountLabel(candidate.totalPrice, candidate.priceCurrency)}</strong>
              <span>
                {candidate.owned ? `owned / ${amountLabel(candidate.basePrice, candidate.priceCurrency)}` : amountLabel(candidate.basePrice, candidate.priceCurrency)}
              </span>
              <span>{candidate.pathDonorCount} / {amountLabel(candidate.donorPrice, candidate.priceCurrency)}</span>
              <span>{candidate.additionalActionsNeeded}</span>
              <span>{candidate.added}+ / {candidate.removed}-</span>
            </button>
          ))}
          {!result ? <div className="rank-empty">Draw target / scan listings</div> : null}
        </div>
      </section>
    </main>
  );
}
