#!/usr/bin/env node
// @ts-check
/**
 * gen-api-map — generate a small, cross-linked API map from a package's emitted
 * `.d.ts` files. The map is what an AI agent in a *consumer* repo reads instead of
 * grepping idco source: one tiny `api/README.md` directory of categories, then one
 * compact `api/<category>.md` per category with signatures, summaries, prop tables,
 * and examples.
 *
 * WHY parse `.d.ts` and not the TS source or a doc tool:
 *   - This monorepo runs TypeScript 7 (native preview). TypeDoc / API Extractor peer
 *     on the classic TS compiler API (<= 5.x) and cannot load here, and TS7 only
 *     exposes an `unstable/ast` surface — too volatile to build a release tool on.
 *   - The emitted `.d.ts` IS the published surface. tsc has already resolved types and
 *     preserved every JSDoc doc-comment (including custom tags like `@category`),
 *     so parsing it yields a map that exactly mirrors what consumers can import — with
 *     zero new dependency and immunity to TS-version churn.
 *
 * The parse is deliberately small because tsc's `.d.ts` output is regular:
 *   - re-exports:  `export { a, type B, c as d } from "./x";`  and  `export * from "./x";`
 *   - declarations: `export declare function|const|class`, `export interface|type`
 *   - one JSDoc block immediately precedes the decl it documents
 *   - a file-leading JSDoc carrying `@module`/`@categoryDefault`/`@categoryDescription`
 *     is the MODULE header, never a symbol doc.
 *
 * Two phases (kept separate so re-export resolution never fights doc extraction):
 *   A. collectPublicNames(entry)  — walk the export graph from each public entry point
 *      (package.json `exports`) to the set of names a consumer can import, in barrel order.
 *   B. resolveName(name)          — follow named/star re-exports to the LEAF file that
 *      declares the name, and read that decl's signature + JSDoc + effective category.
 *
 * If a future edit changes tsc's `.d.ts` formatting (e.g. a different brace style), the
 * statement scanner in `parseDts` is the thing to revisit — it tracks brace/paren depth
 * to capture multi-line decls, and assumes `export`/`declare` keywords lead a statement.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";

/** This is a build tool; its only output is a progress/coverage report on stderr. */
const log = (msg) => process.stderr.write(msg + "\n");

// --------------------------------------------------------------------------------------
// Per-package presentation metadata. Optional: the generator falls back to the entry
// module header's first sentence for the tagline, and to barrel order for categories.
// Kept here (not in each package) so the *consumer-facing voice* stays consistent across
// packages without polluting source headers with presentation concerns.
// --------------------------------------------------------------------------------------
const PACKAGE_META = {
  "@quanghuy1242/idco-ui": {
    tagline:
      "Shared React primitives: React Aria behavior + DaisyUI 5 styling. Import a primitive; never hand-roll dialogs/menus/inputs.",
    conventions: [
      "Every interactive primitive is React Aria behavior + DaisyUI styling — do not hand-roll.",
      "Drive appearance with typed props (`variant`/`size`/`tone`/`density`/`iconName`), not raw `className`.",
      "Register icon names in the package before passing them to `iconName` props.",
    ],
  },
  "@quanghuy1242/idco-editor": {
    tagline:
      "Owned-model rich-text engine. You extend it through SPIs (register* calls), you do not fork it. `registerNode` (add a block) is the headline.",
    conventions: [
      "Extend via SPIs: `registerNode`/`registerMark`/`registerCommand`/`registerDataSource` — one call, no engine fork.",
      "Save/load is the native snapshot: `createEditorStore({ snapshot })` ↔ `store.toSnapshot()`. Render read-only with `RestingDocument` or the `@quanghuy1242/idco-reader` package.",
      "The Compat category is import-only (one-time migration). It is NOT the save/load path — never serialize through it.",
    ],
  },
  "@quanghuy1242/idco-reader": {
    tagline:
      "Server-native read tier. Renders the editor's native snapshot in an RSC with no client JS; opt into interactivity through the `./islands` entry.",
    conventions: [
      "The `.` entry is server-safe (no `use client`). Import it in Server Components.",
      "Client interactivity (scroll-spy TOC, checklists, live code) lives behind `./islands` and pulls a client runtime — opt in deliberately.",
    ],
  },
  "@quanghuy1242/idco-lib": {
    tagline: "Framework-free shared helpers and contracts used by idco UI and product code.",
    conventions: ["No React, no runtime framework deps — pure helpers and types."],
  },
};

