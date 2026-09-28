/* WoordWise — feedback.js
 * Manual dismissal for wrong-answer and almost-answer feedback.
 *
 * Why: learners (especially kids and slower readers) need time to study the
 * correct answer. Timers rush them. This replaces the setTimeout-based
 * auto-advance with an explicit "Next" button + tap-anywhere.
 *
 * Renders:
 *   ┌──────────────────────────┐
 *   │  ...feedback content...  │
 *   │                          │
 *   │   Tap anywhere to        │
 *   │      continue            │
 *   │  ┌────────────────────┐  │
 *   │  │      Next →        │  │
 *   │  └────────────────────┘  │
 *   └──────────────────────────┘
 *
 * The block is absolutely positioned at the bottom of the container, so it
 * renders correctly on fixed-height cards (Spell It, Conjugate) and
 * grow-with-content cards (Sentence, Re-Order, Vocabulary, Niet/Geen).
 */

(function () {
    'use strict';

    function waitForNext(container, opts) {
        opts = opts || {};
        return new Promise(function (resolve) {

            if (!container) { resolve(); return; }

            var label = opts.label || (opts.isLast ? 'See results' : 'Next \u2192');

            /* --- Block with hint + button --- */
            var block = document.createElement('div');
            block.className = 'ww-next-block';

            var hint = document.createElement('div');
            hint.className = 'ww-next-hint';
            hint.textContent = 'Tap anywhere to continue';
            block.appendChild(hint);

            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ww-next-btn';
            btn.textContent = label;
            block.appendChild(btn);

            /* --- Cleanup --- */
            var resolved = false;

            function finish() {
                if (resolved) return;
                resolved = true;

                container.removeEventListener('click', onTap);
                document.removeEventListener('keydown', onKey);

                container.classList.remove('has-next-block');
                if (block.parentNode) block.parentNode.removeChild(block);

                resolve();
            }

            /* --- Handlers --- */
            function onTap(e) {
                /* Ignore clicks on links and other interactive elements
                 * the game may still own. */
                var t = e.target;
                if (t && t.closest && t.closest('a, input, textarea, select')) return;
                /* Ignore clicks on the Next button itself; its own handler
                 * fires first and stops propagation. */
                if (t && t.closest && t.closest('.ww-next-btn')) return;
                finish();
            }

            function onKey(e) {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                    if (document.activeElement === btn) {
                        e.preventDefault();
                        finish();
                    }
                }
            }

            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                finish();
            });

            /* --- Mount --- */
            container.appendChild(block);
            container.classList.add('has-next-block');

            /* Defer tap-anywhere binding by one frame so the click that
             * triggered the wrong answer doesn't immediately dismiss it. */
            requestAnimationFrame(function () {
                if (resolved) return;
                container.addEventListener('click', onTap);
            });
            document.addEventListener('keydown', onKey);

            /* Focus the button so keyboard users can just press Enter. */
            setTimeout(function () {
                try { btn.focus({ preventScroll: true }); } catch (e) { }
            }, 30);
        });
    }

    window.WoordWise = window.WoordWise || {};
    window.WoordWise.Feedback = {
        waitForNext: waitForNext
    };

})();