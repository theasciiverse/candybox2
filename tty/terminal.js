// Drawing the game in the terminal and turning keys and the mouse into the
// events it listens for. Uses AV from browser.js and std/os from QuickJS.

var TERM = {
    w: 100, h: 30,
    prev: null,             // last frame sent, for sending only changes
    regions: [],            // [{el, x, y, w, h}] on screen, topmost last
    hover: null,            // element under the mouse
    hoverChain: [],         // it and its parents, for mouseenter/mouseleave
    mouseX: -1, mouseY: -1,
    kbdFocus: null,         // element chosen with Tab
    kbdFocusKey: null,      // to find it again after the next render
    dropdown: null,         // {select, index} while a list is open
    scrollX: 0, scrollY: 0, // main content scroll when it is bigger than the screen
    statusScrollX: 0,
    follow: true,           // follow the player in quests
    kitty: false,           // terminal reports key releases
    held: {},               // which -> release timer, without the kitty protocol
    out: []
};

// ---------------------------------------------------------------------------
// Colours

TERM.theme = function () {
    if (AV.invert)
        return {
            fg: [255, 255, 255], bg: [0, 0, 0],
            button: [35, 37, 42], buttonHover: [17, 20, 24], buttonFg: [255, 255, 255],
            field: [40, 40, 40], tip: [0, 0, 0], tipBorder: [255, 255, 255],
            link: [173, 216, 230], focus: [90, 90, 140]
        };
    return {
        fg: [0, 0, 0], bg: [255, 255, 255],
        button: [220, 218, 213], buttonHover: [238, 235, 231], buttonFg: [0, 0, 0],
        field: [232, 232, 232], tip: [255, 255, 255], tipBorder: [0, 0, 0],
        link: [0, 0, 238], focus: [190, 200, 255]
    };
};

TERM.parseColor = function (s) {
    if (!s)
        return null;
    var m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
    if (m)
        return [+m[1], +m[2], +m[3]];
    m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
    if (m)
        return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
    var named = { black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], grey: [128, 128, 128], gray: [128, 128, 128] };
    return named[s.toLowerCase()] || null;
};

// ---------------------------------------------------------------------------
// The frame

function Cell(ch, fg, bg) {
    this.ch = ch; this.fg = fg; this.bg = bg;
    this.b = false; this.u = false; this.i = false;
}

TERM.newGrid = function (w, h, th) {
    var g = new Array(w * h);
    for (var i = 0; i < g.length; i++)
        g[i] = new Cell(" ", th.fg, th.bg);
    return g;
};

TERM.put = function (g, x, y, ch, style) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= TERM.w || y >= TERM.h)
        return;
    var c = g[y * TERM.w + x];
    c.ch = ch;
    if (style) {
        if (style.fg) c.fg = style.fg;
        if (style.bg) c.bg = style.bg;
        c.b = !!style.b; c.u = !!style.u; c.i = !!style.i;
    }
};

// where each location is drawn this frame
TERM.layout = function () {
    var st = AV.locations["#statusBar"], mc = AV.locations["#mainContent"];
    var sh = st ? st.height : 0;
    var lay = { status: null, main: null };
    if (st) {
        var sx = st.width <= TERM.w ? Math.floor((TERM.w - st.width) / 2) : -TERM.clamp(TERM.statusScrollX, 0, st.width - TERM.w);
        lay.status = { x: sx, y: 0, top: 0 };
    }
    if (mc) {
        var vh = Math.max(1, TERM.h - sh);
        // a new place starts at its top left, the world map at its right
        // edge (where the village and the first places are) and at the
        // scroll the game remembers for it (400 px at first: the village)
        var place = AV.game ? AV.game.place : null;
        if (place !== TERM.lastPlace) {
            TERM.lastPlace = place;
            TERM.follow = true;
            TERM.scrollY = 0;
            TERM.scrollX = 0;
            if (typeof MainMap != "undefined" && place instanceof MainMap) {
                TERM.scrollX = mc.width - TERM.w;
                TERM.scrollY = Math.round((AV.scrollTop || 0) / AV.ROW_PX);
            }
        }
        TERM.followPlayer(mc, vh);
        var mx = mc.width <= TERM.w ? Math.floor((TERM.w - mc.width) / 2) : -(TERM.scrollX = TERM.clamp(TERM.scrollX, 0, mc.width - TERM.w));
        var my = mc.height <= vh ? sh : sh - (TERM.scrollY = TERM.clamp(TERM.scrollY, 0, mc.height - vh));
        if (mc.height <= vh) TERM.scrollY = 0;
        if (mc.width <= TERM.w) TERM.scrollX = 0;
        lay.main = { x: mx, y: my, top: sh };
    }
    return lay;
};

