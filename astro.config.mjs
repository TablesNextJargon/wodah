// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

import react from '@astrojs/react';
import tailwind from "@astrojs/tailwind";

// https://astro.build/config
export default defineConfig({
  devToolbar: { enabled: false },
  integrations: [react(), tailwind()],
  output: 'server',
  adapter: vercel(),
});
