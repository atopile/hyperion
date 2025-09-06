// LED Matrix Simulator Web Component

import { CoordinateLUT } from './util/lut.js';
import { FPSCounter, FPSLimiter } from './util/fps.js';
import type {
  MatrixConfig,
  MatrixDimensions,
  FrameBuffer,
  ReadyEventDetail,
  StatsEventDetail,
  ComponentState
} from './types.d.ts';

// Frame protocol constants
const FRAME_MAGIC = 0x4D44454C; // "LEDM" in little-endian
const FRAME_HEADER_SIZE = 8;    // bytes
const PANEL_SIZE = 28;          // 28×28 panels

export class LEDMatrix extends HTMLElement {
  // Configuration
  private config: MatrixConfig;
  private lut: CoordinateLUT;

  // Canvas and rendering
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private offscreenCanvas!: OffscreenCanvas;
  private offscreenCtx!: OffscreenCanvasRenderingContext2D;
  private imageData!: ImageData;
  private backBuffer!: Uint8ClampedArray;

  // Frame handling
  private currentFrame: FrameBuffer | null = null;
  private pendingFrame: FrameBuffer | null = null;

  // Performance monitoring
  private fpsCounter: FPSCounter;
  private fpsLimiter: FPSLimiter;
  private animationId: number = 0;

  // WebSocket
  private ws: WebSocket | null = null;
  private wsUrl: string = '';
  private reconnectTimer: number = 0;
  private reconnectDelay: number = 2000;
  private maxReconnectDelay: number = 10000;

  // Component state
  private state: ComponentState;
  private lastCanvasSize: { width: number; height: number } = { width: 0, height: 0 };
  private cachedContainerSize: { width: number; height: number } = { width: 0, height: 0 };

  // Observed attributes (geometry comes from frame headers)
  static get observedAttributes() {
    return [
      'pixel-size', 'gap',
      'fps-cap', 'ws-url'
    ];
  }

  constructor() {
    super();

    // Initialize state
    this.state = {
      initialized: false,
      connected: false,
      rendering: false
    };

    // No default configuration - will be set from frame headers
    this.config = {
      panelsX: 0,
      panelsY: 0,
      panelCols: 0,
      panelRows: 0,
      pixelSize: 'auto',
      gap: 1,
      fpsCap: 0
    };

    // Initialize utilities
    this.lut = new CoordinateLUT(this.config);
    this.fpsCounter = new FPSCounter();
    this.fpsLimiter = new FPSLimiter(this.config.fpsCap);

    // Create shadow DOM
    this.attachShadow({ mode: 'open' });

    // Note: ResizeObserver removed to prevent feedback loops
    // Resizing will be triggered explicitly when needed

    this.initializeDOM();
  }

  connectedCallback() {
    console.log('LED Matrix component connected');

    // Initialize from attributes (non-geometry config only)
    this.updateConfigFromAttributes();

    // Don't initialize until we get geometry from first frame

    // Connect WebSocket if URL provided
    if (this.wsUrl) {
      this.connectWebSocket();
    }
  }

  disconnectedCallback() {
    console.log('LED Matrix component disconnected');

    this.cleanup();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    if (oldValue === newValue) return;

    console.log(`Attribute ${name} changed: ${oldValue} → ${newValue}`);

    // Update configuration
    this.updateConfigFromAttributes();

    // Handle specific changes
    if (name === 'ws-url') {
      if (this.ws) {
        this.disconnectWebSocket();
      }
      if (newValue) {
        this.connectWebSocket();
      }
      // Geometry attributes are ignored - they come from frame headers
    } else if (name === 'pixel-size') {
      // Pixel size changed - refresh container cache if switching to auto
      if (newValue === 'auto') {
        this.cachedContainerSize = { width: 0, height: 0 }; // Reset cache
      }
      // Resize canvas immediately
      if (this.state.initialized) {
        this.resize();
      }
    } else if (name === 'fps-cap') {
      this.fpsLimiter.setTargetFPS(this.config.fpsCap);
    }
  }

  // Public API methods

