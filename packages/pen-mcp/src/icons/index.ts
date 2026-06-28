import { configureMcpHooks, getMcpHooks } from '../hooks';
import { applyIconPathResolution, applyNoEmojiIconHeuristic } from './icon-resolver';

export { applyIconPathResolution, applyNoEmojiIconHeuristic } from './icon-resolver';
export { ICON_PATH_MAP, lookupIconByName, type IconEntry } from './icon-dictionary';

/**
 * Wire the bundled headless icon resolvers into the MCP hooks.
 * Call once at standalone server startup so file-mode / headless design
 * generation resolves icon names (e.g. "MailIcon") to real SVG paths.
 *
 * Merges with any existing hooks so a richer host (the web app) that has
 * already injected its own implementations is not clobbered.
 */
export function installIconHooks(): void {
  configureMcpHooks({
    ...getMcpHooks(),
    applyIconPathResolution,
    applyNoEmojiIconHeuristic,
  });
}
