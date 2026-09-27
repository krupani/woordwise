/* WoordWise — conjugate.js
 * Show the English verb; user types all Dutch conjugation forms.
 * Requires base.js + offline.js.
 *
 * Source: data/verbs.js — only entries with a valid `conjugation` array.
 *
 * Data shape expected:
 *   { "en": "to be called", "nl": "heten", "conjugation": ["heet", "heet"] }
 *
 * Convention: `conjugation` holds the non-infinitive forms; `nl` is the
 * infinitive and is automatically appended as the last form (unless already
 * present in `conjugation`).
 *
 * Scoring:
 *   ok      — every box matches exactly (case-insensitive, order-independent)
 *   almost  — matches after stripping diacritics only
 *   bad     — anything else
 */

(function () {
    'use strict';

    /* ---------------- Config (tweak here) ---------------- */

    var SESSION_SIZE      = 10;
    var FEEDBACK_MS       = { ok: 700, almost: 1200, bad: 2200 };
    var MAX_INPUTS        = 4;
    var SHOW_DUTCH_HINT   = false;
    var PLACEHOLDER_BASE  = 'Conjugation';

    /* ---------------- State ---------------- */

    var ALL = [];
    var session = [];
    var currentIndex = 0;
    var currentWord = null;

    var okCount = 0;             // includes almost
    var almostCount = 0;
    var badCount = 0;

    var audio = {};
    var reduceMotion = false;
    var locked = false;
    var feedbackTimer = null;

    var els = {};
    var allInputs = [];
    var activeInputs = [];

    function $(id) { return document.getElementById(id); }
    function clearNode(el) { while (el.firstChild) el.removeChild(el.firstChild); }

    /* ---------------- Comparison ---------------- */

    function normalize(s) {
        return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    }
    function stripDiacritics(s) {
        return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    /**
     * Full list of expected forms for a verb: the explicit `conjugation` array
     * plus `nl` (the infinitive) appended if it isn't already there.
     */
    function expectedForms(word) {
        var forms = (word.conjugation || []).slice();
        if (word.nl && forms.indexOf(word.nl) === -1) forms.push(word.nl);
        return forms.slice(0, MAX_INPUTS);
    }

    function classify(values, answers) {
        var aNorm = values.map(normalize);
        var bNorm = answers.map(normalize);
        if (aNorm.length !== bNorm.length) return 'bad';
        if (aNorm.some(function (v) { return !v; })) return 'bad';

        var aSorted = aNorm.slice().sort();
        var bSorted = bNorm.slice().sort();

        var exact = aSorted.every(function (v, i) { return v === bSorted[i]; });
        if (exact) return 'ok';

        var aStripped = aSorted.map(stripDiacritics);
        var bStripped = bSorted.map(stripDiacritics);
        var almost = aStripped.every(function (v, i) { return v === bStripped[i]; });
        if (almost) return 'almost';

        return 'bad';
    }

    /* ---------------- Progress + score ---------------- */

    function buildProgress(n) {
        clearNode(els.progress);
        for (var i = 0; i < n; i++) {
            var seg = document.createElement('span');
            seg.className = 'conjugate-seg';
            els.progress.appendChild(seg);
        }
        if (els.progress.firstChild) els.progress.firstChild.classList.add('is-active');
    }

    function markProgress(i, kind) {
        var seg = els.progress.children[i];
        if (seg) {
            seg.classList.remove('is-active');
            seg.classList.add('is-' + (kind === 'ok' ? 'ok' :
                                      kind === 'almost' ? 'almost' : 'bad'));
        }
        var next = els.progress.children[i + 1];
        if (next) next.classList.add('is-active');
    }

    function updateScore() {
        els.scoreOk.textContent  = okCount;
        els.scoreBad.textContent = badCount;
    }

    /* ---------------- Session ---------------- */

    function startSession() {
        if (WoordWise.effects) WoordWise.effects.stop();
        if (!ALL.length) return;

        session      = WoordWise.Offline.buildSession(ALL, SESSION_SIZE);
        currentIndex = 0;
        okCount = almostCount = badCount = 0;
        locked = false;
        clearTimeout(feedbackTimer);

        updateScore();
        buildProgress(session.length);
        els.endScreen.hidden = true;

        nextRound();
    }

    function nextRound() {
        if (currentIndex >= session.length) { showEnd(); return; }

        currentWord = session[currentIndex];
        var conj = expectedForms(currentWord);

        /* Reset card */
        els.card.classList.remove('is-ok', 'is-almost', 'is-bad');
        els.cardEn.textContent   = currentWord.en || '';
        els.fbIcon.textContent   = '';
        els.fbMsg.textContent    = '';
        els.fbAnswer.textContent = '';

        if (SHOW_DUTCH_HINT && currentWord.nl) {
            els.cardHint.hidden = false;
            els.cardHint.textContent = currentWord.nl;
        } else {
            els.cardHint.hidden = true;
        }

        /* Prepare inputs. */
        activeInputs = [];
        for (var i = 0; i < allInputs.length; i++) {
            var inp = allInputs[i];
            if (i < conj.length) {
                inp.hidden = false;
                inp.value = '';
                inp.disabled = false;
                inp.placeholder = PLACEHOLDER_BASE + ' ' + (i + 1);
                activeInputs.push(inp);
            } else {
                inp.hidden = true;
                inp.value = '';
                inp.disabled = true;
            }
        }

        els.hintText.textContent =
            'Type ' + conj.length + ' form' + (conj.length === 1 ? '' : 's') +
            ' \u2014 order doesn\u2019t matter.';

        els.btnCheck.disabled = true;
        locked = false;

        requestAnimationFrame(function () {
            WoordWise.fitText(els.cardEn, els.cardEn.parentElement, { max: 44, min: 18 });
            if (activeInputs[0]) {
                try { activeInputs[0].focus(); } catch (e) {}
            }
        });
    }

    function onInputChanged() {
        if (locked) return;
        var allFilled = activeInputs.every(function (inp) { return normalize(inp.value); });
        els.btnCheck.disabled = !allFilled;
    }

    function submit() {
        if (locked || !currentWord) return;

        var values = activeInputs.map(function (inp) { return inp.value; });
        if (!values.every(function (v) { return normalize(v); })) return;

        locked = true;
        activeInputs.forEach(function (inp) { inp.disabled = true; });
        els.btnCheck.disabled = true;

        var forms  = expectedForms(currentWord);
        var result = classify(values, forms);
        var answerText = forms.join('  \u00B7  ');

        if (result === 'ok') {
            okCount++;
            WoordWise.playSound(audio, 'correct');
            showFeedback('ok', 'Correct!', '');
        } else if (result === 'almost') {
            okCount++;
            almostCount++;
            WoordWise.playSound(audio, 'almost');
            showFeedback('almost', 'Almost \u2014 watch the accents', answerText);
        } else {
            badCount++;
            WoordWise.playSound(audio, 'incorrect');
            showFeedback('bad', 'Not quite', answerText);
        }

        updateScore();
        markProgress(currentIndex, result);

        var delay = reduceMotion ? 500 : (FEEDBACK_MS[result] || 800);
        feedbackTimer = setTimeout(function () {
            currentIndex++;
            nextRound();
        }, delay);
    }

    function showFeedback(kind, msg, answer) {
        els.card.classList.add('is-' + kind);
        els.fbIcon.textContent = kind === 'ok' ? '\u2713' : kind === 'almost' ? '~' : '\u2717';
        els.fbMsg.textContent  = msg;
        els.fbAnswer.textContent = answer || '';
    }

    /* ---------------- End ---------------- */

    function showEnd() {
        var total = session.length;
        var score = okCount;
        els.endScore.textContent = score + ' / ' + total;

        var fullyCorrect = okCount - almostCount;
        var parts = [];
        if (fullyCorrect) parts.push(fullyCorrect + ' correct');
        if (almostCount)  parts.push(almostCount  + ' almost');
        if (badCount)     parts.push(badCount     + ' wrong');
        els.endBreakdown.textContent = parts.join(' \u00B7 ');

        var pct = total ? score / total : 0;
        var msg;
        if (score === total && almostCount === 0)    msg = 'Perfect! \uD83C\uDF89';
        else if (score === total && almostCount > 0) msg = 'All correct \u2014 watch the accents.';
        else if (pct >= 0.8)                          msg = 'Great job!';
        else if (pct >= 0.5)                          msg = 'Nice \u2014 keep going.';
        else                                          msg = 'Keep practicing!';
        els.endMsg.textContent = msg;

        els.endScreen.hidden = false;
        if (WoordWise.effects) WoordWise.effects.celebrate(okCount, total);
    }

    function showError(msg) {
        els.card.classList.remove('is-ok', 'is-almost', 'is-bad');
        clearNode(els.cardEn.parentElement);

        var d = document.createElement('div');
        d.style.cssText = 'padding:20px;text-align:center;color:#b3261e;font-size:14px;line-height:1.5;';
        d.textContent = msg;
        els.cardEn.parentElement.appendChild(d);

        activeInputs.forEach(function (inp) { inp.disabled = true; });
        els.btnCheck.disabled = true;
    }

    /* ---------------- Boot ---------------- */

    function init() {
        els.progress      = $('progress');
        els.card          = $('card');
        els.cardEn        = $('card-en');
        els.cardHint      = $('card-hint');
        els.fbIcon        = $('fb-icon');
        els.fbMsg         = $('fb-msg');
        els.fbAnswer      = $('fb-answer');
        els.inputsBox     = $('inputs-container');
        els.btnCheck      = $('btn-check');
        els.form          = $('answer-form');
        els.scoreOk       = $('score-ok');
        els.scoreBad      = $('score-bad');
        els.endScreen     = $('end-screen');
        els.endScore      = $('end-score');
        els.endBreakdown  = $('end-breakdown');
        els.endMsg        = $('end-msg');
        els.hintText      = $('hint-text');

        try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
        catch (e) { reduceMotion = false; }

        audio = WoordWise.preloadSounds();

        for (var i = 0; i < MAX_INPUTS; i++) {
            var inp = document.createElement('input');
            inp.type = 'text';
            inp.autocomplete   = 'off';
            inp.autocorrect    = 'off';
            inp.autocapitalize = 'off';
            inp.spellcheck     = false;
            inp.inputMode      = 'text';
            inp.setAttribute('enterkeyhint', i === MAX_INPUTS - 1 ? 'go' : 'next');
            inp.hidden = true;
            inp.disabled = true;
            inp.addEventListener('input', onInputChanged);
            els.inputsBox.appendChild(inp);
            allInputs.push(inp);
        }

        els.form.addEventListener('submit', function (e) {
            e.preventDefault();
            submit();
        });

        $('btn-again').addEventListener('click', startSession);

        WoordWise.Offline.loadGroup('verbs')
            .then(function (verbs) {
                var usable = verbs.filter(function (v) {
                    var hasConj = Array.isArray(v.conjugation) &&
                                  v.conjugation.length >= 1 &&
                                  v.conjugation.every(function (f) {
                                      return typeof f === 'string' && f.trim();
                                  });
                    return hasConj && typeof v.nl === 'string' && v.nl.trim();
                });
                if (!usable.length) {
                    throw new Error('no verbs with conjugations found in data/verbs.js');
                }
                ALL = usable;
                startSession();
            })
            .catch(function (err) {
                var msg = (err && err.message) ? err.message : 'unknown error';
                showError('Could not load verb data (' + msg + '). ' +
                          'Make sure data/verbs.js has entries with a "conjugation" array.');
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();