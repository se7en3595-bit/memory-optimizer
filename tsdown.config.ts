import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: './scripts/index.ts',
  outDir: './dist',
  format: ['es'],
  target: 'es2020',
  sourcemap: true,
  minify: false,
  bundle: false,  // 不打包，保持原文件结构
  external: [],   // 不排除任何外部依赖（假设牛马AI环境已提供类型）
});