// The browser Candy Box 2 expects, made for a terminal: jQuery's $, a small
// element tree built from what the game renders, localStorage in a file,
// timers and window. The game's own code runs unchanged on top of this;
// terminal.js draws the element tree and turns keys and the mouse into the
// events the game listens for.
//
// The game draws each place as a RenderArea: rows of characters plus HTML
// tags inserted at columns. Every tag is either a style range (an opening
// tag at one column, its closing tag at another) or an element that the
// game's CSS places absolutely over the text (real buttons, comments,
// inputs, lists, checkboxes, textareas, tooltips), so the characters never
// move. That is what makes a cell-exact terminal version possible.

var AV = {
    locations: {},      // "#statusBar", "#mainContent": the last render of each
    focus: null,        // the element with keyboard focus (a text input, say)
    keydown: [],        // $(document).keydown handlers
    keyup: [],
    ready: [],
    dirty: true,        // something changed since the last frame
    invert: false,      // the game's inverted colours option
    game: null,         // set by main.js through Keyboard.setGame
    scrollTop: 0,       // $("html").scrollTop(), in browser pixels
    ROW_PX: 18,         // a row of the browser's monospace text, in pixels
    log: function () {}
};

// ---------------------------------------------------------------------------
// Elements

function AVElement(tag, attrs, loc, y, x) {
    this.tag = tag;
    this.attrs = attrs;
    this.id = attrs.id || null;
    this.classes = attrs["class"] ? attrs["class"].split(/\s+/).filter(function (c) { return c != ""; }) : [];
    this.style = AV.parseStyle(attrs.style || "");
    this.loc = loc;
    this.y = y;             // row in the location's area
    this.x1 = x;            // first column
    this.x2 = null;         // column after the last, for style ranges
    this.parent = null;
    this.children = [];
    this.content = [];      // characters inside an overlay element, {ch, b, u, i}
    this.handlers = {};
    this.value = "";        // text inputs and textareas
    this.checked = attrs.checked !== undefined;
    this.selected = false;  // options
    this.disabled = false;
    this.shown = null;      // null: as the CSS says; true or false: .show(), .hide()
    this.css = {};          // set through .css()
    this.mouseX = 0;        // tooltip position, set on mousemove
    this.mouseY = 0;
}

AVElement.prototype.hasClass = function (c) { return this.classes.indexOf(c) != -1; };

// The game's CSS (css/design.css), as far as it matters for drawing
AV.CLASS_CSS = {
    aroundComment: { display: "none" },
    comment: { position: "absolute" },
    englishComment: { "font-weight": "bold" },
    translated: { "font-style": "italic" },
    asciiRealButton: { position: "absolute" },
    asciiSelect: { position: "absolute" },
    asciiTextInput: { position: "absolute" },
    aroundCheckbox: { position: "absolute" },
    textarea: { position: "absolute" },
    enigmaWrongMessage: { visibility: "hidden" },
    tooltip: { display: "none", position: "fixed" }
};

AVElement.prototype.cssValue = function (prop) {
    if (this.css[prop] !== undefined)
        return this.css[prop];
    if (this.style[prop] !== undefined)
        return this.style[prop];
    for (var i = this.classes.length - 1; i >= 0; i--) {
        var rule = AV.CLASS_CSS[this.classes[i]];
        if (rule && rule[prop] !== undefined)
            return rule[prop];
    }
    return undefined;
};

AVElement.prototype.isShown = function () {
    for (var e = this; e; e = e.parent) {
        if (e.shown === false)
            return false;
        if (e.shown !== true && e.cssValue("display") == "none")
            return false;
    }
    return true;
};

AVElement.prototype.isVisible = function () {
    if (!this.isShown())
        return false;
    for (var e = this; e; e = e.parent) {
        var v = e.cssValue("visibility");
        if (v == "hidden")
            return false;
        if (v == "visible")
            return true;
    }
    return true;
};

AVElement.prototype.isOverlay = function () {
    var p = this.cssValue("position");
    return p == "absolute" || p == "fixed" || this.tag == "input" || this.tag == "select" || this.tag == "textarea";
};

AVElement.prototype.fire = function (type, event) {
    // jQuery semantics: handlers on the element, then on its parents, until
    // one returns false
    for (var e = this; e; e = e.parent) {
        var list = e.handlers[type];
        if (!list)
            continue;
        var stop = false;
        for (var i = 0; i < list.length; i++) {
            if (list[i].call(e, event || AV.event()) === false)
                stop = true;
        }
        AV.dirty = true;
        if (stop)
            return true;
    }
    return false;
};

