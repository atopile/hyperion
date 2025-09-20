#!/usr/bin/env node
import { WebSocket } from 'ws';

const URL = process.env.WS_URL || 'ws://localhost:9002';
const FRAME_MAGIC = 0x4D44454C; // LEDM
const HEADER_SIZE = 8;
const PANEL_SIZE = 28;

console.log('Connecting to', URL);
const ws = new WebSocket(URL);
ws.binaryType = 'arraybuffer';

let frames = 0;
let start = Date.now();

ws.on('open', () => {
  console.log('WebSocket open');
});

ws.on('message', (data, isBinary) => {
    // Normalize to Buffer regardless of ws version/platform
  let buf;
  if (Buffer.isBuffer(data)) {
    buf = data;
  } else if (data instanceof ArrayBuffer) {
    buf = Buffer.from(new Uint8Array(data));
  } else if (ArrayBuffer.isView(data)) {
    buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  } else {
    console.error('Unexpected message type:', typeof data);
    return;
  }
  if (buf.length < HEADER_SIZE) {
    console.error('Frame too small:', buf.length);
    return;
  }
  const magic = buf.readUInt32LE(0);
  const panelsX = buf.readUInt16LE(4);
  const panelsY = buf.readUInt16LE(6);
  if (magic !== FRAME_MAGIC) {
    console.error('Bad magic:', magic.toString(16));
    return;
  }
  const cols = panelsX * PANEL_SIZE;
  const rows = panelsY * PANEL_SIZE;
  const expectedSize = HEADER_SIZE + cols * rows * 3;
  if (buf.length !== expectedSize) {
    console.error(`Size mismatch: got ${buf.length}, expected ${expectedSize}`);
    return;
  }
  frames++;
  if (frames % 60 === 0) {
    const elapsed = (Date.now() - start) / 1000;
    console.log(`OK: ${frames} frames, ${(frames/elapsed).toFixed(1)} FPS, ${panelsX}x${panelsY} panels -> ${cols}x${rows}`);
  }
});

ws.on('close', () => {
  console.log('WebSocket closed');
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err.message);
});
