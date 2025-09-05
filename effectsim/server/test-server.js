#!/usr/bin/env node

import { WebSocketServer } from 'ws';

const PORT = 9002;
const DEFAULT_COLS = 84;  // 3 panels × 28 cols
const DEFAULT_ROWS = 112; // 4 panels × 28 rows

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
    console.log(`Default matrix: ${DEFAULT_COLS}×${DEFAULT_ROWS} (${DEFAULT_COLS * DEFAULT_ROWS} pixels)`);
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
    const frame = this.generateTestPattern(cols, rows, this.frameCount);
    
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

  generateTestPattern(cols, rows, frameNum) {
    const buffer = new Uint8Array(cols * rows * 3);
    const time = frameNum * 0.1;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = (y * cols + x) * 3;
        
        // Create moving rainbow pattern
        const hue = (x / cols + y / rows + time) % 1;
        const [r, g, b] = this.hsvToRgb(hue, 1, 0.8);
        
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