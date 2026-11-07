/**
 * retheme_accents.cjs
 *
 * Narrower follow-up to retheme.cjs -- only touches the 5 files flagged
 * as containing emerald/indigo classes, and only replaces EXACT
 * decorative patterns (buttons, input focus rings, the login logo
 * gradient). Status badges (is_active, is_billable, project stage) use
 * different opacity/shade notation (emerald-500/20, indigo-500/20,
 * emerald-400 as text) and are never matched by these patterns -- they
 * stay exactly as they are on purpose.
 *
 * USAGE (from the ais-cfo-tower repo root):
 *   node retheme_accents.cjs
 */

const fs = require("fs");

const FILES = [
  "src/components/FormFields.tsx",
  "src/pages/LoginPage.tsx",
  "src/pages/masters/CustomersPage.tsx",
  "src/pages/masters/EmployeesPage.tsx",
  "src/pages/masters/ProjectsPage.tsx",
];

// Exact substring matches only -- deliberately not a broad regex like
// /emerald-\d+/, so badge colors elsewhere in these same files are
// never touched.
const REPLACEMENTS = [
  ["bg-emerald-600 hover:bg-emerald-500", "bg-terra-600 hover:bg-terra-500"],
  ["focus:border-emerald-600", "focus:border-terra-600"],
  ["from-emerald-600 to-indigo-600", "from-terra-500 to-terra-700"],
];

for (const relPath of FILES) {
  if (!fs.existsSync(relPath)) {
    console.log(`  SKIP (not found): ${relPath}`);
    continue;
  }
  const original = fs.readFileSync(relPath, "utf8");
  let updated = original;
  let count = 0;

  for (const [oldStr, newStr] of REPLACEMENTS) {
    while (updated.includes(oldStr)) {
      updated = updated.replace(oldStr, newStr);
      count++;
    }
  }

  if (updated !== original) {
    fs.writeFileSync(relPath, updated, "utf8");
    console.log(`  updated (${count} replacement(s)): ${relPath}`);
  } else {
    console.log(`  no matches: ${relPath}`);
  }
}

console.log("\nDone. Any remaining emerald/indigo/amber in these files is a status");
console.log("badge left as-is on purpose -- not a bug.");
