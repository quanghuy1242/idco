/**
 * Vendored EditContext polyfill adapter.
 *
 * The implementation below is based on `@neftaly/editcontext-polyfill`, but the
 * adapter deliberately installs only the EditContext globals, element binding,
 * hidden textarea, and input/state translator. The engine engine paints its
 * own caret/selection, so we do not install upstream's selection renderer or
 * execCommand interception layer here.
 */

import { EditContextPolyfill } from "./edit-context";
import {
  installEditContextProperty,
  uninstallEditContextProperty,
} from "./element-binding";
import {
  CharacterBoundsUpdateEventPolyfill,
  TextFormatPolyfill,
  TextFormatUpdateEventPolyfill,
  TextUpdateEventPolyfill,
} from "./event-types";
import {
  destroyAllBindings,
  syncElementFromEditContext,
} from "./focus-manager";

export { EditContextPolyfill as EditContext } from "./edit-context";
export {
  CharacterBoundsUpdateEventPolyfill,
  TextFormatPolyfill,
  TextFormatUpdateEventPolyfill,
  TextUpdateEventPolyfill,
} from "./event-types";

export interface InstallOptions {
  readonly force?: boolean;
  readonly target?: Record<string, unknown>;
}

export interface InstallResult {
  readonly installed: boolean;
  readonly native: boolean;
}

type MaybePolyfilledEditContextConstructor = Function & {
  readonly isIdcoPolyfill?: boolean;
};

const POLYFILL_GLOBALS: Record<string, unknown> = {
  EditContext: EditContextPolyfill,
  TextUpdateEvent: TextUpdateEventPolyfill,
  TextFormatUpdateEvent: TextFormatUpdateEventPolyfill,
  CharacterBoundsUpdateEvent: CharacterBoundsUpdateEventPolyfill,
  TextFormat: TextFormatPolyfill,
};

const installedTargets = new Map<
  Record<string, unknown>,
  Record<string, unknown>
>();
let forcedInstallCount = 0;
let forcedGlobalTarget: Record<string, unknown> | null = null;

function isPolyfilledConstructor(value: unknown): boolean {
  return (
    typeof value === "function" &&
    (value as MaybePolyfilledEditContextConstructor).isIdcoPolyfill === true
  );
}

export function install(options: InstallOptions = {}): InstallResult {
  const target = options.target ?? (globalThis as Record<string, unknown>);
  const force = options.force === true;
  const existing = target.EditContext;
  const hasNative =
    typeof existing === "function" && !isPolyfilledConstructor(existing);

  if (!force && hasNative) {
    return { installed: false, native: true };
  }

  if (!installedTargets.has(target)) {
    const previousGlobals: Record<string, unknown> = {};
    for (const [name, implementation] of Object.entries(POLYFILL_GLOBALS)) {
      previousGlobals[name] = target[name];
      target[name] = implementation;
    }
    installedTargets.set(target, previousGlobals);
    if (installedTargets.size === 1) installEditContextProperty();
  }

  if (force) {
    forcedInstallCount += 1;
    forcedGlobalTarget = target;
  }

  return { installed: true, native: hasNative };
}

export function releaseForcedInstall(): void {
  if (forcedInstallCount === 0) return;
  forcedInstallCount -= 1;
  if (forcedInstallCount > 0) return;
  uninstall(forcedGlobalTarget ?? (globalThis as Record<string, unknown>));
  forcedGlobalTarget = null;
}

export function uninstall(
  target: Record<string, unknown> = globalThis as Record<string, unknown>,
): void {
  const previousGlobals = installedTargets.get(target);
  if (!previousGlobals) return;
  for (const name of Object.keys(POLYFILL_GLOBALS)) {
    if (previousGlobals[name] === undefined) {
      delete target[name];
    } else {
      target[name] = previousGlobals[name];
    }
  }
  installedTargets.delete(target);
  if (installedTargets.size === 0) {
    destroyAllBindings();
    uninstallEditContextProperty();
  }
}

export function syncPolyfillSelection(host: Element): void {
  if (host instanceof HTMLElement) {
    syncElementFromEditContext(host);
  }
}
