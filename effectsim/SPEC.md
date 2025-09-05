# LED Matrix Simulator — MVP Implementation Spec

**Goal:** A browser-based MVP that simulates a configurable LED matrix at high frame rates (target: 120+ FPS at 150×200) using a Web Component that renders into a `<canvas>`. No frameworks (no React/Tailwind). Plain TypeScript and HTML. The MVP consumes pixel frames from a WebSocket connection.

---

## 1. Scope & Non-Goals

### In Scope (MVP)

* A custom element `<led-matrix-sim>` implemented as a Web Component.
* Renders to an internal `<canvas>` using Canvas 2D API (with an upgrade path to WebGL/WebGPU later).
* Configurable matrix geometry: total columns/rows, panel grid (horizontal/vertical panel count), per-panel size, wiring pattern.
* **Single data source:** WebSocket client. Receives binary RGB frames; drop-frame strategy for backpressure.
* Performance instrumentation: FPS overlay, dropped frames, render time.
* Deterministic coordinate mapping from logical LED indices → canvas pixels.
* Resize-aware rendering (component expands/contracts with layout).

### Out of Scope (MVP)

* Procedural/built-in effects (none included).
* Server-side WebSocket implementation (assumed external).
* Persistent settings, exporting video, advanced color management.
* Multi-tab sync, mobile optimizations.

---

## 2. User Experience

### Custom Element

```html
<led-matrix
  panels-x="3"
  panels-y="4"
  panel-cols="28"
  panel-rows="28"
  wiring="serpentine"
  pixel-size="auto"
  gap="1"
  fps-cap="0"
  ws-url="ws://localhost:9002/ws"
  style="width: 800px; height: 600px"
></led-matrix>
```

#### Attributes / Properties

* `panels-x`, `panels-y` (number): panel grid dimensions.
* `panel-cols`, `panel-rows` (number): per-panel resolution.
* `wiring` ("row-major" | "column-major" | "serpentine"): logical wiring traversal within each panel.
* `pixel-size` (number | "auto"): logical LED square size in CSS pixels. `auto` scales to component size.
* `gap` (number): gap between LEDs in CSS pixels (visual only).
* `fps-cap` (number): 0 = uncapped (follows display refresh). Otherwise, caps update rate (e.g., 120).
* `ws-url` (string): URL to connect.

All attributes reflect to properties with matching camelCase names (e.g., `panelsX`).

#### CSS Custom Properties (visual tune)

* `--led-radius`: border-radius of each LED (e.g., `35%`).
* `--led-off-bg`: background color behind LEDs.

#### Events (CustomEvent)

* `ready` → `{ detail: { cols, rows } }`
* `stats` → `{ detail: { fps: number, dropped: number, renderMs: number } }` (emitted \~once/second).
* `socketopen` / `socketclose` / `socketerror` (WebSocket lifecycle).

#### Public Methods (Element instance)

* `pushFrame(rgb: Uint8Array, opts?: { cols?: number; rows?: number; })`: Submit one RGB888 frame (length must be `cols*rows*3`). Drops previous queued frame and replaces it.
* `resize()` → Recalculate internal layout (called automatically by `ResizeObserver`).

---

## 3. Rendering Model

### Canvas Strategy (Canvas 2D)

* Maintain a single `ImageData` buffer sized to `cols × rows`.
* Maintain a backing `Uint8ClampedArray` (`img.data`) for RGB, set `A=255` once upfront for all pixels.
* Each frame:

  1. Fill/replace RGB bytes in the backing buffer from the last received socket frame.
  2. `putImageData(img, 0, 0)` onto an **offscreen canvas** sized to logical resolution.
  3. Scale the offscreen canvas to the visible canvas via `drawImage` with `imageSmoothingEnabled=false` to keep crisp LED squares.
* Optional LED gaps/rounded corners are simulated by drawing onto an intermediate mask if `gap>0` (MVP shortcut: draw a scaled bitmap with nearest-neighbor and draw a grid overlay to suggest gaps; true per‑pixel masking can be a post‑MVP enhancement).

### Coordinate Mapping

