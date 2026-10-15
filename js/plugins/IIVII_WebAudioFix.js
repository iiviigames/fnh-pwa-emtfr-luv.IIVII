//=============================================================================
// IIVII_WebAudioFix.js
//=============================================================================

/*:
 * @plugindesc Fixes audio that cuts out and never returns on iOS, and caches
 * decoded short sound effects so repeated sounds do not reload every time.
 * @author IIVII
 *
 * @help
 * What this does
 * --------------
 * 1. AudioContext recovery. RPG Maker MV only tries to wake the browser's audio
 *    system when it is "suspended". iOS Safari also uses an "interrupted"
 *    state (notifications, Siri, call, AirPods switching, app switcher...), and
 *    the stock engine never recovers from that until the app is restarted.
 *    This plugin resumes the audio system on any tap, key press, return to the
 *    app, and with a gentle background retry.
 *
 * 2. Short-sound cache. Stock MV downloads, decrypts and decodes an effect's
 *    file every single time it plays (footsteps, item pickups...). This keeps
 *    decoded copies of short sounds (8 seconds or less) in memory, up to a
 *    memory cap, and reuses them. Long music is never cached.
 *
 * No plugin parameters. Place this plugin at the END of the plugin list.
 */

(function() {
    'use strict';

    if (typeof WebAudio === 'undefined') { return; }

    var MAX_SECONDS = 8;                    // only cache sounds this short
    var CAP_BYTES   = 32 * 1024 * 1024;     // decoded PCM memory budget

    var stats = { hits: 0, misses: 0, resumes: 0 };

    //-------------------------------------------------------------------------
    // 1. AudioContext recovery
    //-------------------------------------------------------------------------

    function ctx() { return WebAudio._context; }

    function needsResume(c) {
        return !!c && !!c.state && c.state !== 'running' && c.state !== 'closed';
    }

    function unlock() {
        try { if (WebAudio._onTouchStart) { WebAudio._onTouchStart(); } } catch (e) {}
    }

    function tryResume() {
        var c = ctx();
        if (!needsResume(c)) { return; }
        try {
            var p = c.resume();
            stats.resumes++;
            if (p && typeof p.then === 'function') {
                p.then(unlock, function() {});
            } else {
                unlock();
            }
        } catch (e) {}
    }

    ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'keydown', 'click']
        .forEach(function(type) {
            document.addEventListener(type, tryResume, true);
        });

    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
            tryResume();
            setTimeout(tryResume, 250);
            setTimeout(tryResume, 1000);
        }
    });
    window.addEventListener('pageshow', tryResume);
    window.addEventListener('focus', tryResume);

    // The context is created lazily by the engine, so hook it when it appears
    // and keep a slow background retry for the "interrupted" case.
    setInterval(function() {
        var c = ctx();
        if (!c) { return; }
        if (!c.__iiviiHooked) {
            c.__iiviiHooked = true;
            if (typeof c.addEventListener === 'function') {
                c.addEventListener('statechange', function() {
                    if (needsResume(c) && document.visibilityState === 'visible') { tryResume(); }
                });
            }
        }
        if (needsResume(c) && document.visibilityState === 'visible') { tryResume(); }
    }, 1000);

    //-------------------------------------------------------------------------
    // 2. Decoded short-sound cache
    //-------------------------------------------------------------------------

    var cache = {};      // url -> entry
    var cacheBytes = 0;
    var cacheCount = 0;

    function bytesOf(buffer) {
        return buffer.length * buffer.numberOfChannels * 4;
    }

    function evictFor(needed) {
        while (cacheBytes + needed > CAP_BYTES && cacheCount > 0) {
            var oldestKey = null, oldestTime = Infinity;
            for (var k in cache) {
                if (cache[k].t < oldestTime) { oldestTime = cache[k].t; oldestKey = k; }
            }
            if (oldestKey === null) { break; }
            cacheBytes -= cache[oldestKey].bytes;
            delete cache[oldestKey];
            cacheCount--;
        }
    }

    function store(audio) {
        var buffer = audio._buffer, url = audio._url;
        if (!buffer || !url || audio.__iiviiCached) { return; }
        if (buffer.duration > MAX_SECONDS || cache[url]) { return; }
        var size = bytesOf(buffer);
        if (size > CAP_BYTES / 2) { return; }
        evictFor(size);
        cache[url] = {
            buffer: buffer,
            totalTime: audio._totalTime,
            loopStart: audio._loopStart,
            loopLength: audio._loopLength,
            sampleRate: audio._sampleRate,
            bytes: size,
            t: Date.now()
        };
        cacheBytes += size;
        cacheCount++;
    }

    var _load = WebAudio.prototype._load;
    WebAudio.prototype._load = function(url) {
        var e = cache[url];
        if (e && WebAudio._context) {
            e.t = Date.now();
            this._buffer = e.buffer;
            this._totalTime = e.totalTime;
            this._loopStart = e.loopStart;
            this._loopLength = e.loopLength;
            this._sampleRate = e.sampleRate;
            this.__iiviiCached = true;
            stats.hits++;
            this._onLoad();
            return;
        }
        stats.misses++;
        return _load.apply(this, arguments);
    };

    var _onLoad = WebAudio.prototype._onLoad;
    WebAudio.prototype._onLoad = function() {
        try { store(this); } catch (e) {}
        return _onLoad.apply(this, arguments);
    };

    //-------------------------------------------------------------------------
    // Diagnostics (read by the touch-controls debug HUD)
    //-------------------------------------------------------------------------

    window.IIVII_AudioFix = {
        stats: function() {
            var c = ctx();
            return {
                state: c ? c.state : 'none',
                cached: cacheCount,
                cacheMB: Math.round(cacheBytes / 1048576 * 10) / 10,
                hits: stats.hits,
                misses: stats.misses,
                resumes: stats.resumes
            };
        },
        clear: function() { cache = {}; cacheBytes = 0; cacheCount = 0; }
    };

})();
