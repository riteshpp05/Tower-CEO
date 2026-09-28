/**
 * retheme.js
 *
 * Bulk-renames the NEUTRAL/CHROME Tailwind classes (backgrounds, borders,
 * body text) from slate-* to the new cream/ink palette, across every
 * .tsx/.ts file under src/.
 *
 * Deliberately does NOT touch emerald/indigo/rose/amber classes --
 * those are used in places as semantic status colors (green=won,
 * red=lost, amber=stale) as well as decoratively (the AppShell logo
 * gradient), and I can't safely tell those apart with a blind
 * find-replace across files I haven't all reviewed. Those need a
 * manual pass -- see the printed list of files containing them at the
 * end of this script's run.
 *
 * USAGE (from the ais-cfo-tower repo root):
 *   node retheme.js
 *
 * Safe to re-run -- it's idempotent (old class names won't exist after
 * the first run, so a second run is a no-op). Review the diff with
 * `git diff` before committing.
 */

const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "src");

// Order matters: longer/more specific patterns first so e.g. "slate-800"
// doesn't get partially matched before "slate-8000" (which doesn't
// exist, but being explicit avoids any regex ambiguity).
const RENAMES = [
  [/\bslate-950\b/g, "cream-50"],
  [/\bslate-900\b/g, "cream-100"],
  [/\bslate-800\b/g, "cream-200"],
  [/\bslate-700\b/g, "terra-100"],
  [/\bslate-600\b/g, "ink-300"],
  [/\bslate-500\b/g, "ink-400"],
  [/\bslate-400\b/g, "ink-500"],
  [/\bslate-300\b/g, "ink-700"],
  [/\bslate-200\b/g, "ink-800"],
  [/\bslate-100\b/g, "ink-900"],
  [/\bslate-950\/(\d+)\b/g, "cream-50/$1"],
  [/\bslate-900\/(\d+)\b/g, "cream-100/$1"],
  [/\bslate-800\/(\d+)\b/g, "cream-200/$1"],
];

const FLAG_PATTERNS = [/emerald-\d+/, /indigo-\d+/];

let filesChanged = 0;
let filesFlagged = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(fullPath);
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      processFile(fullPath);
    }
  }
}

function processFile(filePath) {
  const original = fs.readFileSync(filePath, "utf8");
  let updated = original;

  for (const [pattern, replacement] of RENAMES) {
    updated = updated.replace(pattern, replacement);
  }

  if (updated !== original) {
    fs.writeFileSync(filePath, updated, "utf8");
    filesChanged++;
    console.log(`  updated: ${path.relative(__dirname, filePath)}`);
  }

  for (const flagPattern of FLAG_PATTERNS) {
    if (flagPattern.test(updated)) {
      filesFlagged.push(path.relative(__dirname, filePath));
      break;
    }
  }
}

if (!fs.existsSync(SRC_DIR)) {
  console.error(`Could not find ${SRC_DIR} -- run this from the ais-cfo-tower repo root.`);
  process.exit(1);
}

console.log("Renaming neutral/chrome classes (slate -> cream/ink)...\n");
walk(SRC_DIR);

console.log(`\n${filesChanged} file(s) updated.`);

if (filesFlagged.length > 0) {
  console.log(`\n${filesFlagged.length} file(s) still contain emerald/indigo classes -- `);
  console.log("review these by hand (some may be intentional status colors,");
  console.log("e.g. green=won/red=lost, which should stay as-is):\n");
  filesFlagged.forEach(f => console.log(`  - ${f}`));
} else {
  console.log("\nNo emerald/indigo classes found -- nothing to manually review.");
}