TERM.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

// In a quest bigger than the screen, keep the player in view
TERM.followPlayer = function (mc, vh) {
    if (!TERM.follow || !AV.game || typeof Quest == "undefined")
        return;
    var place = AV.game.place;
    if (!(place instanceof Quest))
        return;
    var player = AV.game.getPlayer(), pos, qp;
    try {
        pos = player.getGlobalPosition();
        qp = place.getRealQuestPosition();
    } catch (e) {
        return;
    }
    if (!pos || !qp)
        return;
    // scroll only when the player would leave the view, so the top of the
    // quest (its exit button) and the start stay in view while they can
    var px = qp.x + pos.x, py = qp.y + pos.y;
    if (mc.width > TERM.w) {
        if (px > TERM.scrollX + Math.floor(TERM.w * 2 / 3)) TERM.scrollX = px - Math.floor(TERM.w * 2 / 3);
        if (px < TERM.scrollX + Math.floor(TERM.w / 6)) TERM.scrollX = px - Math.floor(TERM.w / 6);
    }
    if (mc.height > vh) {
        if (py > TERM.scrollY + vh - 4) TERM.scrollY = py - vh + 4;
        if (py < TERM.scrollY + 3) TERM.scrollY = py - 3;
    }
};

TERM.compose = function () {
    var th = TERM.theme();
    var g = TERM.newGrid(TERM.w, TERM.h, th);
    TERM.regions = [];
    var lay = TERM.layout();
    // main first, so the status bar stays on top when the map scrolls under it
    if (lay.main)
        TERM.drawLocation(g, AV.locations["#mainContent"], lay.main, th);
    if (lay.status)
        TERM.drawLocation(g, AV.locations["#statusBar"], lay.status, th);
    TERM.drawTooltips(g, th);
    TERM.drawDropdown(g, th);
    return g;
};

TERM.drawLocation = function (g, loc, at, th) {
    var inline = [], overlays = [];
    loc.elements.forEach(function (e) {
        if (e.isOverlay()) overlays.push(e);
        else if (e.x2 !== null && e.x2 > e.x1) inline.push(e);
    });
    var byRow = {};
    inline.forEach(function (e) { (byRow[e.y] = byRow[e.y] || []).push(e); });

    var top = at.top;
    for (var y = 0; y < loc.height; y++) {
        var sy = at.y + y;
        if (sy < top || sy >= TERM.h)
            continue;
        var line = loc.area[y] || "";
        var els = byRow[y] || [];
        for (var x = 0; x < loc.width; x++) {
            var sx = at.x + x;
            if (sx < 0 || sx >= TERM.w)
                continue;
            var st = { fg: th.fg, bg: th.bg, b: false, u: false, i: false };
            var hidden = false;
            for (var k = 0; k < els.length; k++) {
                var e = els[k];
                if (x < e.x1 || x >= e.x2)
                    continue;
                if (!e.isVisible()) { hidden = true; continue; }
                TERM.applyStyle(e, st, th);
            }
            TERM.put(g, sx, sy, hidden ? " " : (line[x] || " "), st);
        }
    }
    // regions for the mouse: style ranges with handlers, in reading order
    inline.forEach(function (e) {
        if (!e.isVisible())
            return;
        TERM.addRegion(e, at.x + e.x1, at.y + e.y, e.x2 - e.x1, 1, top);
    });
    overlays.forEach(function (e) { TERM.drawOverlay(g, e, at, th, top); });
};

