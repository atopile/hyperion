#!/usr/bin/env node

import { WebSocketServer } from 'ws';

// Parse CLI arguments
const args = process.argv.slice(2);
let panelsX = 3;  // Default 3 panels wide
let panelsY = 4;  // Default 4 panels tall

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--panels-x' && i + 1 < args.length) {
    panelsX = parseInt(args[i + 1]);
    i++; // Skip next argument
  } else if (args[i] === '--panels-y' && i + 1 < args.length) {
    panelsY = parseInt(args[i + 1]);
    i++; // Skip next argument
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node test-server.js [--panels-x <number>] [--panels-y <number>]');
    console.log('  --panels-x <number>  Number of panels horizontally (default: 3)');
    console.log('  --panels-y <number>  Number of panels vertically (default: 4)');
    console.log('  --help, -h           Show this help message');
    process.exit(0);
  }
}

// Validate arguments
if (isNaN(panelsX) || panelsX < 1 || panelsX > 20) {
  console.error('Error: --panels-x must be a number between 1 and 20');
  process.exit(1);
}
if (isNaN(panelsY) || panelsY < 1 || panelsY > 20) {
  console.error('Error: --panels-y must be a number between 1 and 20');
  process.exit(1);
}

// Server configuration
const PORT = 9002;
const PANEL_SIZE = 28;    // Fixed 28×28 panels
const PANELS_X = panelsX;
const PANELS_Y = panelsY;
const DEFAULT_COLS = PANELS_X * PANEL_SIZE;
const DEFAULT_ROWS = PANELS_Y * PANEL_SIZE;

// Frame protocol constants
const FRAME_MAGIC = 0x4D44454C; // "LEDM" in little-endian
const FRAME_HEADER_SIZE = 8;    // bytes

class TestServer {
  constructor(port = PORT) {
    this.port = port;
    this.wss = null;
    this.clients = new Set();
    this.animationId = null;
    this.frameCount = 0;
    this.startTime = Date.now();
  }

  start() {
    this.wss = new WebSocketServer({ 
      port: this.port,
      perMessageDeflate: false // Disable compression for better performance
    });

    this.wss.on('connection', (ws, req) => {
      console.log(`Client connected from ${req.socket.remoteAddress}`);
      this.clients.add(ws);

      ws.on('close', () => {
        console.log('Client disconnected');
        this.clients.delete(ws);
        
        // Stop animation if no clients
        if (this.clients.size === 0 && this.animationId) {
          clearInterval(this.animationId);
          this.animationId = null;
          console.log('Animation stopped - no clients');
        }
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });

      // Start animation if first client
      if (this.clients.size === 1 && !this.animationId) {
        this.startAnimation();
      }
    });

    console.log(`LED Matrix Test Server running on ws://localhost:${this.port}`);
    console.log(`Matrix: ${PANELS_X}×${PANELS_Y} panels of ${PANEL_SIZE}×${PANEL_SIZE} = ${DEFAULT_COLS}×${DEFAULT_ROWS} pixels`);
  }

  startAnimation() {
    console.log('Starting animation...');
    this.frameCount = 0;
    this.startTime = Date.now();
    
    // Target ~60 FPS for test data
    this.animationId = setInterval(() => {
      this.broadcastFrame();
    }, 1000 / 60);
  }

  broadcastFrame() {
    if (this.clients.size === 0) return;

    const cols = DEFAULT_COLS;
    const rows = DEFAULT_ROWS;
    const rgbData = this.generateTestPattern(cols, rows, this.frameCount);
    const frame = this.createFrameWithHeader(PANELS_X, PANELS_Y, rgbData);
    
    this.clients.forEach(client => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(frame);
      }
    });

    this.frameCount++;

    // Log stats every 5 seconds
    if (this.frameCount % 300 === 0) {
      const elapsed = (Date.now() - this.startTime) / 1000;
      const fps = this.frameCount / elapsed;
      console.log(`Sent ${this.frameCount} frames (${fps.toFixed(1)} FPS avg) to ${this.clients.size} client(s)`);
    }
  }

  createFrameWithHeader(panelsX, panelsY, rgbData) {
    // Frame format:
    // Header (FRAME_HEADER_SIZE bytes):
    //   - Magic: "LEDM" (4 bytes)
    //   - Panels X: uint16 little-endian (2 bytes) 
    //   - Panels Y: uint16 little-endian (2 bytes)
    // Data: RGB888 column-major (panelsX * panelsY * PANEL_SIZE * PANEL_SIZE * 3 bytes)
    
    const dataSize = rgbData.length;
    const frame = new ArrayBuffer(FRAME_HEADER_SIZE + dataSize);
    const headerView = new DataView(frame, 0, FRAME_HEADER_SIZE);
    const dataView = new Uint8Array(frame, FRAME_HEADER_SIZE);
    
    // Write header
    headerView.setUint32(0, FRAME_MAGIC, true);
    headerView.setUint16(4, panelsX, true);
    headerView.setUint16(6, panelsY, true);
    
    // Copy RGB data
    dataView.set(rgbData);
    
    return frame;
  }

  generateTestPattern(cols, rows, frameNum) {
    const buffer = new Uint8Array(cols * rows * 3);
    
    // Rainbow spiral parameters
    const centerX = cols / 2;
    const centerY = rows / 2;
    const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY);
    
    // Rotate at 1/10 Hz = 0.1 rotations per second
    // At 60 FPS, each frame is 1/60 second
    const rotationSpeed = 0.1; // Hz
    const timeSeconds = frameNum / 60; // Convert frame to seconds
    const rotationOffset = timeSeconds * rotationSpeed * 2 * Math.PI;

    // Generate in row-major order (to match Canvas ImageData)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = (y * cols + x) * 3; // Row-major indexing
        
        // Calculate distance and angle from center
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        
        // Create spiral: combine angle and distance for hue
        // Add rotation offset for animation
        const spiralTurns = 3; // Number of complete color cycles in the spiral
        const hue = ((angle + rotationOffset) / (2 * Math.PI) + 
                     (distance / maxRadius) * spiralTurns) % 1;
        
        // Fade out at edges for better visual effect
        const brightness = Math.max(0, 1 - (distance / maxRadius) * 0.3);
        
        const [r, g, b] = this.hsvToRgb(hue, 1, brightness);
        
        buffer[idx] = Math.round(r * 255);
        buffer[idx + 1] = Math.round(g * 255);  
        buffer[idx + 2] = Math.round(b * 255);
      }
    }

    return buffer;
  }

  // HSV to RGB conversion for rainbow effects
  hsvToRgb(h, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs((h * 6) % 2 - 1));
    const m = v - c;
    
    let r, g, b;
    if (h < 1/6) [r, g, b] = [c, x, 0];
    else if (h < 2/6) [r, g, b] = [x, c, 0];
    else if (h < 3/6) [r, g, b] = [0, c, x];
    else if (h < 4/6) [r, g, b] = [0, x, c];
    else if (h < 5/6) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    
    return [r + m, g + m, b + m];
  }

  stop() {
    if (this.animationId) {
      clearInterval(this.animationId);
      this.animationId = null;
    }
    
    if (this.wss) {
      this.wss.close();
    }
    
    console.log('Test server stopped');
  }
}

// Handle graceful shutdown
const server = new TestServer();
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  server.stop();
  process.exit(0);
});

server.start();