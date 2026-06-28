import { useAgentSettingsStore } from '@/stores/agent-settings-store';

/** Shape returned by the server `GET /api/ai/huanxing-default` endpoint. */
export interface HuanxingDefaultInfo {
  available: boolean;
  label: string;
  model: string;
}

/**
 * Fetch the host-runtime 唤星 (Huanxing) default-provider status.
 *
 * The hasn-node daemon injects the current owner's Huanxing LLM credentials into the web
 * sidecar's env; this endpoint reports availability + label + model WITHOUT exposing the key.
 * Network/parse failures resolve to `{ available: false }` (treated as "not configured").
 */
export async function fetchHuanxingDefault(): Promise<HuanxingDefaultInfo> {
  try {
    const res = await fetch('/api/ai/huanxing-default');
    if (!res.ok) return { available: false, label: '', model: '' };
    const data = (await res.json()) as Partial<HuanxingDefaultInfo>;
    return {
      available: data.available === true,
      label: typeof data.label === 'string' ? data.label : '',
      model: typeof data.model === 'string' ? data.model : '',
    };
  } catch {
    return { available: false, label: '', model: '' };
  }
}

/**
 * Reconcile the env-backed 唤星 built-in provider into the agent-settings store, then persist.
 * Idempotent: re-running with the same availability is a no-op. When the daemon injected
 * credentials (`available`), the editor's built-in AI works out of the box (走主人积分).
 */
export async function syncHuanxingDefaultProvider(): Promise<HuanxingDefaultInfo> {
  const info = await fetchHuanxingDefault();
  const store = useAgentSettingsStore.getState();
  store.syncHuanxingDefaultProvider(info);
  store.persist();
  return info;
}
