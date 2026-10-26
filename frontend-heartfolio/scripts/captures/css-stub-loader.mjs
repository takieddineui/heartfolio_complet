/**
 * Node loader hook for `export-samples.ts`: the Studio modules it imports
 * pull in their theme components, whose CSS modules Node cannot load. The
 * sample data needs none of it, so every `.css` import becomes an empty
 * class map. Registered with `node --import ./scripts/captures/css-stub-loader.mjs`.
 */
import { registerHooks } from "node:module";

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) {
      return {
        format: "module",
        shortCircuit: true,
        source: "export default new Proxy({}, { get: (_, key) => String(key) });",
      };
    }
    return nextLoad(url, context);
  },
});
