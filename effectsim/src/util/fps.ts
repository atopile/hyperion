// Performance monitoring utilities

import type { PerformanceStats } from '../types.d.ts';

export class FPSCounter {
  private frameCount: number = 0;
  private lastTime: number = 0;
  private startTime: number = 0;
  private renderTimes: number[] = [];
  private droppedFrames: number = 0;
  private maxRenderSamples: number = 60; // Keep last 60 render times
  
  constructor() {
    this.reset();
  }

  /**
   * Reset all counters
   */
  reset(): void {
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.startTime = this.lastTime;
    this.renderTimes = [];
    this.droppedFrames = 0;
  }

  /**
   * Record the start of a frame render
   */
  startFrame(): number {
    return performance.now();
  }

  /**
   * Record the end of a frame render
   */
  endFrame(startTime: number): void {
    const renderTime = performance.now() - startTime;
    
    // Store render time (keep only recent samples)
    this.renderTimes.push(renderTime);
    if (this.renderTimes.length > this.maxRenderSamples) {
      this.renderTimes.shift();
    }
    
    this.frameCount++;
  }

  /**
   * Record a dropped frame
   */
  dropFrame(): void {
    this.droppedFrames++;
  }

  /**
   * Get current performance statistics
   */
  getStats(): PerformanceStats {
    const now = performance.now();
    const elapsed = (now - this.startTime) / 1000; // seconds
    
    // Calculate FPS over total elapsed time
    const fps = elapsed > 0 ? this.frameCount / elapsed : 0;
    
    // Calculate average render time
    const renderMs = this.renderTimes.length > 0 
      ? this.renderTimes.reduce((a, b) => a + b, 0) / this.renderTimes.length 
      : 0;
    
    return {
      fps: Math.round(fps * 10) / 10, // Round to 1 decimal
      dropped: this.droppedFrames,
      renderMs: Math.round(renderMs * 100) / 100 // Round to 2 decimals
    };
  }

  /**
   * Check if enough time has passed for stats update (typically ~1 second)
   */
  shouldUpdateStats(intervalMs: number = 1000): boolean {
    const now = performance.now();
    const elapsed = now - this.lastTime;
    
    if (elapsed >= intervalMs) {
      this.lastTime = now;
      return true;
    }
    
    return false;
  }
}

/**
 * Frame rate limiter utility
 */
export class FPSLimiter {
  private targetFPS!: number;
  private targetInterval!: number;
  private lastFrameTime: number = 0;

  constructor(targetFPS: number = 0) {
    this.setTargetFPS(targetFPS);
  }

  /**
   * Set target FPS (0 = uncapped)
   */
  setTargetFPS(fps: number): void {
    this.targetFPS = fps;
    this.targetInterval = fps > 0 ? 1000 / fps : 0;
  }

  /**
   * Check if enough time has passed to render next frame
   */
  shouldRender(currentTime: number): boolean {
    if (this.targetFPS <= 0) {
      // Uncapped - always render
      return true;
    }

    const elapsed = currentTime - this.lastFrameTime;
    if (elapsed >= this.targetInterval) {
      this.lastFrameTime = currentTime;
      return true;
    }

    return false;
  }

  /**
   * Get time until next frame should be rendered (in ms)
   */
  getTimeToNextFrame(currentTime: number): number {
    if (this.targetFPS <= 0) return 0;
    
    const elapsed = currentTime - this.lastFrameTime;
    return Math.max(0, this.targetInterval - elapsed);
  }
}