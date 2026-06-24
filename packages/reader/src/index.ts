/**
 * Public surface of `@quanghuy1242/idco-reader` — the server-native read tier
 * (docs/015).
 *
 * This is the server-safe entry (`.`): the L1 presentational primitives, the typography
 * class contract, and the server `<Reader>` + projection adapter. It carries no
 * `"use client"` and pulls no client runtime, so a React Server Component host can import
 * it directly. The opt-in client islands live behind the separate `./islands` entry, so
 * importing the reader never drags island JavaScript into a server bundle (docs/015 §7.3).
 */

// L1 presentational primitives + the `.rt-*` typography class contract (the single source
// of block/mark appearance shared with the editor's resting render and live host, §4.3).
export * from "./l1";

// The server Reader + projection adapter types (server-safe; no island/client import).
export * from "./reader";