const MAX_SIGNATURE = 240; // chars before a signature is truncated in a category file
const MAX_MEMBERS = 40; // members listed for an interface/object before truncation
const MAX_EXAMPLE_LINES = 22;

// ======================================================================================
// .d.ts parsing
// ======================================================================================

/** @typedef {{ kind: string, signature: string, doc: string, members: Member[], paramTypeName: string|null }} Decl */
/** @typedef {{ name: string, optional: boolean, type: string, doc: string }} Member */

const fileCache = new Map();

/**
 * Parse one `.d.ts` file into its module header, exported declarations, the local
 * (possibly non-exported) type table used to resolve a function's props, and its
 * re-export edges. Memoized per absolute path.
 */
function parseDts(absPath) {
  if (fileCache.has(absPath)) return fileCache.get(absPath);
  /** @type {{moduleDoc:string, categoryDefault:string|null, categoryDescriptions:Record<string,string>, decls:Map<string,Decl>, localTypes:Map<string,Member[]>, named:{exported:string,local:string,from:string}[], stars:string[]}} */
  const out = {
    moduleDoc: "",
    categoryDefault: null,
    categoryDescriptions: {},
    decls: new Map(),
    localTypes: new Map(),
    named: [],
    stars: [],
  };
  if (!existsSync(absPath)) {
    fileCache.set(absPath, out);
    return out;
  }
  const raw = readFileSync(absPath, "utf8").replace(/\n\/\/# sourceMappingURL=.*$/m, "");
  const lines = raw.split("\n");

  let i = 0;
  let pendingDoc = ""; // the most recent /** */ block, awaiting the decl it documents
  let sawModuleHeader = false;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // --- capture a JSDoc block --------------------------------------------------------
    if (trimmed.startsWith("/**")) {
      const start = i;
      while (i < lines.length && !lines[i].includes("*/")) i++;
      const block = lines.slice(start, i + 1).join("\n");
      i++;
      // A header carrying module/category metadata documents the FILE, not the next
      // symbol — keep it out of symbol attachment so a file-leading doc never leaks
      // onto the first export below it.
      if (/@(module|packageDocumentation|categoryDefault|categoryDescription)\b/.test(block) || !sawModuleHeader) {
        if (!sawModuleHeader) {
          out.moduleDoc = block;
          sawModuleHeader = true;
          const cd = matchTag(block, "categoryDefault");
          if (cd) out.categoryDefault = cd.trim();
          collectCategoryDescriptions(block, out.categoryDescriptions);
          pendingDoc = "";
          continue;
        }
        // a later module-level metadata block (e.g. a second @categoryDescription)
        if (/@(categoryDefault|categoryDescription)\b/.test(block)) {
          const cd = matchTag(block, "categoryDefault");
          if (cd) out.categoryDefault = cd.trim();
          collectCategoryDescriptions(block, out.categoryDescriptions);
          pendingDoc = "";
          continue;
        }
      }
      pendingDoc = block;
      continue;
    }

    // --- re-exports -------------------------------------------------------------------
    if (trimmed.startsWith("export") && (trimmed.includes(" from ") || trimmed.startsWith("export *"))) {
      // accumulate a possibly multi-line export {...} from "x";
      let stmt = trimmed;
      while (!stmt.includes(" from ") && !/;\s*$/.test(stmt) && i + 1 < lines.length) {
        i++;
        stmt += " " + lines[i].trim();
      }
      // multi-line `export { a, b } from "x";` where the from is on a later line
      while (!/from\s+["']/.test(stmt) && /export\s*\*/.test(stmt) === false && i + 1 < lines.length && !/;\s*$/.test(stmt)) {
        i++;
        stmt += " " + lines[i].trim();
      }
      const fromMatch = stmt.match(/from\s+["']([^"']+)["']/);
      const from = fromMatch ? fromMatch[1] : null;
      if (/export\s*\*/.test(stmt) && from) {
        out.stars.push(from);
      } else if (from) {
        const inner = stmt.slice(stmt.indexOf("{") + 1, stmt.lastIndexOf("}"));
        for (const part of inner.split(",")) {
          const spec = part.trim().replace(/^type\s+/, "");
          if (!spec) continue;
          const m = spec.match(/^(\S+)\s+as\s+(\S+)$/);
          if (m) out.named.push({ local: m[1], exported: m[2], from });
          else out.named.push({ local: spec, exported: spec, from });
        }
      }
      pendingDoc = "";
      i++;
      continue;
    }

    // --- declarations -----------------------------------------------------------------
    const decl = matchDecl(trimmed);
    if (decl) {
      const { kind, name, exported } = decl;
      // capture the full statement (may span lines for class/interface/object-type)
      const { signature, endIndex, members, paramTypeName } = captureStatement(lines, i, kind);
      i = endIndex + 1;
      const entry = { kind, signature, doc: pendingDoc, members, paramTypeName };
      if (members.length || kind === "interface" || kind === "type") out.localTypes.set(name, members);
      if (exported) out.decls.set(name, entry);
      pendingDoc = "";
      continue;
    }

    if (trimmed && !trimmed.startsWith("import") && !trimmed.startsWith("//")) pendingDoc = "";
    i++;
  }

  fileCache.set(absPath, out);
  return out;
}

/** Recognize the leading tokens of a top-level declaration. */
function matchDecl(trimmed) {
  let m;
  if ((m = trimmed.match(/^(export\s+)?declare\s+(?:abstract\s+)?function\s+([A-Za-z0-9_$]+)/)))
    return { kind: "function", name: m[2], exported: !!m[1] };
  if ((m = trimmed.match(/^(export\s+)?declare\s+(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/)))
    return { kind: "class", name: m[2], exported: !!m[1] };
  if ((m = trimmed.match(/^(export\s+)?declare\s+const\s+([A-Za-z0-9_$]+)/)))
    return { kind: "const", name: m[2], exported: !!m[1] };
  if ((m = trimmed.match(/^(export\s+)?interface\s+([A-Za-z0-9_$]+)/)))
    return { kind: "interface", name: m[2], exported: !!m[1] };
  if ((m = trimmed.match(/^(export\s+)?type\s+([A-Za-z0-9_$]+)/)))
    return { kind: "type", name: m[2], exported: !!m[1] };
  return null;
}

/**
 * Capture a declaration's full text starting at line `start`. Single-line statements end
 * at the first `;` at depth 0; brace-bearing statements (class/interface/object-type) end
 * when brace depth returns to 0. Also pulls members (for prop tables) and a function's
 * single-param type name (to resolve a destructured props interface).
 */
function captureStatement(lines, start, kind) {
  let depth = 0;
  let buf = "";
  let endIndex = start;
  let opened = false;
  for (let j = start; j < lines.length; j++) {
    const l = lines[j];
    buf += (j > start ? "\n" : "") + l;
    for (const ch of l) {
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") depth--;
    }
    if (l.includes("{")) opened = true;
    endIndex = j;
    const noBrace = !opened && (kind === "function" || kind === "const" || kind === "type");
    if (noBrace && /;\s*$/.test(l) && depth <= 0) break;
    if (opened && depth <= 0) break;
    if (!opened && /;\s*$/.test(l) && depth <= 0) break;
  }
  const signature = buf.replace(/^export\s+/, "").replace(/^declare\s+/, "").trim();
  const members = kind === "interface" || kind === "type" || kind === "class" ? extractMembers(buf) : [];
  let paramTypeName = null;
  if (kind === "function") {
    const pm = signature.match(/:\s*([A-Za-z0-9_$]+Props)\b/) || signature.match(/}\s*:\s*([A-Za-z0-9_$]+)\b/);
    if (pm) paramTypeName = pm[1];
  }
  return { signature, endIndex, members, paramTypeName };
}

/** Pull `name?: type;` members out of an interface / object-type / class body, with docs. */
function extractMembers(block) {
  const lines = block.split("\n");
  /** @type {Member[]} */
  const members = [];
  let doc = "";
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("/**")) {
      const start = i;
      while (i < lines.length && !lines[i].includes("*/")) i++;
      doc = summarize(lines.slice(start, i + 1).join("\n"));
      continue;
    }
    const m = t.match(/^(readonly\s+)?([A-Za-z0-9_$]+)(\?)?\s*:\s*(.+?);?$/);
    if (m && !t.startsWith("#") && !t.startsWith("private")) {
      members.push({ name: m[2], optional: !!m[3], type: m[4].replace(/;$/, "").trim(), doc });
      doc = "";
    } else if (t && !t.startsWith("//")) {
      doc = "";
    }
  }
  return members;
}

