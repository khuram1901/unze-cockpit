// Stamps public/sw.js with a unique cache name per deploy so browsers
// automatically discard stale caches. Runs via the "prebuild" npm hook.
//
// On Vercel, VERCEL_GIT_COMMIT_SHA identifies the deploy; locally we fall
// back to a timestamp so dev builds also get fresh caches.

import { readFileSync, writeFileSync } from "node:fs";

const path = "public/sw.js";
const id =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ||
  Date.now().toString(36);

let src = readFileSync(path, "utf8");
const stamped = src.replace(
  /const CACHE_NAME = "pulse-[^"]*";/,
  `const CACHE_NAME = "pulse-${id}";`,
);

if (stamped === src && !src.includes(`pulse-${id}`)) {
  console.warn("stamp-sw: CACHE_NAME pattern not found in sw.js — skipped");
} else {
  writeFileSync(path, stamped);
  console.log(`stamp-sw: cache name set to pulse-${id}`);
}
