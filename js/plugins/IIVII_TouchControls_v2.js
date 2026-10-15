//=============================================================================
// IIVII_TouchControls.js  (v2 - tap-only grid customizer)
//=============================================================================

/*:
 * @plugindesc On-screen touch controls (D-pad or stick + buttons) with Auto /
 * On / Off modes and a tap-only, grid-based layout customizer.
 * @author IIVII
 *
 * @help
 * A small gear in the top-right corner opens the settings column.
 *
 *   Mode      Auto = overlay shows while you use touch and hides as soon as a
 *                    controller or keyboard is used (touch to bring it back)
 *             On   = always shown       Off = hardware only
 *   Style     D-pad (arrows) or Stick (knob follows your finger)
 *   Opacity, left-handed mirror, performance readout.
 *
 * This entire system of management for the on screen controls was HEAVILY inspired by 
 *   Thylacine Studios' Siralim : Ultimate, specifically on Android. 
 * I think it has the greatest touch overlay control management, & so I took inspiration from it...
 * 
 * Every control (pad, A, B, T, C, Skill, L, R) has its own section with
 * Up / Down / Left / Right "Nudge" buttons and Size - / Size +. 
 * Each tap moves the control 1 grid step (2.5% of the screen) or changes its size 1 step.
 * There is no dragging and no sliding. Controls can never leave the screen:
 * they stop at the edges and are pushed back inside if the screen rotates.
 *
 *   Reset (per control) and Reset all restore the defaults.
 *   Cancel changes puts everything back the way it was when you opened it.
 *   Esc (keyboard) or B (controller) closes the column from hardware.
 *
 * The game is paused while the column is open. Buttons press the game's real
 * keys, so torch, menus, key config, etc. all keep working.
 *   A = OK / Talk   B = Cancel / Menu   T = Torch   C = Phase
 *   Skill = Shift   L / R = Page Up / Page Down
 *
 * Settings are stored in this browser/app container (localStorage); the
 * Safari tab and the Home Screen app keep separate copies.
 *
 * No plugin parameters. Place this plugin at the END of the plugin list.
 */

