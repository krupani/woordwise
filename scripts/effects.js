/* WoordWise — effects.js
 * Canvas particle effects for session-end celebrations.
 * Load AFTER base.js.
 *
 * Exposes:
 *   WoordWise.effects.celebrate(score, total)  — dispatch by tier
 *   WoordWise.effects.stop()                   — kill any running effect
 *   WoordWise.effects.CONFIG / .COLORS         — live-tweakable
 *
 * Tier (by score/total):
 *   < 0.6    failure    → falling dots    + failure.mp3
 *   < 0.9    wellTried  → rising bubbles  + well_tried.mp3
 *   < 1.0    success    → confetti        + success.mp3
 *   === 1.0  perfect    → confetti + fireworks + success.mp3
 *
 * No images, no libraries. One canvas overlay, cleaned up automatically.
 * Set any tier's mode to 'none' to disable its animation.
 */

(function () {
    'use strict';

    /* ---------------- Config (tweak here) ---------------- */

    var CONFIG = {
        failure: { mode: 'drops', sound: 'failure', spawnMs: 2200, soundDelay: 200 },
        wellTried: { mode: 'bubbles', sound: 'well_tried', spawnMs: 2400, soundDelay: 200 },
        success: { mode: 'confetti', sound: 'success', spawnMs: 3400, soundDelay: 250 },
        perfect: { mode: 'perfect', sound: 'success', spawnMs: 3400, fireworksMs: 5200, soundDelay: 250 }
    };

    var COLORS = {
        confetti: ['#FFD700', '#b39ddb', '#4CAF50', '#e05a5a', '#ffffff'],
        firework: ['#FFD700', '#b39ddb', '#4CAF50', '#ff6b9d', '#5bc0eb', '#0000FF'],
        bubble: ['#b39ddb', '#d4c5ff', '#8e7cc3'],
        drop: ['#a0a0a8', '#8b8b95', '#c4c4c8']
    };

    /* ---------------- State ---------------- */

    var canvas = null, ctx = null, dpr = 1;
    var W = 0, H = 0;
    var particles = [];
    var rafId = 0;
    var running = false;
    var mode = null;
    var spawnUntil = 0;
    var fireworksUntil = 0;
    var lastSpawn = 0;
    var lastFirework = 0;
    var sessionAudio = null;

    /* ---------------- Small helpers ---------------- */

    function rand(a, b) { return a + Math.random() * (b - a); }
    function pickColor(list) { return list[Math.floor(Math.random() * list.length)]; }

    function hexToRgba(hex, a) {
        var h = String(hex).replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var r = parseInt(h.substr(0, 2), 16);
        var g = parseInt(h.substr(2, 2), 16);
        var b = parseInt(h.substr(4, 2), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }

    function ensureAudio() {
        if (sessionAudio) return sessionAudio;
        sessionAudio = {};
        var S = (window.WoordWise && WoordWise.SOUNDS) || {};
        ['failure', 'well_tried', 'success'].forEach(function (k) {
            if (S[k]) {
                var a = new Audio(S[k]);
                a.preload = 'auto';
                sessionAudio[k] = a;
            }
        });
        return sessionAudio;
    }

    function playSessionSound(key) {
        var bag = ensureAudio();
        if (!bag[key]) return;
        try {
            bag[key].currentTime = 0;
            var p = bag[key].play();
            if (p && p.catch) p.catch(function () { });
        } catch (e) { }
    }

    /* ---------------- Canvas lifecycle ---------------- */

    function ensureCanvas() {
        if (canvas) return;
        canvas = document.createElement('canvas');
        canvas.className = 'ww-fx-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        document.body.appendChild(canvas);
        ctx = canvas.getContext('2d');
        resize();
        window.addEventListener('resize', resize);
    }

    function resize() {
        if (!canvas || !ctx) return;

        /* documentElement.clientWidth/Height is more reliable in
         * Android standalone PWAs than window.innerWidth/Height. */
        var vw = document.documentElement.clientWidth || window.innerWidth || 0;
        var vh = document.documentElement.clientHeight || window.innerHeight || 0;

        /* Guard: never build a zero-sized canvas. */
        if (vw < 1 || vh < 1) {
            vw = Math.max(vw, 320);
            vh = Math.max(vh, 480);
        }

        dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = vw;
        H = vh;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function destroyCanvas() {
        if (!canvas) return;
        window.removeEventListener('resize', resize);
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        canvas = null;
        ctx = null;
    }

    /* ---------------- Spawners ---------------- */

    function spawnConfettiBurst(x, y, count) {
        for (var i = 0; i < count; i++) {
            particles.push({
                kind: 'rect',
                x: x, y: y,
                vx: (Math.random() - 0.5) * 6,
                vy: -12 - Math.random() * 6,
                w: 4 + Math.random() * 4,
                h: 8 + Math.random() * 6,
                color: pickColor(COLORS.confetti),
                rot: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.3,
                gravity: 0.35,
                drag: 1,
                alpha: 1,
                fade: 0
            });
        }
    }

    function spawnBubbles(n) {
        for (var i = 0; i < n; i++) {
            var r = 4 + Math.random() * 9;
            particles.push({
                kind: 'circle',
                x: rand(0, W),
                y: H + r,
                vx: (Math.random() - 0.5) * 0.7,
                vy: -(3 + Math.random() * 2.5),
                r: r,
                color: pickColor(COLORS.bubble),
                gravity: 0,
                drag: 0.998,
                alpha: 0.9,
                fade: 0.0025
            });
        }
    }

    function spawnDrops(n) {
        for (var i = 0; i < n; i++) {
            particles.push({
                kind: 'circle',
                x: rand(0, W),
                y: -6,
                vx: (Math.random() - 0.5) * 0.3,
                vy: 0.9 + Math.random() * 1.4,
                r: 2 + Math.random() * 3,
                color: pickColor(COLORS.drop),
                gravity: 0.035,
                drag: 1,
                alpha: 0.9,
                fade: 0.002
            });
        }
    }

    function spawnFirework() {
        var cx = rand(W * 0.15, W * 0.85);
        var cy = rand(H * 0.12, H * 0.5);
        var color = pickColor(COLORS.firework);
        var count = 70;

        for (var i = 0; i < count; i++) {
            var angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.18;
            var speed = 5 + Math.random() * 8;
            particles.push({
                kind: 'circle',
                x: cx, y: cy,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                r: 4 + Math.random() * 4,
                color: color,
                gravity: 0.16,
                drag: 0.975,
                alpha: 1,
                fade: 0.005 + Math.random() * 0.005
            });
        }

        /* Glow — MUST include vx/vy so stepParticle doesn't turn x/y into NaN. */
        particles.push({
            kind: 'glow',
            x: cx, y: cy,
            vx: 0,
            vy: 0,
            r: 14,
            maxR: 110,
            growPerFrame: 2.2,
            color: color,
            alpha: 0.55,
            fade: 0.022
        });
    }

    /* ---------------- Update + draw ---------------- */

    function stepParticle(p) {
        /* Defensive: treat missing vx/vy as 0 so positions never go NaN. */
        var vx = (typeof p.vx === 'number' && isFinite(p.vx)) ? p.vx : 0;
        var vy = (typeof p.vy === 'number' && isFinite(p.vy)) ? p.vy : 0;

        if (p.gravity) vy += p.gravity;
        if (p.drag && p.drag !== 1) { vx *= p.drag; vy *= p.drag; }

        p.vx = vx;
        p.vy = vy;
        p.x += vx;
        p.y += vy;

        if (p.rotSpeed) p.rot += p.rotSpeed;
        if (p.fade) p.alpha -= p.fade;
        if (p.growPerFrame && p.r < p.maxR) p.r += p.growPerFrame;
    }

    function drawParticle(p) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));

        if (p.kind === 'rect') {
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        } else if (p.kind === 'circle') {
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
        } else if (p.kind === 'glow') {
            var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
            g.addColorStop(0, hexToRgba(p.color, 0.9));
            g.addColorStop(0.5, hexToRgba(p.color, 0.35));
            g.addColorStop(1, hexToRgba(p.color, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    function isAlive(p) {
        /* x/y are the only fields every particle shares — checking them alone
           is enough to prevent NaN reaching canvas draw calls. The r/w/h fields
           are kind-specific and set correctly at spawn time. */
        if (!isFinite(p.x) || !isFinite(p.y)) return false;
        if (p.alpha <= 0) return false;
        if (p.y > H + 120) return false;
        if (p.y < -200) return false;
        if (p.x < -160 || p.x > W + 160) return false;
        return true;
    }

    function tick(now) {
        if (!running) return;
        rafId = requestAnimationFrame(tick);

        /* Spawning */
        if (now < spawnUntil) {
            if (mode === 'confetti') {
                if (now - lastSpawn >= 280) { spawnConfettiBurst(rand(0, W), H + 10, 15); lastSpawn = now; }
            } else if (mode === 'bubbles') {
                if (now - lastSpawn >= 90) { spawnBubbles(2); lastSpawn = now; }
            } else if (mode === 'drops') {
                if (now - lastSpawn >= 80) { spawnDrops(1); lastSpawn = now; }
            }
        }
        if (mode === 'perfect' && now < fireworksUntil) {
            if (now - lastFirework >= 700) { spawnFirework(); lastFirework = now; }
        }

        /* Update + draw */
        ctx.clearRect(0, 0, W, H);
        for (var i = particles.length - 1; i >= 0; i--) {
            var p = particles[i];
            stepParticle(p);
            if (!isAlive(p)) { particles.splice(i, 1); continue; }

            /* A single bad particle can never break the frame again. */
            try {
                drawParticle(p);
            } catch (e) {
                particles.splice(i, 1);
            }
        }

        /* Terminate when nothing left and no more spawning planned */
        var spawning = now < spawnUntil || (mode === 'perfect' && now < fireworksUntil);
        if (!spawning && particles.length === 0) stop();
    }

    /* ---------------- Start / stop ---------------- */

    function start(modeName, spawnMs, fireworksMs) {
        ensureCanvas();
        resize();

        mode = modeName;
        particles.length = 0;

        var now = performance.now();
        spawnUntil = now + (spawnMs || 1500);
        fireworksUntil = (modeName === 'perfect' && fireworksMs) ? now + fireworksMs : 0;
        lastSpawn = 0;
        lastFirework = 0;

        if (modeName === 'confetti') {
            spawnConfettiBurst(rand(0, W), H + 10, 60);
        } else if (modeName === 'perfect') {
            spawnConfettiBurst(rand(0, W), H + 10, 60);
            spawnFirework();
            lastFirework = now;
        } else if (modeName === 'bubbles') {
            spawnBubbles(6);
        } else if (modeName === 'drops') {
            spawnDrops(2);
        }

        running = true;
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(tick);
    }

    function stop() {
        running = false;
        cancelAnimationFrame(rafId);
        rafId = 0;
        particles.length = 0;
        destroyCanvas();
    }

    /* ---------------- Public API ---------------- */

    function celebrate(score, total) {
        stop();

        var pct = total > 0 ? score / total : 0;
        var tier;
        if (pct >= 1) tier = 'perfect';
        else if (pct >= 0.9) tier = 'success';
        else if (pct >= 0.6) tier = 'wellTried';
        else tier = 'failure';

        var cfg = CONFIG[tier];
        if (!cfg) return;

        setTimeout(function () { playSessionSound(cfg.sound); }, cfg.soundDelay || 0);

        var reduce = false;
        try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
        catch (e) { }
        if (reduce) return;

        if (cfg.mode && cfg.mode !== 'none') start(cfg.mode, cfg.spawnMs, cfg.fireworksMs);
    }

    window.WoordWise = window.WoordWise || {};
    window.WoordWise.effects = {
        celebrate: celebrate,
        stop: stop,
        CONFIG: CONFIG,
        COLORS: COLORS
    };

    window.addEventListener('pagehide', stop);
})();