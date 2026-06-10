/**
 * Self-contained GIF89a animation encoder.
 *
 * Pipeline: RGBA frames → NeuQuant 256-color global palette → per-frame
 * nearest-color quantization → LZW compression → GIF89a byte stream with
 * a Netscape 2.0 looping extension.
 *
 * Why hand-rolled: the only step that's anywhere near "library" territory
 * is NeuQuant, which is ~150 lines. Adding a 50KB+ npm dep for a single
 * tool isn't a fair trade.
 *
 * Quality knob: `quality` (1..30) is NeuQuant's sample factor — 1 visits
 * every pixel during palette learning (best/slowest), 30 visits one in 30
 * (worst/fastest). Default 10 mirrors common GIF tools.
 *
 * 📝 Design notes & validation TODOs:
 *    .research/record-gif-design-notes.md
 *    The "GIF encoder validation" section calls out the LZW codeSize-bump
 *    rule, sub-block size constraint, and lack of CI fixture tests. Read
 *    BEFORE changing the LZW or color-map code paths.
 */
export interface GifFrameInput {
  /** Width × height × 4 bytes, row-major, top-left origin. */
  rgba: Uint8ClampedArray;
  /** Frame delay in centiseconds (1/100 s). */
  delay_cs: number;
}

export interface EncodeGifOptions {
  width: number;
  height: number;
  frames: GifFrameInput[];
  /** NeuQuant sample factor (1=best, 30=worst). Default 10. */
  quality?: number;
  /** Loop count. 0 = forever. Default 0. */
  loop?: number;
}

export function encodeGif(opts: EncodeGifOptions): Uint8Array {
  const { width, height, frames } = opts;
  const quality = clamp(opts.quality ?? 10, 1, 30);
  const loop = opts.loop ?? 0;

  if (frames.length === 0) throw new Error('encodeGif: no frames');
  for (const f of frames) {
    if (f.rgba.length !== width * height * 4) {
      throw new Error(
        `encodeGif: frame size ${f.rgba.length} ≠ width*height*4 (${width * height * 4})`,
      );
    }
  }

  // Build a global palette by sampling every frame.
  const nq = new NeuQuant(buildSampleBuffer(frames, width, height), quality);
  nq.learn();
  nq.buildIndex();
  const colorMap = nq.colorMap();

  // Quantize each frame against the global palette.
  const indexedFrames: Uint8Array[] = frames.map((f) =>
    quantizeFrame(f.rgba, colorMap, width, height),
  );

  // Assemble the byte stream.
  const out = new ByteWriter();
  writeHeader(out);
  writeLogicalScreenDescriptor(out, width, height);
  writeGlobalColorTable(out, colorMap);
  if (frames.length > 1) writeNetscapeLoopExtension(out, loop);
  for (let i = 0; i < frames.length; i++) {
    writeGraphicControlExtension(out, frames[i]!.delay_cs);
    writeImageDescriptor(out, width, height);
    writeImageData(out, indexedFrames[i]!);
  }
  out.writeByte(0x3b); // trailer
  return out.toUint8Array();
}

// ─── frame quantization ────────────────────────────────────────────────────
function buildSampleBuffer(frames: GifFrameInput[], width: number, height: number): Uint8Array {
  // NeuQuant wants an RGB stream (no alpha) sampled across all frames. To
  // keep palette learning bounded for long recordings we cap total samples
  // at ~600k pixels, picking from frames evenly.
  const target = Math.min(width * height * frames.length, 600_000);
  const buf = new Uint8Array(target * 3);
  let bi = 0;
  const stride = Math.max(1, Math.floor((width * height * frames.length) / target));
  let counter = 0;
  for (const f of frames) {
    const px = f.rgba;
    for (let i = 0; i < px.length && bi < buf.length; i += 4) {
      if (counter % stride === 0) {
        buf[bi++] = px[i]!;
        buf[bi++] = px[i + 1]!;
        buf[bi++] = px[i + 2]!;
      }
      counter++;
    }
  }
  return buf.subarray(0, bi);
}

