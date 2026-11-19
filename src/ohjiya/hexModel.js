/**
 * Density hex map for the company library: counts saved places and areas into
 * a hexagonal grid. No map and no dependency; the grid is a metric projection
 * around a whole-degree latitude, so cells keep their shape and the grid does
 * not move when items are added.
 */
import { pointOf } from './libraryModel.js';

const R = 6_371_000;
const RAD = Math.PI / 180;
export const HEX_SIZES_M = Object.freeze([500, 1000, 2000, 5000]);

/**
 * @param {Array} items library items (places and areas)
 * @param {number} cellM hexagon radius in metres (centre to corner)
 * @returns {{cells: Array<{q:number,r:number,count:number,corners:Array<{lat:number,lon:number}>}>, max:number}}
 */
export function hexBins(items, cellM) {
  if (!items.length || !(cellM > 0)) return { cells: [], max: 0 };
  const lat0 = Math.round(pointOf(items[0]).lat);
  const kx = R * RAD * Math.cos(lat0 * RAD);
  const ky = R * RAD;
  const counts = new Map();
  for (const item of items) {
    const p = pointOf(item);
    const x = p.lon * kx;
    const y = (p.lat - lat0) * ky;
    const fq = ((Math.sqrt(3) / 3) * x - y / 3) / cellM;
    const fr = ((2 / 3) * y) / cellM;
    // Cube rounding.
    let q = Math.round(fq);
    let r = Math.round(fr);
    const s = Math.round(-fq - fr);
    const dq = Math.abs(q - fq);
    const dr = Math.abs(r - fr);
    const ds = Math.abs(s + fq + fr);
    if (dq > dr && dq > ds) q = -r - s;
    else if (dr > ds) r = -q - s;
    const key = `${q},${r}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const cells = [];
  let max = 0;
  for (const [key, count] of counts) {
    const [q, r] = key.split(',').map(Number);
    const cx = cellM * Math.sqrt(3) * (q + r / 2);
    const cy = cellM * 1.5 * r;
    const corners = Array.from({ length: 6 }, (_, i) => {
      const a = (60 * i + 30) * RAD;
      return {
        lat: lat0 + (cy + cellM * Math.sin(a)) / ky,
        lon: (cx + cellM * Math.cos(a)) / kx,
      };
    });
    cells.push({ q, r, count, corners });
    max = Math.max(max, count);
  }
  return { cells, max };
}