TERM.applyStyle = function (e, st, th) {
    if (e.tag == "b" || e.cssValue("font-weight") == "bold") st.b = true;
    if (e.tag == "u") st.u = true;
    if (e.tag == "i" || e.cssValue("font-style") == "italic") st.i = true;
    if (e.tag == "a") { st.u = true; st.fg = th.link; }
    var c = TERM.parseColor(e.cssValue("color"));
    if (c) st.fg = c;
    var bg = TERM.parseColor(e.cssValue("background-color"));
    if (bg) st.bg = bg;
    if (e.hasClass("asciiButton") && (TERM.hover === e || TERM.hoverChain.indexOf(e) != -1)) {
        st.bg = TERM.mix(st.bg, th.fg, 0.18);
    }
    if (TERM.kbdFocus === e)
        st.bg = th.focus;
};

TERM.mix = function (a, b, t) {
    return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
};

TERM.addRegion = function (e, x, y, w, h, top) {
    if (y < top)
        return;
    TERM.regions.push({ el: e, x: x, y: y, w: w, h: h });
};

TERM.width = function (e, fallback) {
    var m = /(\d+)\s*ex/.exec(e.cssValue("width") || "");
    return m ? +m[1] : fallback;
};

TERM.drawOverlay = function (g, e, at, th, top) {
    if (!e.isShown())
        return;
    var x = at.x + e.x1, y = at.y + e.y;
    var visible = e.isVisible();
    var focused = TERM.kbdFocus === e;
    if (e.hasClass("asciiRealButton")) {
        var hover = TERM.hover === e;
        var bg = TERM.parseColor(e.cssValue("background-color")) || (hover ? th.buttonHover : th.button);
        if (hover && e.cssValue("background-color")) bg = TERM.mix(bg, [255, 255, 255], 0.25);
        if (focused) bg = th.focus;
        var fg = e.cssValue("background-color") ? [0, 0, 0] : th.buttonFg;
        if (visible && y >= top)
            for (var i = 0; i < e.content.length; i++) {
                var c = e.content[i];
                TERM.put(g, x + i, y, c.ch, { fg: fg, bg: bg, b: c.b, u: c.u, i: c.i });
            }
        TERM.addRegion(e, x, y, e.content.length, 1, top);
        return;
    }
    if (e.hasClass("comment")) {
        if (visible && y >= top)
            for (var j = 0; j < e.content.length; j++) {
                var cc = e.content[j];
                TERM.put(g, x + j, y, cc.ch, { fg: th.fg, bg: th.bg, b: cc.b || e.hasClass("englishComment"), u: cc.u, i: cc.i || e.hasClass("translated") });
            }
        return;
    }
    if (e.tag == "input" && e.attrs.type == "checkbox") {
        if (visible && y >= top) {
            var box = e.checked ? "[x]" : "[ ]";
            for (var b = 0; b < 3; b++)
                TERM.put(g, x + b, y, box[b], { fg: th.fg, bg: focused ? th.focus : th.field });
        }
        TERM.addRegion(e, x, y, 3, 1, top);
        return;
    }
    if (e.tag == "input") {
        var w = TERM.width(e, 10);
        var hasFocus = AV.focus === e;
        var val = e.value;
        var start = Math.max(0, val.length - (w - 1));
        if (visible && y >= top)
            for (var k = 0; k < w; k++) {
                var ch = val[start + k] || " ";
                var cur = hasFocus && start + k == val.length;
                TERM.put(g, x + k, y, ch, { fg: cur ? th.bg : th.fg, bg: cur ? th.fg : (focused ? th.focus : th.field), u: !cur });
            }
        TERM.addRegion(e, x, y, w, 1, top);
        return;
    }
    if (e.tag == "select") {
        var sw = TERM.width(e, 20);
        var opt = e.selectedOption();
        var label = (opt ? opt.text() : "");
        if (label.length > sw - 2) label = label.substr(0, sw - 2);
        while (label.length < sw - 2) label += " ";
        label += " ▾";
        if (visible && y >= top)
            for (var s = 0; s < sw; s++)
                TERM.put(g, x + s, y, label[s] || " ", { fg: e.disabled ? TERM.mix(th.fg, th.bg, 0.5) : th.fg, bg: focused || (TERM.dropdown && TERM.dropdown.select === e) ? th.focus : th.field });
        TERM.addRegion(e, x, y, sw, 1, top);
        return;
    }
    if (e.tag == "textarea") {
        var cols = +e.attrs.cols || 40, rows = +e.attrs.rows || 4;
        var lines = TERM.wrap(e.value, cols);
        var first = Math.max(0, lines.length - rows);
        var tfocus = AV.focus === e;
        for (var r = 0; r < rows; r++) {
            var ln = lines[first + r] || "";
            for (var q = 0; q < cols; q++) {
                var isCur = tfocus && first + r == lines.length - 1 && q == ln.length;
                if (visible && y + r >= top)
                    TERM.put(g, x + q, y + r, ln[q] || " ", { fg: isCur ? th.bg : th.fg, bg: isCur ? th.fg : (focused ? th.focus : th.field) });
            }
        }
        TERM.addRegion(e, x, y, cols, rows, top);
        return;
    }
};