function quantizeFrame(
  rgba: Uint8ClampedArray,
  colorMap: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  const cache = new Map<number, number>();
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const key = (r << 16) | (g << 8) | b;
    let idx = cache.get(key);
    if (idx === undefined) {
      idx = nearestColor(colorMap, r, g, b);
      if (cache.size < 65_536) cache.set(key, idx);
    }
    out[p] = idx;
  }
  return out;
}

function nearestColor(map: Uint8Array, r: number, g: number, b: number): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 256; i++) {
    const dr = r - map[i * 3]!;
    const dg = g - map[i * 3 + 1]!;
    const db = b - map[i * 3 + 2]!;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) {
      bestDist = d;
      best = i;
      if (d === 0) break;
    }
  }
  return best;
}

// ─── byte writer ───────────────────────────────────────────────────────────
class ByteWriter {
  private chunks: number[] = [];
  writeByte(b: number) {
    this.chunks.push(b & 0xff);
  }
  writeBytes(b: ArrayLike<number>) {
    for (let i = 0; i < b.length; i++) this.chunks.push(b[i]! & 0xff);
  }
  writeShortLE(n: number) {
    this.chunks.push(n & 0xff, (n >> 8) & 0xff);
  }
  writeAscii(s: string) {
    for (let i = 0; i < s.length; i++) this.chunks.push(s.charCodeAt(i));
  }
  toUint8Array(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}

// ─── GIF section writers ───────────────────────────────────────────────────
function writeHeader(w: ByteWriter) {
  w.writeAscii('GIF89a');
}

function writeLogicalScreenDescriptor(w: ByteWriter, width: number, height: number) {
  w.writeShortLE(width);
  w.writeShortLE(height);
  // Packed: GCT flag (1) + color resolution (111) + sort flag (0) + size (111 = 256 entries)
  w.writeByte(0xf7);
  w.writeByte(0); // background color index
  w.writeByte(0); // pixel aspect ratio
}

function writeGlobalColorTable(w: ByteWriter, colorMap: Uint8Array) {
  if (colorMap.length !== 256 * 3) {
    throw new Error(`bad color map size ${colorMap.length}`);
  }
  w.writeBytes(colorMap);
}

function writeNetscapeLoopExtension(w: ByteWriter, loop: number) {
  w.writeByte(0x21); // extension introducer
  w.writeByte(0xff); // application extension label
  w.writeByte(0x0b); // block size
  w.writeAscii('NETSCAPE2.0');
  w.writeByte(0x03); // sub-block size
  w.writeByte(0x01); // sub-block id
  w.writeShortLE(loop & 0xffff);
  w.writeByte(0x00); // block terminator
}

function writeGraphicControlExtension(w: ByteWriter, delay_cs: number) {
  w.writeByte(0x21);
  w.writeByte(0xf9);
  w.writeByte(0x04); // block size
  w.writeByte(0x00); // packed: no transparency, disposal=0
  w.writeShortLE(Math.max(2, Math.round(delay_cs)));
  w.writeByte(0x00); // transparent color index
  w.writeByte(0x00); // block terminator
}

function writeImageDescriptor(w: ByteWriter, width: number, height: number) {
  w.writeByte(0x2c);
  w.writeShortLE(0); // left
  w.writeShortLE(0); // top
  w.writeShortLE(width);
  w.writeShortLE(height);
  w.writeByte(0x00); // no LCT, no interlace
}

function writeImageData(w: ByteWriter, indexed: Uint8Array) {
  w.writeByte(8); // LZW minimum code size
  const compressed = lzwEncode(indexed, 8);
  // Sub-block packing: max 255 bytes per chunk.
  for (let i = 0; i < compressed.length; ) {
    const chunkLen = Math.min(255, compressed.length - i);
    w.writeByte(chunkLen);
    w.writeBytes(compressed.subarray(i, i + chunkLen));
    i += chunkLen;
  }
  w.writeByte(0x00); // block terminator
}

// ─── LZW (GIF variant) ─────────────────────────────────────────────────────
function lzwEncode(pixels: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const MAX_BITS = 12;
  const MAX_CODE = (1 << MAX_BITS) - 1;

  const out: number[] = [];
  let cur = 0;
  let curBits = 0;
  let codeSize = minCodeSize + 1;

  function emit(code: number) {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) {
      out.push(cur & 0xff);
      cur >>>= 8;
      curBits -= 8;
    }
  }