// ======================================================================================
// JSDoc helpers
// ======================================================================================

function stripDoc(block) {
  return block
    .replace(/^\s*\/\*\*/, "")
    .replace(/\*\/\s*$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, ""))
    .join("\n")
    .trim();
}

function matchTag(block, tag) {
  const body = stripDoc(block);
  const re = new RegExp(`@${tag}\\s+([^\\n@]*)`);
  const m = body.match(re);
  return m ? m[1].trim() : null;
}

function collectCategoryDescriptions(block, into) {
  const body = stripDoc(block);
  const re = /@categoryDescription\s+([^\n]+)\n([\s\S]*?)(?=\n@\w|$)/g;
  let m;
  while ((m = re.exec(body))) into[m[1].trim()] = m[2].trim();
}

/** First sentence / paragraph of a doc block, tags stripped. */
function summarize(block) {
  if (!block) return "";
  const body = stripDoc(block).split(/\n@\w/)[0].trim();
  const firstPara = body.split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  const sentence = firstPara.match(/^.*?[.!?](\s|$)/);
  return (sentence ? sentence[0] : firstPara).trim();
}

function fullSummary(block) {
  if (!block) return "";
  return stripDoc(block).split(/\n@\w/)[0].trim();
}

function getExample(block) {
  const body = stripDoc(block);
  const m = body.match(/@example\b[^\n]*\n([\s\S]*?)(?=\n@\w|$)/);
  if (!m) return "";
  let ex = m[1].replace(/```\w*\n?/g, "").trim();
  const exLines = ex.split("\n");
  if (exLines.length > MAX_EXAMPLE_LINES) ex = exLines.slice(0, MAX_EXAMPLE_LINES).join("\n") + "\n// …";
  return ex;
}

function getCategory(decl, fileCategoryDefault) {
  const own = matchTag(decl.doc, "category");
  return (own || fileCategoryDefault || "Other").trim();
}

function isInternal(decl) {
  return /@internal\b/.test(decl.doc);
}

// ======================================================================================
// export-graph resolution
// ======================================================================================

function dtsPathFor(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  for (const cand of [base + ".d.ts", join(base, "index.d.ts"), base]) {
    if (existsSync(cand)) return cand;
  }
  return base + ".d.ts";
}

/** Resolve a public name to the leaf file that declares it. */
function resolveName(name, file, seen = new Set()) {
  const key = file + "::" + name;
  if (seen.has(key)) return null;
  seen.add(key);
  const f = parseDts(file);
  if (f.decls.has(name)) return { file, decl: f.decls.get(name), module: f };
  for (const n of f.named) {
    if (n.exported === name) {
      const r = resolveName(n.local, dtsPathFor(file, n.from), seen);
      if (r) return r;
    }
  }
  for (const s of f.stars) {
    const r = resolveName(name, dtsPathFor(file, s), seen);
    if (r) return r;
  }
  return null;
}

/** All names a consumer can import from an entry file, in source (barrel) order. */
function collectPublicNames(file, seen = new Set(), acc = []) {
  if (seen.has(file)) return acc;
  seen.add(file);
  const f = parseDts(file);
  for (const name of f.decls.keys()) if (!acc.includes(name)) acc.push(name);
  for (const n of f.named) if (!acc.includes(n.exported)) acc.push(n.exported);
  for (const s of f.stars) collectPublicNames(dtsPathFor(file, s), seen, acc);
  return acc;
}

// ======================================================================================
// markdown emit
// ======================================================================================

function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function anchor(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function truncSig(sig) {
  const oneLine = sig.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_SIGNATURE ? oneLine.slice(0, MAX_SIGNATURE) + " …" : oneLine;
}

function membersTable(members) {
  if (!members.length) return "";
  const rows = members
    .slice(0, MAX_MEMBERS)
    .map((m) => {
      const type = m.type.replace(/\|/g, "\\|").replace(/\s+/g, " ");
      const t = type.length > 80 ? type.slice(0, 80) + "…" : type;
      return `| \`${m.name}${m.optional ? "?" : ""}\` | \`${t}\` | ${m.doc || ""} |`;
    })
    .join("\n");
  const more = members.length > MAX_MEMBERS ? `\n_…and ${members.length - MAX_MEMBERS} more._` : "";
  return `\n| field | type | notes |\n| --- | --- | --- |\n${rows}${more}\n`;
}

