/**
 * PhotoPilot Image Processing Engine
 * 
 * Matches backend/processor.py Lightroom develop engine exactly:
 * 1. 256-entry Tonal LUT for Exposure, Contrast, Highlights, Shadows, Whites, Blacks
 * 2. 3x3 Color Matrix for Temperature, Tint, Saturation, Vibrance
 * 3. Vignette radial power curve
 * 4. Grain noise
 * 5. Clarity & Sharpness unsharp masking
 * 
 * Uses WebGL for 60fps real-time GPU preview, with an automated 2D Canvas fallback.
 */

export function buildTonalLut(adj = {}) {
  const lut = new Uint8Array(256);
  const exp = Number(adj.exposure ?? 0) / 50.0;
  const contrast = Number(adj.contrast ?? 0) / 100.0;
  const highlights = Number(adj.highlights ?? 0) / 100.0;
  const shadows = Number(adj.shadows ?? 0) / 100.0;
  const whites = Number(adj.whites ?? 0) / 100.0;
  const blacks = Number(adj.blacks ?? 0) / 100.0;

  const expMult = exp !== 0 ? Math.pow(2.0, exp) : 1.0;

  for (let i = 0; i < 256; i++) {
    let x = i / 255.0;
    if (exp !== 0) x *= expMult;
    if (contrast !== 0) x = (x - 0.5) * (1.0 + contrast) + 0.5;
    if (highlights !== 0) x += highlights * 0.35 * Math.max(0, Math.min(1, (x - 0.5) * 2.0));
    if (shadows !== 0) x += shadows * 0.35 * Math.max(0, Math.min(1, (0.5 - x) * 2.0));
    if (whites !== 0) x += whites * 0.25 * Math.max(0, Math.min(1, (x - 0.7) * 3.33));
    if (blacks !== 0) x += blacks * 0.25 * Math.max(0, Math.min(1, (0.3 - x) * 3.33));
    lut[i] = Math.max(0, Math.min(255, Math.floor(Math.max(0, Math.min(255, x * 255.0)))));
  }
  return lut;
}

export function buildColorMatrix(adj = {}) {
  const temp = Number(adj.temperature ?? 0) / 100.0;
  const tint = Number(adj.tint ?? 0) / 100.0;
  const sat = Number(adj.saturation ?? 0) / 100.0;
  const vib = Number(adj.vibrance ?? 0) / 100.0;

  const s = 1.0 + sat + vib * 0.5;
  const m_b = (1.0 - s) * 0.114;
  const m_g = (1.0 - s) * 0.587;
  const m_r = (1.0 - s) * 0.299;

  // In Python processor.py (BGR):
  // color_mat:
  // [0]: [m_b + s - temp*0.12 + tint*0.05, m_g, m_r]
  // [1]: [m_b, m_g + s - tint*0.12, m_r]
  // [2]: [m_b, m_g, m_r + s + temp*0.12 + tint*0.05]
  //
  // Converted to RGB order (R = row2, G = row1, B = row0):
  return {
    rr: m_r + s + temp * 0.12 + tint * 0.05,
    rg: m_g,
    rb: m_b,

    gr: m_r,
    gg: m_g + s - tint * 0.12,
    gb: m_b,

    br: m_r,
    bg: m_g,
    bb: m_b + s - temp * 0.12 + tint * 0.05,

    isIdentity: temp === 0 && tint === 0 && sat === 0 && vib === 0,
  };
}

const VERT_SRC = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}
`;

const FRAG_SRC = `
precision highp float;
varying vec2 v_texCoord;
uniform sampler2D u_image;
uniform sampler2D u_lut;
uniform mat3 u_colorMat;
uniform float u_vignette;
uniform float u_grain;
uniform float u_clarity;
uniform float u_sharpness;
uniform float u_autoEnhance;
uniform vec2 u_resolution;
uniform float u_time;

