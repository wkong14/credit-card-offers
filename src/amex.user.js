// ==UserScript==
// @name         CC Offers — Amex
// @namespace    credit-card-offers
// @version      0.1.0
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

  //= INLINE core

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
