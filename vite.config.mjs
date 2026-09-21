import { defineConfig } from "vite";
import legacy from "@vitejs/plugin-legacy";

export default defineConfig({
  plugins: [
    legacy({
      targets: ["defaults", "ios >= 12", "safari >= 12"],
      modernPolyfills: true,
    }),
  ],
});
