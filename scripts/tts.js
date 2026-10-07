/* WoordWise — tts.js
 * Dutch text-to-speech via the Web Speech API.
 *
 * Platform quirks handled:
 *   1. Safari (macOS/iOS) uses AVSpeechSynthesizer, whose rate curve is
 *      non-linear and faster at the same numeric value than Chrome's.
 *      Fix: apply a per-platform rate multiplier.
 *   2. iOS Safari ignores rate values above ~1.8 and stutters below 0.5.
 *      Fix: clamp and scale for Safari.
 *   3. Chrome's utterance gets garbage-collected mid-speech unless held
 *      in a global reference. Fix: window.__wwTtsUtterance.
 *   4. getVoices() populates asynchronously on all platforms.
 *      Fix: voiceschanged listener + retry loop.
 *   5. Safari picks a voice by language but ignores explicit gender.
 *      Fix: prefer any explicitly-named female Dutch voice if present.
 *
 * Exposes on WoordWise.TTS:
 *   speak(text), isSupported(), hasDutchVoice(), attachTo(host, text)
 */

(function () {
    'use strict';

    var LANG = 'nl-NL';

    /* Base rate: tuned on Chrome/macOS. Other engines get scaled below. */
    var BASE_RATE = 0.95;

    var voiceCache = null;
    var voicesReady = false;
    var pendingResolvers = [];

    /* Global reference — prevents GC of the utterance mid-speech (Chrome). */
    window.__wwTtsUtterance = null;

    /* ---------------- Platform detection ---------------- */

    function isSafari() {
        var ua = navigator.userAgent;
        /* Safari is the only major browser that isn't Chromium/Firefox
         * but also isn't covered by the "CriOS"/"FxiOS" patterns. */
        var isChrome = /Chrome|CriOS|Chromium|Edg/i.test(ua);
        var isFirefox = /Firefox|FxiOS/i.test(ua);
        var isSafariUa = /Safari/i.test(ua) && !isChrome && !isFirefox;
        return isSafariUa;
    }

    function isIOS() {
        var ua = navigator.userAgent;
        /* iPadOS 13+ reports as Macintosh, so check touch points too. */
        if (/iPad|iPhone|iPod/.test(ua)) return true;
        if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
        return false;
    }

    /**
     * Engine-aware rate. Safari's engine runs faster at the same numeric
     * value, and its usable range is narrower. iOS needs the most damping.
     */
    function getRate() {
        if (isIOS() && isSafari()) return 0.65;   /* iPhone/iPad Safari + PWA */
        if (isSafari()) return 0.72;   /* macOS Safari */
        return BASE_RATE;                          /* Chrome/Edge/Firefox */
    }

    /* ---------------- Voice loading ---------------- */

       function pickDutchVoice(voices) {
        if (!voices || !voices.length) return null;

        var dutch = [];
        for (var i = 0; i < voices.length; i++) {
            if (/^nl/i.test(voices[i].lang)) dutch.push(voices[i]);
        }
        if (!dutch.length) return null;

        /* Priority order depends on the engine:
         *
         * Chrome/Chromium on desktop IGNORES local voices and falls back to
         * English. So Chrome must always prefer a remote voice.
         *
         * Safari honours local voices correctly. But its default Dutch voice
         * is male (Xander) and fast. Prefer a named female voice if the
         * user has one installed.
         */
        if (!isSafari()) {
            /* Chrome / Edge / Firefox: remote voice first. */
            for (var g = 0; g < dutch.length; g++) {
                if (dutch[g].localService === false &&
                    /google/i.test(dutch[g].name)) return dutch[g];
            }
            for (var r = 0; r < dutch.length; r++) {
                if (dutch[r].localService === false) return dutch[r];
            }
            /* No remote available — fall through to local as last resort. */
        } else {
            /* Safari: prefer a named female voice if available. */
            var preferredNames = ['lotte', 'claire', 'femke', 'ellen'];
            for (var p = 0; p < preferredNames.length; p++) {
                for (var q = 0; q < dutch.length; q++) {
                    if (dutch[q].name.toLowerCase().indexOf(preferredNames[p]) !== -1) {
                        return dutch[q];
                    }
                }
            }
        }

        /* Fallback for both engines: exact nl-NL, then any Dutch voice. */
        for (var l = 0; l < dutch.length; l++) {
            if (dutch[l].lang === 'nl-NL') return dutch[l];
        }
        return dutch[0];
    }

    function resolveVoices() {
        var voices = window.speechSynthesis.getVoices();
        if (!voices || !voices.length) return false;

        voiceCache = pickDutchVoice(voices);
        voicesReady = true;

        var resolvers = pendingResolvers.slice();
        pendingResolvers.length = 0;
        resolvers.forEach(function (r) { r(voiceCache); });

        return true;
    }

    function ensureVoices(callback) {
        if (voicesReady) { callback(voiceCache); return; }

        pendingResolvers.push(callback);
        if (resolveVoices()) return;

        if (!window.speechSynthesis.__wwListenerAttached) {
            window.speechSynthesis.__wwListenerAttached = true;
            window.speechSynthesis.addEventListener('voiceschanged', function () {
                resolveVoices();
            });
        }

        var tries = 0;
        (function retry() {
            if (voicesReady) return;
            tries++;
            if (resolveVoices()) return;
            if (tries > 20) return;
            setTimeout(retry, 250);
        })();
    }

    /* ---------------- Speak ---------------- */

    function speak(text) {
        if (!text) return false;
        if (!('speechSynthesis' in window)) return false;

        try { window.speechSynthesis.cancel(); } catch (e) { }

        ensureVoices(function (voice) {
            try {
                var u = new SpeechSynthesisUtterance(String(text));

                if (voice) {
                    u.lang = voice.lang;
                    u.voice = voice;
                    u.voiceURI = voice.voiceURI;
                } else {
                    u.lang = LANG;
                }

                u.rate = getRate();
                u.pitch = 1;

                /* Hold a global reference to defeat Chrome's GC. */
                window.__wwTtsUtterance = u;
                u.onend = function () { window.__wwTtsUtterance = null; };
                u.onerror = function () { window.__wwTtsUtterance = null; };

                window.speechSynthesis.speak(u);
            } catch (e) { /* ignore */ }
        });

        return true;
    }

    function isSupported() {
        return ('speechSynthesis' in window) && ('SpeechSynthesisUtterance' in window);
    }

    function hasDutchVoice() { return !!voiceCache; }

    /* ---------------- Speaker button ---------------- */

    var SPEAKER_SVG =
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/>' +
        '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>' +
        '<path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>' +
        '</svg>';

    function attachTo(host, text) {
        if (!host) return null;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ww-tts-btn';
        btn.setAttribute('aria-label', 'Play pronunciation');
        btn.setAttribute('title', 'Play pronunciation');
        btn.innerHTML = SPEAKER_SVG;

        if (!isSupported()) {
            btn.disabled = true;
            btn.title = 'Speech not supported in this browser';
            host.appendChild(btn);
            return btn;
        }

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            btn.classList.add('is-speaking');
            speak(text);
            setTimeout(function () { btn.classList.remove('is-speaking'); }, 700);
        });

        host.appendChild(btn);
        return btn;
    }

    /* ---------------- Boot ---------------- */

    if (isSupported()) {
        ensureVoices(function () { });
    }

    window.WoordWise = window.WoordWise || {};
    window.WoordWise.TTS = {
        LANG: LANG,
        speak: speak,
        isSupported: isSupported,
        hasDutchVoice: hasDutchVoice,
        attachTo: attachTo,
        getRate: getRate        /* exposed for debugging */
    };

})();