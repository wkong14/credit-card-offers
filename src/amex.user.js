// ==UserScript==
// @name         CC Offers — Amex (discovery build)
// @namespace    credit-card-offers
// @version      0.1.0
// @description  Phase 1: dumps candidate elements on the Amex Offers page so real selectors can be identified. Does not click anything.
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

  function main() {
    var guard = C.runGuard(RUN_KEY);
    if (!guard) return; // already running on this page (SPA re-render)

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
          title: 'CC Offers — Amex',
          message: 'Discovery dump rendered above (' + candidates.length + ' candidates). Copy the text box and share it back.',
        });
        window.setTimeout(function () {
          t.remove();
        }, 15000);
      } else {
        var t2 = C.toast({
          title: 'CC Offers — Amex',
          message:
            'Discovery build — no clicking yet. Add <code>#ccoffers=debug</code> to the URL and reload to dump candidates.',
        });
        window.setTimeout(function () {
          t2.remove();
        }, 8000);
      }

      guard.release();
    }).catch(function (err) {
      console.error('[cc-offers/amex]', err);
      guard.release();
    });
  }

  main();
})();
