import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('migrations');
  return {
    plugins: [
      cloudflareTest({
        remoteBindings: false,
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ACCESS_AUD: 'aud-teste',
            ACCESS_EQUIPE: 'https://equipe-teste.cloudflareaccess.com',
            TRILHA_COMMON_NAME: 'trilha-teste.access',
          },
        },
      }),
    ],
    test: {
      include: ['test/**/*.test.js'],
      setupFiles: ['./test/setup.js'],
    },
  };
});
