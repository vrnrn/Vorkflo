import type { VorkfloBridge } from '../../shared/contracts';

declare global {
  const __VORKFLO_VERSION__: string;
  interface Window {
    vorkflo: VorkfloBridge;
  }
}

export {};
