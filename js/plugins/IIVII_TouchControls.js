//=============================================================================
// IIVII_TouchControls.js
//=============================================================================

/*:
 * @plugindesc Customizable on-screen touch controls (D-pad + buttons) with
 * Auto / On / Off modes. Works alongside controllers and keyboards.
 * @author IIVII
 *
 * @help
 * A small gear in the top-right corner opens the settings panel:
 *   Mode      Auto  = overlay shows while you are using touch and hides as
 *                     soon as a controller or keyboard is used (touch the
 *                     screen to bring it back)
 *             On    = always shown
 *             Off   = never shown (hardware only)
 *   Size, opacity, left-handed layout, which buttons are shown, and
 *   "Edit layout" to drag the D-pad and buttons wherever you like.
 *   The game is paused while the panel or layout editor is open.
 *
 * Buttons press the game's real keys, so every plugin that reads the keyboard
 * (torch, dash, menus, key config...) keeps working.
 *   A = OK / Talk (Z)     B = Cancel / Menu (X)     T = Torch     C = Phase
 *   Skill = Shift         L / R = Page Up / Page Down
 *
 * Settings are stored in this browser/app container (localStorage). The Safari
 * tab and the Home Screen app keep separate copies.
 *
 * No plugin parameters. Place this plugin at the END of the plugin list.
 */

