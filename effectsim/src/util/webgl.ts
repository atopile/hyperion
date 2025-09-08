// WebGL utilities for LED Matrix rendering

export interface WebGLShaderProgram {
  program: WebGLProgram;
  uniforms: { [key: string]: WebGLUniformLocation };
  attributes: { [key: string]: number };
}

/**
 * Compile a WebGL shader
 */
export function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) {
    console.error('Failed to create shader');
    return null;
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

/**
 * Create and link a WebGL program
 */
export function createProgram(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string): WebGLShaderProgram | null {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  if (!vertexShader || !fragmentShader) {
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    console.error('Failed to create program');
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program linking error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  // Clean up shaders
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  return {
    program,
    uniforms: {},
    attributes: {}
  };
}

/**
 * Get and cache uniform locations
 */
export function getUniformLocation(gl: WebGLRenderingContext, shaderProgram: WebGLShaderProgram, name: string): WebGLUniformLocation | null {
  if (shaderProgram.uniforms[name] !== undefined) {
    return shaderProgram.uniforms[name];
  }

  const location = gl.getUniformLocation(shaderProgram.program, name);
  if (location === null) {
    console.warn(`Uniform '${name}' not found in shader program`);
    return null;
  }
  
  shaderProgram.uniforms[name] = location;
  return location;
}

/**
 * Get and cache attribute locations
 */
export function getAttribLocation(gl: WebGLRenderingContext, shaderProgram: WebGLShaderProgram, name: string): number {
  if (shaderProgram.attributes[name] !== undefined) {
    return shaderProgram.attributes[name];
  }

  const location = gl.getAttribLocation(shaderProgram.program, name);
  if (location === -1) {
    console.warn(`Attribute '${name}' not found in shader program`);
  }
  
  shaderProgram.attributes[name] = location;
  return location;
}

/**
 * Create a texture for RGB frame data
 */
export function createFrameTexture(gl: WebGLRenderingContext): WebGLTexture | null {
  const texture = gl.createTexture();
  if (!texture) {
    console.error('Failed to create texture');
    return null;
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  
  // Set texture parameters for pixel-perfect rendering
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  return texture;
}

/**
 * Create a buffer for fullscreen quad vertices
 */
export function createQuadBuffer(gl: WebGLRenderingContext): WebGLBuffer | null {
  const buffer = gl.createBuffer();
  if (!buffer) {
    console.error('Failed to create buffer');
    return null;
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  
  // Fullscreen quad vertices (two triangles)
  const vertices = new Float32Array([
    -1.0, -1.0,  // Bottom left
     1.0, -1.0,  // Bottom right
    -1.0,  1.0,  // Top left
     1.0,  1.0   // Top right
  ]);
  
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  return buffer;
}

// Vertex shader source - simple fullscreen quad
export const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
varying vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = (a_position + 1.0) / 2.0;
}
`;

// Fragment shader source - LED cluster rendering
export const FRAGMENT_SHADER_SOURCE = `
precision mediump float;

uniform sampler2D u_frameTexture;
uniform vec2 u_resolution;
uniform vec2 u_matrixSize;
uniform float u_ledRadius;
uniform float u_ledSpacing;
uniform float u_flareIntensity;
uniform bool u_hasFrameData;

varying vec2 v_texCoord;

// Rotate a 2D point by angle (in radians)
vec2 rotate(vec2 point, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(point.x * c - point.y * s, point.x * s + point.y * c);
}

void main() {
  // Convert screen coords to logical pixel coords
  vec2 logicalPixel = v_texCoord * u_matrixSize;
  vec2 pixelCenter = floor(logicalPixel) + 0.5;
  
  // Sample RGB data for this logical pixel (or use pattern color)
  vec3 pixelColor;
  if (u_hasFrameData) {
    pixelColor = texture2D(u_frameTexture, pixelCenter / u_matrixSize).rgb;
  } else {
    // LED pattern mode - dim LEDs for visibility
    pixelColor = vec3(0.5, 0.5, 0.5);
  }
  
  // Calculate position within the logical pixel
  vec2 localPos = logicalPixel - floor(logicalPixel) - 0.5;
  
  // LED cluster positions (2x2 grid pattern)
  vec2 ledPositions[4];
  ledPositions[0] = vec2(-u_ledSpacing, -u_ledSpacing); // Top-left
  ledPositions[1] = vec2(u_ledSpacing, -u_ledSpacing);  // Top-right
  ledPositions[2] = vec2(-u_ledSpacing, u_ledSpacing);  // Bottom-left
  ledPositions[3] = vec2(u_ledSpacing, u_ledSpacing);   // Bottom-right
  
  vec4 finalColor = vec4(0.067, 0.067, 0.067, 1.0); // #111111 background // Black background (#111)
  
  // First pass: render LED packages and LEDs
  for (int i = 0; i < 4; i++) {
    vec2 ledCenter = ledPositions[i];
    vec2 ledLocalPos = localPos - ledCenter;
    
    // Calculate LED package size (diamond when rotated 45 degrees)
    float packageSize = u_ledSpacing * sqrt(2.0);
    
    // Check if we're inside the diamond package (rotated square)
    vec2 rotatedPos = rotate(ledLocalPos, -0.785398); // -45 degrees
    bool insidePackage = abs(rotatedPos.x) <= packageSize / 2.0 && abs(rotatedPos.y) <= packageSize / 2.0;
    
    if (insidePackage) {
      // Inside package - dark grey background
      finalColor.rgb = vec3(0.2, 0.2, 0.2); // Dark grey package (#333)
      
      // Check if we're inside the circular LED
      // LED diameter should equal package side length
      float distToLED = length(ledLocalPos);
      float circleRadius = packageSize / 2.0; // Circle diameter = package side length
      if (distToLED <= circleRadius) {
        // Inside circular LED - apply pixel color
        finalColor.rgb = pixelColor;
      }
      break;
    }
  }
  
  // Second pass: apply lens flare effects from current and neighboring pixels
  if (u_hasFrameData) {
    // Check flare from neighboring pixels to allow bleeding across boundaries
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        // Sample neighboring pixel color
        vec2 neighborPixelCenter = pixelCenter + vec2(float(dx), float(dy));
        vec3 neighborPixelColor = texture2D(u_frameTexture, neighborPixelCenter / u_matrixSize).rgb;
        float neighborBrightness = max(max(neighborPixelColor.r, neighborPixelColor.g), neighborPixelColor.b);
        
        if (neighborBrightness > 0.1) {
          // Calculate offset for neighbor pixel's LED positions
          vec2 neighborOffset = vec2(float(dx), float(dy));
          
          // Check all 4 LEDs in this neighboring pixel
          for (int i = 0; i < 4; i++) {
            vec2 neighborLEDCenter = ledPositions[i] + neighborOffset;
            vec2 ledLocalPos = localPos - neighborLEDCenter;
            float distToLED = length(ledLocalPos);
            
            float packageSize = u_ledSpacing * sqrt(2.0);
            float circleRadius = packageSize / 2.0;
            float flareRadius = circleRadius * (1.0 + neighborBrightness * u_flareIntensity * 2.0);
            
            if (distToLED <= flareRadius && distToLED > circleRadius) {
              // Outside LED circle but within flare radius
              float flareIntensity = max(0.0, (flareRadius - distToLED) / (flareRadius - circleRadius));
              flareIntensity *= neighborBrightness * u_flareIntensity * 0.3;
              // Additive blend for lens flare from neighboring LEDs
              finalColor.rgb += neighborPixelColor * flareIntensity;
            }
          }
        }
      }
    }
  }
  
  gl_FragColor = finalColor;
}
`;