// ==UserScript==
// @name         CC Offers — Chase
// @namespace    credit-card-offers
// @version      0.1.0
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

  //= INLINE core

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
  // (confirmed by manual test) — so after every successful click, come
  // back before looking for the next tile. Only acts if we actually
  // left, so a click that turns out not to navigate (unexpected, but
  // not proven impossible) doesn't trigger a stray back-navigation.
  async function returnToOffersList() {
    try {
      await C.waitFor(function () {
        return !stillOnOffersList();
      }, 4000);
    } catch (e) {
      return; // never left — nothing to return from
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

  function loadProcessed(storageKey) {
    try {
      var raw = window.sessionStorage.getItem(storageKey);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (e) {
      return new Set();
    }
  }

  function saveProcessed(storageKey, set) {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(Array.from(set)));
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

      try {
        await C.clickSafely(el);
        added += 1;
        processed.add(key);
        saveProcessed(CAROUSEL_PROCESSED_KEY, processed);
        await returnToOffersList();

        if (!guard.recordClick()) {
          t.update({ title: 'CC Offers — Chase', message: 'Stopped: hit the ' + C.MAX_CLICKS_PER_RUN + '-click safety cap.' });
          break;
        }
      } catch (e) {
        errors += 1;
        // Mark as processed even on failure so a broken tile doesn't
        // loop forever re-attempting the same click.
        processed.add(key);
        saveProcessed(CAROUSEL_PROCESSED_KEY, processed);
        console.error('[cc-offers/chase] carousel click failed', e);

        if (!guard.recordError()) {
          t.update({ title: 'CC Offers — Chase', message: 'Stopped after ' + C.MAX_CONSECUTIVE_ERRORS + ' consecutive errors.' });
          break;
        }
      }

      t.update({ title: 'CC Offers — Chase', message: 'Carousel: added ' + added + ' so far…', showStop: true });
      await C.humanDelay();
    }

    return { added: added, errors: errors };
  }

  // Processes the "All Offers" grid. Same resumable pattern as the
  // carousel; no chevron here, just re-settle (re-scroll) if the pending
  // pool empties out in case more tiles lazy-load once earlier ones are
  // added and the layout shifts.
  async function processGrid(guard, t) {
    var processed = loadProcessed(GRID_PROCESSED_KEY);
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

      try {
        await C.clickSafely(el);
        added += 1;
        processed.add(key);
        saveProcessed(GRID_PROCESSED_KEY, processed);
        await returnToOffersList();

        if (!guard.recordClick()) {
          t.update({ title: 'CC Offers — Chase', message: 'Stopped: hit the ' + C.MAX_CLICKS_PER_RUN + '-click safety cap.' });
          break;
        }
      } catch (e) {
        errors += 1;
        processed.add(key);
        saveProcessed(GRID_PROCESSED_KEY, processed);
        console.error('[cc-offers/chase] grid click failed', e);

        if (!guard.recordError()) {
          t.update({ title: 'CC Offers — Chase', message: 'Stopped after ' + C.MAX_CONSECUTIVE_ERRORS + ' consecutive errors.' });
          break;
        }
      }

      t.update({ title: 'CC Offers — Chase', message: 'Grid: added ' + added + ' so far…', showStop: true });
      await C.humanDelay();
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
      await C.settle(function () {
        return document.querySelectorAll(TILE_SELECTOR).length;
      });

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