  // Dictionary: maps "prefix*256 + suffix" → code. Cleared on overflow.
  let dict = new Map<number, number>();
  let nextCode = eoiCode + 1;

  emit(clearCode);

  let prefix = pixels[0] ?? 0;
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i]!;
    const composite = prefix * 256 + k;
    const found = dict.get(composite);
    if (found !== undefined) {
      prefix = found;
    } else {
      emit(prefix);
      if (nextCode < MAX_CODE) {
        dict.set(composite, nextCode++);
        if (nextCode > 1 << codeSize && codeSize < MAX_BITS) codeSize++;
      } else {
        emit(clearCode);
        dict = new Map();
        nextCode = eoiCode + 1;
        codeSize = minCodeSize + 1;
      }
      prefix = k;
    }
  }
  emit(prefix);
  emit(eoiCode);
  if (curBits > 0) out.push(cur & 0xff);
  return Uint8Array.from(out);
}

// ─── NeuQuant (Anthony Dekker, 1994) ───────────────────────────────────────
class NeuQuant {
  private static readonly NETSIZE = 256;
  private static readonly PRIME1 = 499;
  private static readonly PRIME2 = 491;
  private static readonly PRIME3 = 487;
  private static readonly PRIME4 = 503;
  private static readonly MIN_PICTURE_BYTES = 3 * NeuQuant.PRIME4;
  private static readonly NCYCLES = 100;
  private static readonly INT_BIAS_SHIFT = 16;
  private static readonly INT_BIAS = 1 << NeuQuant.INT_BIAS_SHIFT;
  private static readonly GAMMA_SHIFT = 10;
  private static readonly BETA_SHIFT = 10;
  private static readonly BETA = NeuQuant.INT_BIAS >> NeuQuant.BETA_SHIFT;
  private static readonly BETA_GAMMA =
    NeuQuant.INT_BIAS << (NeuQuant.GAMMA_SHIFT - NeuQuant.BETA_SHIFT);
  private static readonly INIT_RAD = NeuQuant.NETSIZE >> 3;
  private static readonly RADIUS_BIAS_SHIFT = 6;
  private static readonly RADIUS_BIAS = 1 << NeuQuant.RADIUS_BIAS_SHIFT;
  private static readonly INIT_RADIUS = NeuQuant.INIT_RAD * NeuQuant.RADIUS_BIAS;
  private static readonly RADIUS_DEC = 30;
  private static readonly ALPHA_BIAS_SHIFT = 10;
  private static readonly INIT_ALPHA = 1 << NeuQuant.ALPHA_BIAS_SHIFT;

  private network: number[][] = [];
  private netindex = new Int32Array(256);
  private bias = new Int32Array(NeuQuant.NETSIZE);
  private freq = new Int32Array(NeuQuant.NETSIZE);
  private radpower = new Int32Array(NeuQuant.INIT_RAD);

  constructor(
    private readonly pixels: Uint8Array,
    private readonly sampleFac: number,
  ) {
    for (let i = 0; i < NeuQuant.NETSIZE; i++) {
      const v = (i << (NeuQuant.INT_BIAS_SHIFT + 8)) / NeuQuant.NETSIZE;
      this.network.push([v, v, v, 0]);
      this.freq[i] = NeuQuant.INT_BIAS / NeuQuant.NETSIZE;
      this.bias[i] = 0;
    }
  }

