# LED Matrix Simulator

High-performance LED matrix simulator Web Component targeting 120+ FPS at 150×200 resolution.

## Quick Start

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Build the project:**
   ```bash
   pnpm run build
   ```

3. **Start the WebSocket test server:**
   ```bash
   pnpm run server
   ```

4. **Start the HTTP server:**
   ```bash
   pnpm run serve
   ```

5. **Open in browser:**
   - Navigate to http://localhost:8080
   - The demo should automatically connect to the WebSocket server and display a moving rainbow pattern

## Usage

### Basic HTML Integration

```html
<led-matrix 
  panels-x="3" 
  panels-y="4" 
  panel-cols="28" 
  panel-rows="28"
  wiring="serpentine"
  ws-url="ws://localhost:9002/ws">
</led-matrix>
```

### Configuration Attributes

- `panels-x`, `panels-y`: Panel grid dimensions
- `panel-cols`, `panel-rows`: Resolution per panel
- `wiring`: "serpentine" | "row-major" | "column-major"
- `pixel-size`: Size in CSS pixels or "auto"
- `gap`: Gap between LEDs in pixels
- `fps-cap`: FPS limit (0 = uncapped)
- `ws-url`: WebSocket server URL

### JavaScript API

```javascript
const matrix = document.querySelector('led-matrix');

// Push a frame manually
const rgbData = new Uint8Array(cols * rows * 3);
// ... fill with RGB888 data
matrix.pushFrame(rgbData);

// Listen to events
matrix.addEventListener('ready', (e) => {
  console.log(`Matrix ready: ${e.detail.cols}×${e.detail.rows}`);
});

matrix.addEventListener('stats', (e) => {
  console.log(`FPS: ${e.detail.fps}, Render: ${e.detail.renderMs}ms`);
});
```

## Architecture

- **Web Component**: Framework-agnostic custom element
- **Canvas 2D**: High-performance rendering with offscreen buffer
- **WebSocket Client**: Real-time frame streaming with drop-frame backpressure
- **Coordinate Mapping**: Pre-computed LUT for panel/wiring configurations
- **Performance Monitoring**: Built-in FPS counter and render time tracking

## WebSocket Protocol

Send binary messages containing exactly `cols × rows × 3` bytes of RGB888 data:

```javascript
// Example: 84×112 matrix = 28,224 bytes
const frame = new Uint8Array(84 * 112 * 3);
// Fill with RGB data...
websocket.send(frame);
```

## Performance

- **Target**: 120+ FPS at 200×150 (30k pixels)
- **Optimizations**: Pre-computed coordinate mapping, buffer reuse, atomic frame swapping
- **Monitoring**: Real-time FPS, render time, and dropped frame statistics

## Files

```
├── src/
│   ├── led-matrix.ts        # Main Web Component
│   ├── util/
│   │   ├── lut.ts          # Coordinate mapping
│   │   └── fps.ts          # Performance monitoring
│   └── types.d.ts          # Type definitions
├── server/
│   └── test-server.js      # WebSocket test server
├── index.html              # Demo page
└── dist/                   # Compiled JavaScript
```

## License

MIT