float random(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    vec4 srcColor = texture2D(u_image, v_texCoord);
    vec3 rgb = srcColor.rgb;
    vec2 px = 1.0 / u_resolution;

    // 0. Auto Quality Boost / Smart Pro Enhancement
    if (u_autoEnhance > 0.0) {
        float luma = dot(rgb, vec3(0.299, 0.587, 0.114));
        vec3 lumaBlur = (
            texture2D(u_image, v_texCoord + vec2(px.x * 1.5, 0.0)).rgb +
            texture2D(u_image, v_texCoord - vec2(px.x * 1.5, 0.0)).rgb +
            texture2D(u_image, v_texCoord + vec2(0.0, px.y * 1.5)).rgb +
            texture2D(u_image, v_texCoord - vec2(0.0, px.y * 1.5)).rgb
        ) * 0.25;
        float blurLuma = dot(lumaBlur, vec3(0.299, 0.587, 0.114));
        float detail = luma - blurLuma;
        float enhancedLuma = clamp(luma + detail * 1.25, 0.0, 1.0);
        enhancedLuma = mix(enhancedLuma, enhancedLuma * enhancedLuma * (3.0 - 2.0 * enhancedLuma), 0.12);
        float lumaRatio = (luma > 0.001) ? (enhancedLuma / luma) : 1.0;
        vec3 enhancedRgb = clamp(rgb * lumaRatio, 0.0, 1.0);
        float maxC = max(enhancedRgb.r, max(enhancedRgb.g, enhancedRgb.b));
        float minC = min(enhancedRgb.r, min(enhancedRgb.g, enhancedRgb.b));
        float sat = (maxC > 0.0) ? ((maxC - minC) / maxC) : 0.0;
        float vibBoost = (1.0 - sat) * 0.16;
        vec3 vibranceRgb = mix(vec3(enhancedLuma), enhancedRgb, 1.0 + vibBoost);
        rgb = mix(rgb, clamp(vibranceRgb, 0.0, 1.0), u_autoEnhance);
    }

    // 1. Sharpness & Clarity unsharp masks
    if (u_sharpness > 25.0) {
        float k = ((u_sharpness - 25.0) / 50.0) * 0.5;
        vec3 sharpBlur = (
            texture2D(u_image, v_texCoord + vec2(px.x, 0.0)).rgb +
            texture2D(u_image, v_texCoord - vec2(px.x, 0.0)).rgb +
            texture2D(u_image, v_texCoord + vec2(0.0, px.y)).rgb +
            texture2D(u_image, v_texCoord - vec2(0.0, px.y)).rgb
        ) * 0.25;
        rgb = clamp(rgb * (1.0 + k) - sharpBlur * k, 0.0, 1.0);
    }

    if (u_clarity != 0.0) {
        float c = u_clarity * 0.7;
        float sigmaStep = max(3.0, min(u_resolution.x, u_resolution.y) * 0.012);
        vec2 cpx = px * sigmaStep;
        vec3 midBlur = (
            texture2D(u_image, v_texCoord + vec2(-cpx.x, -cpx.y)).rgb +
            texture2D(u_image, v_texCoord + vec2(cpx.x, -cpx.y)).rgb +
            texture2D(u_image, v_texCoord + vec2(-cpx.x, cpx.y)).rgb +
            texture2D(u_image, v_texCoord + vec2(cpx.x, cpx.y)).rgb
        ) * 0.25;
        rgb = clamp(rgb * (1.0 + c) - midBlur * c, 0.0, 1.0);
    }

    // 2. 256-entry Tonal LUT (Exposure, Contrast, Highlights, Shadows, Whites, Blacks)
    // Sample 1D LUT texture (256x1)
    float rLut = texture2D(u_lut, vec2(rgb.r, 0.5)).r;
    float gLut = texture2D(u_lut, vec2(rgb.g, 0.5)).g;
    float bLut = texture2D(u_lut, vec2(rgb.b, 0.5)).b;
    vec3 tonal = vec3(rLut, gLut, bLut);

    // 3. Color Matrix Transform (Temperature, Tint, Saturation, Vibrance)
    vec3 colored = clamp(u_colorMat * tonal, 0.0, 1.0);

    // 4. Vignette
    if (u_vignette != 0.0) {
        vec2 norm = (v_texCoord - vec2(0.5, 0.5)) * 2.0;
        float radius = length(norm) / 1.41421356;
        float vignetteMask = clamp(1.0 + u_vignette * pow(radius, 1.5), 0.0, 2.0);
        colored = clamp(colored * vignetteMask, 0.0, 1.0);
    }

    // 5. Grain (Gaussian-like noise)
    if (u_grain > 0.0) {
        float n1 = random(v_texCoord * u_resolution + vec2(u_time, 0.0));
        float n2 = random(v_texCoord * u_resolution + vec2(0.0, u_time));
        float noise = (n1 + n2 - 1.0) * (u_grain * 0.35 / 255.0);
        colored = clamp(colored + vec3(noise), 0.0, 1.0);
    }

    gl_FragColor = vec4(colored, srcColor.a);
}
`;

class WebGLRenderer {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.gl = this.canvas.getContext("webgl", { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
    this.initialized = false;
    if (this.gl) {
      this.initGL();
    }
  }

  initGL() {
    const gl = this.gl;
    const createShader = (type, src) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vert = createShader(gl.VERTEX_SHADER, VERT_SRC);
    const frag = createShader(gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vert || !frag) return;

    const program = gl.createProgram();
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      return;
    }
    this.program = program;

    // Quad geometry: full clip-space quad
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,  1, -1, -1,  1,
        -1,  1,  1, -1,  1,  1,
      ]),
      gl.STATIC_DRAW
    );

    const aPos = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const texBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        0, 1,  1, 1,  0, 0,
        0, 0,  1, 1,  1, 0,
      ]),
      gl.STATIC_DRAW
    );

    const aTex = gl.getAttribLocation(program, "a_texCoord");
    gl.enableVertexAttribArray(aTex);
    gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 0, 0);

    // Uniform locations
    this.uniforms = {
      u_image: gl.getUniformLocation(program, "u_image"),
      u_lut: gl.getUniformLocation(program, "u_lut"),
      u_colorMat: gl.getUniformLocation(program, "u_colorMat"),
      u_vignette: gl.getUniformLocation(program, "u_vignette"),
      u_grain: gl.getUniformLocation(program, "u_grain"),
      u_clarity: gl.getUniformLocation(program, "u_clarity"),
      u_sharpness: gl.getUniformLocation(program, "u_sharpness"),
      u_autoEnhance: gl.getUniformLocation(program, "u_autoEnhance"),
      u_resolution: gl.getUniformLocation(program, "u_resolution"),
      u_time: gl.getUniformLocation(program, "u_time"),
    };

    // Textures
    this.imageTexture = gl.createTexture();
    this.lutTexture = gl.createTexture();

    this.currentPhoto = null;
    this.initialized = true;
  }

  render(photo, width, height, adj, autoEnhance = false, enhanceStrength = 70) {
    if (!this.initialized || !this.gl) return null;
    const gl = this.gl;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);

    // Upload photo texture if changed
    if (this.currentPhoto !== photo) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, photo);
      this.currentPhoto = photo;
    } else {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
    }
    gl.uniform1i(this.uniforms.u_image, 0);

    // Upload 256-entry LUT texture (RGB LUT)
    const rawLut = buildTonalLut(adj);
    const lutData = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const v = rawLut[i];
      lutData[i * 3] = v;
      lutData[i * 3 + 1] = v;
      lutData[i * 3 + 2] = v;
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 256, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, lutData);
    gl.uniform1i(this.uniforms.u_lut, 1);

    // Color Matrix (column-major order for gl.uniformMatrix3fv)
    const mat = buildColorMatrix(adj);
    const mat3Array = new Float32Array([
      mat.rr, mat.gr, mat.br, // Column 0 (multiplies R)
      mat.rg, mat.gg, mat.bg, // Column 1 (multiplies G)
      mat.rb, mat.gb, mat.bb, // Column 2 (multiplies B)
    ]);
    gl.uniformMatrix3fv(this.uniforms.u_colorMat, false, mat3Array);

    // Uniform values
    gl.uniform1f(this.uniforms.u_vignette, Number(adj.vignette ?? 0) / 100.0);
    gl.uniform1f(this.uniforms.u_grain, Number(adj.grain ?? 0));
    gl.uniform1f(this.uniforms.u_clarity, Number(adj.clarity ?? 0) / 100.0);
    gl.uniform1f(this.uniforms.u_sharpness, Number(adj.sharpness ?? 25.0));
    gl.uniform1f(
      this.uniforms.u_autoEnhance,
      autoEnhance ? Math.max(0, Math.min(1, Number(enhanceStrength) / 100.0)) : 0.0
    );
    gl.uniform2f(this.uniforms.u_resolution, width, height);
    gl.uniform1f(this.uniforms.u_time, (Date.now() % 10000) / 1000.0);

    // Draw
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return this.canvas;
  }
}

// 2D Canvas CPU Fallback (in case WebGL is disabled)
class Fallback2DRenderer {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
  }

  render(photo, width, height, adj, autoEnhance = false, enhanceStrength = 70) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const ctx = this.ctx;
    ctx.drawImage(photo, 0, 0, width, height);

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const len = data.length;

    const lut = buildTonalLut(adj);
    const mat = buildColorMatrix(adj);
    const vignette = Number(adj.vignette ?? 0) / 100.0;
    const grain = Number(adj.grain ?? 0);

    const halfW = width / 2.0;
    const halfH = height / 2.0;

    let p = 0;
    const enhanceFactor = autoEnhance ? Math.max(0, Math.min(1, Number(enhanceStrength) / 100.0)) : 0;
    for (let y = 0; y < height; y++) {
      const ny = (y - halfH) / halfH;
      for (let x = 0; x < width; x++) {
        let r = lut[data[p]];
        let g = lut[data[p + 1]];
        let b = lut[data[p + 2]];

        if (enhanceFactor > 0) {
          const luma = 0.299 * r + 0.587 * g + 0.114 * b;
          const sCurve = luma < 128
            ? (luma * luma) / 128.0
            : 255.0 - ((255.0 - luma) * (255.0 - luma)) / 128.0;
          const diff = (sCurve - luma) * 0.25 * enhanceFactor;
          r = Math.max(0, Math.min(255, r + diff));
          g = Math.max(0, Math.min(255, g + diff));
          b = Math.max(0, Math.min(255, b + diff));
        }

        if (!mat.isIdentity) {
          const rNew = mat.rr * r + mat.rg * g + mat.rb * b;
          const gNew = mat.gr * r + mat.gg * g + mat.gb * b;
          const bNew = mat.br * r + mat.bg * g + mat.bb * b;
          r = Math.max(0, Math.min(255, rNew));
          g = Math.max(0, Math.min(255, gNew));
          b = Math.max(0, Math.min(255, bNew));
        }

        if (vignette !== 0) {
          const nx = (x - halfW) / halfW;
          const radius = Math.hypot(nx, ny) / 1.41421356;
          const mask = Math.max(0, Math.min(2.0, 1.0 + vignette * Math.pow(radius, 1.5)));
          r = Math.max(0, Math.min(255, r * mask));
          g = Math.max(0, Math.min(255, g * mask));
          b = Math.max(0, Math.min(255, b * mask));
        }

        if (grain > 0) {
          const noise = (Math.random() - 0.5) * (grain * 0.7);
          r = Math.max(0, Math.min(255, r + noise));
          g = Math.max(0, Math.min(255, g + noise));
          b = Math.max(0, Math.min(255, b + noise));
        }

        data[p] = r;
        data[p + 1] = g;
        data[p + 2] = b;
        p += 4;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return this.canvas;
  }
}

let glRendererInstance = null;
let fallback2DInstance = null;

export function renderAdjustedPhoto(
  photo,
  width,
  height,
  adj,
  autoEnhance = false,
  enhanceStrength = 70
) {
  if (!glRendererInstance) {
    try {
      glRendererInstance = new WebGLRenderer();
    } catch {
      glRendererInstance = null;
    }
  }

  if (glRendererInstance && glRendererInstance.initialized) {
    try {
      const res = glRendererInstance.render(photo, width, height, adj, autoEnhance, enhanceStrength);
      if (res) return res;
    } catch (err) {
      console.warn("WebGL render failed, falling back to 2D canvas:", err);
    }
  }

  if (!fallback2DInstance) {
    fallback2DInstance = new Fallback2DRenderer();
  }
  return fallback2DInstance.render(photo, width, height, adj, autoEnhance, enhanceStrength);
}
