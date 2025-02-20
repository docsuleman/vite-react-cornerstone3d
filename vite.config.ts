import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { viteCommonjs } from "@originjs/vite-plugin-commonjs"
import wasm from "vite-plugin-wasm"
import topLevelAwait from "vite-plugin-top-level-await"

/**
 * Vite configuration for the application.
 *
 * @remarks
 * This configuration is mostly standard Vite + React setup, with specific accommodations for:
 * - WASM decoders used by Cornerstone libraries
 * - DICOM parser which currently uses CommonJS format (planned migration to ESM)
 *
 * @description
 * Key configuration points:
 * - Uses vite-plugin-commonjs to handle the DICOM parser's CommonJS format
 * - Configures worker format as ES modules
 * - Excludes Cornerstone CODEC packages from dependency optimization to handle WASM properly
 * - Explicitly includes dicom-parser in optimization
 * - Ensures WASM files are properly handled as assets
 *
 * @example
 * To use additional WASM decoders, add them to the optimizeDeps.exclude array:
 * ```ts
 * optimizeDeps: {
 *   exclude: [
 *     "@cornerstonejs/codec-new-decoder",
 *     // ... existing codecs
 *   ]
 * }
 * ```
 */
export default defineConfig({
  // assetsInclude: ["**/*.wasm"],
  plugins: [
    react(),
    // for dicom-parser
    viteCommonjs(),
    wasm(),
    // topLevelAwait(),
  ],
  // seems like only required in dev mode
  optimizeDeps: {
    exclude: ["@cornerstonejs/dicom-image-loader", "@cornerstonejs/tools"],
    include: ["dicom-parser", "xmlbuilder2"],
  },
  worker: {
    format: "es",
    rollupOptions: {
      external: ["@icr/polyseg-wasm"],
    },
    // plugins: () => [wasm(), topLevelAwait()],
  },
})
