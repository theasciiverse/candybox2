// The start of the one module the terminal game is built as: QuickJS's
// system modules, its timers under the browser's names, and a console that
// never writes over the screen (to stderr only when that is not the terminal).
import * as std from "qjs:std";
import * as os from "qjs:os";

// as in a browser, an error in a callback is logged and the game goes on
function AV_guard(f) {
    return function () {
        try { return f.apply(this, arguments); }
        catch (e) { console.log("candybox2: " + e + "\n" + (e && e.stack || "")); }
    };
}
var setTimeout = function (f, ms) { return os.setTimeout(AV_guard(f), ms || 0); };
var setInterval = function (f, ms) { return os.setInterval(AV_guard(f), ms || 0); };
var clearTimeout = os.clearTimeout, clearInterval = os.clearInterval;

var console = (function () {
    var log = os.isatty(2) ? function () {} : function () {
        std.err.puts(Array.prototype.join.call(arguments, " ") + "\n");
    };
    return { log: log, info: log, warn: log, error: log, debug: log };
})();
