/* WoordWise — nietgeen.js
 * LLM-generated A2 sentences; user picks "niet" or "geen" for the blank.
 * Requires base.js + online.js + effects.js.
 *
 * Prompt stays local (game-specific). Loading UX comes from
 * WoordWise.Online.loadingTicker().
 */

(function () {
    'use strict';

    /* ---------------- Config ---------------- */

    var SESSION_SIZE = 10;
    var MIN_EACH = 3;
    var FEEDBACK_MS = { ok: 1600, bad: 3500 };
    var OUTER_TIMEOUT_MS = 45000;

    var SYSTEM_PROMPT = [
        'You are a Dutch language teacher creating A2-level exercises.',
        'The learner must choose between "niet" and "geen" in a blank.',
        '',
        'Rules:',
        '- Each sentence must be grammatically correct at A2 level (CEFR).',
        '- Each sentence has exactly one correct answer: "niet" OR "geen".',
        '- Never write sentences where both would be acceptable.',
        '- "niet" negates verbs, adjectives, adverbs, definite nouns (de/het), and proper nouns.',
        '- "geen" precedes indefinite nouns without an article (also plural and uncountable nouns).',
        '- Place the marker ___ (three underscores) where the negation word belongs.',
        '- Provide a short English translation of the full sentence.',
        '- Provide a one-sentence English explanation of why niet or geen is correct.',
        '- Keep the Dutch sentence under 15 words.',
        '',
        'Respond with strict JSON only \u2014 no prose, no markdown fences:',
        '{"sentences":[{"nl":"...___...","answer":"niet"|"geen","en":"...","explain":"..."}]}'
    ].join('\n');

    var USER_PROMPT = [
        'Generate ' + SESSION_SIZE + ' sentences.',
        'Aim for roughly 5 "niet" and 5 "geen".',
        'Never fewer than ' + MIN_EACH + ' of either.',
        'Return only the JSON object.'
    ].join(' ');

    /* ---------------- State ---------------- */

    var session = [];
    var currentIndex = 0;
    var okCount = 0;
    var badCount = 0;
    var locked = false;
    var audio = {};
    var reduceMotion = false;
    var feedbackTimer = null;
    var generationToken = 0;
    var hasSession = false;

    var ticker = null;

    var els = {};

    function $(id) { return document.getElementById(id); }
    function clearNode(el) { while (el.firstChild) el.removeChild(el.firstChild); }

    /* ---------------- Validation ---------------- */

    function isValidSentence(s) {
        if (!s || typeof s !== 'object') return false;
        if (typeof s.nl !== 'string' || s.nl.indexOf('___') === -1) return false;
        if (s.answer !== 'niet' && s.answer !== 'geen') return false;
        if (typeof s.en !== 'string' || !s.en.trim()) return false;
        if (typeof s.explain !== 'string' || !s.explain.trim()) return false;
        return true;
    }

    function pickUsable(data) {
        var arr = (data && Array.isArray(data.sentences)) ? data.sentences : [];
        var valid = arr.filter(isValidSentence);
        if (valid.length < SESSION_SIZE) return null;
        return valid.slice(0, SESSION_SIZE);
    }

    function mixOk(set) {
        var n = 0, g = 0;
        for (var i = 0; i < set.length; i++) {
            if (set[i].answer === 'niet') n++;
            else if (set[i].answer === 'geen') g++;
        }
        return n >= MIN_EACH && g >= MIN_EACH;
    }

    /* ---------------- Generation ---------------- */

    function withOuterTimeout(promise, ms) {
        var id;
        var timeout = new Promise(function (_, reject) {
            id = setTimeout(function () {
                var e = new Error('Gemini took too long to respond.');
                e.code = 'TIMEOUT';
                reject(e);
            }, ms);
        });
        return Promise.race([promise, timeout]).then(
            function (v) { clearTimeout(id); return v; },
            function (e) { clearTimeout(id); throw e; }
        );
    }

    function requestSentences() {
        return withOuterTimeout(
            WoordWise.Online.generate(USER_PROMPT, {
                system: SYSTEM_PROMPT,
                json: true
            }),
            OUTER_TIMEOUT_MS
        );
    }

    function generateSession() {
        var myToken = ++generationToken;
        showLoading();

        requestSentences()
            .then(function (data1) {
                if (myToken !== generationToken) return null;
                var set1 = pickUsable(data1);
                if (set1 && mixOk(set1)) return set1;

                if (ticker) ticker.retry();

                return requestSentences().then(function (data2) {
                    if (myToken !== generationToken) return null;
                    var set2 = pickUsable(data2);
                    if (set2) return set2;
                    if (set1) return set1;
                    throw new Error('The AI returned unusable sentences.');
                });
            })
            .then(function (set) {
                if (myToken !== generationToken) return;
                if (!set) return;
                startWithSet(set, false);
            })
            .catch(function (err) {
                if (myToken !== generationToken) return;
                tryCacheFallback(err);
            });
    }

    function startWithSet(set, fromCache) {
        session = WoordWise.shuffle(set);
        currentIndex = 0;
        okCount = 0;
        badCount = 0;
        locked = false;
        hasSession = true;
        clearTimeout(feedbackTimer);

        if (!fromCache) {
            set.forEach(function (s) {
                WoordWise.Cache.put('nietgeen', 'all', s);
            });
        }

        buildProgress(session.length);
        updateScore();
        showGame();

        if (fromCache) {
            WoordWise.Cache.showBadge(els.card, 'Offline \u2014 using saved questions');
        } else {
            WoordWise.Cache.hideBadge(els.card);
        }

        nextRound();
    }

    function tryCacheFallback(err) {
        var cached = WoordWise.Cache.sessionFromRules('nietgeen', ['all'], SESSION_SIZE);

        if (cached.length === SESSION_SIZE) {
            startWithSet(cached, true);
            return;
        }

        var msg;
        if (err && err.code === 'NO_KEY') {
            msg = 'Add a Gemini API key to play this game.';
            try { WoordWise.Online.openKeyModal(); } catch (e) { }
        } else if (err && err.code === 'TIMEOUT') {
            msg = 'Gemini took too long to respond. Try again, or try a different time of day.';
        } else {
            msg = (err && err.message) || 'Could not reach Gemini.';
        }
        showError(msg);
    }

    /* ---------------- UI states ---------------- */

    function showLoading() {
        if (ticker) ticker.stop();
        els.endScreen.hidden = true;
        els.loading.hidden = false;
        els.content.hidden = true;
        els.feedback.hidden = true;
        els.error.hidden = true;
        els.actions.hidden = true;
        els.card.classList.remove('is-ok', 'is-bad');
        WoordWise.Cache.hideBadge(els.card);

        ticker = WoordWise.Online.loadingTicker(els.loadingText);
    }

    function showGame() {
        if (ticker) { ticker.stop(); ticker = null; }
        els.loading.hidden = true;
        els.error.hidden = true;
        els.content.hidden = false;
        els.feedback.hidden = true;
        els.actions.hidden = false;
    }

    function showError(msg) {
        if (ticker) { ticker.stop(); ticker = null; }
        els.endScreen.hidden = true;
        els.loading.hidden = true;
        els.content.hidden = true;
        els.feedback.hidden = true;
        els.error.hidden = false;
        els.actions.hidden = true;
        els.errorMsg.textContent = msg;
        els.card.classList.remove('is-ok', 'is-bad');
    }

    /* ---------------- Progress + score ---------------- */

    function buildProgress(n) {
        clearNode(els.progress);
        for (var i = 0; i < n; i++) {
            var seg = document.createElement('span');
            seg.className = 'nietgeen-seg';
            els.progress.appendChild(seg);
        }
        if (els.progress.firstChild) els.progress.firstChild.classList.add('is-active');
    }

    function markProgress(i, correct) {
        var seg = els.progress.children[i];
        if (seg) {
            seg.classList.remove('is-active');
            seg.classList.add(correct ? 'is-ok' : 'is-bad');
        }
        var next = els.progress.children[i + 1];
        if (next) next.classList.add('is-active');
    }

    function updateScore() {
        els.scoreOk.textContent = okCount;
        els.scoreBad.textContent = badCount;
    }

    /* ---------------- Round rendering ---------------- */

    function nextRound() {
        if (currentIndex >= session.length) { showEnd(); return; }

        var s = session[currentIndex];

        els.revealBtn.hidden = false;
        els.translation.hidden = true;
        els.translation.textContent = '';

        renderSentence(s, null);

        els.feedback.hidden = true;
        els.fbIcon.textContent = '';
        els.fbMsg.textContent = '';
        els.fbExplain.textContent = '';

        els.card.classList.remove('is-ok', 'is-bad');
        els.btnNiet.disabled = false;
        els.btnGeen.disabled = false;
        locked = false;

        requestAnimationFrame(function () {
            WoordWise.fitText(els.sentence, els.content, { max: 26, min: 16, step: 1 });
        });
    }

    function renderSentence(s, answered) {
        clearNode(els.sentence);

        var parts = s.nl.split('___');
        var before = parts[0] || '';
        var after = parts.length > 1 ? parts.slice(1).join('___') : '';

        els.sentence.appendChild(document.createTextNode(before));

        var pill = document.createElement('span');
        pill.className = 'nietgeen-blank';
        if (answered) {
            pill.textContent = answered.value;
            pill.classList.add(answered.correct ? 'is-ok' : 'is-bad');
        } else {
            pill.textContent = '\u00A0\u00A0\u00A0\u00A0';
            pill.classList.add('is-empty');
        }
        els.sentence.appendChild(pill);

        els.sentence.appendChild(document.createTextNode(after));
    }

    /* ---------------- Answer ---------------- */

    function submit(choice) {
        if (locked || currentIndex >= session.length) return;
        locked = true;

        var s = session[currentIndex];
        var correct = (choice === s.answer);

        els.btnNiet.disabled = true;
        els.btnGeen.disabled = true;
        els.revealBtn.hidden = true;

        if (correct) {
            okCount++;
            WoordWise.playSound(audio, 'correct');
            els.card.classList.add('is-ok');
            els.fbIcon.textContent = '\u2713';
            els.fbMsg.textContent = 'Correct!';
        } else {
            badCount++;
            WoordWise.playSound(audio, 'incorrect');
            els.card.classList.add('is-bad');
            els.fbIcon.textContent = '\u2717';
            els.fbMsg.textContent = 'Not quite';
            els.fbExplain.textContent = s.answer.toUpperCase() + ' \u2014 ' + s.explain;
        }

        renderSentence(s, { value: choice, correct: correct });

        els.translation.textContent = s.en;
        els.translation.hidden = false;

        els.feedback.hidden = false;
        updateScore();
        markProgress(currentIndex, correct);

        var delay = reduceMotion ? 500 : (correct ? FEEDBACK_MS.ok : FEEDBACK_MS.bad);

        if (correct) {
            var delay = reduceMotion ? 500 : FEEDBACK_MS.ok;
            feedbackTimer = setTimeout(function () {
                currentIndex++;
                nextRound();
            }, delay);
        } else {
            WoordWise.Feedback.waitForNext(els.card, {
                isLast: (currentIndex === session.length - 1)
            }).then(function () {
                currentIndex++;
                nextRound();
            });
        }
    }

    function revealHint() {
        var s = session[currentIndex];
        if (!s) return;
        els.translation.textContent = s.en;
        els.translation.hidden = false;
        els.revealBtn.hidden = true;
    }

    /* ---------------- End ---------------- */

    function showEnd() {
        var total = session.length;
        els.endScore.textContent = okCount + ' / ' + total;
        els.endBreakdown.textContent = okCount + ' correct \u00B7 ' + badCount + ' wrong';

        var pct = total ? okCount / total : 0;
        var msg;
        if (okCount === total) msg = 'Perfect! \uD83C\uDF89';
        else if (pct >= 0.8) msg = 'Great job!';
        else if (pct >= 0.5) msg = 'Nice \u2014 keep going.';
        else msg = 'Keep practicing!';
        els.endMsg.textContent = msg;

        els.endScreen.hidden = false;
        if (WoordWise.effects) WoordWise.effects.celebrate(okCount, total);
    }

    /* ---------------- Boot ---------------- */

    function init() {
        els.progress = $('progress');
        els.card = $('card');
        els.content = $('content');
        els.loading = $('loading');
        els.loadingText = $('loading-text');
        els.sentence = $('sentence');
        els.revealBtn = $('reveal-btn');
        els.translation = $('translation');
        els.feedback = $('feedback');
        els.fbIcon = $('fb-icon');
        els.fbMsg = $('fb-msg');
        els.fbExplain = $('fb-explain');
        els.error = $('error');
        els.errorMsg = $('error-msg');
        els.btnRetry = $('btn-retry');
        els.btnSettings = $('btn-settings');
        els.actions = $('actions');
        els.btnNiet = $('btn-niet');
        els.btnGeen = $('btn-geen');
        els.scoreOk = $('score-ok');
        els.scoreBad = $('score-bad');
        els.endScreen = $('end-screen');
        els.endScore = $('end-score');
        els.endBreakdown = $('end-breakdown');
        els.endMsg = $('end-msg');

        try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
        catch (e) { reduceMotion = false; }

        audio = WoordWise.preloadSounds();

        els.btnNiet.addEventListener('click', function () { submit('niet'); });
        els.btnGeen.addEventListener('click', function () { submit('geen'); });
        els.revealBtn.addEventListener('click', revealHint);
        els.btnRetry.addEventListener('click', generateSession);
        els.btnSettings.addEventListener('click', function () {
            if (WoordWise.Online) WoordWise.Online.openKeyModal();
        });
        $('btn-again').addEventListener('click', function () {
            if (WoordWise.effects) WoordWise.effects.stop();
            generateSession();
        });

        window.addEventListener('woordwise:key-saved', function () {
            if (!hasSession) generateSession();
        });

        if (!WoordWise.Online) {
            showError('online.js did not load. Check your script tags.');
            return;
        }

        if (!WoordWise.Online.hasKey()) {
            showError('Add a Gemini API key to play this game.');
            try { WoordWise.Online.openKeyModal(); } catch (e) { }
            return;
        }

        generateSession();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();