  /**
   * Push a frame for rendering
   */
  pushFrame(rgb: Uint8Array, opts?: { cols?: number; rows?: number }): void {
    const dims = this.lut.getDimensions();
    const expectedLength = dims.totalPixels * 3;

    if (rgb.length !== expectedLength) {
      console.error(`Frame size mismatch: expected ${expectedLength}, got ${rgb.length}`);
      this.fpsCounter.dropFrame();
      return;
    }

    // Create frame buffer
    const frame: FrameBuffer = {
      data: new Uint8ClampedArray(rgb.buffer.slice(rgb.byteOffset, rgb.byteOffset + rgb.byteLength)),
      cols: dims.cols,
      rows: dims.rows,
      timestamp: performance.now()
    };

    // Atomic swap - replace any pending frame
    this.pendingFrame = frame;
  }

  /**
   * Manually trigger resize recalculation
   */
  resize(): void {
    if (!this.canvas || !this.state.initialized) {
      return;
    }

    const dims = this.lut.getDimensions();

    // Calculate CSS pixel size based on pixelSize config
    let cssPixelSize: number;
    if (this.config.pixelSize === 'auto') {
      // Use cached container size for auto-sizing to prevent constant changes
      // Only update cache if we don't have valid dimensions yet
      if (this.cachedContainerSize.width === 0 || this.cachedContainerSize.height === 0) {
        // Get parent container dimensions, not our own element dimensions
        const parent = this.parentElement;
        if (!parent) {
          return;
        }
        const containerRect = parent.getBoundingClientRect();
        if (containerRect.width === 0 || containerRect.height === 0) {
          return;
        }
        this.cachedContainerSize = { width: containerRect.width, height: containerRect.height };
        console.log(`📦 Cached parent container size: ${this.cachedContainerSize.width}×${this.cachedContainerSize.height}`);
      }

      const scaleX = this.cachedContainerSize.width / dims.cols;
      const scaleY = this.cachedContainerSize.height / dims.rows;
      cssPixelSize = Math.min(scaleX, scaleY);
    } else {
      cssPixelSize = this.config.pixelSize;
    }

    // Calculate logical canvas size (in CSS pixels)
    const canvasWidth = dims.cols * cssPixelSize;
    const canvasHeight = dims.rows * cssPixelSize;

    // Only update canvas if dimensions actually changed (with tolerance for floating point precision)
    const tolerance = 0.1; // 0.1px tolerance
    const widthChanged = Math.abs(this.lastCanvasSize.width - canvasWidth) > tolerance;
    const heightChanged = Math.abs(this.lastCanvasSize.height - canvasHeight) > tolerance;
    const sizeChanged = widthChanged || heightChanged;
    if (!sizeChanged) {
      return; // No changes needed, avoid triggering ResizeObserver loop
    }

    this.lastCanvasSize = { width: canvasWidth, height: canvasHeight };

    // Set canvas CSS size
    this.canvas.style.width = `${canvasWidth}px`;
    this.canvas.style.height = `${canvasHeight}px`;

    // Set canvas resolution (accounting for device pixel ratio)
    const devicePixelRatio = window.devicePixelRatio || 1;
    this.canvas.width = canvasWidth * devicePixelRatio;
    this.canvas.height = canvasHeight * devicePixelRatio;

    // Scale context for device pixel ratio
    this.ctx.scale(devicePixelRatio, devicePixelRatio);

    // Disable image smoothing for crisp pixels
    this.ctx.imageSmoothingEnabled = false;
  }

  // Private methods

