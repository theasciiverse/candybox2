#!/usr/bin/env python3
"""Record the catalog preview, asciiverse/candybox2.cast, at 100x30.

Starts out/candybox2 with asciiverse/preview-save.json (a game well on its
way: every tab unlocked, a million candies) under asciinema in a tmux
session, and tours it by clicking what is on screen: the candy box, the
village, the world map, the shop, the computer booting, a quest in the
arena, the cauldron. Run from the repo root after building; needs tmux and
asciinema 3.

    asciiverse/record-preview.py [out.cast]
"""
import os, shutil, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "asciiverse", "candybox2.cast")
T = "cbrec"


def sh(*a):
    return subprocess.run(a, capture_output=True, text=True).stdout


def screen():
    return sh("tmux", "capture-pane", "-p", "-N", "-t", T).split("\n")


def find(text, nth=0):
    hits = [(line.find(text), y) for y, line in enumerate(screen()) if text in line]
    return hits[nth] if len(hits) > nth else None


def mouse(x, y, release=True, button=0):
    sh("tmux", "send-keys", "-t", T, "-l", f"\x1b[<{button};{x};{y}M")
    if release:
        sh("tmux", "send-keys", "-t", T, "-l", f"\x1b[<{button};{x};{y}m")


def hover(x, y):
    sh("tmux", "send-keys", "-t", T, "-l", f"\x1b[<35;{x};{y}M")


def click(text, nth=0, dx=1, wait=1.5):
    p = find(text, nth)
    if not p:
        print("not on screen:", text, file=sys.stderr)
        return False
    x, y = p[0] + 1 + dx, p[1] + 1
    hover(x, y)
    time.sleep(0.35)        # the hover shows, as with a real mouse
    mouse(x, y)
    time.sleep(wait)
    return True


def wheel(n, down=True, x=50, y=20):
    for _ in range(n):
        sh("tmux", "send-keys", "-t", T, "-l", f"\x1b[<{65 if down else 64};{x};{y}M")
        time.sleep(0.12)


def keys(*k):
    sh("tmux", "send-keys", "-t", T, *k)


def main():
    run = tempfile.mkdtemp()
    try:
        data = os.path.join(run, "home", ".local", "share", "candybox2")
        os.makedirs(data)
        shutil.copy(os.path.join(ROOT, "asciiverse", "preview-save.json"), os.path.join(data, "localStorage.json"))
        shutil.copy(os.path.join(ROOT, "out", "candybox2"), run)
        env = (f"HOME='{run}/home' XDG_DATA_HOME='{run}/home/.local/share' USER=player LOGNAME=player "
               f"TERM=xterm-256color COLORTERM=truecolor LANG=C.UTF-8 PATH='{run}':\"$PATH\"")
        cmd = (f"cd '{run}' && {env} asciinema rec --overwrite --window-size 100x30 --idle-time-limit 2 "
               f"--capture-env TERM,COLORTERM,LANG --title 'Candy Box 2' --command 'candybox2 --slot 1' "
               f"'{run}/take.cast' 2>/dev/null")
        subprocess.run(["tmux", "new-session", "-d", "-s", T, "-x", "100", "-y", "30", cmd])
        time.sleep(3)

        click("Eat all the candies", wait=2)         # the candy box
        click("MAP", wait=2)                          # the village
        wheel(6)
        time.sleep(1)
        click("SHOP", wait=3)                         # the candy merchant
        click("Back to the village", wait=1.5)
        click("Back to the map", wait=2)              # the world map
        for k in ("Left", "Left", "Up", "Up", "Left", "Down", "Down", "Down"):
            keys(k)
            time.sleep(0.35)
        time.sleep(1)
        click("PUTER", wait=1.5)                      # the computer
        click(".|.", wait=3.5)
        keys("Enter")
        time.sleep(1)
        for ch in "help":
            keys("-l", ch)
            time.sleep(0.15)
        keys("Enter")
        time.sleep(3)
        click("ARENA", wait=1.5)                      # a quest
        click("forest", wait=9)
        click("Exit the quest", wait=1.5)
        click("CLDR", wait=2.5)                       # the cauldron
        click("C |", dx=0, wait=0.1)                  # configuration
        p = find("C |")
        if p:
            mouse(p[0] + 1, p[1] + 2)
            time.sleep(2)
        keys("C-q")
        time.sleep(1.5)
        shutil.copy(os.path.join(run, "take.cast"), OUT)
        print(OUT, os.path.getsize(OUT))
    finally:
        subprocess.run(["tmux", "kill-session", "-t", T], capture_output=True)
        shutil.rmtree(run, ignore_errors=True)


if __name__ == "__main__":
    main()
