# Changes from upstream

This is the Asciiverse terminal edition of Candy Box 2, by aniwey (2013),
maintained at github.com/candybox2/candybox2.github.io (the `upstream`
remote; this branch, `asciiverse`, starts from its master at `35301d4`,
2026-06-04, game version 1.2.3, with the full history).

**The game's own code is unchanged.** Everything new is beside it, so
upstream changes merge as they are:

- `tty/`: the terminal edition, in JavaScript like the compiled game.
- `asciiverse/`: the build (`Makefile`), packaging, QuickJS-ng and the
  GPL text.

## How it works

The browser game draws every place as a `RenderArea`: rows of characters
plus HTML tags inserted at columns, which jQuery puts into two `<pre>`
elements; buttons, lists and inputs are bound by jQuery selectors after
each draw. The game's CSS makes every inserted element either a style
range (an opening tag at one column, its closing tag at another) or an
element placed absolutely over the text (real buttons, comments, inputs,
lists, checkboxes, textareas, tooltips), so the characters never move.
That makes a cell-exact terminal version possible:

- `tty/browser.js`: jQuery's `$` as far as the game uses it (about 25
  methods; class, id and comma-separated selectors), an element tree built
  from each `RenderArea`, `localStorage` in a file, `window` and timers.
- `tty/terminal.js`: draws the status bar and the place on the browser's
  white page as truecolor cells (the game's own "Invert colors?" option
  gives the black page), only the cells that changed each frame; real
  buttons, comments, text inputs, dropdown lists, checkboxes, textareas
  and tooltips; the mouse (click, hover for tooltips and comments, wheel),
  Tab and Enter between buttons, Page Up/Down and Shift+arrows to scroll;
  quests bigger than the screen follow the player; the world map opens at
  the village and the arrows move it.
- Keys: with the kitty keyboard protocol (kitty, Ghostty, foot, WezTerm)
  the game gets real key releases, which The Hole, The Sea and the
  computer's game need for held keys; elsewhere a key is released after
  its key repeat stops.
- `tty/main.js`: the save file (`$XDG_DATA_HOME/candybox2/localStorage.json`,
  `~/.local/share/candybox2`, `%APPDATA%` on Windows), the terminal set up
  and put back, Ctrl+C or Ctrl+Q to quit. `--slot N` starts with a save
  slot, as the browser's `?slot=N` does; the Save page's slot links load
  in the running game through the game's own text save format.
- `asciiverse/Makefile`: upstream's own build (`genAscii.py`, `genText.py`,
  TypeScript 1.7.5 as in `.github/workflows/deploy.yml`), joined with
  `tty/` into one ES module and compiled by QuickJS-ng's `qjsc` into a C
  program: one native binary of about 5 MB that needs nothing to run.

As in a browser, an error in one of the game's callbacks is logged (to
stderr when it is not the terminal) and the game goes on.

## Imported

- `asciiverse/quickjs/`: QuickJS-ng 0.17.0, the engine, its standard
  library and `qjsc`, from the `v0.17.0` tag (archive sha256
  `559bc4c420475e55c7ab4510adbc562f55d7524d75e8e89d79ce4bb02f5687d9`),
  MIT. One change, in `quickjs-libc.c`: a signal interrupting `poll()`
  (EINTR) no longer ends the event loop. It did, before the signal's
  handler could run, so Ctrl+C quit without saving or restoring the
  terminal and resizing the terminal (SIGWINCH) quit the game.
- `asciiverse/COPYING`: the GPL version 3 text (gnu.org), which the
  repository names but does not include.

## Licences

The game's code is GPL-3.0-or-later (`candybox2_sourceCodeLicense.txt`,
shipped as `LICENSE`, with the full text as `COPYING`). The ASCII art is
CC BY-SA 3.0, credited by the `@author` line of each file in `ascii/`;
`ART-LICENSE.txt` in each archive lists them (from `ascii_art.html`: art
without an author "isn't original enough to be copyrighted"). The
translations are part of the game's text. QuickJS-ng ships its licence as
`QUICKJS-LICENSE`.
