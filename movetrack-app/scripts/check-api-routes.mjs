#!/usr/bin/env node
/**
 * Frontend <-> API route drift check.
 *
 * Extracts every API path the frontend calls (template literals anchored on
 * core_url / API_BASE_URL / API_BASE / VITE_API_BASE_URL) and verifies each
 * one resolves to an Express route registered in movetrack-api. Catches the
 * class of bug where a backend route is moved/renamed and a frontend call
 * site keeps 404ing into a silent catch (e.g. /api/calculate-distance ->
 * /api/move/distance, which broke the move cost estimator for three months).
 *
 * Read-only on both codebases. Usage: node scripts/check-api-routes.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_SRC = resolve(__dirname, "../src");
const API_ROOT = resolve(__dirname, "../../movetrack-api");

// ---------------------------------------------------------------------------
// Backend: resolve registered routes by walking router mounts from app.js
// ---------------------------------------------------------------------------

const routeTable = []; // { path: "/api/move/distance", file, line }

function requireTarget(fromFile, spec) {
  if (!spec.startsWith(".")) return null; // node_modules
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [base, `${base}.js`, join(base, "index.js")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function walkRouter(file, prefix, seen = new Set()) {
  const key = `${file}|${prefix}`;
  if (seen.has(key)) return;
  seen.add(key);

  const src = readFileSync(file, "utf8");

  // ident -> required file, for `var x = require('./routes/...')`
  const requires = new Map();
  for (const m of src.matchAll(
    /(?:var|const|let)\s+(\w+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g,
  )) {
    const target = requireTarget(file, m[2]);
    if (target) requires.set(m[1], target);
  }

  // (app|router).use('/prefix', ...middleware, identOrInlineRequire)
  for (const m of src.matchAll(
    /(?:app|router)\.use\(\s*['"]([^'"]*)['"]\s*,\s*([^;]+?)\);/g,
  )) {
    const mountPrefix = m[1];
    for (const inline of m[2].matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const target = requireTarget(file, inline[1]);
      if (target) walkRouter(target, joinPaths(prefix, mountPrefix), seen);
    }
    for (const argIdent of m[2].matchAll(/\b(\w+)\b/g)) {
      const target = requires.get(argIdent[1]);
      if (target) walkRouter(target, joinPaths(prefix, mountPrefix), seen);
    }
  }

  // (app|router).use(ident)  -- unprefixed mount
  for (const m of src.matchAll(/(?:app|router)\.use\(\s*(\w+)\s*\)/g)) {
    const target = requires.get(m[1]);
    if (target) walkRouter(target, prefix, seen);
  }

  // (app|router).<verb>('/path', ...)
  for (const m of src.matchAll(
    /(?:app|router)\.(get|post|put|patch|delete|all)\(\s*['"`]([^'"`]+)['"`]/g,
  )) {
    const line = src.slice(0, m.index).split("\n").length;
    routeTable.push({ path: joinPaths(prefix, m[2]), file, line });
  }
}

function joinPaths(a, b) {
  const joined = `${a}/${b}`.replace(/\/+/g, "/");
  return joined !== "/" && joined.endsWith("/") ? joined.slice(0, -1) : joined;
}

// ---------------------------------------------------------------------------
// Frontend: extract base-url-anchored call paths
// ---------------------------------------------------------------------------

const calls = []; // { path, file, line }
const BASE_VARS = "(?:core_url|API_BASE_URL|API_BASE|url|import\\.meta\\.env\\.VITE_API_BASE_URL)";
// `${core_url}/api/x/${id}?q=1`   and   core_url + "/api/x"
const TEMPLATE_CALL = new RegExp("\\$\\{" + BASE_VARS + "\\}(/[^`]*?)[`?]", "g");
const CONCAT_CALL = new RegExp(
  BASE_VARS + "\\s*\\+\\s*['\"](/[^'\"?]+)['\"](\\s*\\+)?",
  "g",
);

function* walkFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walkFiles(full);
    else if (/\.(vue|ts|js)$/.test(entry)) yield full;
  }
}

for (const file of walkFiles(APP_SRC)) {
  const src = readFileSync(file, "utf8");
  for (const re of [TEMPLATE_CALL, CONCAT_CALL]) {
    for (const m of src.matchAll(re)) {
      const line = src.slice(0, m.index).split("\n").length;
      let path = m[1];
      // `core_url + "/file/upload/" + name` — the concat continues with a
      // dynamic segment the string literal can't see
      if (path.endsWith("/")) {
        path = m[2] ? `${path}\${_}` : path.slice(0, -1);
      }
      calls.push({ path, file, line });
    }
  }
}

// ---------------------------------------------------------------------------
// Match: API :params match any segment; frontend ${expr} segments match any
// ---------------------------------------------------------------------------

const segments = (p) => p.split("/").filter(Boolean);

function matches(callPath, routePath) {
  const c = segments(callPath);
  const r = segments(routePath);
  if (c.length !== r.length) return false;
  return r.every(
    (seg, i) =>
      seg.startsWith(":") || c[i].includes("${") || seg === c[i],
  );
}

walkRouter(join(API_ROOT, "app.js"), "/");

const failures = [];
for (const call of calls) {
  if (!routeTable.some((route) => matches(call.path, route.path))) {
    failures.push(call);
  }
}

const rel = (f) => f.replace(`${resolve(__dirname, "..")}/`, "");
console.log(
  `Checked ${calls.length} frontend call site(s) against ${routeTable.length} registered API route(s).`,
);
if (failures.length) {
  console.error("\nUNMATCHED frontend calls (no registered API route):");
  for (const f of failures) {
    console.error(`  ${rel(f.file)}:${f.line}  ->  ${f.path}`);
  }
  process.exit(1);
}
console.log("No route drift detected.");
