/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL, e.g. https://xxxx.supabase.co — optional; app falls back to localStorage. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon/publishable key — safe to expose to the browser (RLS enforces access). */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Owner-reflections passcode gate. Ships inside the JS bundle like any other VITE_* var — a speed bump, not real security. Defaults to "1234" if unset. */
  readonly VITE_OWNER_PIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