AVElement.prototype.hasHandler = function (type) {
    for (var e = this; e; e = e.parent)
        if (e.handlers[type] && e.handlers[type].length)
            return true;
    return false;
};

// the options of a select
AVElement.prototype.options = function () {
    return this.children.filter(function (c) { return c.tag == "option"; });
};

AVElement.prototype.selectedOption = function () {
    var opts = this.options();
    for (var i = 0; i < opts.length; i++)
        if (opts[i].selected)
            return opts[i];
    return opts.length ? opts[0] : null;
};

AVElement.prototype.text = function () {
    return this.content.map(function (c) { return c.ch; }).join("");
};

AV.event = function (extra) {
    var e = { which: 0, pageX: 0, pageY: 0, preventDefault: function () {}, stopPropagation: function () {} };
    for (var k in extra)
        e[k] = extra[k];
    return e;
};

AV.parseStyle = function (s) {
    var out = {};
    s.split(";").forEach(function (part) {
        var i = part.indexOf(":");
        if (i > 0)
            out[part.substr(0, i).trim().toLowerCase()] = part.substr(i + 1).trim();
    });
    return out;
};

// ---------------------------------------------------------------------------
// Parsing a render

AV.ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

AV.decodeEntities = function (s) {
    return s.replace(/&(#?\w+);/g, function (m, name) {
        if (name[0] == "#")
            return String.fromCharCode(name[1] == "x" ? parseInt(name.substr(2), 16) : parseInt(name.substr(1), 10));
        return AV.ENTITIES[name] !== undefined ? AV.ENTITIES[name] : m;
    });
};

// a tag fragment: "<span class=\"x\">", "</span>", or a whole element with
// text inside; returns tokens {open: tag, attrs}, {close: tag}, {text}
AV.tokenize = function (s) {
    var out = [], i = 0, re = /<(\/?)([a-zA-Z]+)([^>]*)>/g, m;
    while ((m = re.exec(s)) !== null) {
        if (m.index > i)
            out.push({ text: AV.decodeEntities(s.substring(i, m.index)) });
        if (m[1])
            out.push({ close: m[2].toLowerCase() });
        else {
            var attrs = {}, are = /([a-zA-Z-]+)(?:\s*=\s*"([^"]*)")?/g, a;
            while ((a = are.exec(m[3])) !== null)
                attrs[a[1].toLowerCase()] = a[2] === undefined ? "" : AV.decodeEntities(a[2]);
            out.push({ open: m[2].toLowerCase(), attrs: attrs });
        }
        i = re.lastIndex;
    }
    if (i < s.length)
        out.push({ text: AV.decodeEntities(s.substring(i)) });
    return out;
};

AV.VOID = { input: true, br: true, link: true };

// Build the element tree of one RenderArea for location `loc`
AV.parseArea = function (loc, renderArea) {
    var area = renderArea.area.slice(0);
    var tags = renderArea.getTags();
    var elements = [];
    var height = renderArea.getHeight();
    for (var y = 0; y < height; y++) {
        var row = tags[y] || [];
        var stack = [];
        // the game keeps each row's tags sorted by descending column
        for (var t = row.length - 1; t >= 0; t--) {
            // string positions truncate, as substr() does in the browser
            // (some are computed as x + length / 2)
            var x = Math.floor(row[t].getX());
            var tokens = AV.tokenize(row[t].getString());
            for (var k = 0; k < tokens.length; k++) {
                var tok = tokens[k];
                var top = stack.length ? stack[stack.length - 1] : null;
                if (tok.open == "br") {
                    // a line break inside an overlay (tooltips: a title, then the text)
                    if (top) top.content.push({ ch: "\n", b: false, u: false, i: false });
                    continue;
                }
                if (tok.open) {
                    var el = new AVElement(tok.open, tok.attrs, loc, y, x);
                    if (top) {
                        el.parent = top;
                        top.children.push(el);
                    }
                    elements.push(el);
                    if (!AV.VOID[tok.open])
                        stack.push(el);
                }
                else if (tok.close) {
                    // close the innermost open element of that tag
                    for (var s = stack.length - 1; s >= 0; s--) {
                        if (stack[s].tag == tok.close) {
                            var closed = stack.splice(s)[0];
                            if (closed.x2 === null)
                                closed.x2 = x;
                            break;
                        }
                    }
                }
                else if (tok.text && top) {
                    // text inside an element of a tag fragment (a real
                    // button's label, a comment, an option, a textarea)
                    var b = false, u = false, it = false;
                    for (var p = top; p; p = p.parent) {
                        if (p.tag == "b" || p.cssValue("font-weight") == "bold") b = true;
                        if (p.tag == "u") u = true;
                        if (p.tag == "i" || p.cssValue("font-style") == "italic") it = true;
                    }
                    var target = top;
                    while (target.parent && (target.tag == "u" || target.tag == "b" || target.tag == "i"))
                        target = target.parent;
                    for (var c = 0; c < tok.text.length; c++)
                        target.content.push({ ch: tok.text[c], b: b, u: u, i: it });
                    if (target.tag == "textarea")
                        target.value += tok.text;
                }
            }
        }
        // anything left open runs to the end of the row
        for (var r = 0; r < stack.length; r++)
            if (stack[r].x2 === null)
                stack[r].x2 = renderArea.getWidth();
    }
    elements.forEach(function (e) {
        if (e.tag == "select") {
            var opts = e.options();
            if (opts.length && !opts.some(function (o) { return o.selected; }))
                opts[0].selected = true;
        }
    });
    return { area: area, elements: elements, width: renderArea.getWidth(), height: height };
};

