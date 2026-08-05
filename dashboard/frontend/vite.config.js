import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dashboard runs on 5174 so it never clashes with the main SaveSmart app
// (5173). /api is proxied to the Plaid backend on 5100.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5100",
        changeOrigin: true,
      },
    },
  },
});
