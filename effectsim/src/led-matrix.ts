// LED Matrix Simulator Web Component

import { CoordinateLUT } from './util/lut.js';
import { FPSCounter, FPSLimiter } from './util/fps.js';
import type { 
  MatrixConfig, 
  MatrixDimensions, 
  FrameBuffer, 
  WiringPattern,
  ReadyEventDetail,
  StatsEventDetail,
  ComponentState
} from './types.d.ts';

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
  private resizeObserver: ResizeObserver;

  // Observed attributes
  static get observedAttributes() {
    return [
      'panels-x', 'panels-y', 
      'panel-cols', 'panel-rows', 
      'wiring', 'pixel-size', 'gap', 
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
    
    // Default configuration
    this.config = {
      panelsX: 3,
      panelsY: 4, 
      panelCols: 28,
      panelRows: 28,
      wiring: 'serpentine',
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
    
    // Initialize resize observer
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    
    this.initializeDOM();
  }

  connectedCallback() {
    console.log('LED Matrix component connected');
    
    // Start observing resize
    this.resizeObserver.observe(this);
    
    // Initialize from attributes
    this.updateConfigFromAttributes();
    this.initialize();
    
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
    } else if (['panels-x', 'panels-y', 'panel-cols', 'panel-rows', 'wiring'].includes(name)) {
      // Geometry or wiring changed - reinitialize
      this.initialize();
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
    if (!this.canvas || !this.state.initialized) return;
    
    const rect = this.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    
    // Update canvas display size
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    
    // Calculate actual pixel dimensions
    const devicePixelRatio = window.devicePixelRatio || 1;
    const displayWidth = rect.width * devicePixelRatio;
    const displayHeight = rect.height * devicePixelRatio;
    
    // Set canvas resolution
    this.canvas.width = displayWidth;
    this.canvas.height = displayHeight;
    
    // Scale context back to logical pixels
    this.ctx.scale(devicePixelRatio, devicePixelRatio);
    
    // Disable image smoothing for crisp pixels
    this.ctx.imageSmoothingEnabled = false;
    
    console.log(`Canvas resized: ${displayWidth}×${displayHeight} (ratio: ${devicePixelRatio})`);
  }

  // Private methods
  
  private initializeDOM(): void {
    if (!this.shadowRoot) return;
    
    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
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
        display: block;
        width: 100%;
        height: 100%;
        background: var(--led-off-bg, #111);
      }
      canvas {
        width: 100%;
        height: 100%;
        image-rendering: pixelated;
        image-rendering: -moz-crisp-edges;
        image-rendering: crisp-edges;
      }
    `;
    this.shadowRoot.appendChild(style);
  }

  private updateConfigFromAttributes(): void {
    this.config.panelsX = parseInt(this.getAttribute('panels-x') || '3');
    this.config.panelsY = parseInt(this.getAttribute('panels-y') || '4');
    this.config.panelCols = parseInt(this.getAttribute('panel-cols') || '28');
    this.config.panelRows = parseInt(this.getAttribute('panel-rows') || '28');
    this.config.wiring = (this.getAttribute('wiring') || 'serpentine') as WiringPattern;
    
    const pixelSize = this.getAttribute('pixel-size');
    this.config.pixelSize = pixelSize === 'auto' ? 'auto' : parseFloat(pixelSize || 'auto') || 'auto';
    
    this.config.gap = parseFloat(this.getAttribute('gap') || '1');
    this.config.fpsCap = parseInt(this.getAttribute('fps-cap') || '0');
    this.wsUrl = this.getAttribute('ws-url') || '';
  }

  private initialize(): void {
    console.log('Initializing LED Matrix...', this.config);
    
    // Update coordinate mapping
    this.lut.updateConfig(this.config);
    const dims = this.lut.getDimensions();
    
    // Create offscreen canvas for logical resolution
    this.offscreenCanvas = new OffscreenCanvas(dims.cols, dims.rows);
    this.offscreenCtx = this.offscreenCanvas.getContext('2d')!;
    
    // Create ImageData buffer
    this.imageData = this.offscreenCtx.createImageData(dims.cols, dims.rows);
    this.backBuffer = this.imageData.data;
    
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
    
    // Dispatch ready event
    const readyEvent = new CustomEvent<ReadyEventDetail>('ready', {
      detail: { cols: dims.cols, rows: dims.rows }
    });
    this.dispatchEvent(readyEvent);
    
    console.log(`LED Matrix initialized: ${dims.cols}×${dims.rows} (${dims.totalPixels} pixels)`);
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
      console.error('Render error:', error);
      this.fpsCounter.dropFrame();
    }
  }

  private updateImageData(frame: FrameBuffer): void {
    const dims = this.lut.getDimensions();
    
    // Copy RGB data to ImageData buffer using coordinate mapping
    for (let row = 0; row < dims.rows; row++) {
      for (let col = 0; col < dims.cols; col++) {
        const bufferOffset = this.lut.getBufferOffset(row, col);
        if (bufferOffset === -1) continue;
        
        const srcIndex = (row * dims.cols + col) * 3;
        const dstIndex = bufferOffset;
        
        // Copy RGB (alpha already set to 255)
        this.backBuffer[dstIndex] = frame.data[srcIndex];     // R
        this.backBuffer[dstIndex + 1] = frame.data[srcIndex + 1]; // G  
        this.backBuffer[dstIndex + 2] = frame.data[srcIndex + 2]; // B
      }
    }
  }

  private drawToCanvas(): void {
    if (!this.ctx || !this.canvas) return;
    
    // Put image data to offscreen canvas
    this.offscreenCtx.putImageData(this.imageData, 0, 0);
    
    // Scale and draw to main canvas
    const rect = this.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);
    this.ctx.drawImage(this.offscreenCanvas, 0, 0, rect.width, rect.height);
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
          const rgb = new Uint8Array(event.data);
          this.pushFrame(rgb);
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
    
    // Stop resize observation
    this.resizeObserver.disconnect();
    
    console.log('LED Matrix component cleaned up');
  }
}

// Register the custom element
customElements.define('led-matrix', LEDMatrix);