(function() {
    'use strict';

    var STORE_KEY = 'IIVII_TouchControls_v2';
    var OLD_KEY   = 'IIVII_TouchControls_v1';

    var GRID = 40;            // positions are whole steps of 1/40 of the screen
    var SIZE_MIN = 0, SIZE_MAX = 12, SIZE_DEF = 4;   // scale = 0.6 + 0.1 * step
    var MARGIN = 6;           // px kept free at the screen edge

    function scaleOf(step) { return 0.6 + 0.1 * step; }

    //-------------------------------------------------------------------------
    // Controls
    //-------------------------------------------------------------------------

    // def = [gridX, gridY] of the centre in right-handed layout.
    var CONTROLS = [
        { id: 'pad',      title: 'D-pad / Stick',        w: 170, h: 170, def: [6, 30],  on: true  },
        { id: 'ok',       title: 'A \u2014 OK / Talk',   w: 76,  h: 76,  def: [36, 31], on: true,  name: 'ok',       label: 'A',     sub: 'OK' },
        { id: 'escape',   title: 'B \u2014 Cancel / Menu', w: 68, h: 68, def: [33, 33], on: true,  name: 'escape',   label: 'B',     sub: 'Menu' },
        { id: 't',        title: 'T \u2014 Torch',       w: 60,  h: 60,  def: [34, 28], on: true,  name: 't',        label: 'T',     sub: 'Torch' },
        { id: 'c',        title: 'C \u2014 Phase',       w: 54,  h: 54,  def: [37, 27], on: false, name: 'c',        label: 'C',     sub: 'Phase' },
        { id: 'shift',    title: 'Skill (Shift)',        w: 56,  h: 56,  def: [30, 31], on: false, name: 'shift',    label: 'Skill', sub: '' },
        { id: 'pageup',   title: 'L \u2014 Page Up',     w: 56,  h: 30,  def: [31, 26], on: false, name: 'pageup',   label: 'L',     sub: '', pill: true },
        { id: 'pagedown', title: 'R \u2014 Page Down',   w: 56,  h: 30,  def: [34, 25], on: false, name: 'pagedown', label: 'R',     sub: '', pill: true }
    ];
    var BYID = {};
    CONTROLS.forEach(function(c) { BYID[c.id] = c; });

    //-------------------------------------------------------------------------
    // Settings
    //-------------------------------------------------------------------------

    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function defaults() {
        var d = { mode: 'auto', opacity: 65, swap: false, hud: false, padStyle: 'dpad', show: {}, ctl: {} };
        CONTROLS.forEach(function(c) {
            d.show[c.id] = !!c.on;
            d.ctl[c.id] = { x: c.def[0], y: c.def[1], s: SIZE_DEF };
        });
        return d;
    }

    function sanitize(p) {
        var s = defaults();
        if (!p || typeof p !== 'object') { return s; }
        if (p.mode === 'auto' || p.mode === 'on' || p.mode === 'off') { s.mode = p.mode; }
        if (typeof p.opacity === 'number') { s.opacity = clamp(Math.round(p.opacity / 10) * 10, 20, 100); }
        s.swap = !!p.swap;
        s.hud = !!p.hud;
        if (p.padStyle === 'stick' || p.padStyle === 'dpad') { s.padStyle = p.padStyle; }
        CONTROLS.forEach(function(c) {
            if (p.show && typeof p.show[c.id] === 'boolean') { s.show[c.id] = p.show[c.id]; }
            var g = p.ctl && p.ctl[c.id];
            if (g) {
                if (typeof g.x === 'number') { s.ctl[c.id].x = clamp(Math.round(g.x), 0, GRID); }
                if (typeof g.y === 'number') { s.ctl[c.id].y = clamp(Math.round(g.y), 0, GRID); }
                if (typeof g.s === 'number') { s.ctl[c.id].s = clamp(Math.round(g.s), SIZE_MIN, SIZE_MAX); }
            }
        });
        return s;
    }

    function loadSettings() {
        try {
            var raw = window.localStorage.getItem(STORE_KEY);
            if (raw) { return sanitize(JSON.parse(raw)); }
            // carry over the few settings that still mean the same thing from v1
            var old = window.localStorage.getItem(OLD_KEY);
            if (old) {
                var o = JSON.parse(old), s = defaults();
                if (o.mode === 'auto' || o.mode === 'on' || o.mode === 'off') { s.mode = o.mode; }
                if (typeof o.opacity === 'number') { s.opacity = clamp(Math.round(o.opacity / 10) * 10, 20, 100); }
                s.swap = !!o.swap; s.hud = !!o.hud;
                return s;
            }
        } catch (e) {}
        return defaults();
    }

    var S = loadSettings();

    function saveSettings() {
        try { window.localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {}
    }

    //-------------------------------------------------------------------------
    // Key injection (drives the engine's own key handler)
    //-------------------------------------------------------------------------

    var PREFERRED_CODE = {
        ok: 13, escape: 27, shift: 16, pageup: 33, pagedown: 34,
        left: 37, up: 38, right: 39, down: 40, t: 84, c: 67
    };

    function codeFor(name) {
        var pref = PREFERRED_CODE[name];
        if (pref !== undefined && Input.keyMapper[pref] === name) { return pref; }
        for (var code in Input.keyMapper) {
            if (Input.keyMapper[code] === name) { return +code; }
        }
        return null;
    }

    var holds = {};   // key name -> number of active sources

    function press(name) {
        holds[name] = (holds[name] || 0) + 1;
        if (holds[name] !== 1) { return; }
        var code = codeFor(name);
        if (code !== null) {
            Input._onKeyDown({ keyCode: code, preventDefault: function() {} });
        } else {
            Input._currentState[name] = true;
        }
    }

    function release(name) {
        if (!holds[name]) { return; }
        holds[name]--;
        if (holds[name] !== 0) { return; }
        var code = codeFor(name);
        if (code !== null) {
            Input._onKeyUp({ keyCode: code });
        } else {
            Input._currentState[name] = false;
        }
    }

    function releaseAll() {
        for (var name in holds) {
            if (holds[name] > 0) { holds[name] = 1; release(name); }
        }
        setPadDir(null);
        padPointer = null; padAxis = null;
        Object.keys(activeButtons).forEach(function(id) {
            var b = activeButtons[id];
            if (b) { b.el.classList.remove('on'); }
            delete activeButtons[id];
        });
    }

    //-------------------------------------------------------------------------
    // DOM helpers and CSS
    //-------------------------------------------------------------------------

    var CSS = [
        '#iivii-tc{position:fixed;left:0;top:0;right:0;bottom:0;z-index:10000;pointer-events:none;',
        '-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:none;',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
        '#iivii-tc .pad{position:absolute;border-radius:50%;pointer-events:auto;touch-action:none;',
        'background:rgba(18,18,22,.55);border:2px solid rgba(255,255,255,.45);box-sizing:border-box}',
        '#iivii-tc .pad i{position:absolute;color:#fff;font-style:normal;opacity:.8;text-align:center;line-height:1}',
        '#iivii-tc .pad i.hot{opacity:1;color:#ffd84d}',
        '#iivii-tc .pad.stick i{display:none}',
        '#iivii-tc .pad .knob{position:absolute;display:none;border-radius:50%;background:rgba(255,255,255,.55);',
        'border:2px solid rgba(255,255,255,.85);box-sizing:border-box}',
        '#iivii-tc .pad.stick .knob{display:block}',
        '#iivii-tc .btn{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;',
        'pointer-events:auto;touch-action:none;color:#fff;font-weight:700;text-align:center;line-height:1;',
        'background:rgba(18,18,22,.55);border:2px solid rgba(255,255,255,.5);border-radius:50%;box-sizing:border-box}',
        '#iivii-tc .btn small{font-size:.55em;font-weight:500;opacity:.8;margin-top:2px}',
        '#iivii-tc .btn.pill{border-radius:999px}',
        '#iivii-tc .btn.on{background:rgba(255,216,77,.55);border-color:#ffd84d}',
        '#iivii-tc.editing *{pointer-events:none!important}',
        '#iivii-tc.editing .pad,#iivii-tc.editing .btn{outline:2px dashed rgba(255,215,0,.5);outline-offset:3px}',
        '#iivii-tc .sel{outline:3px solid #ffd84d!important;box-shadow:0 0 16px rgba(255,216,77,.9)}',
        '#iivii-tc .blocked{outline:3px solid #ff5a5a!important;box-shadow:0 0 16px rgba(255,90,90,.9)}',
        '#iivii-gear{position:fixed;z-index:10003;width:36px;height:36px;border-radius:50%;',
        'top:calc(env(safe-area-inset-top,0px) + 6px);right:calc(env(safe-area-inset-right,0px) + 6px);',
        'background:rgba(0,0,0,.45);color:#fff;font-size:20px;display:flex;align-items:center;',
        'justify-content:center;opacity:.28;touch-action:none;-webkit-user-select:none;user-select:none}',
        '#iivii-gear:active{opacity:.9}',
        '#iivii-panel{position:fixed;left:0;top:0;right:0;bottom:0;z-index:10002;display:none;',
        'background:rgba(0,0,0,.16);overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y;',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
        '#iivii-card{box-sizing:border-box;width:min(380px,92vw);margin:calc(env(safe-area-inset-top,0px) + 12px) auto 40px;',
        'background:rgba(23,23,27,.94);color:#eee;border-radius:16px;padding:12px 14px 16px;font-size:15px;line-height:1.3}',
        '#iivii-card h2{margin:0 0 8px;font-size:17px}',
        '#iivii-card h3{margin:0;font-size:14px;font-weight:600}',
        '#iivii-card .row{margin:10px 0}',
        '#iivii-card .lab{color:#aaa;font-size:12px;margin-bottom:5px}',
        '#iivii-card button{font:inherit;color:#eee;background:#2c2c33;border:0;border-radius:10px;padding:11px 4px;min-height:44px;',
        '-webkit-tap-highlight-color:transparent}',
        '#iivii-card button:active{background:#4a4a55}',
        '#iivii-card button[disabled]{opacity:.3}',
        '#iivii-card button.main{background:#ffd84d;color:#000;font-weight:700}',
        '#iivii-card .seg,#iivii-card .stp,#iivii-card .two{display:flex;gap:6px}',
        '#iivii-card .seg button,#iivii-card .two button{flex:1}',
        '#iivii-card .seg button.sel{background:#ffd84d;color:#000;font-weight:700}',
        '#iivii-card .stp .val{flex:1;display:flex;align-items:center;justify-content:center;color:#ddd}',
        '#iivii-card .stp button{width:64px}',
        '#iivii-card .sec{margin-top:12px;padding-top:10px;border-top:1px solid #34343b}',
        '#iivii-card .sec .hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;gap:8px}',
        '#iivii-card .sec .hd button{min-height:36px;padding:6px 10px;font-size:13px}',
        '#iivii-card .sec .hd button.vis{background:#244a2c}',
        '#iivii-card .sec .hd button.hid{background:#4a2424}',
        '#iivii-card .grid6{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}',
        '#iivii-card .grid6 button{font-size:17px;padding:8px 0}',
        '#iivii-card .info{display:flex;justify-content:space-between;align-items:center;margin-top:6px;color:#999;font-size:12px}',
        '#iivii-card .info button{min-height:30px;padding:3px 10px;font-size:12px}',
        '#iivii-card .note{margin-top:12px;font-size:12px;color:#888}',
        '#iivii-hud{position:fixed;z-index:10001;left:calc(env(safe-area-inset-left,0px) + 6px);',
        'bottom:calc(env(safe-area-inset-bottom,0px) + 4px);font:11px/1.3 ui-monospace,Menlo,monospace;color:#9f9;',
        'background:rgba(0,0,0,.55);padding:3px 6px;border-radius:6px;display:none;pointer-events:none;white-space:pre}'
    ].join('');

    function h(tag, props, kids) {
        var el = document.createElement(tag);
        if (props) {
            for (var k in props) {
                if (k === 'text') { el.textContent = props[k]; } else { el.setAttribute(k, props[k]); }
            }
        }
        (kids || []).forEach(function(c) { el.appendChild(c); });
        return el;
    }

    // Keep touches on our UI away from the game's own touch handling.
    function swallow(el, allowDefault) {
        ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'mousemove', 'contextmenu']
            .forEach(function(type) {
                el.addEventListener(type, function(ev) {
                    ev.stopPropagation();
                    if (!allowDefault && ev.cancelable) { ev.preventDefault(); }
                }, { passive: false });
            });
    }

    //-------------------------------------------------------------------------
    // State
    //-------------------------------------------------------------------------

    var root, gear, hud, panel, card, padEl, knobEl;
    var els = {};                // control id -> element
    var padArrows = {};
    var activeButtons = {};      // pointerId -> {el, name}
    var panelOpen = false;
    var hardwareActive = false;
    var snapshot = null;
    var paused = false;
    var ui = {};                 // panel widgets that need refreshing

    //-------------------------------------------------------------------------
    // Geometry
    //-------------------------------------------------------------------------

    var probe;
    function insets() {
        if (!probe) {
            probe = h('div');
            probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
                'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
            document.body.appendChild(probe);
        }
        var cs = window.getComputedStyle(probe);
        return {
            t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0,
            b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0
        };
    }

    function metrics() {
        var W = window.innerWidth, H = window.innerHeight;
        return { W: W, H: H, ins: insets(), u: clamp(Math.min(W, H) / 720, 0.8, 1.35) };
    }

    // Where a control actually is on screen right now (always inside the
    // viewport, whatever is stored), plus the limits it must stay within.
    function effective(c, m) {
        var g = S.ctl[c.id], sc = scaleOf(g.s);
        var w = c.w * m.u * sc, hh = c.h * m.u * sc;
        var minX = m.ins.l + MARGIN + w / 2, maxX = m.W - m.ins.r - MARGIN - w / 2;
        var minY = m.ins.t + MARGIN + hh / 2, maxY = m.H - m.ins.b - MARGIN - hh / 2;
        if (maxX < minX) { maxX = minX; }
        if (maxY < minY) { maxY = minY; }
        var gx = S.swap ? GRID - g.x : g.x;
        return {
            w: w, h: hh, sc: sc,
            cx: clamp(gx / GRID * m.W, minX, maxX),
            cy: clamp(g.y / GRID * m.H, minY, maxY),
            minX: minX, maxX: maxX, minY: minY, maxY: maxY
        };
    }

    function layout() {
        if (!root) { return; }
        var m = metrics();
        root.style.opacity = S.opacity / 100;
        padEl.className = 'pad' + (S.padStyle === 'stick' ? ' stick' : '');

        CONTROLS.forEach(function(c) {
            var el = els[c.id], shown = !!S.show[c.id];
            el.style.display = shown ? (c.id === 'pad' ? 'block' : 'flex') : 'none';
            if (!shown) { return; }
            var e = effective(c, m);
            el.style.width = e.w + 'px';
            el.style.height = e.h + 'px';
            el.style.left = (e.cx - e.w / 2) + 'px';
            el.style.top = (e.cy - e.h / 2) + 'px';
            if (c.id === 'pad') {
                var fs = Math.round(e.w * 0.26);
                var a = e.w * 0.26, edge = e.w * 0.06;
                [['up', '\u25B2', e.w / 2 - a / 2, edge],
                 ['down', '\u25BC', e.w / 2 - a / 2, e.w - edge - a],
                 ['left', '\u25C0', edge, e.w / 2 - a / 2],
                 ['right', '\u25B6', e.w - edge - a, e.w / 2 - a / 2]].forEach(function(d) {
                    var ar = padArrows[d[0]];
                    ar.textContent = d[1];
                    ar.style.fontSize = fs + 'px';
                    ar.style.width = ar.style.height = a + 'px';
                    ar.style.left = d[2] + 'px';
                    ar.style.top = d[3] + 'px';
                });
                var k = e.w * 0.42;
                knobEl.style.width = knobEl.style.height = k + 'px';
                knobEl.style.left = (e.w / 2 - k / 2) + 'px';
                knobEl.style.top = (e.w / 2 - k / 2) + 'px';
            } else {
                el.style.fontSize = Math.round((c.pill ? 15 : (c.label.length > 2 ? 13 : 22)) * m.u * e.sc) + 'px';
            }
        });

        hud.style.display = S.hud ? 'block' : 'none';
        refreshVisibility();
        refreshPanel();
    }

    function overlayVisible() {
        if (panelOpen) { return true; }
        if (S.mode === 'on') { return true; }
        if (S.mode === 'off') { return false; }
        return !hardwareActive;
    }

    function refreshVisibility() {
        if (!root) { return; }
        root.style.display = overlayVisible() ? '' : 'none';
        if (!overlayVisible()) { releaseAll(); }
    }

    //-------------------------------------------------------------------------
    // Nudge / resize (the tap-only customizer actions)
    //-------------------------------------------------------------------------

    var flashTimers = {};
    function flash(id, cls) {
        var el = els[id];
        if (!el) { return; }
        el.classList.remove('sel'); el.classList.remove('blocked');
        el.classList.add(cls);
        clearTimeout(flashTimers[id]);
        flashTimers[id] = setTimeout(function() { el.classList.remove(cls); }, 1400);
    }

    // dx, dy are VISUAL steps (right / down are positive) - left-handed mirroring
    // is handled here so the buttons always do what their arrows say.
    function nudge(id, dx, dy) {
        var c = BYID[id], m = metrics(), e = effective(c, m);
        var gx = Math.round(e.cx / m.W * GRID), gy = Math.round(e.cy / m.H * GRID);
        var nx = gx + dx, ny = gy + dy;
        var cx = nx / GRID * m.W, cy = ny / GRID * m.H;
        if (cx < e.minX - 0.5 || cx > e.maxX + 0.5 || cy < e.minY - 0.5 || cy > e.maxY + 0.5) {
            flash(id, 'blocked');
            return false;
        }
        S.ctl[id].x = S.swap ? GRID - nx : nx;
        S.ctl[id].y = ny;
        saveSettings(); layout(); flash(id, 'sel');
        return true;
    }

    function resize(id, delta) {
        var g = S.ctl[id], ns = clamp(g.s + delta, SIZE_MIN, SIZE_MAX);
        if (ns === g.s) { flash(id, 'blocked'); return false; }
        g.s = ns;
        saveSettings(); layout(); flash(id, 'sel');
        return true;
    }

    function toggleShow(id) {
        S.show[id] = !S.show[id];
        saveSettings(); layout();
        if (S.show[id]) { flash(id, 'sel'); }
    }

    function resetControl(id) {
        var c = BYID[id];
        S.ctl[id] = { x: c.def[0], y: c.def[1], s: SIZE_DEF };
        S.show[id] = !!c.on;
        saveSettings(); layout(); flash(id, 'sel');
    }

    function resetAll() {
        var keep = { mode: S.mode, opacity: S.opacity, hud: S.hud };
        S = defaults();
        S.mode = keep.mode; S.opacity = keep.opacity; S.hud = keep.hud;
        saveSettings(); layout();
    }

    //-------------------------------------------------------------------------
    // D-pad / stick
    //-------------------------------------------------------------------------

    var padDir = null, padAxis = null, padPointer = null;

    function setPadDir(dir) {
        if (dir === padDir) { return; }
        if (padDir) { release(padDir); if (padArrows[padDir]) { padArrows[padDir].classList.remove('hot'); } }
        padDir = dir;
        if (padDir) { press(padDir); if (padArrows[padDir]) { padArrows[padDir].classList.add('hot'); } }
    }

    function moveKnob(dx, dy, rad) {
        if (!knobEl) { return; }
        var len = Math.sqrt(dx * dx + dy * dy), max = rad * 0.5;
        if (len > max) { dx = dx / len * max; dy = dy / len * max; }
        knobEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    }

    function padUpdate(ev) {
        var r = padEl.getBoundingClientRect();
        var dx = ev.clientX - (r.left + r.width / 2);
        var dy = ev.clientY - (r.top + r.height / 2);
        var rad = r.width / 2;
        moveKnob(dx, dy, rad);
        if (Math.sqrt(dx * dx + dy * dy) < rad * (S.padStyle === 'stick' ? 0.25 : 0.2)) {
            padAxis = null; setPadDir(null); return;
        }
        var ax = Math.abs(dx), ay = Math.abs(dy), axis;
        if (padAxis === 'h') { axis = ay > ax * 1.3 ? 'v' : 'h'; }
        else if (padAxis === 'v') { axis = ax > ay * 1.3 ? 'h' : 'v'; }
        else { axis = ax > ay ? 'h' : 'v'; }
        padAxis = axis;
        setPadDir(axis === 'h' ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));
    }

    function padEnd(ev) {
        if (padPointer !== null && ev.pointerId !== padPointer) { return; }
        padPointer = null; padAxis = null; setPadDir(null);
        if (knobEl) { knobEl.style.transform = ''; }
    }

    //-------------------------------------------------------------------------
    // Build the overlay
    //-------------------------------------------------------------------------

    function buildControls() {
        root = h('div', { id: 'iivii-tc' });
        swallow(root, false);

        padEl = h('div', { 'class': 'pad' });
        ['up', 'down', 'left', 'right'].forEach(function(d) {
            padArrows[d] = h('i');
            padEl.appendChild(padArrows[d]);
        });
        knobEl = h('div', { 'class': 'knob' });
        padEl.appendChild(knobEl);
        els.pad = padEl;
        root.appendChild(padEl);

        padEl.addEventListener('pointerdown', function(ev) {
            if (panelOpen || padPointer !== null) { return; }
            padPointer = ev.pointerId;
            try { padEl.setPointerCapture(ev.pointerId); } catch (e) {}
            padUpdate(ev);
        });
        padEl.addEventListener('pointermove', function(ev) { if (ev.pointerId === padPointer) { padUpdate(ev); } });
        padEl.addEventListener('pointerup', padEnd);
        padEl.addEventListener('pointercancel', padEnd);
        padEl.addEventListener('lostpointercapture', padEnd);

        CONTROLS.forEach(function(c) {
            if (c.id === 'pad') { return; }
            var el = h('div', { 'class': 'btn' + (c.pill ? ' pill' : '') });
            el.appendChild(h('span', { text: c.label }));
            if (c.sub) { el.appendChild(h('small', { text: c.sub })); }
            els[c.id] = el;
            root.appendChild(el);

            el.addEventListener('pointerdown', function(ev) {
                if (panelOpen) { return; }
                try { el.setPointerCapture(ev.pointerId); } catch (e) {}
                if (activeButtons[ev.pointerId]) { return; }
                activeButtons[ev.pointerId] = { el: el, name: c.name };
                el.classList.add('on');
                press(c.name);
            });
            var up = function(ev) {
                var a = activeButtons[ev.pointerId];
                if (!a || a.el !== el) { return; }
                delete activeButtons[ev.pointerId];
                el.classList.remove('on');
                release(c.name);
            };
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
            el.addEventListener('lostpointercapture', up);
        });

        document.body.appendChild(root);
    }

    //-------------------------------------------------------------------------
    // Build the settings column (built once; updated in place so the scroll
    // position never jumps while you nudge)
    //-------------------------------------------------------------------------

    function segment(options, onPick) {
        var wrap = h('div', { 'class': 'seg' }), buttons = {};
        options.forEach(function(o) {
            var b = h('button', { text: o[1], type: 'button' });
            b.addEventListener('click', function() { onPick(o[0]); });
            buttons[o[0]] = b;
            wrap.appendChild(b);
        });
        return {
            el: wrap,
            set: function(v) { for (var k in buttons) { buttons[k].className = (k === v) ? 'sel' : ''; } }
        };
    }

    function stepper(minusLabel, plusLabel, onMinus, onPlus) {
        var minus = h('button', { text: minusLabel, type: 'button' });
        var plus = h('button', { text: plusLabel, type: 'button' });
        var val = h('div', { 'class': 'val' });
        minus.addEventListener('click', onMinus);
        plus.addEventListener('click', onPlus);
        return { el: h('div', { 'class': 'stp' }, [minus, val, plus]), val: val, minus: minus, plus: plus };
    }

    function labelled(text, el) {
        return h('div', { 'class': 'row' }, [h('div', { 'class': 'lab', text: text }), el]);
    }

    function buildSection(c) {
        var title = h('h3', { text: c.title });
        var vis = h('button', { type: 'button' });
        vis.addEventListener('click', function() { toggleShow(c.id); });

        var arrows = [
            ['\u2191', function() { nudge(c.id, 0, -1); }],
            ['\u2193', function() { nudge(c.id, 0, 1); }],
            ['\u2190', function() { nudge(c.id, -1, 0); }],
            ['\u2192', function() { nudge(c.id, 1, 0); }],
            ['\u2212', function() { resize(c.id, -1); }],
            ['+',      function() { resize(c.id, 1); }]
        ];
        var btns = arrows.map(function(a) {
            var b = h('button', { text: a[0], type: 'button' });
            b.addEventListener('click', a[1]);
            return b;
        });
        var readout = h('span');
        var reset = h('button', { text: 'Reset', type: 'button' });
        reset.addEventListener('click', function() { resetControl(c.id); });

        var sec = h('div', { 'class': 'sec' }, [
            h('div', { 'class': 'hd' }, [title, vis]),
            h('div', { 'class': 'grid6' }, btns),
            h('div', { 'class': 'info' }, [readout, reset])
        ]);
        ui['sec_' + c.id] = { vis: vis, btns: btns, readout: readout };
        return sec;
    }

    function buildPanel() {
        gear = h('div', { id: 'iivii-gear', text: '\u2699' });
        swallow(gear, false);
        gear.addEventListener('pointerup', function() { openPanel(); });
        document.body.appendChild(gear);

        hud = h('div', { id: 'iivii-hud' });
        document.body.appendChild(hud);

        panel = h('div', { id: 'iivii-panel' });
        swallow(panel, true);
        card = h('div', { id: 'iivii-card' });
        panel.appendChild(card);
        document.body.appendChild(panel);

        card.appendChild(h('h2', { text: 'Touch controls' }));

        var save = h('button', { text: 'Save & close', type: 'button', 'class': 'main' });
        save.addEventListener('click', function() { closePanel(); });
        var cancel = h('button', { text: 'Cancel changes', type: 'button' });
        cancel.addEventListener('click', function() { cancelPanel(); });
        card.appendChild(h('div', { 'class': 'two' }, [cancel, save]));

        ui.mode = segment([['auto', 'Auto'], ['on', 'On'], ['off', 'Off']], function(v) { S.mode = v; saveSettings(); layout(); });
        card.appendChild(labelled('Mode  (Auto hides when you use a controller or keyboard)', ui.mode.el));

        ui.style = segment([['dpad', 'D-pad'], ['stick', 'Stick']], function(v) { S.padStyle = v; saveSettings(); layout(); flash('pad', 'sel'); });
        card.appendChild(labelled('Movement control', ui.style.el));

        ui.opacity = stepper('\u2212', '+',
            function() { S.opacity = clamp(S.opacity - 10, 20, 100); saveSettings(); layout(); },
            function() { S.opacity = clamp(S.opacity + 10, 20, 100); saveSettings(); layout(); });
        card.appendChild(labelled('Opacity', ui.opacity.el));

        ui.swap = segment([['off', 'Right-handed'], ['on', 'Left-handed (mirror)']], function(v) { S.swap = (v === 'on'); saveSettings(); layout(); });
        card.appendChild(labelled('Layout', ui.swap.el));

        ui.hud = segment([['off', 'Off'], ['on', 'On']], function(v) { S.hud = (v === 'on'); saveSettings(); layout(); });
        card.appendChild(labelled('Performance readout (fps, audio state)', ui.hud.el));

        CONTROLS.forEach(function(c) { card.appendChild(buildSection(c)); });

        var resetAllBtn = h('button', { text: 'Reset all controls', type: 'button' });
        resetAllBtn.addEventListener('click', resetAll);
        var save2 = h('button', { text: 'Save & close', type: 'button', 'class': 'main' });
        save2.addEventListener('click', function() { closePanel(); });
        var cancel2 = h('button', { text: 'Cancel changes', type: 'button' });
        cancel2.addEventListener('click', function() { cancelPanel(); });
        card.appendChild(h('div', { 'class': 'sec' }, [h('div', { 'class': 'two' }, [resetAllBtn]),
            h('div', { 'class': 'two', style: 'margin-top:8px' }, [cancel2, save2])]));
        card.appendChild(h('div', { 'class': 'note', text: 'Each tap moves a control one grid step or changes its size one step. Controls stop at the screen edges. The game is paused while this is open. Esc or the controller B button also closes it.' }));
    }

    function refreshPanel() {
        if (!panel || !ui.mode) { return; }
        ui.mode.set(S.mode);
        ui.style.set(S.padStyle);
        ui.swap.set(S.swap ? 'on' : 'off');
        ui.hud.set(S.hud ? 'on' : 'off');
        ui.opacity.val.textContent = S.opacity + '%';
        ui.opacity.minus.disabled = S.opacity <= 20;
        ui.opacity.plus.disabled = S.opacity >= 100;
        var m = metrics();
        CONTROLS.forEach(function(c) {
            var w = ui['sec_' + c.id], shown = !!S.show[c.id], g = S.ctl[c.id];
            w.vis.textContent = shown ? 'Shown' : 'Hidden';
            w.vis.className = shown ? 'vis' : 'hid';
            w.btns.forEach(function(b) { b.disabled = !shown; });
            if (shown) {
                var e = effective(c, m);
                w.readout.textContent = 'x ' + Math.round(e.cx / m.W * GRID) + '  y ' + Math.round(e.cy / m.H * GRID) +
                    '  \u00B7  size ' + (g.s + 1) + '/' + (SIZE_MAX + 1);
                w.btns[4].disabled = g.s <= SIZE_MIN;
                w.btns[5].disabled = g.s >= SIZE_MAX;
            } else {
                w.readout.textContent = 'hidden';
            }
        });
    }

    //-------------------------------------------------------------------------
    // Open / close (the game is paused while the column is open)
    //-------------------------------------------------------------------------

    function setPaused(v) {
        paused = v;
        if (v) { releaseAll(); }
    }

    function openPanel() {
        if (panelOpen) { return; }
        snapshot = clone(S);
        panelOpen = true;
        panel.style.display = 'block';
        panel.scrollTop = 0;
        root.classList.add('editing');
        setPaused(true);
        layout();
    }

    function closePanel() {
        if (!panelOpen) { return; }
        panelOpen = false;
        panel.style.display = 'none';
        root.classList.remove('editing');
        CONTROLS.forEach(function(c) { els[c.id].classList.remove('sel'); els[c.id].classList.remove('blocked'); });
        setPaused(false);
        saveSettings();
        layout();
    }

    function cancelPanel() {
        if (snapshot) { S = sanitize(snapshot); saveSettings(); }
        closePanel();
    }

    //-------------------------------------------------------------------------
    // Auto mode (touch vs. hardware) + hardware shortcuts for the column
    //-------------------------------------------------------------------------

    function noteHardware() { if (!hardwareActive) { hardwareActive = true; refreshVisibility(); } }
    function noteTouch()    { if (hardwareActive)  { hardwareActive = false; refreshVisibility(); } }

    var padBWas = false;
    function gamepadPoll() {
        var any = false, b = false;
        try {
            var pads = navigator.getGamepads ? navigator.getGamepads() : [];
            for (var i = 0; i < pads.length; i++) {
                var g = pads[i];
                if (!g || !g.connected) { continue; }
                if (g.buttons[1] && g.buttons[1].pressed) { b = true; }
                for (var k = 0; k < g.buttons.length; k++) { if (g.buttons[k].pressed) { any = true; } }
                for (var a = 0; a < g.axes.length; a++) { if (Math.abs(g.axes[a]) > 0.6) { any = true; } }
            }
        } catch (e) {}
        if (any) { noteHardware(); }
        if (panelOpen && b && !padBWas) { closePanel(); }
        padBWas = b;
    }

    function installDetection() {
        window.addEventListener('keydown', function(ev) {
            if (panelOpen && (ev.key === 'Escape' || ev.keyCode === 27)) {
                ev.stopPropagation(); ev.preventDefault();
                closePanel();
                return;
            }
            if (ev.isTrusted !== false) { noteHardware(); }
        }, true);
        document.addEventListener('pointerdown', function(ev) {
            if (ev.pointerType === 'touch' || ev.pointerType === 'pen') { noteTouch(); }
        }, true);
        document.addEventListener('touchstart', noteTouch, true);
        setInterval(gamepadPoll, 250);
        window.addEventListener('blur', releaseAll);
        document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'hidden') { releaseAll(); } });
        window.addEventListener('resize', layout);
        window.addEventListener('orientationchange', function() { setTimeout(layout, 250); });
    }

    //-------------------------------------------------------------------------
    // Pause hook + performance readout
    //-------------------------------------------------------------------------

    var ticks = 0;
    var _updateScene = SceneManager.updateScene;
    SceneManager.updateScene = function() {
        ticks++;
        if (paused) { return; }
        return _updateScene.apply(this, arguments);
    };

    var frames = 0, worst = 0, lastFrame = 0, hudTimer = 0;
    function hudLoop(now) {
        if (lastFrame) { var d = now - lastFrame; if (d > worst) { worst = d; } }
        lastFrame = now;
        frames++;
        if (!hudTimer) { hudTimer = now; }
        if (now - hudTimer >= 1000) {
            if (S.hud) {
                var a = window.IIVII_AudioFix ? window.IIVII_AudioFix.stats() : null;
                hud.textContent =
                    'fps ' + frames + '  logic ' + ticks + '  worst ' + Math.round(worst) + 'ms' +
                    (a ? '\naudio ' + a.state + '  cache ' + a.cached + ' (' + a.cacheMB + 'MB)  hit ' + a.hits + '/' + (a.hits + a.misses) : '');
            }
            frames = 0; ticks = 0; worst = 0; hudTimer = now;
        }
        requestAnimationFrame(hudLoop);
    }

    //-------------------------------------------------------------------------
    // Start
    //-------------------------------------------------------------------------

    function init() {
        var style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);
        buildControls();
        buildPanel();
        installDetection();
        layout();
        requestAnimationFrame(hudLoop);
    }

    if (document.body) { init(); }
    else { window.addEventListener('DOMContentLoaded', init); }

    window.IIVII_TouchControls = {
        open: openPanel,
        close: closePanel,
        settings: function() { return clone(S); },
        _press: press, _release: release
    };

})();