// ---------------------------------------------------------------------------
// jQuery, as far as the game uses it

function AVQuery(els) {
    this.els = els;
    this.length = els.length;
    for (var i = 0; i < els.length; i++)
        this[i] = els[i];
}

AV.allElements = function () {
    var out = [];
    for (var k in AV.locations)
        if (AV.locations[k])
            out = out.concat(AV.locations[k].elements);
    return out;
};

AV.select = function (sel) {
    sel = sel.trim();
    // "a, b": the elements matching either, in document order
    if (sel.indexOf(",") != -1) {
        var hits = [];
        sel.split(",").forEach(function (part) {
            AV.select(part).forEach(function (e) { if (hits.indexOf(e) == -1) hits.push(e); });
        });
        var all = AV.allElements();
        return hits.sort(function (a, b) { return all.indexOf(a) - all.indexOf(b); });
    }
    if (sel == ":focus")
        return AV.focus ? [AV.focus] : [];
    if (sel[0] == ".") {
        var cls = sel.substr(1);
        return AV.allElements().filter(function (e) { return e.hasClass(cls); });
    }
    if (sel[0] == "#") {
        var id = sel.substr(1);
        return AV.allElements().filter(function (e) { return e.id == id; });
    }
    return [];
};

function $(arg) {
    if (typeof arg == "function") {
        AV.ready.push(arg);
        return new AVQuery([]);
    }
    if (arg === document || arg === window)
        return new AVQuery([arg]);
    if (arg instanceof AVElement)
        return new AVQuery([arg]);
    if (typeof arg == "string")
        return new AVQuery(AV.select(arg));
    return new AVQuery([]);
}

AVQuery.prototype.each = function (fn) {
    for (var i = 0; i < this.els.length; i++)
        fn.call(this.els[i], i, this.els[i]);
    return this;
};

AVQuery.prototype.on = function (type, fn) {
    if (this.els[0] === document && (type == "keydown" || type == "keyup")) {
        AV[type].push(fn);
        return this;
    }
    return this.each(function () {
        if (this instanceof AVElement)
            (this.handlers[type] = this.handlers[type] || []).push(fn);
    });
};

["mouseup", "mouseenter", "mouseleave", "mouseout", "change"].forEach(function (type) {
    AVQuery.prototype[type] = function (fn) { return this.on(type, fn); };
});
AVQuery.prototype.keydown = function (fn) { return this.on("keydown", fn); };
AVQuery.prototype.keyup = function (fn) { return this.on("keyup", fn); };
AVQuery.prototype.hover = function (fnIn, fnOut) {
    this.on("mouseenter", fnIn);
    if (fnOut)
        this.on("mouseleave", fnOut);
    return this;
};
AVQuery.prototype.ready = function (fn) { AV.ready.push(fn); return this; };

AVQuery.prototype.html = function () { return this; };   // terminal.js takes renders from RenderLocation
AVQuery.prototype.append = function () { return this; };
AVQuery.prototype.remove = function () { return this; };

AVQuery.prototype.css = function (a, b) {
    var props = typeof a == "string" ? (function () { var o = {}; o[a] = b; return o; })() : a;
    if (typeof a == "string" && b === undefined)
        return this.els[0] instanceof AVElement ? this.els[0].cssValue(a) : undefined;
    this.each(function () {
        if (!(this instanceof AVElement))
            return;
        for (var k in props)
            this.css[k] = props[k];
    });
    AV.dirty = true;
    return this;
};

