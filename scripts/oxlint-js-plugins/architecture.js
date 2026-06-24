function normalizeFilename(filename) {
  return (filename || "").replace(/\\/g, "/");
}

function extractImportSource(node) {
  if (node.source && node.source.type === "Literal") {
    return node.source.value;
  }
  return null;
}

function isUiPackageSource(filename) {
  filename = normalizeFilename(filename);
  return filename.includes("/packages/ui/src/");
}

function isLibPackageSource(filename) {
  filename = normalizeFilename(filename);
  return filename.includes("/packages/lib/src/");
}

function isEditorPackageSource(filename) {
  filename = normalizeFilename(filename);
  return filename.includes("/packages/editor/src/");
}

function isReaderPackageSource(filename) {
  filename = normalizeFilename(filename);
  return filename.includes("/packages/reader/src/");
}

// The server-safe layer of the reader (docs/015 §7.5): L1 primitives + the server
// `<Reader>`/adapter. Must stay RSC-pure — no client import can reach here, or the whole
// reader collapses back into a client component. The islands (`src/islands/`) are the
// allowed client zone and are deliberately excluded.
function isReaderServerSafeSource(filename) {
  filename = normalizeFilename(filename);
  return (
    filename.includes("/packages/reader/src/l1/") ||
    filename.includes("/packages/reader/src/reader/") ||
    /\/packages\/reader\/src\/index\.tsx?$/.test(filename)
  );
}

var REACT_HOOK_RE = /^use[A-Z]/;

// The legacy Lexical editor was extracted to its own product-neutral package
// (note.md Legacy extraction track). It is subject to the same @idco boundary,
// and the Lexical-only update-listener rule moved here with the Lexical code.
function isEditorLegacyPackageSource(filename) {
  filename = normalizeFilename(filename);
  return filename.includes("/packages/editor-legacy/src/");
}

function isEditorPerformanceSource(filename) {
  filename = normalizeFilename(filename);
  return filename.endsWith("/packages/editor-legacy/src/plugins/editor-performance.ts");
}

function isEngineCoreSource(filename) {
  filename = normalizeFilename(filename);
  return filename.includes("/packages/editor/src/core/");
}

function isFrameworkImportSource(spec) {
  if (!spec) return false;
  return (
    spec === "react" ||
    spec === "react-dom" ||
    spec.startsWith("react/") ||
    spec.startsWith("react-dom/") ||
    spec === "lexical" ||
    spec.startsWith("lexical/") ||
    spec.startsWith("@lexical/")
  );
}

function isIdcoPackageSource(filename) {
  return (
    isUiPackageSource(filename) ||
    isLibPackageSource(filename) ||
    isEditorPackageSource(filename) ||
    isEditorLegacyPackageSource(filename) ||
    isReaderPackageSource(filename)
  );
}

function memberPropertyName(property) {
  if (!property) return null;
  if (property.type === "Identifier") return property.name;
  if (property.type === "Literal") return property.value;
  return null;
}

var PRODUCT_IMPORT_PATTERNS = [
  "@content/",
  "@content-api/",
  "@/workers/",
  "@/app/",
  "workers/",
  "/workers/",
  "content-api",
];

var RUNTIME_IMPORT_PATTERNS = [
  "better-auth",
  "drizzle-orm",
  "hono",
  "cloudflare:",
  "@cloudflare/",
];

function startsWithPattern(spec, pattern) {
  if (pattern.endsWith(":")) return spec.startsWith(pattern);
  return spec === pattern || spec.startsWith(pattern);
}

function matchesAnyPattern(spec, patterns) {
  if (!spec) return false;
  for (var i = 0; i < patterns.length; i++) {
    if (startsWithPattern(spec, patterns[i]) || spec.includes(patterns[i])) return true;
  }
  return false;
}

