import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  base: process.env.VITE_BASE ?? (command === "serve" ? "/" : "/vibefinance/"),
  server: {
    port: 5173,
    proxy: {
      "/api": {target:process.env.VF_PROXY_TARGET ?? "http://localhost:8080",changeOrigin:false},
    },
  },
}));
