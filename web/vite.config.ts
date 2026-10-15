import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  // Hosted in the profile site's folder, not under the review repository name.
  base: process.env.VITE_BASE ?? (command === "serve" ? "/" : "/vibefinance/"),
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
}));
