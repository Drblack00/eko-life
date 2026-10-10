/**
 * Billboard creative renderer — pure canvas 2D drawing, no DOM needed beyond
 * the context passed in. Shared by the 3D map (CityMap billboards) and the
 * admin live preview. All art is generated at runtime; no external images.
 */

export interface BillboardCreative {
  headline: string;
  subtext?: string | null;
  bg?: string | null;
  fg?: string | null;
  accent?: string | null;
}

const HEADLINE_FONT = (px: number) =>
  `900 ${px}px 'Arial Black', 'Helvetica Neue', Arial, sans-serif`;
const SUB_FONT = (px: number) => `400 ${px}px Verdana, Geneva, Arial, sans-serif`;

/** Word-wrap `text` to at most `maxLines` lines within `maxWidth`. */
export function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = String(text || "")
    .split(/\s+/)
    .filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(trial).width > maxWidth) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) {
        line = "";
        break;
      }
    } else {
      line = trial;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  // Ellipsize if words were dropped.
  if (lines.length === maxLines && words.length > 0) {
    const joined = lines.join(" ");
    const total = words.join(" ");
    if (joined.length < total.length) {
      let last = lines[lines.length - 1];
      while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[lines.length - 1] = `${last}…`;
    }
  }
  return lines;
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/**
 * Draw one billboard creative onto `ctx` (canvas sized w×h, default 512×256).
 * Dark/colorful panel, bold headline, smaller subtext, accent border,
 * and a small "ÈKÓ AD" tag. Deterministic for a given input.
 */
export function drawBillboardCreative(
  ctx: CanvasRenderingContext2D,
  b: BillboardCreative,
  w = 512,
  h = 256
): void {
  const bg = b.bg || "#0f172a";
  const fg = b.fg || "#ffffff";
  const accent = b.accent || "#22d3ee";

  ctx.save();

  // Panel.
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Subtle diagonal accent sheen.
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = accent;
  const stripeW = w * 0.14;
  for (const off of [-0.08, 0.28, 0.64]) {
    const x0 = w * off;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0 + stripeW, 0);
    ctx.lineTo(x0 + stripeW - h * 0.35, h);
    ctx.lineTo(x0 - h * 0.35, h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Accent border.
  ctx.strokeStyle = accent;
  ctx.lineWidth = 10;
  ctx.strokeRect(7, 7, w - 14, h - 14);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // "ÈKÓ AD" tag, top-right.
  const tag = "ÈKÓ AD";
  ctx.font = SUB_FONT(20);
  const tagPadX = 14;
  const tagW = ctx.measureText(tag).width + tagPadX * 2;
  const tagH = 32;
  const tagX = w - 20 - tagW;
  const tagY = 20;
  ctx.fillStyle = accent;
  roundedRectPath(ctx, tagX, tagY, tagW, tagH, 9);
  ctx.fill();
  ctx.fillStyle = bg;
  ctx.textBaseline = "middle";
  ctx.fillText(tag, tagX + tagW / 2, tagY + tagH / 2 + 1);
  ctx.textBaseline = "alphabetic";

  // Headline — bold, up to 2 lines, shrink-to-fit on long words.
  const maxTextW = w - 72;
  let headPx = 46;
  ctx.font = HEADLINE_FONT(headPx);
  let headLines = wrapLines(ctx, b.headline, maxTextW, 2);
  if (headLines.length === 0) headLines = [" "];
  const widest = Math.max(...headLines.map((l) => ctx.measureText(l).width));
  if (widest > maxTextW && widest > 0) {
    headPx = Math.max(28, Math.floor(headPx * (maxTextW / widest)));
    ctx.font = HEADLINE_FONT(headPx);
  }
  ctx.fillStyle = fg;
  const headLineH = headPx + 8;
  const headBlockH = headLineH * headLines.length;
  const headTop = h * 0.46 - headBlockH / 2;
  headLines.forEach((ln, i) =>
    ctx.fillText(ln, w / 2, headTop + headLineH * i + headPx * 0.82)
  );

  // Accent underline bar.
  const barW = Math.min(w * 0.32, 170);
  const barY = headTop + headBlockH + 8;
  ctx.fillStyle = accent;
  ctx.fillRect(w / 2 - barW / 2, barY, barW, 6);

  // Subtext — smaller, up to 2 lines.
  const subLines = wrapLines(ctx, b.subtext || "", maxTextW, 2);
  if (subLines.length > 0) {
    ctx.font = SUB_FONT(26);
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = fg;
    const subLineH = 32;
    const subTop = barY + 26;
    subLines.forEach((ln, i) =>
      ctx.fillText(ln, w / 2, subTop + subLineH * i + 20)
    );
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}
