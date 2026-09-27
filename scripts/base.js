/* WoordWise — base.js
 * Shared chrome + utilities. NO Gemini logic — see online.js.
 *
 * Exposes on window.WoordWise:
 *   SOUNDS, shuffle, fitText, preloadSounds, playSound, safeText
 *
 * Boot:
 *   - Injects the "← WoordWise" home link on every non-home page.
 *   - If <body data-llm="on"> and online.js is loaded, calls Online.init()
 *     so the Gemini button appears. Pages without that attribute get no button.
 */

(function () {
    'use strict';

    var SOUNDS = {
        correct:    'media/sounds/correct.mp3',
        incorrect:  'media/sounds/incorrect.mp3',
        almost:     'media/sounds/correct.mp3',
        failure:    'media/sounds/failure.mp3',
        well_tried: 'media/sounds/well_tried.mp3',
        success:    'media/sounds/success.mp3'
    };

    function shuffle(a) {
        var arr = a.slice();
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
    }

    function fitText(textEl, areaEl, opts) {
        if (!textEl || !areaEl) return;
        opts = opts || {};
        var max  = opts.max  || 56;
        var min  = opts.min  || 16;
        var step = opts.step || 2;

        var size = max;
        textEl.style.fontSize = size + 'px';
        void areaEl.offsetHeight;

        while (size > min) {
            if (areaEl.scrollHeight <= areaEl.clientHeight + 1 &&
                areaEl.scrollWidth  <= areaEl.clientWidth  + 1) break;
            size -= step;
            textEl.style.fontSize = size + 'px';
        }
    }

    function preloadSounds() {
        var bag = {};
        Object.keys(SOUNDS).forEach(function (k) {
            var a = new Audio(SOUNDS[k]);
            a.preload = 'auto';
            a.volume  = 1;
            bag[k] = a;
        });
        return bag;
    }

    function playSound(bag, key) {
        if (!bag || !bag[key]) return;
        try {
            bag[key].currentTime = 0;
            var p = bag[key].play();
            if (p && p.catch) p.catch(function () {});
        } catch (e) {}
    }

    function safeText(el, text) {
        if (!el) return;
        el.textContent = text == null ? '' : String(text);
    }

    function injectHomeLink() {
        var page = document.body.dataset.page || 'game';
        if (page === 'home') return;
        if (document.querySelector('.ww-home-link')) return;

        var a = document.createElement('a');
        a.href = 'index.html';
        a.className = 'ww-home-link';
        a.textContent = '\u2190 WoordWise';
        document.body.appendChild(a);
    }

    window.WoordWise = {
        SOUNDS: SOUNDS,
        shuffle: shuffle,
        fitText: fitText,
        preloadSounds: preloadSounds,
        playSound: playSound,
        safeText: safeText
    };

    function boot() {
        injectHomeLink();

        var wantLlm = document.body.dataset.llm === 'on';
        if (wantLlm &&
            window.WoordWise && window.WoordWise.Online &&
            typeof window.WoordWise.Online.init === 'function') {
            try { window.WoordWise.Online.init(); } catch (e) {}
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();