import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __VORKFLO_VERSION__: JSON.stringify(
      JSON.parse(
        readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
      ).version,
    ),
  },
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
