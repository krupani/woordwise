/* WoordWise — version.js
 * Single source of truth for the app version.
 * Loaded by every HTML page (as <script>) and by sw.js (via importScripts).
 * `self` resolves to `window` in a page and to the worker scope in sw.js,
 * so this file works in both contexts. */

self.WOORDWISE_VERSION = '1.3';
self.CACHE_VERSION     = 'woordwise_v' + self.WOORDWISE_VERSION;