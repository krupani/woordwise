/* WoordWise — dehet.js
 * De / Het swipe game. Requires base.js + offline.js loaded first.
 * Uses only data/nouns.js (needs the article field).
 */

(function () {
    'use strict';

    var SESSION_SIZE    = 10;
    var SWIPE_THRESHOLD = 80;

    var stage, elTop, elUnder, progressEl, flashEl, endScreen;
    var scoreOkEl, scoreBadEl, endScoreEl, endMsgEl, cardTpl;

    var ALL = [];
    var session = [];
    var currentIndex = 0;
    var currentWord = null;
    var okCount = 0;
    var badCount = 0;
    var locked = false;
    var audio = {};
    var flashTimer = null;
    var reduceMotion = false;

    var drag = { active: false, pointerId: null, startX: 0, startY: 0, x: 0, y: 0 };

    function $(id) { return document.getElementById(id); }
    function clearNode(el) { while (el.firstChild) el.removeChild(el.firstChild); }
    function resetInline(el) {
        el.style.transition = '';
        el.style.transform  = '';
        el.style.opacity    = '';
        el.style.filter     = '';
    }

    function renderCard(el, word) {
        clearNode(el);
        if (!word) { el.classList.add('is-empty'); return; }
        el.classList.remove('is-empty');

        var frag  = cardTpl.content.cloneNode(true);
        var wordE = frag.querySelector('.dehet-card-word');
        var enE   = frag.querySelector('.dehet-card-en');

        wordE.textContent = word.nl || '';
        enE.textContent   = word.en || '';

        el.appendChild(frag);
        requestAnimationFrame(function () {
            WoordWise.fitText(
                el.querySelector('.dehet-card-word'),
                el.querySelector('.dehet-card-word-area'),
                { max: 56, min: 16 }
            );
        });
    }

    function buildProgress(n) {
        clearNode(progressEl);
        for (var i = 0; i < n; i++) {
            var seg = document.createElement('span');
            seg.className = 'dehet-seg';
            progressEl.appendChild(seg);
        }
        if (progressEl.firstChild) progressEl.firstChild.classList.add('is-active');
    }

    function markProgress(i, correct) {
        var seg = progressEl.children[i];
        if (seg) {
            seg.classList.remove('is-active');
            seg.classList.add(correct ? 'is-ok' : 'is-bad');
        }
        var next = progressEl.children[i + 1];
        if (next) next.classList.add('is-active');
    }

    function updateScore() {
        scoreOkEl.textContent  = okCount;
        scoreBadEl.textContent = badCount;
    }

    function startSession() {
        if (WoordWise.effects) WoordWise.effects.stop();
        if (!ALL.length) return;

        session      = WoordWise.Offline.buildSession(ALL, SESSION_SIZE);
        currentIndex = 0;
        okCount      = 0;
        badCount     = 0;
        locked       = false;
        drag.active  = false;

        updateScore();
        buildProgress(session.length);
        endScreen.hidden = true;

        elTop   = $('card-top');
        elUnder = $('card-under');
        elTop.className   = 'dehet-card is-top';
        elUnder.className = 'dehet-card is-under';
        resetInline(elTop);
        resetInline(elUnder);

        currentWord = session[0];
        renderCard(elTop,   session[0]);
        renderCard(elUnder, session[1]);
    }

    function commit(direction) {
        if (locked || !currentWord) return;
        locked = true;
        drag.active = false;

        var correct = (direction === currentWord.article);

        if (correct) { okCount++;  WoordWise.playSound(audio, 'correct');   }
        else         { badCount++; WoordWise.playSound(audio, 'incorrect'); }

        updateScore();
        markProgress(currentIndex, correct);
        showFlash(correct);

        if (reduceMotion) { advance(); locked = false; return; }

        var dirSign = (direction === 'de') ? -1 : 1;
        var dx  = dirSign * (window.innerWidth + 200);
        var rot = dirSign * 25;

        elTop.style.transition = 'transform 0.34s cubic-bezier(.4,.6,.4,1), opacity 0.34s ease-out';
        elTop.style.transform  = 'translate(' + dx + 'px, ' + (drag.y || 0) + 'px) rotate(' + rot + 'deg)';
        elTop.style.opacity    = '0';

        setTimeout(function () { advance(); locked = false; }, 360);
    }

    function advance() {
        currentIndex++;
        if (currentIndex >= session.length) { showEnd(); return; }

        var tmp = elTop;
        elTop   = elUnder;
        elUnder = tmp;

        elTop.classList.remove('is-under');
        elTop.classList.add('is-top');
        resetInline(elTop);

        elUnder.className = 'dehet-card is-under';
        resetInline(elUnder);

        renderCard(elUnder, session[currentIndex + 1]);

        currentWord = session[currentIndex];
        if (!elTop.firstChild) renderCard(elTop, currentWord);
    }

    function showEnd() {
        var total = session.length;
        endScoreEl.textContent = okCount + ' / ' + total;

        var pct = total ? okCount / total : 0;
        var msg;
        if (okCount === total) msg = 'Perfect! \uD83C\uDF89';
        else if (pct >= 0.8)   msg = 'Great job!';
        else if (pct >= 0.5)   msg = 'Nice \u2014 keep going.';
        else                   msg = 'Keep practicing!';
        endMsgEl.textContent = msg;

        endScreen.hidden = false;
        if (WoordWise.effects) WoordWise.effects.celebrate(okCount, total);
    }

    function showFlash(correct) {
        if (!flashEl) return;
        flashEl.className = 'dehet-flash is-active ' + (correct ? 'is-ok' : 'is-bad');
        clearTimeout(flashTimer);
        flashTimer = setTimeout(function () {
            flashEl.className = 'dehet-flash ' + (correct ? 'is-ok' : 'is-bad');
        }, 260);
    }

    function onPointerDown(e) {
        if (locked || !elTop || elTop.classList.contains('is-empty')) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        var t = e.target;
        if (!(t === elTop || elTop.contains(t))) return;

        drag.active    = true;
        drag.pointerId = e.pointerId;
        drag.startX    = e.clientX;
        drag.startY    = e.clientY;
        drag.x = 0; drag.y = 0;

        elTop.style.transition = 'none';
        elTop.classList.add('is-dragging');
    }

    function onPointerMove(e) {
        if (!drag.active || e.pointerId !== drag.pointerId) return;
        drag.x = e.clientX - drag.startX;
        drag.y = e.clientY - drag.startY;
        applyDragTransform(drag.x, drag.y);
    }

    function onPointerUp(e) {
        if (!drag.active || e.pointerId !== drag.pointerId) return;
        drag.active = false;
        elTop.classList.remove('is-dragging');

        if (drag.x > SWIPE_THRESHOLD)       commit('het');
        else if (drag.x < -SWIPE_THRESHOLD) commit('de');
        else                                snapBack();
    }

    function applyDragTransform(x, y) {
        var rot = x * 0.05;
        elTop.style.transform = 'translate(' + x + 'px, ' + y + 'px) rotate(' + rot + 'deg)';

        var pct   = Math.min(1, Math.abs(x) / 120);
        var deOv  = elTop.querySelector('.dehet-card-overlay-de');
        var hetOv = elTop.querySelector('.dehet-card-overlay-het');
        if (deOv)  deOv.style.opacity  = (x < 0) ? pct : 0;
        if (hetOv) hetOv.style.opacity = (x > 0) ? pct : 0;
    }

    function snapBack() {
        elTop.style.transition = 'transform 0.2s ease-out';
        elTop.style.transform  = 'translate(0, 0) rotate(0)';

        var deOv  = elTop.querySelector('.dehet-card-overlay-de');
        var hetOv = elTop.querySelector('.dehet-card-overlay-het');
        if (deOv)  deOv.style.opacity  = 0;
        if (hetOv) hetOv.style.opacity = 0;
    }

    function onKeyDown(e) {
        if (endScreen && !endScreen.hidden) return;
        if (e.key === 'ArrowLeft')       { e.preventDefault(); commit('de');  }
        else if (e.key === 'ArrowRight') { e.preventDefault(); commit('het'); }
    }

    function showError(msg) {
        elTop.className   = 'dehet-card is-top';
        elUnder.className = 'dehet-card is-under is-empty';
        clearNode(elTop);
        clearNode(elUnder);

        var d = document.createElement('div');
        d.className = 'dehet-error';
        d.textContent = msg;
        elTop.appendChild(d);

        if (progressEl) clearNode(progressEl);
    }

    function init() {
        stage      = $('stage');
        progressEl = $('progress');
        flashEl    = $('flash');
        endScreen  = $('end-screen');
        scoreOkEl  = $('score-ok');
        scoreBadEl = $('score-bad');
        endScoreEl = $('end-score');
        endMsgEl   = $('end-msg');
        cardTpl    = $('card-tpl');
        elTop      = $('card-top');
        elUnder    = $('card-under');

        try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
        catch (e) { reduceMotion = false; }

        audio = WoordWise.preloadSounds();

        stage.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup',   onPointerUp);
        document.addEventListener('pointercancel', onPointerUp);
        document.addEventListener('keydown', onKeyDown);

        $('btn-de').addEventListener('click', function () { commit('de');  });
        $('btn-het').addEventListener('click', function () { commit('het'); });
        $('btn-again').addEventListener('click', startSession);

        WoordWise.Offline.loadGroup('nouns')
            .then(function (words) {
                if (!words.length) throw new Error('nouns.js has no valid entries');
                ALL = words;
                startSession();
            })
            .catch(function (err) {
                var msg = (err && err.message) ? err.message : 'unknown error';
                showError('Could not load noun data (' + msg + '). ' +
                          'Make sure data/nouns.js exists.');
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();