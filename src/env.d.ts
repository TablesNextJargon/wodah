/// <reference types="astro/client" />

interface Window {
  gtag?: (
    command: 'config' | 'event',
    name: string,
    parameters: Record<string, unknown>,
  ) => void;
}