function emit(pkgName, pkgDir, entries, ctx) {
  const meta = PACKAGE_META[pkgName] || { tagline: "", conventions: [] };
  const apiDir = join(pkgDir, "api");
  if (existsSync(apiDir)) rmSync(apiDir, { recursive: true, force: true });
  mkdirSync(apiDir, { recursive: true });

  // group, preserving first-seen (barrel) order for both categories and members
  /** @type {Map<string, typeof entries>} */
  const byCat = new Map();
  for (const e of entries) {
    if (!byCat.has(e.category)) byCat.set(e.category, []);
    byCat.get(e.category).push(e);
  }

  const tagline = meta.tagline || summarize(parseDts(entries[0]?.file || "").moduleDoc) || "";

  // ---- README (Tier 1: category directory) -------------------------------------------
  let readme = `# ${pkgName} — API map\n\n> ${tagline}\n\n`;
  readme += `_Generated from the published \`.d.ts\` surface (v${ctx.version}). Each category is a small, self-contained file — open the one you need; do not grep package source._\n\n`;
  readme += `## Categories\n\n`;
  for (const [cat, list] of byCat) {
    const desc = ctx.categoryDescriptions[cat];
    const short = desc ? summarize("/** " + desc + " */") : "";
    readme += `- [${cat}](./${slug(cat)}.md) — ${short || `${list.length} export${list.length === 1 ? "" : "s"}`}\n`;
  }
  if (meta.conventions?.length) {
    readme += `\n## Conventions\n\n` + meta.conventions.map((c) => `- ${c}`).join("\n") + "\n";
  }
  readme += `\n## Lookup\n\nSearching for a specific export? See the flat [A–Z index](./all-exports.md).\n`;
  writeFileSync(join(apiDir, "README.md"), readme);

  // ---- flat A–Z lookup (kept out of README so README stays a tiny directory) ---------
  let azIndex = `# ${pkgName} — all exports (A–Z)\n\n[← API map](./README.md)\n\n`;
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  for (const e of sorted) {
    azIndex += `- [\`${e.name}\`](./${slug(e.category)}.md#${anchor(e.name)}) — ${e.summary || "_undocumented_"}\n`;
  }
  writeFileSync(join(apiDir, "all-exports.md"), azIndex);

  // ---- per-category files (Tier 2) ---------------------------------------------------
  const cats = [...byCat.keys()];
  for (let ci = 0; ci < cats.length; ci++) {
    const cat = cats[ci];
    const list = byCat.get(cat);
    const prev = ci > 0 ? cats[ci - 1] : null;
    const next = ci < cats.length - 1 ? cats[ci + 1] : null;
    let md = `# ${cat}\n\n`;
    const desc = ctx.categoryDescriptions[cat];
    if (desc) md += desc + "\n\n";
    md += `[← API map](./README.md)`;
    if (prev) md += ` · prev: [${prev}](./${slug(prev)}.md)`;
    if (next) md += ` · next: [${next}](./${slug(next)}.md)`;
    md += `\n\n`;
    for (const e of list) {
      md += `## \`${e.name}\`\n\n`;
      md += `\`\`\`ts\n${truncSig(e.signature)}\n\`\`\`\n\n`;
      if (e.fullSummary) md += e.fullSummary + "\n\n";
      else md += `_Undocumented._\n\n`;
      if (e.members.length && (e.kind === "interface" || e.kind === "type" || e.paramTypeName)) {
        md += `**Fields**\n${membersTable(e.members)}\n`;
      }
      if (e.example) md += `**Example**\n\n\`\`\`tsx\n${e.example}\n\`\`\`\n\n`;
      md += `---\n\n`;
    }
    writeFileSync(join(apiDir, slug(cat) + ".md"), md);
  }

  return { categories: byCat.size, symbols: entries.length };
}

