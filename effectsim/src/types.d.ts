// Core type definitions for LED Matrix Simulator

export interface MatrixConfig {
  panelsX: number;
  panelsY: number;
  panelCols: number;
  panelRows: number;
  pixelSize: number | 'auto';
  gap: number;
  fpsCap: number;
  lensFlareIntensity: number;
}

export interface MatrixDimensions {
  cols: number;
  rows: number;
  totalPixels: number;
}

export interface PerformanceStats {
  fps: number;
  dropped: number;
  renderMs: number;
}

export interface CoordinateMapping {
  logicalIndex: number;
  bufferOffset: number;
  panelX: number;
  panelY: number;
  inPanelX: number;
  inPanelY: number;
}

export interface FrameBuffer {
  data: Uint8ClampedArray;
  cols: number;
  rows: number;
  timestamp: number;
}

// Custom events
export interface ReadyEventDetail {
  cols: number;
  rows: number;
}

export interface StatsEventDetail {
  fps: number;
  dropped: number;
  renderMs: number;
}

// Component lifecycle
export interface ComponentState {
  initialized: boolean;
  connected: boolean;
  rendering: boolean;
}