import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  test: {
    // 只收集单元测试；Playwright 用例走 test:e2e，避免被 vitest 误收集
    include: ["tests/**/*.test.ts"],
  },
});
