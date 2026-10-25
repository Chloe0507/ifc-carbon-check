// Copies the web-ifc WASM files and the fragments worker into public/,
// so the site never depends on a CDN at runtime.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/wasm", { recursive: true });
mkdirSync("public/worker", { recursive: true });
for (const f of ["web-ifc.wasm", "web-ifc-mt.wasm"]) {
  copyFileSync(`node_modules/web-ifc/${f}`, `public/wasm/${f}`);
}
copyFileSync(
  "node_modules/@thatopen/fragments/dist/Worker/worker.mjs",
  "public/worker/worker.mjs",
);
console.log("Copied web-ifc WASM and fragments worker into public/");