(function() {
    'use strict';

    var STORE_KEY = 'IIVII_TouchControls_v1';

    //-------------------------------------------------------------------------
    // Settings
    //-------------------------------------------------------------------------

    var DEFAULTS = {
        mode: 'auto',
        size: 100,
        opacity: 65,
        swap: false,
        hud: false,
        show: { ok: true, escape: true, t: true, c: false, shift: false, pager: false },
        pad: { x: 0.14, y: 0.76 },
        act: { x: 0.85, y: 0.74 }
    };

    function clone(o) { return JSON.parse(JSON.stringify(o)); }

    function loadSettings() {
        var s = clone(DEFAULTS);
        try {
            var raw = window.localStorage.getItem(STORE_KEY);
            if (raw) {
                var p = JSON.parse(raw);
                ['mode', 'size', 'opacity', 'swap', 'hud'].forEach(function(k) {
                    if (p[k] !== undefined) { s[k] = p[k]; }
                });
                if (p.show) { for (var k in s.show) { if (p.show[k] !== undefined) { s.show[k] = !!p.show[k]; } } }
                if (p.pad) { s.pad = { x: +p.pad.x || s.pad.x, y: +p.pad.y || s.pad.y }; }
                if (p.act) { s.act = { x: +p.act.x || s.act.x, y: +p.act.y || s.act.y }; }
            }
        } catch (e) {}
        return s;
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

    var holds = {};   // name -> number of active sources

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
    // DOM
    //-------------------------------------------------------------------------

    var CSS = [
        '#iivii-tc{position:fixed;left:0;top:0;right:0;bottom:0;z-index:10000;pointer-events:none;',
        '-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:none;',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
        '#iivii-tc .grp{position:absolute;pointer-events:none}',
        '#iivii-tc.editing .grp{outline:2px dashed rgba(255,215,0,.9);outline-offset:6px;pointer-events:auto;cursor:move;',
        'background:rgba(255,215,0,.08);border-radius:18px}',
        '#iivii-tc.editing .grp *{pointer-events:none!important}',
        '#iivii-tc .pad{position:absolute;left:0;top:0;border-radius:50%;pointer-events:auto;touch-action:none;',
        'background:rgba(18,18,22,.55);border:2px solid rgba(255,255,255,.45)}',
        '#iivii-tc .pad i{position:absolute;color:#fff;font-style:normal;opacity:.8;text-align:center;line-height:1}',
        '#iivii-tc .pad i.hot{opacity:1;color:#ffd84d}',
        '#iivii-tc .btn{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;',
        'pointer-events:auto;touch-action:none;color:#fff;font-weight:700;text-align:center;line-height:1;',
        'background:rgba(18,18,22,.55);border:2px solid rgba(255,255,255,.5);border-radius:50%}',
        '#iivii-tc .btn small{font-size:.55em;font-weight:500;opacity:.8;margin-top:2px}',
        '#iivii-tc .btn.pill{border-radius:999px}',
        '#iivii-tc .btn.on{background:rgba(255,216,77,.55);border-color:#ffd84d}',
        '#iivii-gear{position:fixed;z-index:10001;width:36px;height:36px;border-radius:50%;',
        'top:calc(env(safe-area-inset-top,0px) + 6px);right:calc(env(safe-area-inset-right,0px) + 6px);',
        'background:rgba(0,0,0,.45);color:#fff;font-size:20px;display:flex;align-items:center;',
        'justify-content:center;opacity:.28;touch-action:none;-webkit-user-select:none;user-select:none}',
        '#iivii-gear:active{opacity:.9}',
        '#iivii-panel{position:fixed;left:0;top:0;right:0;bottom:0;z-index:10002;display:none;',
        'background:rgba(0,0,0,.62);overflow:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y;',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
        '#iivii-card{box-sizing:border-box;width:min(440px,94vw);margin:calc(env(safe-area-inset-top,0px) + 14px) auto 24px;',
        'background:#17171b;color:#eee;border-radius:16px;padding:14px 16px 16px;font-size:15px;line-height:1.35}',
        '#iivii-card h2{margin:0 0 10px;font-size:17px}',
        '#iivii-card .row{margin:12px 0}',
        '#iivii-card label.t{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;color:#bbb;font-size:13px}',
        '#iivii-card .seg{display:flex;border:1px solid #444;border-radius:10px;overflow:hidden}',
        '#iivii-card .seg button{flex:1;padding:10px 0;background:#222;color:#ddd;border:0;font-size:15px}',
        '#iivii-card .seg button.sel{background:#ffd84d;color:#000;font-weight:700}',
        '#iivii-card input[type=range]{width:100%;height:34px}',
        '#iivii-card .chk{display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid #2a2a2f}',
        '#iivii-card .chk input{width:22px;height:22px}',
        '#iivii-card .btns{display:flex;gap:8px;margin-top:14px}',
        '#iivii-card .btns button{flex:1;padding:12px 6px;border-radius:10px;border:0;background:#2b2b31;color:#eee;font-size:15px}',
        '#iivii-card .btns button.main{background:#ffd84d;color:#000;font-weight:700}',
        '#iivii-card .note{margin-top:12px;font-size:12px;color:#888}',
        '#iivii-editbar{position:fixed;z-index:10001;left:50%;transform:translateX(-50%);display:none;gap:8px;',
        'top:calc(env(safe-area-inset-top,0px) + 10px)}',
        '#iivii-editbar button{padding:11px 18px;border-radius:12px;border:0;background:#ffd84d;color:#000;font-size:15px;font-weight:700}',
        '#iivii-editbar button.sec{background:#33333a;color:#eee;font-weight:500}',
        '#iivii-hud{position:fixed;z-index:10001;left:calc(env(safe-area-inset-left,0px) + 6px);',
        'bottom:calc(env(safe-area-inset-bottom,0px) + 4px);font:11px/1.3 ui-monospace,Menlo,monospace;color:#9f9;',
        'background:rgba(0,0,0,.55);padding:3px 6px;border-radius:6px;display:none;pointer-events:none;white-space:pre}'
    ].join('');

    var root, padGrp, actGrp, padEl, gear, panel, card, editbar, hud, padArrows = {};
    var activeButtons = {};   // pointerId -> {el, name}
    var buttonEls = [];       // {name, el, def}
    var editing = false;
    var panelOpen = false;
    var hardwareActive = false;

    // Button layout inside the action cluster, in "units" (before scaling).
    var ACT_W = 250, ACT_H = 190, PAD_SZ = 170;
    var BUTTONS = [
        { name: 'ok',       label: 'A',   sub: 'OK',    x: 180, y: 122, r: 38, group: 'ok' },
        { name: 'escape',   label: 'B',   sub: 'Menu',  x: 100, y: 150, r: 34, group: 'escape' },
        { name: 't',        label: 'T',   sub: 'Torch', x: 112, y: 66,  r: 30, group: 't' },
        { name: 'c',        label: 'C',   sub: 'Phase', x: 188, y: 46,  r: 27, group: 'c' },
        { name: 'shift',    label: 'Skill', sub: '',    x: 34,  y: 118, r: 28, group: 'shift' },
        { name: 'pageup',   label: 'L',   sub: '',      x: 52,  y: 20,  r: 0, w: 56, h: 30, pill: true, group: 'pager' },
        { name: 'pagedown', label: 'R',   sub: '',      x: 118, y: 20,  r: 0, w: 56, h: 30, pill: true, group: 'pager' }
    ];

    function h(tag, props, kids) {
        var el = document.createElement(tag);
        if (props) { for (var k in props) { if (k === 'text') { el.textContent = props[k]; } else { el.setAttribute(k, props[k]); } } }
        (kids || []).forEach(function(c) { el.appendChild(c); });
        return el;
    }

    function unit() {
        var base = Math.max(0.8, Math.min(1.35, Math.min(window.innerWidth, window.innerHeight) / 720));
        return base * S.size / 100;
    }

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

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function placeGroup(grp, frac, w, h_) {
        var W = window.innerWidth, H = window.innerHeight, ins = insets();
        var x = S.swap ? 1 - frac.x : frac.x;   // mirrored when left-handed
        var left = clamp(x * W - w / 2, ins.l + 6, Math.max(ins.l + 6, W - ins.r - w - 6));
        var top = clamp(frac.y * H - h_ / 2, ins.t + 6, Math.max(ins.t + 6, H - ins.b - h_ - 6));
        grp.style.left = left + 'px';
        grp.style.top = top + 'px';
        grp.style.width = w + 'px';
        grp.style.height = h_ + 'px';
    }

    function layout() {
        if (!root) { return; }
        var u = unit();
        root.style.opacity = S.opacity / 100;

        // D-pad
        var ps = PAD_SZ * u;
        // Stored x is the right-handed position; placeGroup mirrors it when left-handed.
        placeGroup(padGrp, S.pad, ps, ps);
        padEl.style.width = padEl.style.height = ps + 'px';
        var fs = Math.round(ps * 0.26) + 'px';
        var edge = ps * 0.06;
        var a = padArrows;
        [['up', '\u25B2', ps / 2 - ps * 0.13, edge],
         ['down', '\u25BC', ps / 2 - ps * 0.13, ps - edge - ps * 0.26],
         ['left', '\u25C0', edge, ps / 2 - ps * 0.13],
         ['right', '\u25B6', ps - edge - ps * 0.26, ps / 2 - ps * 0.13]].forEach(function(d) {
            var el = a[d[0]];
            el.textContent = d[1];
            el.style.fontSize = fs;
            el.style.width = el.style.height = (ps * 0.26) + 'px';
            el.style.left = d[2] + 'px';
            el.style.top = d[3] + 'px';
        });

        // Action buttons
        var aw = ACT_W * u, ah = ACT_H * u;
        placeGroup(actGrp, S.act, aw, ah);
        buttonEls.forEach(function(b) {
            var d = b.def, visible = !!S.show[d.group];
            b.el.style.display = visible ? 'flex' : 'none';
            if (!visible) { return; }
            var bw = d.pill ? d.w * u : d.r * 2 * u, bh = d.pill ? d.h * u : d.r * 2 * u;
            var cx = S.swap ? (ACT_W - d.x) : d.x;
            b.el.style.width = bw + 'px';
            b.el.style.height = bh + 'px';
            b.el.style.left = (cx * u - bw / 2) + 'px';
            b.el.style.top = (d.y * u - bh / 2) + 'px';
            b.el.style.fontSize = Math.round((d.pill ? 15 : (d.label.length > 2 ? 13 : 22)) * u) + 'px';
        });

        gear.style.display = '';
        hud.style.display = S.hud ? 'block' : 'none';
        refreshVisibility();
    }

    function overlayVisible() {
        if (editing) { return true; }
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
    // D-pad
    //-------------------------------------------------------------------------

    var padDir = null, padAxis = null, padPointer = null;

    function setPadDir(dir) {
        if (dir === padDir) { return; }
        if (padDir) { release(padDir); if (padArrows[padDir]) { padArrows[padDir].classList.remove('hot'); } }
        padDir = dir;
        if (padDir) { press(padDir); if (padArrows[padDir]) { padArrows[padDir].classList.add('hot'); } }
    }

    function padUpdate(ev) {
        var r = padEl.getBoundingClientRect();
        var dx = ev.clientX - (r.left + r.width / 2);
        var dy = ev.clientY - (r.top + r.height / 2);
        var rad = r.width / 2;
        if (Math.sqrt(dx * dx + dy * dy) < rad * 0.2) { padAxis = null; setPadDir(null); return; }
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
    }

    //-------------------------------------------------------------------------
    // Build UI
    //-------------------------------------------------------------------------

    function swallow(el) {
        ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'mousemove', 'contextmenu']
            .forEach(function(type) {
                el.addEventListener(type, function(ev) {
                    ev.stopPropagation();
                    if (ev.cancelable && ev.target.tagName !== 'INPUT' && ev.target.tagName !== 'BUTTON') { ev.preventDefault(); }
                }, { passive: false });
            });
    }

    function buildControls() {
        root = h('div', { id: 'iivii-tc' });
        swallow(root);

        padGrp = h('div', { 'class': 'grp' });
        padEl = h('div', { 'class': 'pad' });
        ['up', 'down', 'left', 'right'].forEach(function(d) {
            padArrows[d] = h('i');
            padEl.appendChild(padArrows[d]);
        });
        padGrp.appendChild(padEl);
        root.appendChild(padGrp);

        padEl.addEventListener('pointerdown', function(ev) {
            if (editing || padPointer !== null) { return; }
            padPointer = ev.pointerId;
            try { padEl.setPointerCapture(ev.pointerId); } catch (e) {}
            padUpdate(ev);
        });
        padEl.addEventListener('pointermove', function(ev) { if (ev.pointerId === padPointer) { padUpdate(ev); } });
        padEl.addEventListener('pointerup', padEnd);
        padEl.addEventListener('pointercancel', padEnd);
        padEl.addEventListener('lostpointercapture', padEnd);

        actGrp = h('div', { 'class': 'grp' });
        BUTTONS.forEach(function(def) {
            var el = h('div', { 'class': 'btn' + (def.pill ? ' pill' : '') });
            el.appendChild(h('span', { text: def.label }));
            if (def.sub) { el.appendChild(h('small', { text: def.sub })); }
            actGrp.appendChild(el);
            buttonEls.push({ name: def.name, el: el, def: def });

            el.addEventListener('pointerdown', function(ev) {
                if (editing) { return; }
                try { el.setPointerCapture(ev.pointerId); } catch (e) {}
                if (activeButtons[ev.pointerId]) { return; }
                activeButtons[ev.pointerId] = { el: el, name: def.name };
                el.classList.add('on');
                press(def.name);
            });
            var up = function(ev) {
                var a = activeButtons[ev.pointerId];
                if (!a || a.el !== el) { return; }
                delete activeButtons[ev.pointerId];
                el.classList.remove('on');
                release(def.name);
            };
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
            el.addEventListener('lostpointercapture', up);
        });
        root.appendChild(actGrp);

        // drag-to-move in edit mode
        [[padGrp, 'pad'], [actGrp, 'act']].forEach(function(pair) {
            var grp = pair[0], key = pair[1], drag = null;
            grp.addEventListener('pointerdown', function(ev) {
                if (!editing) { return; }
                try { grp.setPointerCapture(ev.pointerId); } catch (e) {}
                var r = grp.getBoundingClientRect();
                drag = { id: ev.pointerId, ox: ev.clientX - r.left, oy: ev.clientY - r.top, w: r.width, h: r.height };
            });
            grp.addEventListener('pointermove', function(ev) {
                if (!drag || ev.pointerId !== drag.id) { return; }
                var W = window.innerWidth, H = window.innerHeight;
                var cx = (ev.clientX - drag.ox + drag.w / 2) / W;
                var cy = (ev.clientY - drag.oy + drag.h / 2) / H;
                cx = clamp(cx, 0.04, 0.96); cy = clamp(cy, 0.08, 0.96);
                var stored = { x: S.swap ? 1 - cx : cx, y: cy };
                if (key === 'pad') { S.pad = stored; } else { S.act = stored; }
                layout();
            });
            var end = function(ev) { if (drag && ev.pointerId === drag.id) { drag = null; saveSettings(); } };
            grp.addEventListener('pointerup', end);
            grp.addEventListener('pointercancel', end);
        });

        document.body.appendChild(root);
    }

    function segment(options, current, onPick) {
        var wrap = h('div', { 'class': 'seg' });
        options.forEach(function(o) {
            var b = h('button', { text: o[1], type: 'button' });
            if (o[0] === current) { b.className = 'sel'; }
            b.addEventListener('click', function() {
                Array.prototype.forEach.call(wrap.children, function(c) { c.className = ''; });
                b.className = 'sel';
                onPick(o[0]);
            });
            wrap.appendChild(b);
        });
        return wrap;
    }

    function slider(label, min, max, value, fmt, onChange) {
        var val = h('span', { text: fmt(value) });
        var t = h('label', { 'class': 't' }, [h('span', { text: label }), val]);
        var input = h('input', { type: 'range', min: min, max: max, step: 5, value: value });
        input.addEventListener('input', function() { val.textContent = fmt(+input.value); onChange(+input.value); });
        return h('div', { 'class': 'row' }, [t, input]);
    }

    function checkRow(label, checked, onChange) {
        var input = h('input', { type: 'checkbox' });
        input.checked = !!checked;
        input.addEventListener('change', function() { onChange(input.checked); });
        return h('div', { 'class': 'chk' }, [h('span', { text: label }), input]);
    }

    function buildPanel() {
        gear = h('div', { id: 'iivii-gear', text: '\u2699' });
        swallow(gear);
        gear.addEventListener('pointerup', function() { openPanel(); });
        document.body.appendChild(gear);

        hud = h('div', { id: 'iivii-hud' });
        document.body.appendChild(hud);

        panel = h('div', { id: 'iivii-panel' });
        swallow(panel);
        panel.addEventListener('pointerdown', function(ev) { if (ev.target === panel) { closePanel(); } });
        card = h('div', { id: 'iivii-card' });
        panel.appendChild(card);
        document.body.appendChild(panel);

        editbar = h('div', { id: 'iivii-editbar' });
        var done = h('button', { text: 'Done', type: 'button' });
        var reset = h('button', { text: 'Reset', type: 'button', 'class': 'sec' });
        done.addEventListener('click', function() { stopEdit(); });
        reset.addEventListener('click', function() { S.pad = clone(DEFAULTS.pad); S.act = clone(DEFAULTS.act); saveSettings(); layout(); });
        editbar.appendChild(reset); editbar.appendChild(done);
        swallow(editbar);
        document.body.appendChild(editbar);
    }

    function renderPanel() {
        card.innerHTML = '';
        card.appendChild(h('h2', { text: 'Touch controls' }));

        card.appendChild(h('div', { 'class': 'row' }, [
            h('label', { 'class': 't' }, [h('span', { text: 'Mode' })]),
            segment([['auto', 'Auto'], ['on', 'On'], ['off', 'Off']], S.mode, function(v) { S.mode = v; saveSettings(); layout(); })
        ]));
        card.appendChild(slider('Size', 60, 160, S.size, function(v) { return v + '%'; }, function(v) { S.size = v; saveSettings(); layout(); }));
        card.appendChild(slider('Opacity', 20, 100, S.opacity, function(v) { return v + '%'; }, function(v) { S.opacity = v; saveSettings(); layout(); }));

        card.appendChild(checkRow('Left-handed layout (swap sides)', S.swap, function(v) { S.swap = v; saveSettings(); layout(); }));
        card.appendChild(checkRow('Torch button (T)', S.show.t, function(v) { S.show.t = v; saveSettings(); layout(); }));
        card.appendChild(checkRow('Phase button (C)', S.show.c, function(v) { S.show.c = v; saveSettings(); layout(); }));
        card.appendChild(checkRow('Skill button (Shift)', S.show.shift, function(v) { S.show.shift = v; saveSettings(); layout(); }));
        card.appendChild(checkRow('L / R page buttons', S.show.pager, function(v) { S.show.pager = v; saveSettings(); layout(); }));
        card.appendChild(checkRow('Performance readout', S.hud, function(v) { S.hud = v; saveSettings(); layout(); }));

        var edit = h('button', { text: 'Edit layout', type: 'button' });
        edit.addEventListener('click', function() { closePanel(); startEdit(); });
        var reset = h('button', { text: 'Reset all', type: 'button' });
        reset.addEventListener('click', function() { S = clone(DEFAULTS); saveSettings(); layout(); renderPanel(); });
        var close = h('button', { text: 'Close', type: 'button', 'class': 'main' });
        close.addEventListener('click', closePanel);
        card.appendChild(h('div', { 'class': 'btns' }, [edit, reset, close]));
        card.appendChild(h('div', { 'class': 'note', text: 'The game is paused while this is open. Settings are saved separately for the Safari tab and the Home Screen app.' }));
    }

    //-------------------------------------------------------------------------
    // Panel / edit mode (these pause the game)
    //-------------------------------------------------------------------------

    var paused = false;

    function setPaused(v) {
        paused = v;
        if (v) { releaseAll(); }
    }

    function openPanel() {
        renderPanel();
        panel.style.display = 'block';
        panelOpen = true;
        setPaused(true);
    }

    function closePanel() {
        panel.style.display = 'none';
        panelOpen = false;
        setPaused(editing);
    }

    function startEdit() {
        editing = true;
        root.classList.add('editing');
        editbar.style.display = 'flex';
        setPaused(true);
        // make sure every button is visible so the cluster has its full size
        layout();
    }

    function stopEdit() {
        editing = false;
        root.classList.remove('editing');
        editbar.style.display = 'none';
        setPaused(panelOpen);
        layout();
    }

    //-------------------------------------------------------------------------
    // Auto mode: touch vs. hardware
    //-------------------------------------------------------------------------

    function noteHardware() {
        if (!hardwareActive) { hardwareActive = true; refreshVisibility(); }
    }

    function noteTouch() {
        if (hardwareActive) { hardwareActive = false; refreshVisibility(); }
    }

    function gamepadActive() {
        try {
            var pads = navigator.getGamepads ? navigator.getGamepads() : [];
            for (var i = 0; i < pads.length; i++) {
                var g = pads[i];
                if (!g || !g.connected) { continue; }
                for (var b = 0; b < g.buttons.length; b++) { if (g.buttons[b].pressed) { return true; } }
                for (var a = 0; a < g.axes.length; a++) { if (Math.abs(g.axes[a]) > 0.6) { return true; } }
            }
        } catch (e) {}
        return false;
    }

    function installDetection() {
        window.addEventListener('keydown', function(ev) {
            if (ev.isTrusted !== false) { noteHardware(); }
        }, true);
        document.addEventListener('pointerdown', function(ev) {
            if (ev.pointerType === 'touch' || ev.pointerType === 'pen') { noteTouch(); }
        }, true);
        document.addEventListener('touchstart', noteTouch, true);
        setInterval(function() { if (gamepadActive()) { noteHardware(); } }, 300);
        window.addEventListener('blur', releaseAll);
        document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'hidden') { releaseAll(); } });
        window.addEventListener('resize', layout);
        window.addEventListener('orientationchange', function() { setTimeout(layout, 250); });
    }

    //-------------------------------------------------------------------------
    // Pause hook + HUD
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
        settings: function() { return clone(S); },
        _press: press, _release: release
    };

})();
