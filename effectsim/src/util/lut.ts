// Coordinate mapping and lookup table utilities

import type { WiringPattern, MatrixConfig, MatrixDimensions, CoordinateMapping } from '../types.d.ts';

export class CoordinateLUT {
  private config: MatrixConfig;
  private dimensions: MatrixDimensions;
  private lut: Int32Array; // Pre-computed buffer offsets for each logical position
  private mappings: CoordinateMapping[]; // Detailed mapping info for debugging

  constructor(config: MatrixConfig) {
    this.config = { ...config };
    this.dimensions = this.calculateDimensions(config);
    this.lut = new Int32Array(0);
    this.mappings = [];
    this.rebuild();
  }

  /**
   * Update configuration and rebuild LUT
   */
  updateConfig(config: MatrixConfig): void {
    this.config = { ...config };
    const newDimensions = this.calculateDimensions(config);
    
    // Only rebuild if dimensions or wiring changed
    if (!this.dimensionsEqual(newDimensions, this.dimensions) || 
        this.config.wiring !== config.wiring) {
      this.dimensions = newDimensions;
      this.rebuild();
    }
  }

  /**
   * Get buffer offset for logical coordinate (row, col)
   * Returns -1 if coordinates are out of bounds
   */
  getBufferOffset(row: number, col: number): number {
    if (row < 0 || row >= this.dimensions.rows || 
        col < 0 || col >= this.dimensions.cols) {
      return -1;
    }
    
    const logicalIndex = row * this.dimensions.cols + col;
    return this.lut[logicalIndex];
  }

  /**
   * Get detailed mapping info for debugging
   */
  getMapping(row: number, col: number): CoordinateMapping | null {
    const logicalIndex = row * this.dimensions.cols + col;
    return this.mappings[logicalIndex] || null;
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

  /**
   * Check if two dimensions are equal
   */
  private dimensionsEqual(a: MatrixDimensions, b: MatrixDimensions): boolean {
    return a.cols === b.cols && a.rows === b.rows;
  }

  /**
   * Rebuild the lookup table
   */
  private rebuild(): void {
    const { totalPixels } = this.dimensions;
    
    // Allocate arrays
    this.lut = new Int32Array(totalPixels);
    this.mappings = new Array(totalPixels);

    // Build mapping for each logical position
    for (let row = 0; row < this.dimensions.rows; row++) {
      for (let col = 0; col < this.dimensions.cols; col++) {
        const logicalIndex = row * this.dimensions.cols + col;
        const mapping = this.calculateMapping(row, col);
        
        this.lut[logicalIndex] = mapping.bufferOffset;
        this.mappings[logicalIndex] = mapping;
      }
    }

    console.log(`LUT rebuilt: ${this.dimensions.cols}×${this.dimensions.rows} (${totalPixels} pixels), wiring: ${this.config.wiring}`);
  }

  /**
   * Calculate coordinate mapping for a single logical position
   */
  private calculateMapping(logicalRow: number, logicalCol: number): CoordinateMapping {
    // Determine which panel this pixel belongs to
    const panelX = Math.floor(logicalCol / this.config.panelCols);
    const panelY = Math.floor(logicalRow / this.config.panelRows);
    
    // Position within the panel
    const inPanelX = logicalCol % this.config.panelCols;
    const inPanelY = logicalRow % this.config.panelRows;
    
    // Apply wiring pattern within the panel
    const physicalIndex = this.applyWiring(
      panelX, panelY, 
      inPanelX, inPanelY, 
      this.config.wiring
    );
    
    // Convert to buffer offset (RGB888 = 4 bytes per pixel in ImageData)
    const bufferOffset = physicalIndex * 4;
    
    return {
      logicalIndex: logicalRow * this.dimensions.cols + logicalCol,
      bufferOffset,
      panelX,
      panelY,
      inPanelX,
      inPanelY
    };
  }

  /**
   * Apply wiring pattern to convert logical panel coordinates to physical index
   */
  private applyWiring(
    panelX: number, 
    panelY: number, 
    inPanelX: number, 
    inPanelY: number, 
    wiring: WiringPattern
  ): number {
    // Calculate base offset for this panel
    const panelIndex = panelY * this.config.panelsX + panelX;
    const pixelsPerPanel = this.config.panelCols * this.config.panelRows;
    const panelOffset = panelIndex * pixelsPerPanel;
    
    // Apply wiring within panel
    let pixelInPanel: number;
    
    switch (wiring) {
      case 'row-major':
        pixelInPanel = inPanelY * this.config.panelCols + inPanelX;
        break;
        
      case 'column-major':
        pixelInPanel = inPanelX * this.config.panelRows + inPanelY;
        break;
        
      case 'serpentine':
        // Alternate row direction for serpentine wiring
        if (inPanelY % 2 === 0) {
          // Even rows: left to right
          pixelInPanel = inPanelY * this.config.panelCols + inPanelX;
        } else {
          // Odd rows: right to left  
          pixelInPanel = inPanelY * this.config.panelCols + (this.config.panelCols - 1 - inPanelX);
        }
        break;
        
      default:
        throw new Error(`Unknown wiring pattern: ${wiring}`);
    }
    
    return panelOffset + pixelInPanel;
  }
}

/**
 * Utility function to create a LUT from configuration
 */
export function createCoordinateLUT(config: MatrixConfig): CoordinateLUT {
  return new CoordinateLUT(config);
}