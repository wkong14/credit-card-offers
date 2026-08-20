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
  // surfaces exist on this page, both add inline (no navigation, no
  // separate detail-page button — confirmed by manually tapping a grid
  // tile):
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
  // Neither surface showed a confirmed "already added" example for
  // Chase in discovery (unlike Amex, where one was seen), so the
  // added-state exclusion below is a best-effort guess consistent with
  // Amex's wording rather than something directly observed on Chase.
  // ------------------------------------------------------------------
  var TILE_SELECTOR = '[data-cy="commerce-tile"], [data-testid="commerce-tile"]';
  var RIGHT_CHEVRON_SELECTOR = '[data-testid="carouselRightChevron"]';
  var ADD_OFFER_SUFFIX_RE = /\badd offer\s*$/i;
  var ADDED_RE = /\badded\b/i;
  var LEADING_ORDINAL_RE = /^\d+\s+of\s+\d+\s*/i;

  var CAROUSEL_PROCESSED_KEY = 'ccOffersChaseProcessedCarousel';
  var GRID_PROCESSED_KEY = 'ccOffersChaseProcessedGrid';
  var MAX_NAV_CLICKS = 40; // separate from MAX_CLICKS_PER_RUN, which counts Add-clicks

  function isCarouselAddableTile(el) {
    return ADD_OFFER_SUFFIX_RE.test(C.accName(el).trim());
  }

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

    var flags = C.flags();
    var t = C.toast({ title: 'CC Offers — Chase', message: 'Loading offers…' });
    t.onStop(function () {
      guard.stopped = true;
    });

    try {
      await C.settle(function () {
        return document.querySelectorAll(TILE_SELECTOR).length;
      });

      if (flags.dryRun) {
        // Undercounts the carousel, since this only reflects tiles
        // currently rendered before any chevron pagination.
        var wouldAddCarousel = Array.prototype.filter.call(document.querySelectorAll(TILE_SELECTOR), isCarouselAddableTile).length;
        var wouldAddGrid = Array.prototype.filter.call(document.querySelectorAll(TILE_SELECTOR), isGridAddableTile).length;
        t.update({
          title: 'CC Offers — Chase',
          message: 'Dry run: would add ' + wouldAddCarousel + ' carousel + ' + wouldAddGrid + ' grid offers (grid count may grow with pagination) · clicked nothing.',
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
