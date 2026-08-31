// WebGL LED Matrix Renderer

import type { MatrixDimensions, FrameBuffer } from '../types.d.ts';
import {
  WebGLShaderProgram,
  createProgram,
  getUniformLocation,
  getAttribLocation,
  createFrameTexture,
  createQuadBuffer,
  VERTEX_SHADER_SOURCE,
  FRAGMENT_SHADER_SOURCE
} from './webgl.js';

export class WebGLLEDRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLShaderProgram | null = null;
  private frameTexture: WebGLTexture | null = null;
  private quadBuffer: WebGLBuffer | null = null;
  
  // Cached uniform locations
  private uniforms = {
    frameTexture: null as WebGLUniformLocation | null,
    resolution: null as WebGLUniformLocation | null,
    matrixSize: null as WebGLUniformLocation | null,
    ledRadius: null as WebGLUniformLocation | null,
    ledSpacing: null as WebGLUniformLocation | null,
    flareIntensity: null as WebGLUniformLocation | null,
    hasFrameData: null as WebGLUniformLocation | null
  };
  
  // Current state
  private currentDimensions: MatrixDimensions | null = null;
  private isInitialized = false;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl');
    if (!gl) {
      throw new Error('WebGL not supported');
    }
    this.gl = gl;
    
    // Enable blending for lens flare effects
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /**
   * Initialize WebGL resources
   */
  initialize(): boolean {
    try {
      // Create shader program
      this.program = createProgram(this.gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
      if (!this.program) {
        console.error('Failed to create shader program');
        return false;
      }

      // Get uniform locations
      this.uniforms.frameTexture = getUniformLocation(this.gl, this.program, 'u_frameTexture');
      this.uniforms.resolution = getUniformLocation(this.gl, this.program, 'u_resolution');
      this.uniforms.matrixSize = getUniformLocation(this.gl, this.program, 'u_matrixSize');
      this.uniforms.ledRadius = getUniformLocation(this.gl, this.program, 'u_ledRadius');
      this.uniforms.ledSpacing = getUniformLocation(this.gl, this.program, 'u_ledSpacing');
      this.uniforms.flareIntensity = getUniformLocation(this.gl, this.program, 'u_flareIntensity');
      this.uniforms.hasFrameData = getUniformLocation(this.gl, this.program, 'u_hasFrameData');

      // Create fullscreen quad buffer
      this.quadBuffer = createQuadBuffer(this.gl);
      if (!this.quadBuffer) {
        console.error('Failed to create quad buffer');
        return false;
      }

      // Create frame texture
      this.frameTexture = createFrameTexture(this.gl);
      if (!this.frameTexture) {
        console.error('Failed to create frame texture');
        return false;
      }

      this.isInitialized = true;
      console.log('WebGL LED renderer initialized successfully');
      return true;

    } catch (error) {
      console.error('WebGL initialization failed:', error);
      return false;
    }
  }

  /**
   * Update matrix dimensions and reallocate resources if needed
   */
  updateDimensions(dimensions: MatrixDimensions): void {
    if (!this.currentDimensions || 
        this.currentDimensions.cols !== dimensions.cols || 
        this.currentDimensions.rows !== dimensions.rows) {
      
      this.currentDimensions = { ...dimensions };
      console.log(`WebGL renderer updated to ${dimensions.cols}×${dimensions.rows}`);
    }
  }

  /**
   * Upload frame data to texture
   */
  updateFrame(frame: FrameBuffer): void {
    if (!this.isInitialized || !this.frameTexture || !this.currentDimensions) {
      return;
    }

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.frameTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,                               // level
      this.gl.RGB,                     // internal format
      this.currentDimensions.cols,     // width
      this.currentDimensions.rows,     // height
      0,                               // border
      this.gl.RGB,                     // format
      this.gl.UNSIGNED_BYTE,           // type
      frame.data                       // data
    );
  }

  /**
   * Render the current frame with LED effects
   */
  render(canvasWidth: number, canvasHeight: number, config: {
    gap: number;
    lensFlareIntensity: number;
  }, hasFrameData: boolean = true): void {
    
    if (!this.isInitialized || !this.program || !this.quadBuffer || !this.currentDimensions) {
      return;
    }

    const gl = this.gl;

    // Set viewport
    gl.viewport(0, 0, canvasWidth, canvasHeight);

    // Clear with dark background
    gl.clearColor(0.067, 0.067, 0.067, 1.0); // #111111
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Use shader program
    gl.useProgram(this.program.program);

    // Bind fullscreen quad
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    
    const positionAttrib = getAttribLocation(gl, this.program, 'a_position');
    if (positionAttrib !== -1) {
      gl.enableVertexAttribArray(positionAttrib);
      gl.vertexAttribPointer(positionAttrib, 2, gl.FLOAT, false, 0, 0);
    }

    // Set uniforms
    if (this.uniforms.resolution) {
      gl.uniform2f(this.uniforms.resolution, canvasWidth, canvasHeight);
    }
    
    if (this.uniforms.matrixSize) {
      gl.uniform2f(this.uniforms.matrixSize, this.currentDimensions.cols, this.currentDimensions.rows);
    }

    // LED parameters (matching current Canvas 2D implementation)
    if (this.uniforms.ledRadius) {
      gl.uniform1f(this.uniforms.ledRadius, 0.15); // 15% of pixel radius
    }
    
    if (this.uniforms.ledSpacing) {
      gl.uniform1f(this.uniforms.ledSpacing, 0.25); // 25% spacing between LED centers
    }
    
    if (this.uniforms.flareIntensity) {
      gl.uniform1f(this.uniforms.flareIntensity, config.lensFlareIntensity);
    }

    if (this.uniforms.hasFrameData) {
      gl.uniform1i(this.uniforms.hasFrameData, hasFrameData ? 1 : 0);
    }

    // Bind frame texture
    if (hasFrameData && this.frameTexture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.frameTexture);
      
      if (this.uniforms.frameTexture) {
        gl.uniform1i(this.uniforms.frameTexture, 0);
      }
    }

    // Draw fullscreen quad
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Clean up
    if (positionAttrib !== -1) {
      gl.disableVertexAttribArray(positionAttrib);
    }
  }

  /**
   * Handle canvas resize
   */
  resize(canvasWidth: number, canvasHeight: number): void {
    if (!this.isInitialized) return;
    
    // Update canvas size
    this.gl.canvas.width = canvasWidth;
    this.gl.canvas.height = canvasHeight;
  }

  /**
   * Clean up WebGL resources
   */
  cleanup(): void {
    if (!this.gl) return;

    if (this.frameTexture) {
      this.gl.deleteTexture(this.frameTexture);
      this.frameTexture = null;
    }

    if (this.quadBuffer) {
      this.gl.deleteBuffer(this.quadBuffer);
      this.quadBuffer = null;
    }

    if (this.program) {
      this.gl.deleteProgram(this.program.program);
      this.program = null;
    }

    this.isInitialized = false;
    console.log('WebGL renderer cleaned up');
  }
}