var idcoPackageBoundaryRule = {
  meta: { type: "problem", docs: { description: "@idco packages stay product-neutral and free of Worker/runtime dependencies" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (!isIdcoPackageSource(filename)) return {};

    return {
      ImportDeclaration: function (node) {
        var spec = extractImportSource(node);
        if (matchesAnyPattern(spec, PRODUCT_IMPORT_PATTERNS)) {
          context.report({ node: node.source, message: "@idco packages must not import product or Worker source: " + spec });
        }
        if (matchesAnyPattern(spec, RUNTIME_IMPORT_PATTERNS)) {
          context.report({ node: node.source, message: "@idco packages must not import Worker/runtime persistence/auth dependencies: " + spec });
        }
      },
    };
  },
};

var uiNoSideEffectCssRule = {
  meta: { type: "problem", docs: { description: "@idco/ui source modules stay side-effect-free unless package.json explicitly opts in" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (!isUiPackageSource(filename)) return {};

    return {
      ImportDeclaration: function (node) {
        var spec = extractImportSource(node);
        if (spec && /\.css(?:\?|$)/.test(spec)) {
          context.report({ node: node.source, message: "@idco/ui modules must not import CSS as a side effect; consumers own app-global CSS and themes." });
        }
      },
    };
  },
};

var uiNoNativeDialogRule = {
  meta: { type: "problem", docs: { description: "@idco/ui modal surfaces use React Aria Modal/Dialog, not native <dialog>" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (!isUiPackageSource(filename)) return {};

    return {
      JSXOpeningElement: function (node) {
        if (node.name.type === "JSXIdentifier" && node.name.name === "dialog") {
          context.report({ node: node, message: "@idco/ui must not use native <dialog>; use React Aria ModalOverlay/Modal/Dialog with DaisyUI modal classes." });
        }
      },
    };
  },
};

function classNameLiteral(attr) {
  if (!attr || attr.type !== "JSXAttribute") return null;
  if (!attr.name || attr.name.type !== "JSXIdentifier" || attr.name.name !== "className") return null;
  if (!attr.value) return null;
  if (attr.value.type === "Literal" && typeof attr.value.value === "string") return attr.value.value;
  if (
    attr.value.type === "JSXExpressionContainer" &&
    attr.value.expression &&
    attr.value.expression.type === "Literal" &&
    typeof attr.value.expression.value === "string"
  ) {
    return attr.value.expression.value;
  }
  return null;
}

var uiNoNeutralButtonClassRule = {
  meta: { type: "problem", docs: { description: "@idco/ui does not expose DaisyUI btn-neutral as a portable action tone" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (!isUiPackageSource(filename)) return {};

    return {
      JSXOpeningElement: function (node) {
        for (var i = 0; i < node.attributes.length; i++) {
          var value = classNameLiteral(node.attributes[i]);
          if (value && /\bbtn-neutral\b/.test(value)) {
            context.report({ node: node.attributes[i], message: "Do not use btn-neutral in @idco/ui; use a typed secondary/outline tone instead." });
          }
        }
      },
    };
  },
};

var editorNoDirectUpdateListenerRule = {
  meta: { type: "problem", docs: { description: "Lexical editor update listeners must use the editor performance scheduler contract" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (!isEditorLegacyPackageSource(filename) || isEditorPerformanceSource(filename)) return {};

    return {
      CallExpression: function (node) {
        var callee = node.callee;
        if (!callee || callee.type !== "MemberExpression") return;
        if (memberPropertyName(callee.property) !== "registerUpdateListener") return;
        context.report({
          node: callee.property,
          message:
            "Use registerEditorUpdateListener/registerCoalescedEditorUpdateListener from editor-performance.ts so every editor update listener declares frequency, cost, scheduling lane, and budget.",
        });
      },
    };
  },
};

var engineCoreNoFrameworkRule = {
  meta: { type: "problem", docs: { description: "engine core stays framework-agnostic: no React or Lexical imports (docs/010 §7.1, G3)" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (!isEngineCoreSource(filename)) return {};

    return {
      ImportDeclaration: function (node) {
        var spec = extractImportSource(node);
        if (isFrameworkImportSource(spec)) {
          context.report({ node: node.source, message: "the canonical engine (core/ and shared/) must not import React or Lexical (docs/010 §7.1); keep the engine core framework-agnostic. Offending import: " + spec });
        }
      },
    };
  },
};

// docs/015 §7.5 — the L1 purity rule: nothing in the reader's server-safe layer (L1 +
// the server `<Reader>`) may turn it into a client module, or the whole reader stops being
// a Server Component (silent bundle bloat / a broken server build, §13). The mirror of the
// engine-core purity rule (010 G3). Scope of what THIS lint enforces (single-file, static):
// no `"use client"` directive; no React hook used by named import OR `React.useX` member
// access; no import of the client islands entry; no import of the client-heavy `@idco/ui`
// barrel. It deliberately does NOT chase a transitive `"use client"` in some third module
// or a runtime browser-global access — those are beyond a single-file lint and are caught
// instead by the RSC bundler at the consumer and by review.
var readerL1PurityRule = {
  meta: { type: "problem", docs: { description: "reader L1 (and the server <Reader>) stays RSC-safe: no client module markers reach it (docs/015 §7.5)" } },
  create: function (context) {
    var filename = context.filename || context.physicalFilename || "";
    if (!isReaderServerSafeSource(filename)) return {};

    // Local name React is bound to (default/namespace import), so `React.useState` etc.
    // can be flagged, not just `import { useState } from "react"`.
    var reactLocalNames = [];

    function reportDirective(node) {
      var body = node.body || [];
      for (var i = 0; i < body.length; i++) {
        var stmt = body[i];
        if (
          stmt &&
          stmt.type === "ExpressionStatement" &&
          stmt.expression &&
          stmt.expression.type === "Literal" &&
          stmt.expression.value === "use client"
        ) {
          context.report({ node: stmt, message: "reader L1 / server <Reader> must not be a client module: remove the \"use client\" directive (docs/015 §7.5). Interactive code belongs in src/islands/." });
        }
      }
    }

    return {
      Program: reportDirective,
      ImportDeclaration: function (node) {
        var spec = extractImportSource(node);
        if (!spec) return;
        if (/(^|\/)islands(\/|$)/.test(spec)) {
          context.report({ node: node.source, message: "reader L1 / server <Reader> must not import the client islands (docs/015 §7.5); the island seam is the `renderIsland` callback the consumer supplies." });
          return;
        }
        if (spec === "@idco/ui" || spec === "@quanghuy1242/idco-ui") {
          context.report({ node: node.source, message: "reader L1 / server <Reader> must not import @idco/ui (client-heavy); it would taint the server graph (docs/015 §7.5)." });
          return;
        }
        if (spec === "react" && node.specifiers) {
          for (var i = 0; i < node.specifiers.length; i++) {
            var s = node.specifiers[i];
            // `import { useState } from "react"` — a named hook import.
            if (
              s.type === "ImportSpecifier" &&
              s.imported &&
              typeof s.imported.name === "string" &&
              REACT_HOOK_RE.test(s.imported.name)
            ) {
              context.report({ node: s, message: "reader L1 / server <Reader> must not use a React hook (" + s.imported.name + "); primitives are pure node→DOM (docs/015 §7.5)." });
            }
            // `import React from "react"` / `import * as React from "react"` — track the
            // local name so member access `React.useX` below is flagged too.
            if (
              (s.type === "ImportDefaultSpecifier" || s.type === "ImportNamespaceSpecifier") &&
              s.local &&
              typeof s.local.name === "string"
            ) {
              reactLocalNames.push(s.local.name);
            }
          }
        }
      },
      MemberExpression: function (node) {
        if (
          node.object &&
          node.object.type === "Identifier" &&
          reactLocalNames.indexOf(node.object.name) !== -1
        ) {
          var prop = memberPropertyName(node.property);
          if (typeof prop === "string" && REACT_HOOK_RE.test(prop)) {
            context.report({ node: node, message: "reader L1 / server <Reader> must not use a React hook (" + node.object.name + "." + prop + "); primitives are pure node→DOM (docs/015 §7.5)." });
          }
        }
      },
    };
  },
};

var plugin = {
  meta: { name: "architecture" },
  rules: {
    "editor-no-direct-update-listener": editorNoDirectUpdateListenerRule,
    "engine-core-no-framework": engineCoreNoFrameworkRule,
    "idco-package-boundary": idcoPackageBoundaryRule,
    "reader-l1-purity": readerL1PurityRule,
    "ui-no-side-effect-css": uiNoSideEffectCssRule,
    "ui-no-native-dialog": uiNoNativeDialogRule,
    "ui-no-neutral-button-class": uiNoNeutralButtonClassRule,
  },
};

export default plugin;