  private initializeDOM(): void {
    if (!this.shadowRoot) return;

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.imageRendering = 'pixelated';

    // Get context
    this.ctx = this.canvas.getContext('2d')!;
    if (!this.ctx) {
      throw new Error('Failed to get 2D canvas context');
    }

    // Add to shadow DOM
    this.shadowRoot.appendChild(this.canvas);

    // Load CSS
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: inline-block;
        background: var(--led-off-bg, #111);
      }
      canvas {
        display: block;
        image-rendering: pixelated;
        image-rendering: -moz-crisp-edges;
        image-rendering: crisp-edges;
      }
    `;
    this.shadowRoot.appendChild(style);
  }

  private updateConfigFromAttributes(): void {
    // Only update non-geometry configuration from attributes
    // Geometry comes from frame headers

    const pixelSize = this.getAttribute('pixel-size');
    this.config.pixelSize = pixelSize === 'auto' ? 'auto' : parseFloat(pixelSize || 'auto') || 'auto';

    this.config.gap = parseFloat(this.getAttribute('gap') || '1');
    this.config.fpsCap = parseInt(this.getAttribute('fps-cap') || '0');
    this.wsUrl = this.getAttribute('ws-url') || '';
  }

  private initialize(): void {
    console.log('🔄 Initializing LED Matrix...', this.config);

    // Update coordinate mapping
    this.lut.updateConfig(this.config);
    const dims = this.lut.getDimensions();
    console.log(`📐 Matrix dimensions calculated: ${dims.cols}×${dims.rows} (${dims.totalPixels} pixels)`);

    // Create offscreen canvas for logical resolution
    this.offscreenCanvas = new OffscreenCanvas(dims.cols, dims.rows);
    this.offscreenCtx = this.offscreenCanvas.getContext('2d')!;
    console.log(`🎨 Created offscreen canvas: ${dims.cols}×${dims.rows}`);

    // Create ImageData buffer
    this.imageData = this.offscreenCtx.createImageData(dims.cols, dims.rows);
    this.backBuffer = this.imageData.data;
    console.log(`💾 Created ImageData buffer: ${this.backBuffer.length} bytes`);

    // Pre-fill alpha channel to 255 (opaque)
    for (let i = 3; i < this.backBuffer.length; i += 4) {
      this.backBuffer[i] = 255;
    }

    // Reset performance counters
    this.fpsCounter.reset();
    this.fpsLimiter.setTargetFPS(this.config.fpsCap);

    // Start render loop
    this.startRenderLoop();

    // Update state
    this.state.initialized = true;
    console.log(`✅ LED Matrix initialization complete: ${dims.cols}×${dims.rows}`);

    // Trigger immediate resize to set up canvas display
    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      this.resize();

      // Fallback: retry resize after a short delay in case container isn't ready
      setTimeout(() => {
        this.resize();
      }, 50);
    });

    // Dispatch ready event
    const readyEvent = new CustomEvent<ReadyEventDetail>('ready', {
      detail: { cols: dims.cols, rows: dims.rows }
    });
    this.dispatchEvent(readyEvent);
  }

  private startRenderLoop(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }

    this.state.rendering = true;

    const render = (timestamp: number) => {
      if (!this.state.rendering) return;

      // Check FPS limiting
      if (this.fpsLimiter.shouldRender(timestamp)) {
        this.renderFrame();
      }

      // Update stats periodically
      if (this.fpsCounter.shouldUpdateStats()) {
        const stats = this.fpsCounter.getStats();
        const statsEvent = new CustomEvent<StatsEventDetail>('stats', {
          detail: stats
        });
        this.dispatchEvent(statsEvent);
      }

      this.animationId = requestAnimationFrame(render);
    };

    this.animationId = requestAnimationFrame(render);
  }

  private renderFrame(): void {
    const renderStart = this.fpsCounter.startFrame();

    try {
      // Swap frame buffers atomically
      if (this.pendingFrame) {
        this.currentFrame = this.pendingFrame;
        this.pendingFrame = null;
      }

      // Render current frame
      if (this.currentFrame) {
        this.updateImageData(this.currentFrame);
        this.drawToCanvas();
      }

      this.fpsCounter.endFrame(renderStart);

    } catch (error) {
      console.error('❌ Render error:', error);
      this.fpsCounter.dropFrame();
    }
  }

  private updateImageData(frame: FrameBuffer): void {
    const dims = this.lut.getDimensions();

    // Direct copy of row-major RGB data to row-major ImageData buffer
    // Both source and destination use: row * cols + col indexing (ROW-MAJOR)
    for (let row = 0; row < dims.rows; row++) {
      for (let col = 0; col < dims.cols; col++) {
        // Both source and destination use same row-major indexing
        const pixelIndex = row * dims.cols + col;  // ROW-MAJOR: row * cols + col
        const srcIndex = pixelIndex * 3;           // RGB888
        const dstIndex = pixelIndex * 4;           // RGBA

        // Copy RGB (alpha already set to 255)
        this.backBuffer[dstIndex] = frame.data[srcIndex];         // R
        this.backBuffer[dstIndex + 1] = frame.data[srcIndex + 1]; // G
        this.backBuffer[dstIndex + 2] = frame.data[srcIndex + 2]; // B
      }
    }
  }

  private drawToCanvas(): void {
    if (!this.ctx || !this.canvas) return;

    // Put image data to offscreen canvas
    this.offscreenCtx.putImageData(this.imageData, 0, 0);

    // Get canvas CSS dimensions
    const canvasWidth = parseFloat(this.canvas.style.width.replace('px', ''));
    const canvasHeight = parseFloat(this.canvas.style.height.replace('px', ''));

    // Clear and draw scaled image
    this.ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    this.ctx.drawImage(this.offscreenCanvas, 0, 0, canvasWidth, canvasHeight);
  }

  // Frame message handling

  private handleFrameMessage(buffer: ArrayBuffer): void {
    // Check minimum header size
    if (buffer.byteLength < FRAME_HEADER_SIZE) {
      console.error('❌ Frame too small for header');
      this.fpsCounter.dropFrame();
      return;
    }

    const headerView = new DataView(buffer, 0, FRAME_HEADER_SIZE);

    // Check magic bytes
    const magic = headerView.getUint32(0, true);
    if (magic !== FRAME_MAGIC) {
      console.error('❌ Invalid frame magic');
      this.fpsCounter.dropFrame();
      return;
    }

    // Parse header
    const panelsX = headerView.getUint16(4, true);
    const panelsY = headerView.getUint16(6, true);

    // Calculate expected dimensions
    const expectedCols = panelsX * PANEL_SIZE;
    const expectedRows = panelsY * PANEL_SIZE;
    const expectedDataSize = expectedCols * expectedRows * 3;

    // Validate frame size
    if (buffer.byteLength !== FRAME_HEADER_SIZE + expectedDataSize) {
      console.error(`❌ Frame size mismatch: expected ${FRAME_HEADER_SIZE + expectedDataSize}, got ${buffer.byteLength}`);
      this.fpsCounter.dropFrame();
      return;
    }

    // Auto-configure if geometry changed or first time
    if (this.config.panelsX !== panelsX || this.config.panelsY !== panelsY || !this.state.initialized) {
      console.log(`🔧 Auto-configuring: ${panelsX}×${panelsY} panels (${expectedCols}×${expectedRows} pixels)`);
      this.config.panelsX = panelsX;
      this.config.panelsY = panelsY;
      this.config.panelCols = PANEL_SIZE;
      this.config.panelRows = PANEL_SIZE;
      this.initialize();
    }

    // Extract RGB data and push frame
    const rgbData = new Uint8Array(buffer, FRAME_HEADER_SIZE);
    this.pushFrame(rgbData);
  }

  // WebSocket management

  private connectWebSocket(): void {
    if (!this.wsUrl) return;

    console.log(`Connecting to WebSocket: ${this.wsUrl}`);

    try {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.state.connected = true;
        this.reconnectDelay = 2000; // Reset delay

        const event = new CustomEvent('socketopen');
        this.dispatchEvent(event);
      };

      this.ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          this.handleFrameMessage(event.data);
        }
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.state.connected = false;
        this.ws = null;

        const event = new CustomEvent('socketclose');
        this.dispatchEvent(event);

        // Auto-reconnect
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        const event = new CustomEvent('socketerror', { detail: error });
        this.dispatchEvent(event);
      };

    } catch (error) {
      console.error('Failed to create WebSocket:', error);
    }
  }

  private disconnectWebSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = 0;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.state.connected = false;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    console.log(`Reconnecting in ${this.reconnectDelay}ms...`);

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = 0;
      this.connectWebSocket();

      // Exponential backoff
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }, this.reconnectDelay);
  }

  private cleanup(): void {
    // Stop render loop
    this.state.rendering = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = 0;
    }

    // Disconnect WebSocket
    this.disconnectWebSocket();

    console.log('LED Matrix component cleaned up');
  }
}

// Register the custom element
customElements.define('led-matrix', LEDMatrix);