// ======================================================================================
// driver
// ======================================================================================

function entryPointsOf(pkgDir, pkg) {
  const points = [];
  const exp = pkg.exports || {};
  for (const key of Object.keys(exp)) {
    if (key.includes("*")) continue; // skip wildcard subpath exports like "./*"
    const types = exp[key]?.types;
    if (types && !types.includes("*")) points.push(resolve(pkgDir, types));
  }
  if (!points.length) points.push(resolve(pkgDir, "dist/index.d.ts"));
  return points;
}

function main() {
  // `--check` turns the generator into the coverage gate: it still writes the map, but
  // exits non-zero if any public export is missing a summary or a category. `pnpm
  // check:docs` runs this after the build so an undocumented new export fails CI.
  const strict = process.argv.includes("--check");
  const pkgArg = process.argv.slice(2).find((a) => !a.startsWith("-"));
  const pkgDir = resolve(pkgArg || ".");
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const entryFiles = entryPointsOf(pkgDir, pkg);

  // resolve public names across all entry points (reader has 3: `.`, ./islands, ...)
  const names = [];
  for (const ef of entryFiles) {
    if (!existsSync(ef)) {
      log(`[gen-api-map] ${pkg.name}: entry ${relative(pkgDir, ef)} missing — build dist first.`);
      continue;
    }
    for (const n of collectPublicNames(ef)) if (!names.includes(n)) names.push(n);
  }

  const entries = [];
  const categoryDescriptions = {};
  const gaps = { noSummary: [], noCategory: [] };
  for (const name of names) {
    let resolved = null;
    for (const ef of entryFiles) {
      resolved = resolveName(name, ef);
      if (resolved) break;
    }
    if (!resolved) continue;
    if (isInternal(resolved.decl)) continue;
    const category = getCategory(resolved.decl, resolved.module.categoryDefault);
    const summary = summarize(resolved.decl.doc);
    let members = resolved.decl.members;
    if (resolved.decl.paramTypeName && resolved.module.localTypes.has(resolved.decl.paramTypeName)) {
      members = resolved.module.localTypes.get(resolved.decl.paramTypeName);
    }
    entries.push({
      name,
      kind: resolved.decl.kind,
      signature: resolved.decl.signature,
      summary,
      fullSummary: fullSummary(resolved.decl.doc),
      example: getExample(resolved.decl.doc),
      category,
      members,
      file: resolved.file,
      paramTypeName: resolved.decl.paramTypeName,
    });
    if (!summary) gaps.noSummary.push(name);
    if (!matchTag(resolved.decl.doc, "category") && !resolved.module.categoryDefault) gaps.noCategory.push(name);
  }

  if (!entries.length) {
    log(`[gen-api-map] ${pkg.name}: no public symbols resolved — nothing written.`);
    process.exit(0);
  }

  // Category descriptions may be authored anywhere (typically the package barrel, which
  // already carries the curated section prose). Merge from every file the parse touched.
  for (const f of fileCache.values()) Object.assign(categoryDescriptions, f.categoryDescriptions);

  const result = emit(pkg.name, pkgDir, entries, { version: pkg.version, categoryDescriptions });

  const total = entries.length;
  const docPct = Math.round(((total - gaps.noSummary.length) / total) * 100);
  const catPct = Math.round(((total - gaps.noCategory.length) / total) * 100);
  log(`[gen-api-map] ${pkg.name}: ${total} exports, ${result.categories} categories → api/  (summaries ${docPct}%, categorized ${catPct}%)`);
  if (gaps.noSummary.length)
    log(`  missing summary (${gaps.noSummary.length}): ${gaps.noSummary.slice(0, 30).join(", ")}${gaps.noSummary.length > 30 ? " …" : ""}`);
  if (gaps.noCategory.length)
    log(`  uncategorized (${gaps.noCategory.length}): ${gaps.noCategory.slice(0, 30).join(", ")}${gaps.noCategory.length > 30 ? " …" : ""}`);

  if (strict && (gaps.noSummary.length || gaps.noCategory.length)) {
    log(`[gen-api-map] ${pkg.name}: doc-coverage gate failed — document the symbols above (docs/032).`);
    process.exit(1);
  }
}

main();
