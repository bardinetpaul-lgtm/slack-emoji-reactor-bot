// ═══════════════════════════════════════════════════════════
//  🖼️ MODULE REDIMENSIONNEMENT (pur JS : pngjs + jpeg-js)
//
//  Lecture des pixels d'une photo de carte et réduction en JPEG.
//  Utilisé par les miniatures du classeur (src/cardImages.js) et
//  par l'analyse des looks de l'Arène (src/game/).
// ═══════════════════════════════════════════════════════════

/** Pixels d'une image (PNG, JPEG) → { width, height, data RGBA } | null (GIF, WebP, illisible) */
function decode(buffer, mime) {
  try {
    if (mime === 'image/png') return require('pngjs').PNG.sync.read(buffer);
    if (mime === 'image/jpeg') return require('jpeg-js').decode(buffer, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512 });
  } catch (e) {
    return null;
  }
  return null;
}

/** Réduit (plus grand côté ≤ maxSide, jamais agrandi) → Buffer JPEG */
function shrink(pixels, maxSide, quality = 85) {
  const { width: W, height: H, data } = pixels;
  const k = Math.min(1, maxSide / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k));
  const h = Math.max(1, Math.round(H * k));
  const out = Buffer.alloc(w * h * 4);
  // moyenne des pixels source couverts (réduction propre, sans crénelage)
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.floor(y / k);
    const y1 = Math.min(H, Math.max(y0 + 1, Math.floor((y + 1) / k)));
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.floor(x / k);
      const x1 = Math.min(W, Math.max(x0 + 1, Math.floor((x + 1) / k)));
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const i = (sy * W + sx) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return require('jpeg-js').encode({ width: w, height: h, data: out }, quality).data;
}

module.exports = { decode, shrink };