TERM.wrap = function (text, width) {
    var out = [];
    String(text).split("\n").forEach(function (para) {
        if (para.length == 0) { out.push(""); return; }
        for (var i = 0; i < para.length; i += width)
            out.push(para.substr(i, width));
    });
    if (out.length == 0) out.push("");
    return out;
};

TERM.wordWrap = function (text, width) {
    var out = [], line = "";
    text.split(/\s+/).forEach(function (word) {
        if (word == "") return;
        if (line.length && line.length + 1 + word.length > width) { out.push(line); line = ""; }
        while (word.length > width) { if (line.length) { out.push(line); line = ""; } out.push(word.substr(0, width)); word = word.substr(width); }
        line += (line.length ? " " : "") + word;
    });
    if (line.length) out.push(line);
    return out;
};

// tooltips: shown by the game on hover, drawn as a box beside the mouse
TERM.drawTooltips = function (g, th) {
    AV.allElements().forEach(function (e) {
        if (!e.hasClass("tooltip") || e.cssValue("display") != "block")
            return;
        // each line of the tooltip (split at <br>) wrapped to the box, bold kept
        var lines = [], bold = [];
        var parts = [[]];
        e.content.forEach(function (c) { if (c.ch == "\n") parts.push([]); else parts[parts.length - 1].push(c); });
        parts.forEach(function (p) {
            var text = p.map(function (c) { return c.ch; }).join("");
            var isBold = p.length && p.every(function (c) { return c.b || c.ch == " "; });
            var wrapped = TERM.wordWrap(text, 26);
            if (!wrapped.length) wrapped = [""];
            wrapped.forEach(function (l) { lines.push(l); bold.push(isBold); });
        });
        if (!lines.length) return;
        var w = 28, h = lines.length + 2;
        var x = TERM.mouseX + 2, y = TERM.mouseY + 1;
        if (x + w > TERM.w) x = Math.max(0, TERM.mouseX - w - 1);
        if (y + h > TERM.h) y = Math.max(0, TERM.h - h);
        for (var r = 0; r < h; r++)
            for (var c = 0; c < w; c++) {
                var ch = " ";
                if (r == 0 || r == h - 1) ch = c == 0 ? (r == 0 ? "┌" : "└") : c == w - 1 ? (r == 0 ? "┐" : "┘") : "─";
                else if (c == 0 || c == w - 1) ch = "│";
                else ch = lines[r - 1][c - 1] || " ";
                TERM.put(g, x + c, y + r, ch, { fg: th.fg, bg: th.tip, b: r > 0 && r < h - 1 && c > 0 && c < w - 1 && bold[r - 1] });
            }
    });
};

TERM.drawDropdown = function (g, th) {
    var d = TERM.dropdown;
    if (!d) return;
    var reg = null;
    for (var i = 0; i < TERM.regions.length; i++)
        if (TERM.regions[i].el === d.select) reg = TERM.regions[i];
    if (!reg) { TERM.dropdown = null; return; }
    var opts = d.select.options();
    var w = Math.max(reg.w, 4);
    opts.forEach(function (o) { w = Math.max(w, o.text().length + 2); });
    var y0 = reg.y + 1;
    if (y0 + opts.length > TERM.h) y0 = Math.max(0, reg.y - opts.length);
    for (var r = 0; r < opts.length; r++) {
        var label = " " + opts[r].text();
        for (var c = 0; c < w; c++)
            TERM.put(g, reg.x + c, y0 + r, label[c] || " ", { fg: r == d.index ? th.bg : th.fg, bg: r == d.index ? th.fg : th.field });
        TERM.regions.push({ el: opts[r], x: reg.x, y: y0 + r, w: w, h: 1, option: r });
    }
};

