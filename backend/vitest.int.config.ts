import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
  test: {
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['./vitest.int.setup.ts'],
    env: {
      DB_DATABASE: process.env.DB_TEST_DATABASE || 'SportHub_Test',
    },
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
