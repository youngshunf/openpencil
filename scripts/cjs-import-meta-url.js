// esbuild inject shim: provide a CJS-safe `import.meta.url` for our CJS bundles.
//
// When we bundle to `--format=cjs` and `--define:import.meta.env={}`, esbuild stops
// applying its built-in node shim for `import.meta.url` and materializes `import.meta`
// as an empty object — so `import.meta.url` becomes `undefined`. Any module that does
// `createRequire(import.meta.url)` / `fileURLToPath(import.meta.url)` at load time then
// throws `ERR_INVALID_ARG_VALUE` and crashes the process (e.g. pen-mcp's
// `render/canvaskit-node.ts`, which killed the packaged MCP sidecar on Windows/Bun).
//
// Paired with `--define:import.meta.url=importMetaUrl`, this restores a real file URL
// (`file://…/out/mcp-server.cjs`) at runtime. In CJS output `require`/`__filename` are
// available; `pathToFileURL(__filename)` yields the bundle's own URL, which is a valid
// base for `createRequire` and `fileURLToPath`.
export const importMetaUrl = require('node:url').pathToFileURL(__filename).href;
