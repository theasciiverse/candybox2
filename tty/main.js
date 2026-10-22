// Starting Candy Box 2 in the terminal: the game's renders go to AV and
// terminal.js, localStorage to a file in the player's data folder, and the
// terminal is set up and put back on the way in and out.

var MAIN = {};

MAIN.dataDir = function () {
    var xdg = std.getenv("XDG_DATA_HOME"), home = std.getenv("HOME"), app = std.getenv("APPDATA");
    var base = xdg && xdg[0] == "/" ? xdg : home ? home + "/.local/share" : app ? app : ".";
    var dir = base + "/candybox2";
    // make each missing folder of the path
    var parts = dir.split("/"), p = "";
    for (var i = 0; i < parts.length; i++) {
        p += (i ? "/" : "") + parts[i];
        if (p.length) os.mkdir(p, 0o755);
    }
    return dir;
};

MAIN.storagePath = null;
MAIN.saveTimer = null;

MAIN.loadStorage = function () {
    MAIN.storagePath = MAIN.dataDir() + "/localStorage.json";
    var text = std.loadFile(MAIN.storagePath);
    if (text) {
        try { localStorage.data = JSON.parse(text); } catch (e) { localStorage.data = {}; }
    }
};

MAIN.writeStorage = function () {
    if (!MAIN.storagePath) return;
    var tmp = MAIN.storagePath + ".tmp";
    var f = std.open(tmp, "w");
    if (!f) return;
    f.puts(JSON.stringify(localStorage.data));
    f.close();
    // Windows' rename() does not replace an existing file
    if (os.rename(tmp, MAIN.storagePath) < 0) {
        os.remove(MAIN.storagePath);
        os.rename(tmp, MAIN.storagePath);
    }
};

AV.storageChanged = function () {
    if (MAIN.saveTimer) return;
    MAIN.saveTimer = setTimeout(function () { MAIN.saveTimer = null; MAIN.writeStorage(); }, 1000);
};

// ---------------------------------------------------------------------------
// The game's hooks

MAIN.hookGame = function () {
    RenderLocation.prototype.render = function (renderArea) {
        AV.locations[this.locationString] = AV.parseArea(this.locationString, renderArea);
        renderArea.runLinks();
        TERM.refocus();
        AV.dirty = true;
    };
    RenderLocation.prototype.setContentGap = function () {};
    var setGame = Keyboard.setGame;
    Keyboard.setGame = function (game) {
        AV.game = game;
        setGame(game);
    };
    var applyInverted = Game.prototype.applyInvertedColorsToCss;
    Game.prototype.applyInvertedColorsToCss = function () {
        AV.invert = Saving.loadBool("gameInvertedColors");
        AV.dirty = true;
    };
};

// ---------------------------------------------------------------------------
// The terminal

MAIN.ON = "\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?1003h\x1b[?1006h\x1b[?2004h\x1b[2J";
MAIN.OFF = "\x1b[0m\x1b[?2004l\x1b[?1006l\x1b[?1003l\x1b[?7h\x1b[?25h\x1b[?1049l";
MAIN.started = false;

MAIN.size = function () {
    var s = os.ttyGetWinSize(1);
    if (s && s[0] > 0 && s[1] > 0) {
        if (s[0] != TERM.w || s[1] != TERM.h) {
            TERM.w = s[0]; TERM.h = s[1];
            TERM.prev = null;
            TERM.write("\x1b[0m\x1b[2J");
            AV.dirty = true;
        }
    }
};

// the kitty keyboard protocol: asked for at start; a terminal that knows it
// answers, and then we get key releases (needed for The Hole, The Sea and
// the computer's galactic wars, which use held keys)
MAIN.kittyReply = function () {
    if (TERM.kitty) return;
    TERM.kitty = true;
    TERM.write("\x1b[>11u");    // disambiguate, event types, all keys as codes
};

MAIN.utf8 = function (bytes, n) {
    var s = "", i = 0;
    while (i < n) {
        var c = bytes[i];
        if (c < 0x80) { s += String.fromCharCode(c); i++; continue; }
        var len = c >= 0xf0 ? 4 : c >= 0xe0 ? 3 : c >= 0xc0 ? 2 : 1;
        if (len == 1 || i + len > n) { i++; continue; }
        var cp = c & (0xff >> (len + 1));
        for (var k = 1; k < len; k++) cp = (cp << 6) | (bytes[i + k] & 0x3f);
        s += String.fromCodePoint(cp);
        i += len;
    }
    return s;
};

