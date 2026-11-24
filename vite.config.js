import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  server: { port: 5173 },
  build: {
    rollupOptions: {
      // 여러 페이지(멀티 페이지) 빌드 설정
      input: {
        main: resolve(__dirname, "index.html"),
        student: resolve(__dirname, "student.html"),
        teacher: resolve(__dirname, "teacherMonitor.html"),
      },
    },
  },
});
