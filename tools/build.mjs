#!/usr/bin/env node
// credit-card-offers/tools/build.mjs
//
// Inlines lib/core.js into each src/*.user.js adapter (replacing the
// `//= INLINE core` marker) and bumps the @version in the userscript
// metadata block, then writes the result to dist/.
//
// Why inline instead of @require: @require fetches the resource once at
// *save* time and never re-checks it for updates (per the Userscripts
// docs), which is the wrong mechanism for a helper file that will keep
// changing. Inlining means every dist/*.user.js is fully standalone, and
// @updateURL/@version is the only thing that needs to work for updates.
//
// Why bump @version automatically: @updateURL does nothing unless the
// remote @version compares greater than the installed one. Forgetting to
// bump it after an edit means the phone silently keeps running stale
// code — this build step removes that footgun rather than relying on
// a human to remember.
//
// Usage: node tools/build.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIB_CORE = path.join(ROOT, 'lib', 'core.js');
const SRC_DIR = path.join(ROOT, 'src');
const DIST_DIR = path.join(ROOT, 'dist');

const MARKER = '//= INLINE core';
const VERSION_RE = /(\/\/\s*@version\s+)(\d+)\.(\d+)\.(\d+)/;

const ADAPTERS = [
  { src: 'chase.user.js', dist: 'chase-offers.user.js' },
  { src: 'amex.user.js', dist: 'amex-offers.user.js' },
];

function bumpVersion(source) {
  const match = source.match(VERSION_RE);
  if (!match) {
    throw new Error(
      'No "// @version x.y.z" line found — every adapter must declare one so ' +
        '@updateURL has something to compare against.'
    );
  }
  const patch = Number(match[4]) + 1;
  const bumped = `${match[1]}${match[2]}.${match[3]}.${patch}`;
  return source.replace(VERSION_RE, bumped);
}

function build() {
  mkdirSync(DIST_DIR, { recursive: true });
  const core = readFileSync(LIB_CORE, 'utf8');

  for (const { src, dist } of ADAPTERS) {
    const srcPath = path.join(SRC_DIR, src);
    const distPath = path.join(DIST_DIR, dist);

    let source = readFileSync(srcPath, 'utf8');

    if (!source.includes(MARKER)) {
      throw new Error(`${src}: missing "${MARKER}" marker — nowhere to inline core.js`);
    }

    // Read the previously-built dist file (if any) so we can bump the
    // version relative to what's actually live, not what's in src/
    // (src/ doesn't carry a version — dist/ is the versioned artifact).
    let previousVersion = null;
    try {
      const prevDist = readFileSync(distPath, 'utf8');
      const prevMatch = prevDist.match(VERSION_RE);
      if (prevMatch) previousVersion = prevMatch.slice(2).join('.');
    } catch {
      // No previous build; that's fine, first build starts at whatever
      // src/ declares.
    }

    let output = source.replace(MARKER, () => `\n${core}\n`);

    if (previousVersion !== null) {
      output = output.replace(VERSION_RE, (full, prefix) => `${prefix}${previousVersion}`);
      output = bumpVersion(output);
    }
    // else: first-ever build — keep whatever @version src/ declares as-is.

    writeFileSync(distPath, output, 'utf8');

    const finalVersion = output.match(VERSION_RE);
    console.log(`built ${dist} (v${finalVersion ? finalVersion.slice(2).join('.') : '?'})`);
  }
}

build();
