/**
 * Schema-profile resolution (note.md item 6) — the view half of the per-deployment
 * `SchemaProfile`.
 *
 * The profile itself is plain data (`{ allowedGroups }`) carried opaquely on the store
 * (`EditorStoreOptions.schemaProfile`, core). *Interpreting* it — mapping a node type to
 * its schema group and deciding whether the group is allowed — is a view concern,
 * because groups live on the view registries (`NodeView.schemaGroup` /
 * `StructuralNodeView.schemaGroup`). This module is the single place that joins the two:
 * core never reads a group string, the view never owns the profile data.
 *
 * Two enforcement points consume `isNodeTypeAllowed` over the *same* group set:
 *
 * - the **palette gate** (insert time) — `registryCommands` / the ribbon's `resolveInsert`
 *   drop an out-of-profile insert affordance, so the author cannot add the type; and
 * - the **render gate** (load/round-trip time) — `EngineBlock` renders an out-of-profile
 *   node that is *already* in a loaded document as an inert quarantine placeholder rather
 *   than deleting it. Quarantine, not deletion, is deliberate: the editor never destroys
 *   author content it did not create (the snapshot round-trips untouched); the server's
 *   Zod union (docs/006 §2.7) stays the hard authority that rejects on write.
 *
 * The unit is the **group**, not the type, so a family of node types toggles coherently:
 * `table`/`table-row`/`table-cell` all declare group `"table"`, so "tables off" can never
 * leave a profile in the incoherent state of "table allowed, table-cell disallowed".
 */
import type { SchemaProfile } from "../../core";
import { getNodeView } from "./node-view";
import { getStructuralView } from "./structural-view";

/**
 * The schema group a node type belongs to, from whichever registry owns it (object or
 * structural), or undefined when the type declares no group. An undefined group means
 * the type is part of the prose floor (paragraph/heading/quote/list) or simply opts out
 * of profile gating, and is therefore always permitted.
 */
export function schemaGroupOf(type: string): string | undefined {
  return getNodeView(type)?.schemaGroup ?? getStructuralView(type)?.schemaGroup;
}

/**
 * Whether a node type is permitted under a schema profile (note.md item 6).
 *
 * - No profile (or no `allowedGroups`) → everything is permitted (the backward-compatible
 *   default, so an editor with no profile behaves exactly as before).
 * - An ungrouped type (the prose floor, or a node that declared no group) → always
 *   permitted; the profile only ever makes deliberate calls about *grouped* nodes
 *   (owned blocks like tables, and the exposed reference collections).
 * - A grouped type → permitted iff its group is in the allowlist.
 */
export function isNodeTypeAllowed(
  profile: SchemaProfile | undefined,
  type: string,
): boolean {
  const allowed = profile?.allowedGroups;
  if (!allowed) return true;
  const group = schemaGroupOf(type);
  if (group === undefined) return true;
  return allowed.includes(group);
}
