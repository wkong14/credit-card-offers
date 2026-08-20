// ==UserScript==
// @name         CC Offers — Chase
// @namespace    credit-card-offers
// @version      0.1.9
// @description  Adds every available Chase offer (personalized carousel + full "All Offers" grid) to the currently-selected card.
// @author       you
// @match        https://secure.chase.com/*
// @updateURL    https://raw.githubusercontent.com/wkong14/credit-card-offers/main/dist/chase-offers.user.js
// @downloadURL  https://raw.githubusercontent.com/wkong14/credit-card-offers/main/dist/chase-offers.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  
// credit-card-offers/lib/core.js
//
// Shared helpers for the Chase + Amex offer-adding userscripts.
// This file is the single source of truth. It is NOT shipped as-is —
// tools/build.mjs inlines its contents into src/*.user.js to produce
// standalone files in dist/. Edit here, never edit dist/ by hand.
//
// Design notes (see plan for full rationale):
// - No credentials are read, stored, or transmitted. This only clicks
//   buttons inside the page the browser already has open and authenticated.
// - iOS Safari has no JS console, so debug/dry-run flags are read from the
//   URL hash (#ccoffers=debug / #ccoffers=dryrun), not localStorage typed
//   in by hand. localStorage is still supported as a secondary source since
//   it's the natural mechanism on desktop and persists across page loads.
// - Chase uses the URL hash for its own SPA routing, so the flag parser
//   must not clobber an existing route hash.

