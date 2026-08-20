// ==UserScript==
// @name         CC Offers — Chase (discovery build)
// @namespace    credit-card-offers
// @version      0.1.0
// @description  Phase 1: dumps candidate elements on the Chase merchant-offers route so real selectors can be identified. Does not click anything.
// @author       you
// @match        https://secure.chase.com/*
// @updateURL    https://raw.githubusercontent.com/REPLACE_ME_GITHUB_USER/credit-card-offers/main/dist/chase-offers.user.js
// @downloadURL  https://raw.githubusercontent.com/REPLACE_ME_GITHUB_USER/credit-card-offers/main/dist/chase-offers.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  //= INLINE core

  var C = window.CCOffersCore;
  var RUN_KEY = 'chase';

  // Chase serves its whole authenticated dashboard from one URL and
  // routes internally — the merchant-offers screen lives under a hash
  // route rather than its own page load. @match on secure.chase.com/*
  // is intentionally broad because we don't yet know the exact route;
  // this guard is what keeps the script inert everywhere else on the
  // site. Confirm/tighten this string once discovery mode confirms the
  // real route (see README "Repairing after a reskin").
  var OFFERS_ROUTE_HINT = /merchantOffers/i;

  function onOffersRoute() {
    return OFFERS_ROUTE_HINT.test(window.location.hash || '') ||
      OFFERS_ROUTE_HINT.test(window.location.pathname || '');
  }

  function run() {
    if (!onOffersRoute()) return;

    var guard = C.runGuard(RUN_KEY);
    if (!guard) return; // already running for this render

    var flags = C.flags();

    C.settle(function () {
      return document.querySelectorAll(
        'button, [role="button"], input[type="submit"], a[role], select, [role="combobox"], [role="listbox"]'
      ).length;
    }).then(function () {
      if (flags.debug) {
        var candidates = C.discoverCandidates(document);
        C.debugDump(candidates);
        var t = C.toast({
          title: 'CC Offers — Chase',
          message: 'Discovery dump rendered above (' + candidates.length + ' candidates). Copy the text box and share it back.',
        });
        window.setTimeout(function () {
          t.remove();
        }, 15000);
      } else {
        var t2 = C.toast({
          title: 'CC Offers — Chase',
          message:
            'Discovery build — no clicking yet. Add <code>#ccoffers=debug</code> alongside the route hash and reload to dump candidates.',
        });
        window.setTimeout(function () {
          t2.remove();
        }, 8000);
      }

      guard.release();
    }).catch(function (err) {
      console.error('[cc-offers/chase]', err);
      guard.release();
    });
  }

  // Chase's dashboard is a single-page app: navigating to the offers
  // screen after initial load changes the hash without a full page
  // load, so document-idle alone would miss it. Re-check on every
  // hash change in addition to the initial run.
  window.addEventListener('hashchange', run);
  run();
})();