  learn(): void {
    const lengthcount = this.pixels.length;
    if (lengthcount < NeuQuant.MIN_PICTURE_BYTES) {
      // Very small sample — skip learning, the initial gradient is fine.
      return;
    }
    const samplepixels = lengthcount / (3 * this.sampleFac);
    let delta = (samplepixels / NeuQuant.NCYCLES) | 0;
    if (delta === 0) delta = 1;
    let alpha = NeuQuant.INIT_ALPHA;
    let radius = NeuQuant.INIT_RADIUS;
    let rad = radius >> NeuQuant.RADIUS_BIAS_SHIFT;
    if (rad <= 1) rad = 0;
    for (let i = 0; i < rad; i++) {
      this.radpower[i] = alpha * (((rad * rad - i * i) * NeuQuant.RADIUS_BIAS) / (rad * rad));
    }

    let step: number;
    if (lengthcount < NeuQuant.MIN_PICTURE_BYTES) step = 3;
    else if (lengthcount % NeuQuant.PRIME1 !== 0) step = 3 * NeuQuant.PRIME1;
    else if (lengthcount % NeuQuant.PRIME2 !== 0) step = 3 * NeuQuant.PRIME2;
    else if (lengthcount % NeuQuant.PRIME3 !== 0) step = 3 * NeuQuant.PRIME3;
    else step = 3 * NeuQuant.PRIME4;

    let pix = 0;
    let i = 0;
    while (i < samplepixels) {
      const b = (this.pixels[pix]! & 0xff) << NeuQuant.INT_BIAS_SHIFT;
      const g = (this.pixels[pix + 1]! & 0xff) << NeuQuant.INT_BIAS_SHIFT;
      const r = (this.pixels[pix + 2]! & 0xff) << NeuQuant.INT_BIAS_SHIFT;
      const j = this.contest(b, g, r);
      this.alterSingle(alpha, j, b, g, r);
      if (rad !== 0) this.alterNeigh(rad, j, b, g, r);
      pix += step;
      if (pix >= lengthcount) pix -= lengthcount;
      i++;
      if (i % delta === 0) {
        alpha -= alpha / 30;
        radius -= radius / NeuQuant.RADIUS_DEC;
        rad = radius >> NeuQuant.RADIUS_BIAS_SHIFT;
        if (rad <= 1) rad = 0;
        for (let q = 0; q < rad; q++) {
          this.radpower[q] = alpha * (((rad * rad - q * q) * NeuQuant.RADIUS_BIAS) / (rad * rad));
        }
      }
    }
  }

  buildIndex(): void {
    let previouscol = 0;
    let startpos = 0;
    for (let i = 0; i < NeuQuant.NETSIZE; i++) {
      const p = this.network[i]!;
      let smallpos = i;
      let smallval = p[1]!;
      for (let j = i + 1; j < NeuQuant.NETSIZE; j++) {
        const q = this.network[j]!;
        if (q[1]! < smallval) {
          smallpos = j;
          smallval = q[1]!;
        }
      }
      const q = this.network[smallpos]!;
      if (i !== smallpos) {
        const t0 = q[0]!;
        q[0] = p[0]!;
        p[0] = t0;
        const t1 = q[1]!;
        q[1] = p[1]!;
        p[1] = t1;
        const t2 = q[2]!;
        q[2] = p[2]!;
        p[2] = t2;
        const t3 = q[3]!;
        q[3] = p[3]!;
        p[3] = t3;
      }
      if (smallval !== previouscol) {
        this.netindex[previouscol] = (startpos + i) >> 1;
        for (let j = previouscol + 1; j < smallval; j++) this.netindex[j] = i;
        previouscol = smallval;
        startpos = i;
      }
    }
    this.netindex[previouscol] = (startpos + (NeuQuant.NETSIZE - 1)) >> 1;
    for (let j = previouscol + 1; j < 256; j++) this.netindex[j] = NeuQuant.NETSIZE - 1;
  }