(function (global) {
  'use strict';

  // ---------------------------------------------------------------------
  // flags() — read debug / dry-run mode without a console.
  //
  // Accepts either:
  //   #ccoffers=debug        (bare, when the site has no other hash route)
  //   #/dashboard/foo&ccoffers=dryrun   (appended alongside an existing route)
  // or localStorage.ccOffersDebug / ccOffersDryRun set to a truthy value.
  // ---------------------------------------------------------------------
  function flags() {
    var hash = String(global.location.hash || '');
    // "debughtml" is a superset of "debug" (matches both regexes below by
    // design) — it means "dump candidates, AND include markup snippets,"
    // not a separate mode.
    var debug = /ccoffers=debug/i.test(hash);
    var debugHtml = /ccoffers=debughtml/i.test(hash);
    var dryRun = /ccoffers=dryrun/i.test(hash);

    try {
      if (!debug && global.localStorage.getItem('ccOffersDebug')) debug = true;
      if (!debugHtml && global.localStorage.getItem('ccOffersDebugHtml')) debugHtml = true;
      if (!dryRun && global.localStorage.getItem('ccOffersDryRun')) dryRun = true;
    } catch (e) {
      // localStorage can throw in locked-down contexts; hash flags still work.
    }

    return { debug: debug, debugHtml: debugHtml, dryRun: dryRun };
  }

  // ---------------------------------------------------------------------
  // waitFor(fn, timeoutMs) — poll fn() every 200ms until it returns a
  // truthy value, or reject after timeoutMs. Used for lazy-loaded tiles
  // and post-navigation re-renders.
  // ---------------------------------------------------------------------
  function waitFor(fn, timeoutMs) {
    var timeout = timeoutMs || 8000;
    var intervalMs = 200;
    var elapsed = 0;
    return new Promise(function (resolve, reject) {
      (function poll() {
        var result;
        try {
          result = fn();
        } catch (e) {
          result = null;
        }
        if (result) {
          resolve(result);
          return;
        }
        elapsed += intervalMs;
        if (elapsed >= timeout) {
          reject(new Error('waitFor timed out after ' + timeout + 'ms'));
          return;
        }
        global.setTimeout(poll, intervalMs);
      })();
    });
  }

  // ---------------------------------------------------------------------
  // settle(countFn) — scroll to the bottom of the page repeatedly until
  // countFn() stops increasing across two consecutive checks. Handles
  // infinite-scroll / lazy-loaded offer tiles on both issuers.
  // ---------------------------------------------------------------------
  function settle(countFn) {
    var maxRounds = 20;
    var stillMs = 700;

    return new Promise(function (resolve) {
      var lastCount = -1;
      var stableRounds = 0;
      var round = 0;

      (function tick() {
        var count = 0;
        try {
          count = countFn();
        } catch (e) {
          count = 0;
        }

        if (count === lastCount) {
          stableRounds += 1;
        } else {
          stableRounds = 0;
          lastCount = count;
        }

        round += 1;

        // Two stable checks in a row (no growth) or we've scrolled enough
        // rounds that further scrolling isn't finding anything new.
        if (stableRounds >= 2 || round >= maxRounds) {
          resolve(count);
          return;
        }

        global.scrollTo(0, global.document.body.scrollHeight);
        global.setTimeout(tick, stillMs);
      })();
    });
  }

  // ---------------------------------------------------------------------
  // humanDelay() — randomized 900-2200ms. Not evasion of bot detection;
  // it exists so the SPA has time to re-render between clicks and so the
  // issuer's endpoint isn't hammered click-after-click.
  // ---------------------------------------------------------------------
  function humanDelay() {
    var ms = 900 + Math.floor(Math.random() * 1300);
    return new Promise(function (resolve) {
      global.setTimeout(resolve, ms);
    });
  }

  // ---------------------------------------------------------------------
  // accName(el) — accessible name approximation, used as the basis for
  // all text-based matching so we're not dependent on data-* attributes
  // that break on reskin.
  // ---------------------------------------------------------------------
  function accName(el) {
    if (!el) return '';
    var label = el.getAttribute && el.getAttribute('aria-label');
    if (label && label.trim()) return label.trim();
    var title = el.getAttribute && el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    var text = el.textContent || '';
    return text.replace(/\s+/g, ' ').trim();
  }

  // ---------------------------------------------------------------------
  // clickSafely(el) — scrollIntoView, then native click, then a
  // synthetic MouseEvent fallback if the native click throws or appears
  // to do nothing. Retries up to 3 times total.
  // ---------------------------------------------------------------------
  function clickSafely(el) {
    var attempts = 0;
    var maxAttempts = 3;

    return new Promise(function (resolve, reject) {
      (function attempt() {
        attempts += 1;
        try {
          if (el.scrollIntoView) {
            el.scrollIntoView({ block: 'center', inline: 'center' });
          }
          el.click();
          resolve(true);
          return;
        } catch (e) {
          try {
            var evt = new global.MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: global,
            });
            el.dispatchEvent(evt);
            resolve(true);
            return;
          } catch (e2) {
            if (attempts >= maxAttempts) {
              reject(e2);
              return;
            }
            global.setTimeout(attempt, 500);
          }
        }
      })();
    });
  }

  // ---------------------------------------------------------------------
  // toast(initialState) — status overlay rendered in a shadow root so
  // issuer CSS can't clobber it. Returns a controller with .update(),
  // .onStop(handler), and .remove().
  // ---------------------------------------------------------------------
  function toast(initialState) {
    var host = global.document.createElement('div');
    host.setAttribute(
      'style',
      'position:fixed;bottom:16px;right:16px;z-index:2147483647;' +
        'font-family:-apple-system,system-ui,sans-serif;'
    );
    var root = host.attachShadow({ mode: 'closed' });

    var style = global.document.createElement('style');
    style.textContent =
      '.panel{background:#1c1c1e;color:#fff;border-radius:12px;padding:12px 14px;' +
      'min-width:220px;box-shadow:0 4px 16px rgba(0,0,0,.35);font-size:13px;line-height:1.4;}' +
      '.title{font-weight:600;margin-bottom:4px;}' +
      '.row{display:flex;justify-content:space-between;margin-top:6px;gap:8px;}' +
      'button{background:#3a3a3c;color:#fff;border:none;border-radius:8px;' +
      'padding:6px 10px;font-size:12px;cursor:pointer;}' +
      'button:active{background:#54545a;}';
    root.appendChild(style);

    var panel = global.document.createElement('div');
    panel.className = 'panel';
    root.appendChild(panel);

    var stopHandlers = [];

    function render(state) {
      var s = state || {};
      var lines = [];
      lines.push('<div class="title">' + (s.title || 'Card Offers') + '</div>');
      lines.push('<div>' + (s.message || '') + '</div>');
      panel.innerHTML = lines.join('');

      if (s.showStop) {
        var row = global.document.createElement('div');
        row.className = 'row';
        var btn = global.document.createElement('button');
        btn.textContent = 'Stop';
        btn.addEventListener('click', function () {
          stopHandlers.forEach(function (h) {
            h();
          });
        });
        row.appendChild(btn);
        panel.appendChild(row);
      }
    }

    render(initialState);
    global.document.documentElement.appendChild(host);

    return {
      update: render,
      onStop: function (handler) {
        stopHandlers.push(handler);
      },
      remove: function () {
        if (host.parentNode) host.parentNode.removeChild(host);
      },
    };
  }

  // ---------------------------------------------------------------------
  // runGuard(key) — prevents double-firing when an SPA re-renders the
  // same page (e.g. after a card switch), enforces a hard cap on clicks
  // per run, and tracks consecutive errors so a broken selector aborts
  // instead of looping uselessly.
  // ---------------------------------------------------------------------
  var MAX_CLICKS_PER_RUN = 120;
  var MAX_CONSECUTIVE_ERRORS = 3;

  function runGuard(key) {
    var sentinelKey = '__ccOffersRunning_' + key;
    if (global[sentinelKey]) {
      return null; // already running; caller should bail out
    }
    global[sentinelKey] = true;

    var clicks = 0;
    var consecutiveErrors = 0;

    return {
      // Set to true by a caller's toast Stop handler; loops should check
      // this between iterations. Not a method because callers read it as
      // a plain property from inside a while-loop condition.
      stopped: false,
      release: function () {
        global[sentinelKey] = false;
      },
      recordClick: function () {
        clicks += 1;
        consecutiveErrors = 0;
        return clicks < MAX_CLICKS_PER_RUN;
      },
      recordError: function () {
        consecutiveErrors += 1;
        return consecutiveErrors < MAX_CONSECUTIVE_ERRORS;
      },
      clickCount: function () {
        return clicks;
      },
    };
  }

  // ---------------------------------------------------------------------
  // Discovery mode heuristics.
  //
  // We don't know the real markup yet, so discovery casts wide and then
  // buckets what it finds — rather than pre-filtering to a guessed
  // selector and coming back with nothing. Each bucket maps to one of
  // the things Phase 1 needs answered: which element is the add button,
  // which one signals "already added", which is pagination, which is
  // the card/account switcher.
  // ---------------------------------------------------------------------
  // The 'add' rule matches either a bare "Add" label, or a longer descriptive
  // label that ENDS in one of the known add phrasings — real markup turned out
  // to be things like `"1 of 18 Turo $30 cash back Add Offer"` (Chase, suffix)
  // and `"add to list card"` (Amex, whole string) rather than a clean "Add".
  var CLASSIFY_RULES = [
    { group: 'add', re: /(^\s*add\s*$)|(\badd\s+(offer|to\s+card|to\s+list\s+card)\s*$)/i },
    { group: 'added-state', re: /\b(added|activated|expired|expires)\b/i },
    { group: 'pagination', re: /load\s*more|show\s*more|^\s*next\s*$|view\s*more/i },
    { group: 'card-selector', re: /ending in|card ending|••••|\*{4}|last 4/i },
  ];

  function classify(name) {
    for (var i = 0; i < CLASSIFY_RULES.length; i += 1) {
      if (CLASSIFY_RULES[i].re.test(name)) return CLASSIFY_RULES[i].group;
    }
    return 'other';
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.offsetParent === null && el.tagName !== 'BODY') {
      // offsetParent is null for fixed/absolute-positioned visible elements
      // too, so also accept anything with a non-zero client rect.
      var rects = el.getClientRects ? el.getClientRects() : [];
      if (!rects || rects.length === 0) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------
  // discoverCandidates(doc) — gather every plausibly-interactive element
  // on the page: buttons, role="button", submit inputs, links styled as
  // buttons, and selects/comboboxes (candidate card/account switchers).
  // Deduplicated, visible-only, capped so the dump stays readable.
  // ---------------------------------------------------------------------
  var DISCOVERY_SELECTOR =
    'button, [role="button"], input[type="submit"], a[role], select, [role="combobox"], [role="listbox"]';
  var MAX_DISCOVERY_CANDIDATES = 400;

  function discoverCandidates(doc) {
    var d = doc || global.document;
    var nodeList = d.querySelectorAll(DISCOVERY_SELECTOR);
    var seen = new Set();
    var out = [];

    for (var i = 0; i < nodeList.length && out.length < MAX_DISCOVERY_CANDIDATES; i += 1) {
      var el = nodeList[i];
      if (seen.has(el)) continue;
      seen.add(el);
      if (!isVisible(el)) continue;

      var name = accName(el);
      out.push({ el: el, name: name, group: classify(name) });
    }

    return out;
  }

  // ---------------------------------------------------------------------
  // debugDump(candidates) — discovery mode. Renders a copyable overlay,
  // grouped by classify() bucket, listing each candidate element's tag,
  // accessible name, aria-label, and data-* attributes. This is the tool
  // used to find real selectors on first setup and to repair the script
  // after a bank reskins its offers page — never guess selectors without
  // running this first.
  //
  // Accepts either the raw output of discoverCandidates() (array of
  // {el, name, group}) or a plain array of elements (group inferred).
  // ---------------------------------------------------------------------
  function describeAttrs(el) {
    var attrs = [];
    if (el.attributes) {
      for (var a = 0; a < el.attributes.length; a += 1) {
        var attr = el.attributes[a];
        if (attr.name.indexOf('data-') === 0 || attr.name === 'aria-label' || attr.name === 'role') {
          attrs.push(attr.name + '="' + attr.value + '"');
        }
      }
    }
    return attrs.join(' ');
  }

  // A "state" conveyed only by an icon (e.g. a checkmark with no
  // accompanying text) is invisible to accName()/describeAttrs(), which
  // only look at the candidate's OWN attributes and text — not its
  // children. This is what surfaces that: a bounded, whitespace-collapsed
  // snippet of the element's actual markup, so an inner <svg>/<img>/class
  // name shows up in the dump instead of silently vanishing.
  var HTML_SNIPPET_MAX_LEN = 220;

  function htmlSnippet(el) {
    var html = '';
    try {
      html = el.outerHTML || '';
    } catch (e) {
      html = '';
    }
    html = html.replace(/\s+/g, ' ').trim();
    return html.length > HTML_SNIPPET_MAX_LEN ? html.slice(0, HTML_SNIPPET_MAX_LEN) + '…' : html;
  }

  function debugDump(candidates, opts) {
    var includeHtml = !!(opts && opts.html);
    var normalized = candidates.map(function (item) {
      if (item && item.el) return item;
      var name = accName(item);
      return { el: item, name: name, group: classify(name) };
    });

    var groups = {};
    normalized.forEach(function (item) {
      if (!groups[item.group]) groups[item.group] = [];
      groups[item.group].push(item);
    });

    var groupOrder = ['add', 'added-state', 'pagination', 'card-selector', 'other'];
    var sections = groupOrder
      .filter(function (g) {
        return groups[g] && groups[g].length;
      })
      .map(function (g) {
        var lines = groups[g].map(function (item, i) {
          var line =
            '  #' +
            i +
            ' <' +
            item.el.tagName.toLowerCase() +
            '> name="' +
            item.name +
            '" ' +
            describeAttrs(item.el);
          if (includeHtml) {
            line += '\n      html: ' + htmlSnippet(item.el);
          }
          return line;
        });
        return '== ' + g + ' (' + groups[g].length + ') ==\n' + lines.join('\n');
      });

    var text = sections.join('\n\n') || '(no candidates found)';

    var box = global.document.createElement('textarea');
    box.value = text;
    box.setAttribute(
      'style',
      'position:fixed;top:8px;left:8px;right:8px;height:60vh;z-index:2147483647;' +
        'font-family:monospace;font-size:11px;padding:8px;box-sizing:border-box;' +
        'background:#fff;color:#000;border:2px solid #000;'
    );
    global.document.documentElement.appendChild(box);
    box.focus();
    box.select();

    return text;
  }

  var CCOffersCore = {
    flags: flags,
    waitFor: waitFor,
    settle: settle,
    humanDelay: humanDelay,
    accName: accName,
    clickSafely: clickSafely,
    toast: toast,
    runGuard: runGuard,
    debugDump: debugDump,
    htmlSnippet: htmlSnippet,
    discoverCandidates: discoverCandidates,
    classify: classify,
    MAX_CLICKS_PER_RUN: MAX_CLICKS_PER_RUN,
    MAX_CONSECUTIVE_ERRORS: MAX_CONSECUTIVE_ERRORS,
  };

  global.CCOffersCore = CCOffersCore;
})(window);



  var C = window.CCOffersCore;
  var RUN_KEY = 'chase';

  // Chase serves its whole authenticated dashboard from one URL and routes
  // internally — confirmed via discovery mode that the merchant-offers screen
  // lives under a hash route. @match on secure.chase.com/* is intentionally
  // broad because the exact route wasn't known ahead of time; this guard is
  // what keeps the script inert everywhere else on the site.
  var OFFERS_ROUTE_HINT = /merchantOffers/i;

  function onOffersRoute() {
    return OFFERS_ROUTE_HINT.test(window.location.hash || '') || OFFERS_ROUTE_HINT.test(window.location.pathname || '');
  }

  // ------------------------------------------------------------------
  // Confirmed via discovery mode + manual test. Two distinct offer
  // surfaces exist on this page. Clicking a tile on EITHER surface is a
  // single action that both adds the offer and navigates to a detail
  // page showing its terms and an "Added to card" confirmation — it's
  // not two steps (no separate Add button to hunt for on that page).
  // Confirmed getting back to the list works via plain browser back
  // (a breadcrumb "<" also exists, but history.back() covers it and
  // needs no selector).
  //
  // 1. A personalized carousel (~18 offers) whose tile aria-label ends
  //    in "Add Offer", e.g. "1 of 18 Turo $30 cash back Add Offer".
  //    Paginated via a right-chevron button, not vertical scroll.
  //
  // 2. A full "All Offers" grid (~107 offers) whose tiles carry no such
  //    suffix, e.g. "1 of 107 Chevron 3% cash back" — the tile itself
  //    IS the add button; there's no separate control. Loaded via
  //    vertical scroll (handled by settle()).
  //
  // Already-added detection differs between the two:
  // - Carousel: no already-added example has been directly observed,
  //   but the "Add Offer" suffix is that tile's own call-to-action text
  //   — it's a reasonable inference (not yet a confirmed observation)
  //   that an already-added tile simply drops it, the same way Amex's
  //   Add button disappears once used. isCarouselAddableTile() already
  //   requires that suffix to be PRESENT, so this needs no separate
  //   exclusion check.
  // - Grid: confirmed via manual observation that Chase shows a green
  //   checkmark icon for an already-added tile, with NO text change —
  //   there is no textual signal to key off of (unlike the carousel's
  //   suffix), so isGridAddableTile() can't distinguish a checkmarked
  //   tile from an addable one and may click one again. Confirmed via
  //   manual check that the detail page offers no remove/undo option,
  //   so this is a harmless redundant round-trip (an extra navigate +
  //   click + back cycle, and an inflated "added" count including
  //   re-clicks of already-added tiles) rather than a real risk — not
  //   worth blocking on, unlike the click mechanism itself was.
  // ------------------------------------------------------------------
  var TILE_SELECTOR = '[data-cy="commerce-tile"], [data-testid="commerce-tile"]';
  var RIGHT_CHEVRON_SELECTOR = '[data-testid="carouselRightChevron"]';
  var ADD_OFFER_SUFFIX_RE = /\badd offer\s*$/i;
  var ADDED_RE = /\badded\b/i;
  var LEADING_ORDINAL_RE = /^\d+\s+of\s+\d+\s*/i;
  var ADDED_CONFIRMATION_RE = /added to (your\s+)?card/i;
  var MAX_TILE_ATTEMPTS = 2; // one retry before giving up on a single offer

  var CAROUSEL_PROCESSED_KEY = 'ccOffersChaseProcessedCarousel';
  var GRID_PROCESSED_KEY = 'ccOffersChaseProcessedGrid';
  var MAX_NAV_CLICKS = 40; // separate from MAX_CLICKS_PER_RUN, which counts Add-clicks

  // Snapshot of the offers list's own hash, taken once per run() — lets
  // stillOnOffersList() use exact equality instead of re-testing
  // OFFERS_ROUTE_HINT, which could plausibly also match a detail-page
  // sub-route (e.g. "#/dashboard/merchantOffers/detail/123").
  var listRouteHash = null;

  function stillOnOffersList() {
    return listRouteHash !== null && window.location.hash === listRouteHash;
  }

  // A tile click both adds the offer AND navigates to its detail page
  // (confirmed by manual test), showing text matching ADDED_CONFIRMATION_RE
  // — this is what confirmAdded() waits for, so a click only counts as a
  // real success once actually verified, not just because the click event
  // fired without throwing. A slow page load (real-world Chase latency,
  // not something this script can shortcut) previously meant a click
  // could be counted as "added" before the add had actually happened,
  // which is the likely cause of offers silently not going through.
  async function confirmAdded() {
    try {
      await C.waitFor(function () {
        return ADDED_CONFIRMATION_RE.test(document.body.textContent || '');
      }, 6000);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Comes back to the offers list after a tile click. `knownToHaveLeft`
  // skips the initial "did we navigate" poll when the caller already
  // confirmed it via confirmAdded() (avoids a redundant wait in the
  // common case); otherwise it checks first, since a click that turns
  // out not to have navigated shouldn't trigger a stray back-navigation.
  async function returnToOffersList(knownToHaveLeft) {
    if (!knownToHaveLeft) {
      try {
        await C.waitFor(function () {
          return !stillOnOffersList();
        }, 4000);
      } catch (e) {
        return; // never left — nothing to return from
      }
    }

    window.history.back();
    try {
      await C.waitFor(stillOnOffersList, 8000);
    } catch (e) {
      // Didn't confirm landing back within 8s; let the caller's next
      // loop iteration re-check naturally rather than looping here.
    }
    await C.settle(function () {
      return document.querySelectorAll(TILE_SELECTOR).length;
    });
  }

  // Clicks one tile and verifies it actually added before counting it.
  // Returns 'added', 'retry' (caller should try the same tile again —
  // it stays in `processed`-excluded state since its key was never
  // added), or 'gaveup' (failed confirmation MAX_TILE_ATTEMPTS times;
  // marked processed anyway so a systematically broken tile can't loop
  // forever). A thrown click error is treated the same as 'gaveup',
  // immediately, since retrying a click that itself failed to fire is
  // less likely to help than retrying one that fired but wasn't
  // confirmed in time.
  async function attemptAddTile(el, key, processed, storageKey, retryCounts, label) {
    try {
      await C.clickSafely(el);
    } catch (e) {
      console.error('[cc-offers/chase] ' + label + ' click failed for', key, e);
      processed.add(key);
      saveProcessed(storageKey, processed);
      return 'gaveup';
    }

    var confirmed = await confirmAdded();

    if (confirmed) {
      processed.add(key);
      saveProcessed(storageKey, processed);
      await returnToOffersList(true);
      return 'added';
    }

    retryCounts[key] = (retryCounts[key] || 0) + 1;
    await returnToOffersList(false);

    if (retryCounts[key] >= MAX_TILE_ATTEMPTS) {
      processed.add(key);
      saveProcessed(storageKey, processed);
      console.error('[cc-offers/chase] ' + label + ' gave up on', key, 'after', retryCounts[key], 'unconfirmed attempts');
      return 'gaveup';
    }

    return 'retry';
  }

  // Real pacing between tile clicks is provided by the click's own
  // navigate/confirm/return round-trip — this is just enough of a pause
  // to not immediately hammer the next click, not the ~1-2s human-style
  // delay used for Amex's genuinely-instant inline clicks (there is no
  // equivalent real-world pacing to lean on there).
  function briefDelay() {
    var ms = 250 + Math.floor(Math.random() * 350);
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  function isCarouselAddableTile(el) {
    return ADD_OFFER_SUFFIX_RE.test(C.accName(el).trim());
  }

  // KNOWN GAP, accepted as low-risk: see the block comment above
  // TILE_SELECTOR. ADDED_RE only catches an already-added state conveyed
  // as text; Chase's grid uses an icon instead, so this can't tell a
  // checkmarked tile apart from an addable one — confirmed harmless to
  // re-click (no remove/undo option exists), so left as-is rather than
  // built out further.
  function isGridAddableTile(el) {
    var name = C.accName(el).trim();
    return !ADD_OFFER_SUFFIX_RE.test(name) && !ADDED_RE.test(name);
  }

  // The leading "N of M" ordinal shifts as tiles scroll/paginate, so it's
  // excluded from the identity used to track what's already been clicked —
  // merchant name + cashback amount is what's stable across renders. Works
  // for both surfaces since the carousel's "Add Offer" suffix is stripped
  // too.
  function tileKey(el) {
    return C.accName(el).replace(ADD_OFFER_SUFFIX_RE, '').replace(LEADING_ORDINAL_RE, '').trim();
  }

  // Bump this whenever what counts as "processed" changes semantics —
  // e.g. adding confirmAdded() meant a click alone used to be enough to
  // mark something processed, and now it isn't. Without this, a
  // sessionStorage record written by an OLDER, buggier version of this
  // script (one that marked things "processed" too eagerly) would keep
  // suppressing real offers indefinitely under a newer, fixed version —
  // sessionStorage survives a script update within the same tab session,
  // it has no idea the rules for what "processed" means just changed.
  var PROCESSED_SCHEMA_VERSION = 2;

  function loadProcessed(storageKey) {
    try {
      var raw = window.sessionStorage.getItem(storageKey);
      if (!raw) return new Set();
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== PROCESSED_SCHEMA_VERSION) return new Set(); // stale schema — discard, don't trust it
      return new Set(parsed.keys || []);
    } catch (e) {
      return new Set();
    }
  }

  function saveProcessed(storageKey, set) {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify({ v: PROCESSED_SCHEMA_VERSION, keys: Array.from(set) }));
    } catch (e) {
      // sessionStorage can be unavailable in some contexts; resumability
      // is a nice-to-have, not a correctness requirement, so ignore.
    }
  }

  // Processes the personalized carousel. Resumable by design: progress is
  // persisted to sessionStorage keyed by a stable per-offer identity, so if
  // something interrupts the run (Stop, error cap, page reload) a later run
  // — triggered by the hashchange listener below, or a fresh page load —
  // picks up where it left off instead of re-clicking or losing count.
  async function processCarousel(guard, t) {
    var processed = loadProcessed(CAROUSEL_PROCESSED_KEY);
    var retryCounts = {};
    var added = 0;
    var errors = 0;
    var navClicks = 0;
    var stagnantRounds = 0;
    var lastSeenCount = -1;

    while (!guard.stopped) {
      var tiles = Array.prototype.filter.call(document.querySelectorAll(TILE_SELECTOR), isCarouselAddableTile);
      var pending = tiles.filter(function (el) {
        return !processed.has(tileKey(el));
      });

      if (pending.length === 0) {
        var chevron = document.querySelector(RIGHT_CHEVRON_SELECTOR);
        var chevronDisabled = !chevron || chevron.disabled || chevron.getAttribute('aria-disabled') === 'true';

        if (chevronDisabled || navClicks >= MAX_NAV_CLICKS) break;

        if (tiles.length === lastSeenCount) {
          stagnantRounds += 1;
          if (stagnantRounds >= 2) break; // carousel exhausted or wrapped back to start
        } else {
          stagnantRounds = 0;
          lastSeenCount = tiles.length;
        }

        navClicks += 1;
        await C.clickSafely(chevron);
        await C.humanDelay();
        continue;
      }

      var el = pending[0];
      var key = tileKey(el);
      var outcome = await attemptAddTile(el, key, processed, CAROUSEL_PROCESSED_KEY, retryCounts, 'carousel');

      if (outcome === 'added') {
        added += 1;
        if (!guard.recordClick()) {
          t.update({ title: 'CC Offers — Chase', message: 'Stopped: hit the ' + C.MAX_CLICKS_PER_RUN + '-click safety cap.' });
          break;
        }
      } else if (outcome === 'gaveup') {
        errors += 1;
        if (!guard.recordError()) {
          t.update({ title: 'CC Offers — Chase', message: 'Stopped after ' + C.MAX_CONSECUTIVE_ERRORS + ' consecutive errors.' });
          break;
        }
      }
      // 'retry': loop again — this tile's key was never added to
      // `processed`, so it's picked up again next iteration.

      t.update({ title: 'CC Offers — Chase', message: 'Carousel: added ' + added + ' so far…', showStop: true });
      await briefDelay();
    }

    return { added: added, errors: errors };
  }

  // Processes the "All Offers" grid. Same resumable pattern as the
  // carousel; no chevron here, just re-settle (re-scroll) if the pending
  // pool empties out in case more tiles lazy-load once earlier ones are
  // added and the layout shifts.
  async function processGrid(guard, t) {
    var processed = loadProcessed(GRID_PROCESSED_KEY);
    var retryCounts = {};
    var added = 0;
    var errors = 0;
    var stagnantRounds = 0;

    while (!guard.stopped) {
      var tiles = Array.prototype.filter.call(document.querySelectorAll(TILE_SELECTOR), isGridAddableTile);
      var pending = tiles.filter(function (el) {
        return !processed.has(tileKey(el));
      });

      if (pending.length === 0) {
        var countBefore = tiles.length;
        await C.settle(function () {
          return document.querySelectorAll(TILE_SELECTOR).length;
        });
        var tilesAfter = Array.prototype.filter.call(document.querySelectorAll(TILE_SELECTOR), isGridAddableTile);

        if (tilesAfter.length === countBefore) {
          stagnantRounds += 1;
          if (stagnantRounds >= 2) break; // nothing new after re-settling; grid exhausted
        } else {
          stagnantRounds = 0;
        }
        continue;
      }

      var el = pending[0];
      var key = tileKey(el);
      var outcome = await attemptAddTile(el, key, processed, GRID_PROCESSED_KEY, retryCounts, 'grid');

      if (outcome === 'added') {
        added += 1;
        if (!guard.recordClick()) {
          t.update({ title: 'CC Offers — Chase', message: 'Stopped: hit the ' + C.MAX_CLICKS_PER_RUN + '-click safety cap.' });
          break;
        }
      } else if (outcome === 'gaveup') {
        errors += 1;
        if (!guard.recordError()) {
          t.update({ title: 'CC Offers — Chase', message: 'Stopped after ' + C.MAX_CONSECUTIVE_ERRORS + ' consecutive errors.' });
          break;
        }
      }
      // 'retry': loop again — this tile's key was never added to
      // `processed`, so it's picked up again next iteration.

      t.update({ title: 'CC Offers — Chase', message: 'Grid: added ' + added + ' so far…', showStop: true });
      await briefDelay();
    }

    return { added: added, errors: errors };
  }

  async function run() {
    if (!onOffersRoute()) return;

    var guard = C.runGuard(RUN_KEY);
    if (!guard) return; // already running for this render

    // Snapshot now, before anything clicks and potentially navigates —
    // this is what returnToOffersList() compares against later.
    listRouteHash = window.location.hash;

    var flags = C.flags();
    var t = C.toast({ title: 'CC Offers — Chase', message: 'Loading offers…' });
    t.onStop(function () {
      guard.stopped = true;
    });

    try {
      var tileCount = await C.settle(function () {
        return document.querySelectorAll(TILE_SELECTOR).length;
      });
      // Cheap diagnostic, always on: if a run ever again reports 0/0
      // with no errors, this is the first thing to check in Safari's
      // console — distinguishes "found tiles but treated them all as
      // already processed" from "found no tiles matching TILE_SELECTOR
      // at all" (a page-structure change, needing discovery mode).
      console.log('[cc-offers/chase] tiles found at settle:', tileCount);

      if (flags.debug) {
        var candidates = C.discoverCandidates(document);
        C.debugDump(candidates, { html: flags.debugHtml });
        t.update({
          title: 'CC Offers — Chase',
          message: 'Discovery dump rendered above (' + candidates.length + ' candidates). Copy it and share it back.',
        });
        guard.release();
        return;
      }

      if (flags.dryRun) {
        // Undercounts the carousel, since this only reflects tiles
        // currently rendered before any chevron pagination.
        var wouldAddCarousel = Array.prototype.filter.call(document.querySelectorAll(TILE_SELECTOR), isCarouselAddableTile).length;
        var wouldAddGrid = Array.prototype.filter.call(document.querySelectorAll(TILE_SELECTOR), isGridAddableTile).length;
        t.update({
          title: 'CC Offers — Chase',
          message: 'Dry run: would add ' + wouldAddCarousel + ' carousel + ' + wouldAddGrid + ' grid offers (both counts may grow with pagination/scrolling) · clicked nothing.',
        });
        guard.release();
        return;
      }

      var carouselResult = await processCarousel(guard, t);
      var gridResult = { added: 0, errors: 0 };
      if (!guard.stopped) {
        gridResult = await processGrid(guard, t);
      }

      t.update({
        title: 'CC Offers — Chase',
        message:
          'Carousel: added ' + carouselResult.added + ', errors ' + carouselResult.errors + '. ' +
          'Grid: added ' + gridResult.added + ', errors ' + gridResult.errors + '.',
      });
      window.setTimeout(function () {
        t.remove();
      }, 15000);

      guard.release();
    } catch (err) {
      console.error('[cc-offers/chase]', err);
      t.update({ title: 'CC Offers — Chase', message: 'Error: ' + err.message });
      guard.release();
    }
  }

  // Chase's dashboard is a single-page app: navigating to the offers screen
  // after initial load changes the hash without a full page load, so
  // document-idle alone would miss it. Re-check on every hash change too.
  window.addEventListener('hashchange', run);
  run();
})();
