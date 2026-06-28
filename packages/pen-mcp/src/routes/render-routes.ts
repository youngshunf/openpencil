import type { ToolContent } from '../server';
import { handleRenderPng, type RenderPngParams } from '../tools/render-png';

/**
 * RENDER MCP tools — always available (not gated behind --debug).
 *
 * `render_png` rasterizes a saved .op file to a PNG headlessly (CPU surface, no
 * live canvas required), so an Agent that drew a design with no editor open can
 * still produce a real PNG preview/artifact of its work.
 */
export const RENDER_TOOL_DEFINITIONS = [
  {
    name: 'render_png',
    description:
      'Render a saved .op design file to a PNG image file, headlessly (no live ' +
      'canvas/editor needed). Use this to produce a real preview/export of a design ' +
      'after editing it with the design tools. Renders the whole document by default, ' +
      'or one node subtree via rootId. Writes <doc>.png next to the .op unless output ' +
      'is given, and returns the written path and pixel size. For a live, focused ' +
      'editor canvas use debug_screenshot instead.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the .op file. Omit to use the current resolved document path.',
        },
        output: {
          type: 'string',
          description: 'Output PNG path. Omit to write <doc-stem>.png next to the .op file.',
        },
        rootId: {
          type: 'string',
          description: 'Render only this node subtree (by id). Omit for the whole document.',
        },
        pageId: {
          type: 'string',
          description: 'Page id for multi-page documents. Omit to use all top-level children.',
        },
        scale: {
          type: 'number',
          description: 'Output device-pixel scale (default 2 for retina-quality).',
        },
        background: {
          type: 'string',
          description:
            'Background fill as hex (#RRGGBB or #RRGGBBAA), or "transparent". Default #FFFFFF.',
        },
        padding: {
          type: 'number',
          description: 'Logical-pixel padding around the content bounds (default 0).',
        },
        returnBase64: {
          type: 'boolean',
          description: 'Also return the PNG as a base64 string in the result (default false).',
        },
      },
      required: [],
    },
  },
] as const;

export const RENDER_TOOL_NAMES: ReadonlySet<string> = new Set(
  RENDER_TOOL_DEFINITIONS.map((t) => t.name),
);

export async function handleRenderToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string | ToolContent[]> {
  switch (name) {
    case 'render_png': {
      const result = await handleRenderPng(args as unknown as RenderPngParams);
      return JSON.stringify(result, null, 2);
    }
    default:
      throw new Error(`Unknown render tool: ${name}`);
  }
}