MAIN.start = function () {
    MAIN.started = true;
    os.ttySetRaw(0);
    TERM.write(MAIN.ON + "\x1b[?u");
    MAIN.size();
    var buf = new ArrayBuffer(4096), bytes = new Uint8Array(buf);
    os.setReadHandler(0, AV_guard(function () {
        var n = os.read(0, buf, 0, buf.byteLength);
        if (n <= 0) { MAIN.quit(); return; }
        TERM.feed(MAIN.utf8(bytes, n));
    }));
    // SIGWINCH (28 on Linux and macOS); the size is also checked every half second
    try { os.signal(28, function () { MAIN.size(); }); } catch (e) {}
    // QuickJS's raw mode keeps ISIG, so Ctrl+C comes as SIGINT: quit properly
    // (storage written, terminal restored) on it, SIGTERM and SIGHUP
    try { [2, 15, 1].forEach(function (sig) { os.signal(sig, function () { setTimeout(MAIN.quit, 0); }); }); } catch (e) {}
    setInterval(MAIN.size, 500);
    setInterval(function () {
        if (TERM.pendingHover) { TERM.pendingHover = false; TERM.mouseMove(TERM.mouseX, TERM.mouseY); }
        if (AV.dirty) { AV.dirty = false; TERM.draw(); }
    }, 33);
};

MAIN.restore = function () {
    if (!MAIN.started) return;
    MAIN.started = false;
    TERM.write((TERM.kitty ? "\x1b[<u" : "") + MAIN.OFF);
};

MAIN.quit = function () {
    MAIN.writeStorage();
    MAIN.restore();
    std.exit(0);
};

// The browser loads a save slot by opening "?slot=N", a new page. Here the
// slot's values are turned into the game's own text save format and loaded
// the way its "load from text" button does (Main.reloadEverythingFromFile),
// so it works in the running game on every system
MAIN.restartWithSlot = function (slot) {
    var id = "slot" + slot;
    if (localStorage.getItem(id) === null) return;
    var parts = [];
    var add = function (type, all) {
        for (var name in all) {
            var v = localStorage.getItem(id + "." + name);
            if (v !== null) parts.push(type + " " + name + "=" + v);
        }
    };
    add("bool", Saving.getAllBools());
    add("number", Saving.getAllNumbers());
    add("string", Saving.getAllStrings());
    TERM.lastPlace = null;
    Main.reloadEverythingFromFile(parts.join(", "));
    AV.dirty = true;
};

// ---------------------------------------------------------------------------

MAIN.args = function () {
    var args = scriptArgs.slice(1);
    for (var i = 0; i < args.length; i++) {
        if (args[i] == "--slot" && args[i + 1]) window.location.search = document.location.search = "?slot=" + args[++i];
        else if (args[i] == "--gamemode" && args[i + 1]) window.location.search = document.location.search = "?gamemode=" + args[++i];
        else if (args[i] == "--version") { std.out.puts("candybox2 " + MAIN.VERSION + "\n"); std.exit(0); }
        else if (args[i] == "--help" || args[i] == "-h") {
            std.out.puts("candybox2 [--slot N] [--gamemode MODE]\n\n" +
                "Candy Box 2 by aniwey, in the terminal. Saves go to $XDG_DATA_HOME/candybox2.\n" +
                "Ctrl+C or Ctrl+Q quits (save in the game first). Tab moves between buttons,\n" +
                "Enter presses one; Page Up/Down and the mouse wheel scroll.\n");
            std.exit(0);
        }
    }
};

MAIN.run = function () {
    MAIN.args();
    if (!os.isatty(1)) {
        std.err.puts("candybox2 needs a terminal\n");
        std.exit(1);
    }
    MAIN.loadStorage();
    MAIN.hookGame();
    MAIN.start();
    try {
        AV.ready.forEach(function (f) { f(); });
    } catch (e) {
        MAIN.restore();
        std.err.puts("candybox2: " + e + "\n" + (e.stack || "") + "\n");
        std.exit(1);
    }
};