// ---------------------------------------------------------------------------
// Sending a frame: only the cells that changed

TERM.sgr = function (c) {
    return "\x1b[0;38;2;" + c.fg[0] + ";" + c.fg[1] + ";" + c.fg[2] + ";48;2;" + c.bg[0] + ";" + c.bg[1] + ";" + c.bg[2] +
        (c.b ? ";1" : "") + (c.i ? ";3" : "") + (c.u ? ";4" : "") + "m";
};

TERM.same = function (a, b) {
    return a.ch == b.ch && a.b == b.b && a.u == b.u && a.i == b.i &&
        a.fg[0] == b.fg[0] && a.fg[1] == b.fg[1] && a.fg[2] == b.fg[2] &&
        a.bg[0] == b.bg[0] && a.bg[1] == b.bg[1] && a.bg[2] == b.bg[2];
};

TERM.draw = function () {
    var g = TERM.compose();
    var prev = TERM.prev && TERM.prev.length == g.length ? TERM.prev : null;
    var out = [], last = null;
    for (var y = 0; y < TERM.h; y++) {
        var at = false;
        for (var x = 0; x < TERM.w; x++) {
            var c = g[y * TERM.w + x];
            if (prev && TERM.same(c, prev[y * TERM.w + x])) { at = false; continue; }
            if (!at) out.push("\x1b[" + (y + 1) + ";" + (x + 1) + "H");
            at = true;
            var s = TERM.sgr(c);
            if (s !== last) { out.push(s); last = s; }
            out.push(c.ch);
        }
    }
    TERM.prev = g;
    if (out.length)
        TERM.write(out.join(""));
};

TERM.write = function (s) {
    std.out.puts(s);
    std.out.flush();
};

// ---------------------------------------------------------------------------
// Input

TERM.regionAt = function (x, y) {
    for (var i = TERM.regions.length - 1; i >= 0; i--) {
        var r = TERM.regions[i];
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
            return r;
    }
    return null;
};

TERM.chain = function (e) {
    var out = [];
    for (; e; e = e.parent) out.push(e);
    return out;
};

TERM.mouseMove = function (x, y) {
    TERM.mouseX = x; TERM.mouseY = y;
    var r = TERM.regionAt(x, y);
    var e = r ? r.el : null;
    var chain = TERM.chain(e);
    var ev = AV.event({ pageX: x, pageY: y });
    TERM.hoverChain.forEach(function (old) {
        if (chain.indexOf(old) == -1) {
            TERM.fireOwn(old, "mouseleave", ev);
            TERM.fireOwn(old, "mouseout", ev);
        }
    });
    chain.forEach(function (n) {
        if (TERM.hoverChain.indexOf(n) == -1)
            TERM.fireOwn(n, "mouseenter", ev);
        TERM.fireOwn(n, "mousemove", ev);
    });
    if (r && r.option !== undefined && TERM.dropdown)
        TERM.dropdown.index = r.option;
    TERM.hover = e;
    TERM.hoverChain = chain;
    AV.dirty = true;
};

// handlers on this element only (mouseenter and mouseleave do not bubble)
TERM.fireOwn = function (e, type, ev) {
    var list = e.handlers[type];
    if (list) {
        list.forEach(function (f) { f.call(e, ev); });
        AV.dirty = true;
    }
};

TERM.click = function (x, y) {
    var r = TERM.regionAt(x, y);
    if (TERM.dropdown) {
        if (r && r.option !== undefined) TERM.chooseOption(r.option);
        else TERM.dropdown = null;
        AV.dirty = true;
        return;
    }
    if (!r) {
        AV.setFocus(null);
        return;
    }
    TERM.activate(r.el);
};