AVQuery.prototype.show = function () { this.each(function () { if (this instanceof AVElement) this.shown = true; }); AV.dirty = true; return this; };
AVQuery.prototype.hide = function () { this.each(function () { if (this instanceof AVElement) this.shown = false; }); AV.dirty = true; return this; };

AVQuery.prototype.prop = function (name, value) {
    if (value === undefined) {
        var e = this.els[0];
        return e ? e[name] : undefined;
    }
    this.each(function () {
        if (!(this instanceof AVElement))
            return;
        if (name == "selected" && value && this.tag == "option" && this.parent) {
            this.parent.options().forEach(function (o) { o.selected = false; });
        }
        this[name] = value;
    });
    AV.dirty = true;
    return this;
};

AVQuery.prototype.attr = function (name) {
    var e = this.els[0];
    if (!(e instanceof AVElement))
        return undefined;
    return name == "id" ? (e.id === null ? undefined : e.id) : e.attrs[name];
};

AVQuery.prototype.find = function (sel) {
    var out = [];
    this.each(function () {
        if (!(this instanceof AVElement))
            return;
        if (sel == ":selected" && this.tag == "select") {
            var o = this.selectedOption();
            if (o)
                out.push(o);
        }
    });
    return new AVQuery(out);
};

AVQuery.prototype.val = function (v) {
    var e = this.els[0];
    if (v === undefined) {
        if (!(e instanceof AVElement))
            return undefined;
        if (e.tag == "select") {
            var o = e.selectedOption();
            return o ? o.text() : "";
        }
        return e.value;
    }
    this.each(function () { if (this instanceof AVElement) this.value = String(v); });
    AV.dirty = true;
    return this;
};

AVQuery.prototype.is = function (what) {
    var e = this.els[0];
    if (!(e instanceof AVElement))
        return false;
    if (what == ":checked")
        return e.checked;
    if (what == ":focus")
        return AV.focus === e;
    return false;
};

AVQuery.prototype.hasClass = function (c) {
    return this.els.some(function (e) { return e instanceof AVElement && e.hasClass(c); });
};

AVQuery.prototype.focus = function () {
    var e = this.els[0];
    if (e instanceof AVElement)
        AV.setFocus(e);
    return this;
};

// Moving the focus, as a browser does: a text input or textarea whose value
// changed since it got the focus fires "change" as it loses it (the
// cauldron reads its inputs only then, just before its button's click).
// An element from an earlier render is gone and fires nothing.
AV.setFocus = function (e) {
    var old = AV.focus;
    if (old && old !== e && (old.tag == "input" || old.tag == "textarea") && old.value !== AV.focusValue &&
        AV.allElements().indexOf(old) != -1) {
        AV.focusValue = old.value;
        old.fire("change");
    }
    AV.focus = e || null;
    AV.focusValue = e ? e.value : null;
    AV.dirty = true;
};

// sizes: the game uses them only to centre the content, which terminal.js does
AVQuery.prototype.width = function () { return 1000; };
AVQuery.prototype.outerWidth = function () { return 1000; };
AVQuery.prototype.scrollLeft = function () { return 0; };
AVQuery.prototype.scrollTop = function (v) {
    if (v === undefined)
        return AV.scrollTop;
    AV.scrollTop = v;
    return this;
};

// ---------------------------------------------------------------------------
// window, document, localStorage

var document = { location: { search: "" } };
var window = {
    location: { search: "" },
    setInterval: function (f, ms) { return setInterval(f, ms); },
    setTimeout: function (f, ms) { return setTimeout(f, ms); },
    clearInterval: function (id) { clearInterval(id); },
    clearTimeout: function (id) { clearTimeout(id); }
};

// localStorage lives in one JSON file, written a second after the last change
// and when the game quits (main.js sets AV.storagePath and the file access)
var localStorage = {
    data: {},
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; },
    setItem: function (k, v) {
        this.data[k] = String(v);
        AV.storageChanged();
    },
    removeItem: function (k) { delete this.data[k]; AV.storageChanged(); },
    clear: function () { this.data = {}; AV.storageChanged(); }
};
window.localStorage = localStorage;

// LocalSaving.save() compares a failure with this
var DOMException = { QUOTA_EXCEEDED_ERR: 22 };
