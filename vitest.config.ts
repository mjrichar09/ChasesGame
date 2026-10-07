import { defineConfig } from 'vitest/config';

// The sim tests run real races; CI runners are slower than a dev machine, so
// the 5 s default is too tight for any of them.
export default defineConfig({
  test: { testTimeout: 60_000 },
});