// what a click or Enter does to an element
TERM.activate = function (e) {
    AV.dirty = true;
    if (e.tag == "select") {
        if (e.disabled) return;
        var opts = e.options();
        TERM.dropdown = { select: e, index: Math.max(0, opts.indexOf(e.selectedOption())) };
        return;
    }
    if (e.tag == "input" && e.attrs.type == "checkbox") {
        e.checked = !e.checked;
        e.fire("change");
        return;
    }
    if (e.tag == "input" || e.tag == "textarea") {
        AV.setFocus(e);
        return;
    }
    if (e.tag == "a" && e.attrs.href) {
        var m = /[?&]slot=(\d+)/.exec(e.attrs.href);
        if (m) MAIN.restartWithSlot(m[1]);
        return;
    }
    AV.setFocus(null);
    e.fire("mouseup", AV.event({ which: 1 }));
};

TERM.chooseOption = function (index) {
    var d = TERM.dropdown;
    TERM.dropdown = null;
    var opts = d.select.options();
    if (!opts[index]) return;
    opts.forEach(function (o) { o.selected = false; });
    opts[index].selected = true;
    d.select.fire("change");
};

// elements Tab can reach, in reading order on screen
TERM.focusables = function () {
    var seen = [];
    TERM.regions.forEach(function (r) {
        if (r.option !== undefined) return;
        var e = r.el;
        var ok = e.tag == "select" || e.tag == "input" || e.tag == "textarea" || (e.tag == "a" && /slot=/.test(e.attrs.href || "")) ||
            e.hasClass("asciiRealButton") || e.hasClass("asciiButton") || (e.handlers.mouseup && !e.hasClass("asciiNinjaButton"));
        if (ok && !seen.some(function (s) { return s.el === e; }))
            seen.push(r);
    });
    seen.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    return seen.map(function (r) { return r.el; });
};

TERM.keyOf = function (e) {
    return e ? [e.loc, e.y, e.x1, e.tag, e.classes.join(" ")].join("|") : null;
};

// after a render the elements are new: find the Tab focus again
TERM.refocus = function () {
    if (!TERM.kbdFocusKey) { TERM.kbdFocus = null; return; }
    var all = AV.allElements();
    TERM.kbdFocus = null;
    for (var i = 0; i < all.length; i++)
        if (TERM.keyOf(all[i]) == TERM.kbdFocusKey) { TERM.kbdFocus = all[i]; break; }
    if (TERM.hover && all.indexOf(TERM.hover) == -1) {
        TERM.hover = null;
        TERM.hoverChain = [];
        if (TERM.mouseX >= 0) TERM.pendingHover = true;
    }
};

TERM.moveFocus = function (dir) {
    var list = TERM.focusables();
    if (!list.length) return;
    var i = list.indexOf(TERM.kbdFocus);
    i = i == -1 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    TERM.kbdFocus = list[i];
    TERM.kbdFocusKey = TERM.keyOf(list[i]);
    TERM.scrollTo(list[i]);
    AV.dirty = true;
};

TERM.scrollTo = function (e) {
    if (e.loc != "#mainContent") return;
    var st = AV.locations["#statusBar"], sh = st ? st.height : 0;
    var vh = TERM.h - sh;
    if (e.y < TERM.scrollY) TERM.scrollY = e.y;
    if (e.y >= TERM.scrollY + vh) TERM.scrollY = e.y - vh + 1;
};

// browser key codes (event.which) for the game's hotkeys
TERM.WHICH = { up: 38, down: 40, left: 37, right: 39, enter: 13, space: 32, backspace: 8, tab: 9, escape: 27 };

TERM.gameKey = function (which, release) {
    var ev = AV.event({ which: which });
    if (release) {
        AV.keyup.forEach(function (f) { f(ev); });
        return;
    }
    AV.keydown.forEach(function (f) { f(ev); });
    AV.dirty = true;
    if (!TERM.kitty) {
        // no key releases from this terminal: release after the key repeat
        // stops (the first repeat comes after about half a second)
        var h = TERM.held[which];
        if (h) clearTimeout(h.timer);
        var wait = h ? 120 : 600;
        TERM.held[which] = { timer: setTimeout(function () { delete TERM.held[which]; TERM.gameKey(which, true); }, wait) };
    }
};

