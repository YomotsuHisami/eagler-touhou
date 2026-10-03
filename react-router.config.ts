import type { Config } from '@react-router/dev/config';

/** Parallel SPA build. The legacy publisher is deliberately unchanged. */
export default {
  appDirectory: 'app',
  buildDirectory: '.cache/build/ui',
  ssr: false,
} satisfies Config;
