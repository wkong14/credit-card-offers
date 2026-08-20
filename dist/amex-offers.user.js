// ==UserScript==
// @name         CC Offers — Amex
// @namespace    credit-card-offers
// @version      0.1.2
// @description  Adds every available Amex Offer to the currently-selected card.
// @author       you
// @match        https://global.americanexpress.com/offers*
// @updateURL    https://raw.githubusercontent.com/wkong14/credit-card-offers/main/dist/amex-offers.user.js
// @downloadURL  https://raw.githubusercontent.com/wkong14/credit-card-offers/main/dist/amex-offers.user.js
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
    var debug = /ccoffers=debug/i.test(hash);
    var dryRun = /ccoffers=dryrun/i.test(hash);

    try {
      if (!debug && global.localStorage.getItem('ccOffersDebug')) debug = true;
      if (!dryRun && global.localStorage.getItem('ccOffersDryRun')) dryRun = true;
    } catch (e) {
      // localStorage can throw in locked-down contexts; hash flags still work.
    }

    return { debug: debug, dryRun: dryRun };
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

  function debugDump(candidates) {
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
          return (
            '  #' +
            i +
            ' <' +
            item.el.tagName.toLowerCase() +
            '> name="' +
            item.name +
            '" ' +
            describeAttrs(item.el)
          );
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
    discoverCandidates: discoverCandidates,
    classify: classify,
    MAX_CLICKS_PER_RUN: MAX_CLICKS_PER_RUN,
    MAX_CONSECUTIVE_ERRORS: MAX_CONSECUTIVE_ERRORS,
  };

  global.CCOffersCore = CCOffersCore;
})(window);



  var C = window.CCOffersCore;
  var RUN_KEY = 'amex';

  // Confirmed via discovery mode (Phase 1 dump):
  // - Add button: <button data-testid="merchantOfferListAddButton"> "add to list card"
  // - Already-added offers simply don't render that button at all — the tile
  //   becomes a plain link/anchor instead (its aria-label contains "Added").
  //   So there's no separate "skip already-added" filter needed on the button
  //   set itself; we only use the tile-level check to report an accurate count
  //   in the toast.
  var ADD_BUTTON_SELECTOR = '[data-testid="merchantOfferListAddButton"]';
  var TILE_SELECTOR = '[data-cy="commerce-tile"], [data-testid="commerce-tile"]';
  var ADDED_RE = /\badded\b/i;

  function collectAddButtons() {
    return Array.prototype.filter.call(document.querySelectorAll(ADD_BUTTON_SELECTOR), function (el) {
      return !el.disabled && el.getAttribute('aria-disabled') !== 'true';
    });
  }

  function countAlreadyAdded() {
    return Array.prototype.filter.call(document.querySelectorAll(TILE_SELECTOR), function (el) {
      return ADDED_RE.test(C.accName(el));
    }).length;
  }

  async function main() {
    var guard = C.runGuard(RUN_KEY);
    if (!guard) return; // already running on this page (SPA re-render)

    var flags = C.flags();
    var t = C.toast({ title: 'CC Offers — Amex', message: 'Loading offers…' });
    t.onStop(function () {
      guard.stopped = true;
    });

    try {
      await C.settle(function () {
        return document.querySelectorAll(TILE_SELECTOR).length;
      });

      var alreadyAdded = countAlreadyAdded();
      var added = 0;
      var errors = 0;

      if (flags.dryRun) {
        var wouldAdd = collectAddButtons().length;
        t.update({
          title: 'CC Offers — Amex',
          message: 'Dry run: would add ' + wouldAdd + ' · already added ' + alreadyAdded + ' · clicked nothing.',
        });
        guard.release();
        return;
      }

      while (!guard.stopped) {
        var buttons = collectAddButtons();
        if (buttons.length === 0) break;

        var btn = buttons[0];
        try {
          await C.clickSafely(btn);
          added += 1;
          if (!guard.recordClick()) {
            t.update({
              title: 'CC Offers — Amex',
              message: 'Stopped: hit the ' + C.MAX_CLICKS_PER_RUN + '-click safety cap.',
            });
            break;
          }
        } catch (e) {
          errors += 1;
          console.error('[cc-offers/amex] click failed', e);
          if (!guard.recordError()) {
            t.update({
              title: 'CC Offers — Amex',
              message: 'Stopped after ' + C.MAX_CONSECUTIVE_ERRORS + ' consecutive errors.',
            });
            break;
          }
        }

        t.update({
          title: 'CC Offers — Amex',
          message: 'Added ' + added + ' so far…',
          showStop: true,
        });
        await C.humanDelay();
      }

      t.update({
        title: 'CC Offers — Amex',
        message: 'Added ' + added + ' · already added ' + alreadyAdded + ' · errors ' + errors + '.',
      });
      window.setTimeout(function () {
        t.remove();
      }, 12000);

      guard.release();
    } catch (err) {
      console.error('[cc-offers/amex]', err);
      t.update({ title: 'CC Offers — Amex', message: 'Error: ' + err.message });
      guard.release();
    }
  }

  main();
})();