// a key from the terminal: name ("up", "enter", "a", ...), the text it types,
// whether it is a release, and modifiers
TERM.key = function (k) {
    if (k.name == "ctrl-c" || k.name == "ctrl-q") { MAIN.quit(); return; }
    if (k.release) {
        var w = TERM.whichOf(k);
        if (w) TERM.gameKey(w, true);
        return;
    }
    AV.dirty = true;
    var d = TERM.dropdown;
    if (d) {
        var n = d.select.options().length;
        if (k.name == "up") d.index = (d.index + n - 1) % n;
        else if (k.name == "down") d.index = (d.index + 1) % n;
        else if (k.name == "enter" || k.name == "space") TERM.chooseOption(d.index);
        else if (k.name == "escape") TERM.dropdown = null;
        return;
    }
    // typing into a text input or textarea
    var f = AV.focus;
    if (f && (f.tag == "input" && f.attrs.type != "checkbox" || f.tag == "textarea")) {
        if (k.name == "escape" || k.name == "tab") { AV.setFocus(null); if (k.name == "tab") TERM.moveFocus(k.shift ? -1 : 1); return; }
        if (k.name == "backspace") { f.value = f.value.substr(0, f.value.length - 1); return; }
        if (k.name == "enter") {
            if (f.tag == "textarea") f.value += "\n";
            else { AV.focusValue = f.value; f.fire("change"); }
            return;
        }
        if (k.text) { f.value += k.text; return; }
        return;
    }
    if (k.name == "tab") { TERM.moveFocus(k.shift ? -1 : 1); return; }
    if (k.name == "escape") { TERM.kbdFocus = null; TERM.kbdFocusKey = null; return; }
    if ((k.name == "enter") && TERM.kbdFocus) { TERM.activate(TERM.kbdFocus); return; }
    if (k.name == "pageup" || k.name == "pagedown") {
        var st = AV.locations["#statusBar"], vh = TERM.h - (st ? st.height : 0);
        TERM.follow = false;
        TERM.scrollY += (k.name == "pageup" ? -1 : 1) * Math.max(1, vh - 2);
        return;
    }
    if (k.shift && (k.name == "left" || k.name == "right")) {
        TERM.follow = false;
        TERM.scrollX += (k.name == "left" ? -1 : 1) * 10;
        TERM.statusScrollX += (k.name == "left" ? -1 : 1) * 10;
        return;
    }
    // on the world map (a scrolling place without key controls) the arrows move the view
    if (AV.game && AV.game.place && AV.game.place.getScrolling && AV.game.place.getScrolling() &&
        { up: 1, down: 1, left: 1, right: 1 }[k.name]) {
        TERM.follow = false;
        if (k.name == "up") TERM.scrollY -= 3;
        if (k.name == "down") TERM.scrollY += 3;
        if (k.name == "left") TERM.scrollX -= 8;
        if (k.name == "right") TERM.scrollX += 8;
        AV.scrollTop = TERM.scrollY * AV.ROW_PX;
        return;
    }
    var which = TERM.whichOf(k);
    if (which) TERM.gameKey(which, false);
};

TERM.whichOf = function (k) {
    if (TERM.WHICH[k.name]) return TERM.WHICH[k.name];
    if (k.text && k.text.length == 1) {
        var c = k.text.toUpperCase().charCodeAt(0);
        if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90)) return c;
    }
    return 0;
};

TERM.wheel = function (dir, shift) {
    TERM.follow = false;
    if (shift) { TERM.scrollX += dir * 6; TERM.statusScrollX += dir * 6; }
    else TERM.scrollY += dir * 3;
    AV.scrollTop = Math.max(0, TERM.scrollY) * AV.ROW_PX;
    AV.dirty = true;
};

// ---------------------------------------------------------------------------
// Parsing what the terminal sends

TERM.inbuf = "";
TERM.pasting = null;

