import type { PenNode, PathNode, PenFill, PenStroke, SizingBehavior } from '@zseven-w/pen-types';
import {
  ICON_PATH_MAP,
  findPrefixFallback,
  findSubstringFallback,
  type IconEntry,
} from './icon-dictionary';

// ---------------------------------------------------------------------------
// Headless icon resolution hooks for pen-mcp.
//
// These mirror the web app's icon resolver but run WITHOUT a browser or
// network: every icon name is resolved against the bundled Iconify
// dictionary synchronously. There is no async Iconify-API fallback queue —
// on a dictionary miss for an icon-like name we drop in a neutral circle so
// the output is a recognizable shape rather than a leftover placeholder box.
// ---------------------------------------------------------------------------

const ICON_MARKER_WORDS = new Set(['icon', 'logo', 'symbol', 'glyph']);

/**
 * The `path` type is also used for legitimate custom geometry (chart lines,
 * progress arcs, sparklines). We only resolve path nodes whose NAME clearly
 * signals "this is an icon" — an exact word hit on icon/logo/symbol/glyph
 * after splitting on camelCase / space / dash / underscore.
 */
function hasExplicitIconMarker(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_-]+/);
  return words.some((word) => ICON_MARKER_WORDS.has(word));
}

function isOverlyGenericFallbackName(normalized: string): boolean {
  return (
    normalized === 'icon' ||
    /^wc\d+$/.test(normalized) ||
    /^tab[a-z0-9]+$/.test(normalized) ||
    /^nav[a-z0-9]+$/.test(normalized) ||
    /^item\d+$/.test(normalized) ||
    /^section\d+$/.test(normalized)
  );
}

// --- Small style helpers (ported inline; no web `generation-utils` dep) -----

function extractPrimaryColor(fill: unknown): string | null {
  if (!Array.isArray(fill) || fill.length === 0) return null;
  const first = fill[0];
  if (!first || typeof first !== 'object') return null;
  const solid = first as { type?: string; color?: string };
  if (solid.type !== 'solid') return null;
  return solid.color ?? null;
}

