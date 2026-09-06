/*
 * The AHYC burgee: a blue pennant with two white stars at the hoist and a white wedge that
 * opens from the middle of the hoist out to the fly. The club letters sit on that wedge on
 * the real flag; at marker size they would be a smudge, so the glyph keeps only the shapes
 * that still read at a dozen pixels.
 *
 * Built as markup rather than a component because Leaflet's divIcon takes an HTML string;
 * `BurgeeGlyph` in the kiosk renders the same string so the flag is defined in one place.
 */

const BLUE = "#000099";
const WHITE = "#ffffff";

/** Five-pointed star centred on (cx, cy), sized by its circumradius. */
function star(cx: number, cy: number, r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.42;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(
      `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`,
    );
  }
  return `<polygon points="${points.join(" ")}" fill="${WHITE}"/>`;
}

const VIEW_W = 30;
const VIEW_H = 20;
export const BURGEE_ASPECT = VIEW_W / VIEW_H;

/** Burgee markup at the given rendered height, in the flag's 3:2 proportions. */
export function burgeeSvg(height: number, className = ""): string {
  const width = Math.round(height * BURGEE_ASPECT);
  return `<svg class="${className}" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${width}" height="${height}" aria-hidden="true">
  <path d="M1 1 L29 6.4 L29 13.6 L1 19 Z" fill="${BLUE}" stroke="rgba(255,255,255,0.92)" stroke-width="1.4" stroke-linejoin="round"/>
  <path d="M3 10 L29 6.6 L29 13.4 Z" fill="${WHITE}"/>
  ${star(6.4, 5.2, 2.6)}
  ${star(6.4, 14.8, 2.6)}
</svg>`;
}
