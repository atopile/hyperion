// Simple coordinate mapping utilities

import type { MatrixConfig, MatrixDimensions } from '../types.d.ts';

export class CoordinateLUT {
  private dimensions: MatrixDimensions;

  constructor(config: MatrixConfig) {
    this.dimensions = this.calculateDimensions(config);
  }

  /**
   * Update configuration and recalculate dimensions
   */
  updateConfig(config: MatrixConfig): void {
    const newDimensions = this.calculateDimensions(config);
    this.dimensions = newDimensions;
    console.log(`Matrix dimensions: ${this.dimensions.cols}×${this.dimensions.rows} (${this.dimensions.totalPixels} pixels)`);
  }

  /**
   * Get buffer offset for coordinate (row, col) - row-major layout for ImageData
   * Returns -1 if coordinates are out of bounds
   */
  getBufferOffset(row: number, col: number): number {
    if (row < 0 || row >= this.dimensions.rows || 
        col < 0 || col >= this.dimensions.cols) {
      return -1;
    }
    
    // Row-major layout for ImageData: row * cols + col
    const index = row * this.dimensions.cols + col;
    
    // Convert to ImageData buffer offset (RGBA = 4 bytes per pixel)
    return index * 4;
  }

  /**
   * Get matrix dimensions
   */
  getDimensions(): MatrixDimensions {
    return { ...this.dimensions };
  }

  /**
   * Calculate total matrix dimensions from panel configuration
   */
  private calculateDimensions(config: MatrixConfig): MatrixDimensions {
    const cols = config.panelsX * config.panelCols;
    const rows = config.panelsY * config.panelRows;
    return {
      cols,
      rows,
      totalPixels: cols * rows
    };
  }
}

/**
 * Utility function to create a LUT from configuration
 */
export function createCoordinateLUT(config: MatrixConfig): CoordinateLUT {
  return new CoordinateLUT(config);
}