function toStrokeThicknessNumber(stroke: PenStroke | undefined, fallback: number): number {
  if (!stroke) return fallback;
  const t = stroke.thickness;
  if (typeof t === 'number' && Number.isFinite(t)) return t;
  if (Array.isArray(t) && t.length > 0 && Number.isFinite(t[0])) return t[0];
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toSizeNumber(size: SizingBehavior | undefined, fallback: number): number {
  return typeof size === 'number' && Number.isFinite(size) ? size : fallback;
}

/** Apply stroke/fill styling to a resolved icon node. */
function applyIconStyle(node: PathNode, style: 'stroke' | 'fill'): void {
  if (style === 'stroke') {
    const existingColor =
      extractPrimaryColor(node.fill) ?? extractPrimaryColor(node.stroke?.fill) ?? '#64748B';
    const strokeWidth = toStrokeThicknessNumber(node.stroke, 0);
    const strokeColor = extractPrimaryColor(node.stroke?.fill);
    if (!node.stroke || strokeWidth <= 0 || !strokeColor) {
      node.stroke = {
        thickness: strokeWidth > 0 ? strokeWidth : 2,
        fill: [{ type: 'solid', color: existingColor }],
      };
    }
    // Line icons should not carry an opaque fill (would blot out the strokes).
    if (node.fill && node.fill.length > 0) {
      const fillColor = extractPrimaryColor(node.fill);
      if (fillColor && node.stroke) {
        node.stroke.fill = [{ type: 'solid', color: fillColor }];
      }
      node.fill = [];
    }
  } else {
    const fillColor =
      extractPrimaryColor(node.fill) ?? extractPrimaryColor(node.stroke?.fill) ?? '#64748B';
    node.fill = [{ type: 'solid', color: fillColor }];
    if (node.stroke && toStrokeThicknessNumber(node.stroke, 0) <= 0) {
      node.stroke = undefined;
    }
  }
}

/**
 * Resolve a single path node's icon name → verified SVG `d`.
 * Only runs on path nodes carrying an explicit icon/logo/symbol/glyph marker.
 */
function resolveIconNode(node: PenNode): void {
  if (node.type !== 'path') return;
  const path = node as PathNode;

  const originalName = path.name ?? path.id ?? '';
  if (!hasExplicitIconMarker(originalName)) return;

  const rawName = originalName
    .toLowerCase()
    .replace(/[-_\s]+/g, '')
    .replace(/(icon|logo|symbol|glyph)$/, '');

  let match: IconEntry | undefined = ICON_PATH_MAP[rawName];
  if (!match) {
    const prefixKey = findPrefixFallback(rawName);
    if (prefixKey) match = ICON_PATH_MAP[prefixKey];
  }
  if (!match) {
    const suffixKey = findSubstringFallback(rawName);
    if (suffixKey) match = ICON_PATH_MAP[suffixKey];
  }

  if (!match) {
    // Neutral circle fallback for icon-like names (no async API queue headless).
    const queueName = rawName || originalName.toLowerCase().replace(/[-_\s]+/g, '');
    if (queueName.length > 0 && queueName.length <= 30 && !isOverlyGenericFallbackName(queueName)) {
      const circle = ICON_PATH_MAP['circle'];
      if (circle) {
        path.d = circle.d;
        path.iconId = circle.iconId;
        applyIconStyle(path, circle.style);
      }
    }
    return;
  }

  path.d = match.d;
  path.iconId = match.iconId ?? `lucide:${rawName}`;
  applyIconStyle(path, match.style);
}

// ---------------------------------------------------------------------------
// Emoji-in-text heuristic
// ---------------------------------------------------------------------------

const EMOJI_REGEX = /[\p{Extended_Pictographic}\p{Emoji_Presentation}️]/gu;

/**
 * Strip emoji from a text node. If the content is ENTIRELY emoji (nothing left
 * after stripping), convert the node into a fallback circle path icon in-place.
 */
function applyEmojiHeuristic(node: PenNode): void {
  if (node.type !== 'text') return;
  if (typeof node.content !== 'string' || !node.content) return;

  EMOJI_REGEX.lastIndex = 0;
  if (!EMOJI_REGEX.test(node.content)) return;
  EMOJI_REGEX.lastIndex = 0;

  const cleaned = node.content
    .replace(EMOJI_REGEX, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (cleaned.length > 0) {
    node.content = cleaned;
    return;
  }

  const iconSize = clamp(
    toSizeNumber(node.height, toSizeNumber(node.width, node.fontSize ?? 20)),
    14,
    24,
  );
  const iconFill = extractPrimaryColor(node.fill) ?? '#64748B';
  const circle = ICON_PATH_MAP['circle'];
  const stroke: PenStroke | undefined =
    circle?.style === 'stroke'
      ? { thickness: 2, fill: [{ type: 'solid', color: iconFill }] }
      : undefined;
  const fill: PenFill[] =
    circle?.style === 'stroke' ? [] : [{ type: 'solid', color: iconFill }];

  const replacement: PathNode = {
    id: node.id,
    type: 'path',
    name: `${node.name ?? 'Icon'} Path`,
    d: circle?.d ?? 'M 2 12 a 10 10 0 1 0 20 0 a 10 10 0 1 0 -20 0 Z',
    width: iconSize,
    height: iconSize,
    stroke,
    fill,
  };
  if (typeof node.x === 'number') replacement.x = node.x;
  if (typeof node.y === 'number') replacement.y = node.y;
  if (typeof node.opacity === 'number') replacement.opacity = node.opacity;
  if (typeof node.rotation === 'number') replacement.rotation = node.rotation;

  const targetRecord = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(node)) delete targetRecord[key];
  Object.assign(targetRecord, replacement as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Hook entry points (array form — matches McpHooks signature)
// ---------------------------------------------------------------------------

/** Resolve icon name → SVG path on each path node in `nodes`. */
export function applyIconPathResolution(nodes: PenNode[]): void {
  for (const node of nodes) resolveIconNode(node);
}

/** Strip/convert emoji on each text node in `nodes`. */
export function applyNoEmojiIconHeuristic(nodes: PenNode[]): void {
  for (const node of nodes) applyEmojiHeuristic(node);
}
