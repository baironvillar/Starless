/// <reference types="vite/client" />

/** Injected from package.json by vite.config.ts. Mirrors tauri.conf.json. */
declare const __APP_VERSION__: string;

/**
 * Injected from STARLESS_CHANNEL by vite.config.ts: "develop" or "release".
 */
declare const __STARLESS_CHANNEL__: string;

/**
 * Injected from TAURI_ENV_PLATFORM by vite.config.ts: true for Android and iOS.
 */
declare const __STARLESS_MOBILE__: boolean;
