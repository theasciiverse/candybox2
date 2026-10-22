// The start of the one module the terminal game is built as: QuickJS's
// system modules, its timers under the browser's names, and a console that
// never writes over the screen (to stderr only when that is not the terminal).
import * as std from "qjs:std";
import * as os from "qjs:os";

var setTimeout = os.setTimeout, setInterval = os.setInterval;
var clearTimeout = os.clearTimeout, clearInterval = os.clearInterval;

var console = (function () {
    var log = os.isatty(2) ? function () {} : function () {
        std.err.puts(Array.prototype.join.call(arguments, " ") + "\n");
    };
    return { log: log, info: log, warn: log, error: log, debug: log };
})();
