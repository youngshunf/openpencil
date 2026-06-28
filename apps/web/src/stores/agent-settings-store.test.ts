import { describe, it, expect, beforeEach } from 'vitest';
import {
  useAgentSettingsStore,
  HUANXING_PROVIDER_ID,
  type BuiltinProviderConfig,
} from './agent-settings-store';

function reset() {
  useAgentSettingsStore.setState({ builtinProviders: [] });
}

beforeEach(reset);

const userProvider: BuiltinProviderConfig = {
  id: 'bp-user',
  displayName: 'My OpenAI',
  type: 'openai-compat',
  apiKey: 'sk-user',
  model: 'gpt-4o',
  enabled: true,
};

describe('syncHuanxingDefaultProvider', () => {
  it('injects an env-backed 唤星 provider when available (empty key, enabled)', () => {
    useAgentSettingsStore
      .getState()
      .syncHuanxingDefaultProvider({ available: true, label: '唤星', model: 'agnes-2.0-flash' });
    const { builtinProviders } = useAgentSettingsStore.getState();
    const huanxing = builtinProviders.find((p) => p.id === HUANXING_PROVIDER_ID);
    expect(huanxing).toBeDefined();
    expect(huanxing?.envBacked).toBe(true);
    expect(huanxing?.apiKey).toBe('');
    expect(huanxing?.baseURL).toBe('');
    expect(huanxing?.model).toBe('agnes-2.0-flash');
    expect(huanxing?.enabled).toBe(true);
    expect(huanxing?.type).toBe('openai-compat');
  });

  it('stores the failover chain as models, excluding the primary + blanks/dupes', () => {
    useAgentSettingsStore.getState().syncHuanxingDefaultProvider({
      available: true,
      label: '唤星',
      model: 'agnes-2.0-flash',
      fallbackModels: ['agnes-2.0-flash', 'deepseek-v4-flash', '  ', 'qwen3.7-plus', 'deepseek-v4-flash'],
    });
    const huanxing = useAgentSettingsStore
      .getState()
      .builtinProviders.find((p) => p.id === HUANXING_PROVIDER_ID);
    // primary excluded, blank dropped, dupe collapsed once (store trims + dedupes + drops model).
    expect(huanxing?.models).toEqual(['deepseek-v4-flash', 'qwen3.7-plus']);
  });

  it('defaults models to empty when no failover chain is provided', () => {
    useAgentSettingsStore
      .getState()
      .syncHuanxingDefaultProvider({ available: true, label: '唤星', model: 'm' });
    const huanxing = useAgentSettingsStore
      .getState()
      .builtinProviders.find((p) => p.id === HUANXING_PROVIDER_ID);
    expect(huanxing?.models).toEqual([]);
  });

  it('falls back to 唤星 label when none provided', () => {
    useAgentSettingsStore
      .getState()
      .syncHuanxingDefaultProvider({ available: true, label: '', model: 'm' });
    const huanxing = useAgentSettingsStore
      .getState()
      .builtinProviders.find((p) => p.id === HUANXING_PROVIDER_ID);
    expect(huanxing?.displayName).toBe('唤星');
  });

  it('is idempotent — never duplicates the 唤星 provider', () => {
    const sync = useAgentSettingsStore.getState().syncHuanxingDefaultProvider;
    sync({ available: true, label: '唤星', model: 'm1' });
    sync({ available: true, label: '唤星', model: 'm2' });
    const huanxing = useAgentSettingsStore
      .getState()
      .builtinProviders.filter((p) => p.id === HUANXING_PROVIDER_ID);
    expect(huanxing).toHaveLength(1);
    expect(huanxing[0]?.model).toBe('m2');
  });

  it('removes a stale 唤星 provider when no longer available', () => {
    const sync = useAgentSettingsStore.getState().syncHuanxingDefaultProvider;
    sync({ available: true, label: '唤星', model: 'm' });
    sync({ available: false, label: '', model: '' });
    expect(
      useAgentSettingsStore.getState().builtinProviders.some((p) => p.id === HUANXING_PROVIDER_ID),
    ).toBe(false);
  });

  it('preserves user-added providers when reconciling', () => {
    useAgentSettingsStore.setState({ builtinProviders: [userProvider] });
    useAgentSettingsStore
      .getState()
      .syncHuanxingDefaultProvider({ available: true, label: '唤星', model: 'm' });
    const { builtinProviders } = useAgentSettingsStore.getState();
    expect(builtinProviders.some((p) => p.id === 'bp-user')).toBe(true);
    expect(builtinProviders.some((p) => p.id === HUANXING_PROVIDER_ID)).toBe(true);

    // Becoming unavailable drops only 唤星, keeps the user provider.
    useAgentSettingsStore
      .getState()
      .syncHuanxingDefaultProvider({ available: false, label: '', model: '' });
    const after = useAgentSettingsStore.getState().builtinProviders;
    expect(after.some((p) => p.id === 'bp-user')).toBe(true);
    expect(after.some((p) => p.id === HUANXING_PROVIDER_ID)).toBe(false);
  });
});