* Precompute a **LUT** from logical index `(r, c)` → linear buffer offset `i = (r*cols + c)*4` to minimize branching per frame.
* If panelization is provided, compute `(panelR, panelC, inR, inC)` and apply wiring:

  * `row-major`: `i = (r*cols + c)`
  * `column-major`: `i = (c*rows + r)`
  * `serpentine`: rows (or columns) alternate direction within each panel.
* The LUT is rebuilt when geometry/wiring changes.

### Timing & Loop

* Use `requestAnimationFrame` (RAF). Maintain `simTime` using `performance.now()`; apply `fps-cap` by skipping frames when needed.
* Track `frameCount`, compute FPS every \~1000 ms and dispatch `stats`.
* **Backpressure policy:** keep a single-slot incoming frame buffer (atomic swap); renderer consumes latest available; older frames are dropped.

---

## 4. Data Source — WebSocket Client

* Create a single `WebSocket` connection using `ws-url`.
* **Binary frame protocol (MVP simple):**

  * Dimensions are fixed by component props.
  * Each message is exactly `cols*rows*3` bytes of RGB888.
  * Any other message length is ignored (increment `dropped`).
* **Optional text control messages:** JSON for control (future use).
* Auto-reconnect every 2s on close (with cap 10s). Expose events.

---

## 5. Performance Budget & Techniques

* Target: **120 FPS** at **200×150** (30k pixels) on a recent laptop.
* Avoid allocations per frame; reuse buffers.
* Pre-fill alpha channel once.
* Use a single offscreen `ImageBitmap` or offscreen canvas for nearest-neighbor scaling.
* Set `ctx.imageSmoothingEnabled = false` on the visible canvas.
* Recompute LUTs only on geometry/wiring change.

---

## 6. Public API Details

### Observed Attributes → Reaction

* Changing geometry (`panels-x`, `panels-y`, `panel-cols`, `panel-rows`, `wiring`) triggers LUT rebuild, buffer reallocation.
* Changing `ws-url` connects/disconnects WS.
* `gap`, `pixel-size`, `fps-cap` are applied next frame.

### Methods

* `pushFrame(rgb)`

  * Accept `Uint8Array`/`Uint8ClampedArray` length `cols*rows*3`.
  * Copies into a single-slot buffer (no queue growth). Copy cost is amortized; consider `set` on a pre-sized buffer.

### Errors

* Throw `RangeError` on invalid geometry or frame size.
* Dispatch `socketerror` on WS errors.

---

## 7. File Layout

```
/ (repo root)
├─ index.html                 # demo page
├─ src/
│  ├─ led-matrix.ts       # Web Component
│  ├─ util/
│  │  ├─ lut.ts               # coordinate mapping + wiring
│  │  ├─ fps.ts               # stats helpers
│  └─ types.d.ts              # shared interfaces
├─ styles/
│  └─ component.css           # shadow DOM styles (minimal)
├─ tsconfig.json
├─ package.json
└─ README.md                  # quick start
```

---

## 8. Application Page (`index.html`)

* Includes the compiled `led-matrix.js` and registers the element.
* Hosts a small control bar (plain HTML) to tweak geometry and WebSocket URL.
* Shows a live stats overlay: FPS and render ms.

---

## 9. Build & Tooling

* **TypeScript only** (no bundler required for MVP). Output ES2024 modules to `dist/`.
* `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "ES2024",
    "moduleResolution": "Bundler",
    "lib": ["DOM", "ES2024"],
    "outDir": "dist",
    "strict": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

* `package.json` scripts:

```json
{
  "scripts": {
    "build": "tsc -p .",
    "dev": "tsc -w"
  }
}
```

* Serve `index.html` via any static server (e.g., `pnpx http-server`).

---

## 10. Testing & Acceptance Criteria

### Manual Tests

* Default demo loads and animates smoothly on a modern desktop.
* Changing `panels-x`/`panels-y`/`panel-cols`/`panel-rows` live rebuilds buffers without leaks.
* `ws-url` connects to a local WS and renders frames; incorrect lengths are ignored.
* FPS overlay reports ≥120 fps at 200×150 on a recent laptop.

### Edge Cases

* WebSocket disconnect → auto-reconnect; UI events emitted.
* Resize container smaller than logical aspect → maintain pixel aspect (letterbox inside component).
