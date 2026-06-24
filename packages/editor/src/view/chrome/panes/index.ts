/**
 * Barrel for the dock pane components (docs/027 §8, §9).
 *
 * A pane is a workspace body the side-panel dock renders for a registered
 * `SidePanel`. Panes live here (not under `surfaces/`, which holds the command-surface
 * hosts) and read the SPI registries / the read-side document index, dispatching store
 * commands like the rest of the chrome. Registration of the built-in panes happens in
 * `surfaces/command-builtins` alongside the tabs/slots/commands.
 */
export * from "./outline-pane";
export * from "./statistics-pane";
export * from "./text-stats";
export * from "./glossary";
export * from "./glossary-pane";
export * from "./comments";
export * from "./comments-pane";
export * from "./accessibility";
export * from "./broken-refs";
export * from "./health-panes";
