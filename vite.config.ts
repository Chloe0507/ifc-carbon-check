import { defineConfig } from "vite";

// base: "./" lets the built site run from any sub-path, e.g. GitHub Pages.
export default defineConfig({
  base: "./",
  build: { target: "es2022" },
});
