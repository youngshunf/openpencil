// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { huanxingProjectId, isHuanxingProjectContext } from '../huanxing-context';

function setSearch(search: string): void {
  window.history.replaceState({}, '', `/editor${search}`);
}

describe('huanxing-context', () => {
  afterEach(() => {
    setSearch('');
  });

  it('detects huanxing project context when ?project= is present', () => {
    setSearch('?project=proj_abc123');
    expect(huanxingProjectId()).toBe('proj_abc123');
    expect(isHuanxingProjectContext()).toBe(true);
  });

  it('treats standalone OpenPencil (no ?project=) as non-huanxing', () => {
    setSearch('');
    expect(huanxingProjectId()).toBeNull();
    expect(isHuanxingProjectContext()).toBe(false);
  });

  it('ignores an empty or whitespace-only project id', () => {
    setSearch('?project=');
    expect(huanxingProjectId()).toBeNull();
    expect(isHuanxingProjectContext()).toBe(false);

    setSearch('?project=%20%20');
    expect(huanxingProjectId()).toBeNull();
    expect(isHuanxingProjectContext()).toBe(false);
  });

  it('coexists with other query params', () => {
    setSearch('?foo=1&project=proj_xyz&bar=2');
    expect(huanxingProjectId()).toBe('proj_xyz');
    expect(isHuanxingProjectContext()).toBe(true);
  });
});
