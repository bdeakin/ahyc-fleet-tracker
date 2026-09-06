/*
 * The AHYC burgee: a blue pennant with two white stars at the hoist, a white wedge opening
 * from the middle of the hoist out to the fly, and the club letters in red across it.
 *
 * The geometry is the club flag's own, measured off the artwork and scaled into a 30x20 box:
 * the pennant's edges and the wedge's edges each converge at the fly, which is what makes
 * the blue read as two tapering borders rather than a field with a triangle cut out.
 *
 * Built as markup rather than a component because Leaflet's divIcon takes an HTML string;
 * `BurgeeGlyph` in the kiosk renders the same string so the flag is defined in one place.
 */

const BLUE = "#000099";
const WHITE = "#ffffff";
const RED = "#cc0104";

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

/*
 * The club letters are set on the taper: equal widths, but each one taller than the last so
 * the word grows with the wedge and stays off the blue, the way it does on the flag.
 */
function letters(): string {
  const glyphs = ["A", "H", "Y", "C"]
    .map((ch, i) => {
      const size = 5.2 + i * 1.2;
      return `<text x="${(11.7 + i * 3.25).toFixed(2)}" y="${(10 + size * 0.36).toFixed(2)}" font-size="${size.toFixed(1)}" textLength="3" lengthAdjust="spacingAndGlyphs">${ch}</text>`;
    })
    .join("");
  return `<g fill="${RED}" font-family="'Arial Narrow', 'Helvetica Neue', Helvetica, Arial, sans-serif" font-weight="700" text-anchor="middle">${glyphs}</g>`;
}

const VIEW_W = 30;
const VIEW_H = 20;
export const BURGEE_ASPECT = VIEW_W / VIEW_H;

/** Burgee markup at the given rendered height, in the flag's own proportions. */
export function burgeeSvg(height: number, className = ""): string {
  const width = Math.round(height * BURGEE_ASPECT);
  return `<svg class="${className}" viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="${width}" height="${height}" aria-hidden="true">
  <path d="M0.7 0.8 L29.4 3.9 L29.4 16.1 L0.7 19.2 Z" fill="${BLUE}" stroke="rgba(255,255,255,0.92)" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M1.6 10 L29.4 4.1 L29.4 15.9 Z" fill="${WHITE}"/>
  ${star(5.3, 4.8, 2.3)}
  ${star(5.3, 15.2, 2.3)}
  ${letters()}
</svg>`;
}
