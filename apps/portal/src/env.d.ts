/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Which portals this build contains: `investor`, `staff`, or `all` (demo). */
  readonly VITE_PORTAL: 'investor' | 'staff' | 'all';
  /** Shows the demo controls (portal switch, acting-as, sample PIN hint). */
  readonly VITE_DEMO: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