TERM.feed = function (s) {
    TERM.inbuf += s;
    var b = TERM.inbuf, i = 0;
    while (i < b.length) {
        if (TERM.pasting !== null) {
            var end = b.indexOf("\x1b[201~", i);
            if (end == -1) { TERM.pasting += b.substr(i); i = b.length; break; }
            TERM.pasting += b.substring(i, end);
            TERM.paste(TERM.pasting);
            TERM.pasting = null;
            i = end + 6;
            continue;
        }
        var c = b[i];
        if (c == "\x1b") {
            if (i + 1 >= b.length) { TERM.key({ name: "escape" }); i++; continue; }
            if (b[i + 1] == "[" || b[i + 1] == "O") {
                var m = /^\x1b[\[O]([<?>]?)([0-9;:]*)([A-Za-z~])/.exec(b.substr(i));
                if (!m) {
                    if (b.length - i < 32) break;      // wait for the rest
                    i++; continue;
                }
                TERM.csi(m[1], m[2], m[3]);
                i += m[0].length;
                continue;
            }
            // Alt+key: ignored, except a lone Esc
            TERM.key({ name: "escape" });
            i++;
            continue;
        }
        var code = c.charCodeAt(0);
        if (code == 13 || code == 10) TERM.key({ name: "enter" });
        else if (code == 9) TERM.key({ name: "tab" });
        else if (code == 127 || code == 8) TERM.key({ name: "backspace" });
        else if (code == 3) TERM.key({ name: "ctrl-c" });
        else if (code == 17) TERM.key({ name: "ctrl-q" });
        else if (code == 32) TERM.key({ name: "space", text: " " });
        else if (code >= 32) TERM.key({ name: c.toLowerCase(), text: c });
        i++;
    }
    TERM.inbuf = b.substr(i);
};

TERM.paste = function (text) {
    var f = AV.focus;
    if (f && (f.tag == "input" || f.tag == "textarea")) {
        f.value += f.tag == "input" ? text.replace(/[\r\n]+/g, " ") : text.replace(/\r\n?/g, "\n");
        AV.dirty = true;
    }
};

TERM.KITTY_KEYS = { 13: "enter", 9: "tab", 127: "backspace", 27: "escape", 32: "space" };
TERM.CSI_NAMES = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end" };
TERM.TILDE = { 1: "home", 2: "insert", 3: "delete", 4: "end", 5: "pageup", 6: "pagedown", 7: "home", 8: "end" };

TERM.csi = function (prefix, params, fin) {
    var parts = params.split(";");
    if (prefix == "<" && (fin == "M" || fin == "m")) {
        var b = +parts[0], x = +parts[1] - 1, y = +parts[2] - 1;
        if (b & 64) { TERM.wheel(b & 1 ? 1 : -1, !!(b & 4)); return; }
        if (b & 32) { TERM.mouseMove(x, y); return; }
        TERM.mouseMove(x, y);
        if (fin == "m" && (b & 3) == 0) TERM.click(x, y);
        return;
    }
    if (prefix == "?" && fin == "u") { MAIN.kittyReply(); return; }
    if (prefix == "?" || prefix == ">") return;
    if (params == "200" && fin == "~") { TERM.pasting = ""; return; }
    // modifiers and event type: "1;5:3" (kitty), "1;2" (xterm)
    var mod = parts[1] ? parts[1].split(":") : ["1"];
    var mods = (+mod[0] || 1) - 1;
    var release = mod[1] == "3";
    var shift = !!(mods & 1), ctrl = !!(mods & 4);
    if (fin == "u") {
        var cp = +parts[0].split(":")[0];
        var name = TERM.KITTY_KEYS[cp];
        if (ctrl && (cp == 99 || cp == 113)) { if (!release) MAIN.quit(); return; }
        var text = cp >= 32 && cp < 0x110000 && !name ? String.fromCodePoint(cp) : (cp == 32 ? " " : undefined);
        if (shift && text) text = text.toUpperCase();
        TERM.key({ name: name || (text ? text.toLowerCase() : "key" + cp), text: text, release: release, shift: shift });
        return;
    }
    if (TERM.CSI_NAMES[fin]) { TERM.key({ name: TERM.CSI_NAMES[fin], release: release, shift: shift }); return; }
    if (fin == "~" && TERM.TILDE[parts[0]]) { TERM.key({ name: TERM.TILDE[parts[0]], release: release, shift: shift }); return; }
};