  /** Returns the 256 × 3 RGB color map. */
  colorMap(): Uint8Array {
    const map = new Uint8Array(256 * 3);
    const index = new Int32Array(NeuQuant.NETSIZE);
    for (let i = 0; i < NeuQuant.NETSIZE; i++) index[this.network[i]![3]!] = i;
    for (let i = 0; i < NeuQuant.NETSIZE; i++) {
      const j = index[i]!;
      const n = this.network[j]!;
      map[i * 3] = n[0]!;
      map[i * 3 + 1] = n[1]!;
      map[i * 3 + 2] = n[2]!;
    }
    return map;
  }

  private contest(b: number, g: number, r: number): number {
    let bestd = ~(1 << 31);
    let bestbiasd = bestd;
    let bestpos = -1;
    let bestbiaspos = bestpos;
    for (let i = 0; i < NeuQuant.NETSIZE; i++) {
      const n = this.network[i]!;
      const dist = Math.abs(n[0]! - b) + Math.abs(n[1]! - g) + Math.abs(n[2]! - r);
      if (dist < bestd) {
        bestd = dist;
        bestpos = i;
      }
      const biasdist = dist - (this.bias[i]! >> (NeuQuant.INT_BIAS_SHIFT - NeuQuant.NETSIZE));
      if (biasdist < bestbiasd) {
        bestbiasd = biasdist;
        bestbiaspos = i;
      }
      const betafreq = this.freq[i]! >> NeuQuant.BETA_SHIFT;
      this.freq[i] = this.freq[i]! - betafreq;
      this.bias[i] = this.bias[i]! + (betafreq << NeuQuant.GAMMA_SHIFT);
    }
    this.freq[bestpos] = this.freq[bestpos]! + NeuQuant.BETA;
    this.bias[bestpos] = this.bias[bestpos]! - NeuQuant.BETA_GAMMA;
    return bestbiaspos;
  }

  private alterSingle(alpha: number, i: number, b: number, g: number, r: number) {
    const n = this.network[i]!;
    n[0] = n[0]! - (alpha * (n[0]! - b)) / NeuQuant.INIT_ALPHA;
    n[1] = n[1]! - (alpha * (n[1]! - g)) / NeuQuant.INIT_ALPHA;
    n[2] = n[2]! - (alpha * (n[2]! - r)) / NeuQuant.INIT_ALPHA;
  }

  private alterNeigh(rad: number, i: number, b: number, g: number, r: number) {
    const lo = Math.max(i - rad, -1);
    const hi = Math.min(i + rad, NeuQuant.NETSIZE);
    let j = i + 1;
    let k = i - 1;
    let m = 1;
    while (j < hi || k > lo) {
      const a = this.radpower[m++]!;
      if (j < hi) {
        const p = this.network[j++]!;
        p[0] = p[0]! - (a * (p[0]! - b)) / NeuQuant.RADIUS_BIAS / NeuQuant.INIT_ALPHA;
        p[1] = p[1]! - (a * (p[1]! - g)) / NeuQuant.RADIUS_BIAS / NeuQuant.INIT_ALPHA;
        p[2] = p[2]! - (a * (p[2]! - r)) / NeuQuant.RADIUS_BIAS / NeuQuant.INIT_ALPHA;
      }
      if (k > lo) {
        const p = this.network[k--]!;
        p[0] = p[0]! - (a * (p[0]! - b)) / NeuQuant.RADIUS_BIAS / NeuQuant.INIT_ALPHA;
        p[1] = p[1]! - (a * (p[1]! - g)) / NeuQuant.RADIUS_BIAS / NeuQuant.INIT_ALPHA;
        p[2] = p[2]! - (a * (p[2]! - r)) / NeuQuant.RADIUS_BIAS / NeuQuant.INIT_ALPHA;
      }
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
