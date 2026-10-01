import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        codeSplitting: false,
        entryFileNames: "react-app.js",
        assetFileNames: "react-app.[ext]",
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8793",
        changeOrigin: true,
        configure(proxy) {
          // Local dev only: map only the known Vite origin. Foreign origins stay
          // intact and are rejected by Python. This is not used in the pilot.
          proxy.on("proxyReq", (request, incoming) => {
            if (
              ["http://127.0.0.1:5173", "http://localhost:5173"].includes(
                incoming.headers.origin || "",
              )
            ) {
              request.setHeader("Origin", "http://127.0.0.1:8793");
            }
          });
        },
      },
    },
  },
});
