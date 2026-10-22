#!/bin/sh
# Packs dist/candybox2-<target>.tar.gz (.zip for Windows) for av: the
# program at the top, with the GPL (the game's code), the art's licence and
# credits (CC BY-SA 3.0, the @author line of each file in ascii/), QuickJS's
# licence and PATCHES.md.
#
#   asciiverse/package.sh x86_64-unknown-linux-musl
set -eu
cd "$(dirname "$0")/.."
target="$1"
case "$target" in *windows*) exe=.exe ;; *) exe= ;; esac
stage=stage/candybox2
rm -rf "$stage" && mkdir -p "$stage" dist
cp "out/candybox2$exe" PATCHES.md "$stage/"
cp asciiverse/COPYING "$stage/COPYING"
cp candybox2_sourceCodeLicense.txt "$stage/LICENSE"
cp asciiverse/quickjs/LICENSE "$stage/QUICKJS-LICENSE"
{
  echo "Candy Box 2's ASCII art is published under the Creative Commons"
  echo "Attribution-ShareAlike 3.0 Unported licence"
  echo "(https://creativecommons.org/licenses/by-sa/3.0/), credited to the"
  echo "author named at the top of each file. Files without an author are, in"
  echo "aniwey's words, not original enough to be copyrighted."
  echo
  echo "By author:"
  grep -rh "^@author" ascii | sed 's/^@author //; s/ *$//' | sort | uniq -c | sort -rn | sed 's/^ *[0-9]* /  /'
  echo
  echo "Each file:"
  find ascii -type f | sort | while read -r f; do
    a=$(head -1 "$f" | sed -n 's/^@author //p' | sed 's/ *$//')
    [ -n "$a" ] && echo "  ${f#ascii/}: $a"
  done
} > "$stage/ART-LICENSE.txt"
if [ -n "$exe" ]; then
  (cd "$stage" && zip -qr "../../dist/candybox2-$target.zip" .)
else
  tar -czf "dist/candybox2-$target.tar.gz" -C "$stage" .
fi
ls -l dist
