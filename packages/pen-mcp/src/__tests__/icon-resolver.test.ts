import { describe, it, expect } from 'vitest';
import type { PathNode, TextNode, PenNode } from '@zseven-w/pen-types';
import {
  applyIconPathResolution,
  applyNoEmojiIconHeuristic,
  ICON_PATH_MAP,
  lookupIconByName,
} from '../icons';

const PLACEHOLDER = 'M0 0';

function iconPath(name: string, extra: Partial<PathNode> = {}): PathNode {
  return { id: name, type: 'path', name, d: PLACEHOLDER, ...extra };
}

describe('applyIconPathResolution', () => {
  it('resolves a stroke icon name to verified path + stroke style', () => {
    const node = iconPath('MailIcon');
    applyIconPathResolution([node]);
    expect(node.d).not.toBe(PLACEHOLDER);
    expect(node.d).toBe(ICON_PATH_MAP['mail'].d);
    expect(node.iconId).toBe('lucide:mail');
    // Stroke icons must carry a renderable stroke and no opaque fill.
    expect(node.stroke?.thickness).toBeGreaterThan(0);
    expect(node.fill ?? []).toHaveLength(0);
  });

  it('resolves a fill icon (star) and keeps the fill', () => {
    const node = iconPath('StarIcon', { fill: [{ type: 'solid', color: '#FFFFFF' }] });
    applyIconPathResolution([node]);
    expect(node.d).toBe(ICON_PATH_MAP['star'].d);
    expect(node.fill?.[0]).toMatchObject({ type: 'solid', color: '#FFFFFF' });
  });

  it('resolves lock and eye (login form icons)', () => {
    const lock = iconPath('LockIcon');
    const eye = iconPath('EyeIcon');
    applyIconPathResolution([lock, eye]);
    expect(lock.d).toBe(ICON_PATH_MAP['lock'].d);
    expect(eye.d).toBe(ICON_PATH_MAP['eye'].d);
  });

  it('resolves a brand/social logo from Simple Icons (fill)', () => {
    const wechat = iconPath('WechatIcon', { fill: [{ type: 'solid', color: '#07C160' }] });
    applyIconPathResolution([wechat]);
    expect(wechat.iconId).toBe('simple-icons:wechat');
    expect(wechat.d).not.toBe(PLACEHOLDER);
    expect(wechat.fill?.[0]).toMatchObject({ color: '#07C160' });
  });

  it('leaves real custom geometry (no icon marker) untouched', () => {
    const chart = iconPath('Heart Rate Chart', { d: 'M0 10 L10 0 L20 10' });
    const before = chart.d;
    applyIconPathResolution([chart]);
    expect(chart.d).toBe(before);
    expect(chart.iconId).toBeUndefined();
  });

  it('falls back to a circle for an icon-like name with no dictionary hit', () => {
    const node = iconPath('SomeNonexistentThingIcon');
    applyIconPathResolution([node]);
    expect(node.d).toBe(ICON_PATH_MAP['circle'].d);
  });

  it('ignores non-path nodes', () => {
    const text: TextNode = { id: 't', type: 'text', name: 'Label', content: 'Hello' };
    expect(() => applyIconPathResolution([text as PenNode])).not.toThrow();
    expect(text.content).toBe('Hello');
  });
});

describe('applyNoEmojiIconHeuristic', () => {
  it('strips emoji from mixed text, keeping the words', () => {
    const node: TextNode = { id: 't1', type: 'text', name: 'T', content: '登录 🔒 安全' };
    applyNoEmojiIconHeuristic([node]);
    expect(node.content).toBe('登录 安全');
  });

  it('converts an emoji-only text node into a circle path icon', () => {
    const node = { id: 't2', type: 'text', name: 'Lock', content: '🔒' } as PenNode;
    applyNoEmojiIconHeuristic([node]);
    expect((node as PathNode).type).toBe('path');
    expect((node as PathNode).d).toBe(ICON_PATH_MAP['circle'].d);
  });

  it('leaves plain text untouched', () => {
    const node: TextNode = { id: 't3', type: 'text', name: 'T', content: 'No emoji here' };
    applyNoEmojiIconHeuristic([node]);
    expect(node.content).toBe('No emoji here');
    expect(node.type).toBe('text');
  });
});

describe('lookupIconByName', () => {
  it('resolves with icon-set prefix and separators stripped', () => {
    expect(lookupIconByName('lucide:mail')?.iconId).toBe('lucide:mail');
    expect(lookupIconByName('arrow-right')?.iconId).toBe('lucide:arrow-right');
    expect(lookupIconByName('UnknownGibberishXYZ')).toBeNull();
  });
});
