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

function isIdcoPackageSource(filename) {
  return (
    isUiPackageSource(filename) ||
    isLibPackageSource(filename) ||
    isEditorPackageSource(filename)
  );
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

var plugin = {
  meta: { name: "architecture" },
  rules: {
    "idco-package-boundary": idcoPackageBoundaryRule,
    "ui-no-side-effect-css": uiNoSideEffectCssRule,
    "ui-no-native-dialog": uiNoNativeDialogRule,
    "ui-no-neutral-button-class": uiNoNeutralButtonClassRule,
  },
};

export default plugin;
