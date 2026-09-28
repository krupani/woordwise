/* WoordWise — cache.js
 * Rolling localStorage cache of AI-generated questions.
 * Load AFTER base.js.
 *
 * Purpose: when the AI is unreachable, games fall back to the last 20
 * sentences per bucket and still let the user play.
 *
 * Storage layout:
 *   dutch.cache.version               — schema version (bump = wipe all)
 *   dutch.cache.<namespace>.<bucket>  — JSON array, oldest first, max 20 items
 *
 * Namespaces used:
 *   'sentences'  — Re-Order and Sentence (bucket = grammar rule)
 *   'nietgeen'   — Niet / Geen        (single bucket: 'all')
 *
 * Exposes on WoordWise.Cache:
 *   put(ns, bucket, item)             — add; dedup by JSON; FIFO cap at 20
 *   get(ns, bucket, n)                — returns the most recent n items
 *   has(ns, bucket), count(ns, bucket)
 *   totalCount(ns)                    — sum across all buckets in namespace
 *   sessionFromRules(ns, rules, n)    — build a shuffled session from buckets
 *   clearAll(), clearNamespace(ns)
 *   showBadge(el, text), hideBadge(el)
 */

(function () {
    'use strict';

    var PREFIX = 'dutch.cache.';
    var VERSION_KEY = PREFIX + 'version';
    var VERSION = '1';
    var MAX_PER_BUCKET = 20;

    /* ---------------- safe localStorage ---------------- */

    function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function safeSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    function safeDel(k) { try { localStorage.removeItem(k); } catch (e) { } }

    /* ---------------- version guard ---------------- */

    function ensureVersion() {
        var v = safeGet(VERSION_KEY);
        if (v !== VERSION) {
            clearAll();
            safeSet(VERSION_KEY, VERSION);
        }
    }

    /* ---------------- bucket IO ---------------- */

    function bucketKey(ns, bucket) {
        return PREFIX + ns + '.' + bucket;
    }

    function loadBucket(ns, bucket) {
        var raw = safeGet(bucketKey(ns, bucket));
        if (!raw) return [];
        try {
            var arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
    }

    function saveBucket(ns, bucket, arr) {
        var trimmed = arr.length > MAX_PER_BUCKET
            ? arr.slice(arr.length - MAX_PER_BUCKET)
            : arr;
        safeSet(bucketKey(ns, bucket), JSON.stringify(trimmed));
    }

    function listBuckets(ns) {
        var pre = PREFIX + ns + '.';
        var ids = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf(pre) === 0) ids.push(k.slice(pre.length));
            }
        } catch (e) { }
        return ids;
    }

    /* ---------------- public bucket API ---------------- */

    function put(ns, bucket, item) {
        if (!ns || !bucket || !item) return false;

        var arr = loadBucket(ns, bucket);
        var key = JSON.stringify(item);

        for (var i = 0; i < arr.length; i++) {
            if (JSON.stringify(arr[i]) === key) return false;
        }

        arr.push(item);
        saveBucket(ns, bucket, arr);
        return true;
    }

    function get(ns, bucket, n) {
        var arr = loadBucket(ns, bucket);
        if (!n || n >= arr.length) return arr.slice();
        return arr.slice(arr.length - n);
    }

    function has(ns, bucket) { return loadBucket(ns, bucket).length > 0; }
    function count(ns, bucket) { return loadBucket(ns, bucket).length; }

    function totalCount(ns) {
        var buckets = listBuckets(ns);
        var total = 0;
        for (var i = 0; i < buckets.length; i++) {
            total += loadBucket(ns, buckets[i]).length;
        }
        return total;
    }

    function buckets(ns) {
        var ids = listBuckets(ns);
        var out = [];
        for (var i = 0; i < ids.length; i++) {
            var arr = loadBucket(ns, ids[i]);
            out.push({ name: ids[i], count: arr.length });
        }
        out.sort(function (a, b) { return b.count - a.count; });
        return out;
    }

    /* ---------------- session builder ---------------- */

    /**
     * Build a shuffled session of `count` items drawn from `rules` buckets.
     * If `rules` is empty, draws from every bucket in the namespace.
     * Distributes `count` evenly across buckets, tops up if short.
     * Returns fewer than `count` only if the whole namespace is short.
     */
    function sessionFromRules(ns, rules, count) {
        count = count || 10;
        var pool = [];
        var seen = {};

        function takeFrom(bucketId, n) {
            var bucket = loadBucket(ns, bucketId);
            var shuffled = window.WoordWise.shuffle(bucket);
            for (var i = 0; i < shuffled.length && n > 0; i++) {
                var item = shuffled[i];
                var key = JSON.stringify(item);
                if (seen[key]) continue;
                seen[key] = 1;
                pool.push(item);
                n--;
            }
        }

        var bucketIds = (Array.isArray(rules) && rules.length)
            ? rules.slice()
            : listBuckets(ns);

        if (!bucketIds.length) return [];

        var perBucket = Math.ceil(count / bucketIds.length);
        for (var i = 0; i < bucketIds.length; i++) {
            takeFrom(bucketIds[i], perBucket);
        }

        if (pool.length < count) {
            for (var j = 0; j < bucketIds.length && pool.length < count; j++) {
                takeFrom(bucketIds[j], count - pool.length);
            }
        }

        pool = window.WoordWise.shuffle(pool);
        return pool.slice(0, count);
    }

    /* ---------------- clearing ---------------- */

    function clearAll() {
        var keys = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf(PREFIX) === 0) keys.push(k);
            }
        } catch (e) { return; }
        keys.forEach(safeDel);
    }

    function clearNamespace(ns) {
        var pre = PREFIX + ns + '.';
        var keys = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf(pre) === 0) keys.push(k);
            }
        } catch (e) { return; }
        keys.forEach(safeDel);
    }

    /* ---------------- badge UI ---------------- */

    function showBadge(container, text) {
        if (!container) return null;
        var existing = container.querySelector('.ww-cache-badge');
        if (existing) {
            existing.textContent = text || existing.textContent;
            return existing;
        }
        var badge = document.createElement('div');
        badge.className = 'ww-cache-badge';
        badge.textContent = text || 'Offline \u2014 using saved questions';
        /* Insert as first child so the card's own flex layout places it
         * above everything else without overlapping. */
        if (container.firstChild) {
            container.insertBefore(badge, container.firstChild);
        } else {
            container.appendChild(badge);
        }
        return badge;
    }

    function hideBadge(container) {
        if (!container) return;
        var b = container.querySelector('.ww-cache-badge');
        if (b && b.parentNode) b.parentNode.removeChild(b);
    }

    /* ---------------- boot ---------------- */

    ensureVersion();

    window.WoordWise = window.WoordWise || {};
    window.WoordWise.Cache = {
        put: put,
        get: get,
        has: has,
        count: count,
        totalCount: totalCount,
        buckets: buckets,
        sessionFromRules: sessionFromRules,
        clearAll: clearAll,
        clearNamespace: clearNamespace,
        showBadge: showBadge,
        hideBadge: hideBadge
    };
})();