# Candy Box 2 in the terminal, as one native program: the game's TypeScript
# compiled by upstream's own TypeScript 1.7.5, joined with tty/ (browser.js,
# terminal.js, main.js) into one module, and that compiled to bytecode by
# QuickJS-ng's qjsc into a C program. Run from the repo root:
#
#   make -f asciiverse/Makefile          # out/candybox2
#
# Needs python3 and node (npx fetches TypeScript 1.7.5) to build, nothing
# to run. CC, CFLAGS, LDFLAGS, HOSTCC and VERSION can be set from outside.

CC ?= cc
HOSTCC ?= cc
CFLAGS ?= -O2
LDFLAGS ?=
VERSION ?= dev

Q := asciiverse/quickjs
QSRC := $(Q)/quickjs.c $(Q)/libregexp.c $(Q)/libunicode.c $(Q)/dtoa.c $(Q)/quickjs-libc.c
QDEFS := -D_GNU_SOURCE -DCONFIG_VERSION=\"0.17.0\"
B := build

all: out/candybox2

$(B)/code/gen/genAscii.ts $(B)/code/gen/genText.ts: $(wildcard ascii/*/* ascii/*/*/* text/*.txt)
	mkdir -p code/gen $(B)/code/gen
	cd pythonScripts && PYTHONUTF8=1 python3 genAscii.py && PYTHONUTF8=1 python3 genText.py
	cp code/gen/genAscii.ts code/gen/genText.ts $(B)/code/gen/

# upstream's own command (.github/workflows/deploy.yml)
$(B)/candybox2_compiled.js: $(B)/code/gen/genAscii.ts $(wildcard code/main/*.ts code/arena/*/*.ts libs/*.ts)
	npx --yes --package typescript@1.7.5 -- tsc ./libs/*.ts ./code/main/*.ts ./code/gen/*.ts ./code/arena/*/*.ts --out $@ --target ES5

$(B)/candybox2.mjs: $(B)/candybox2_compiled.js tty/prelude.js tty/browser.js tty/terminal.js tty/main.js
	( cat tty/prelude.js tty/browser.js tty/terminal.js tty/main.js; \
	  echo 'MAIN.VERSION = "$(VERSION)";'; \
	  cat candybox2_sourceCodeLicense.txt $(B)/candybox2_compiled.js; \
	  echo 'MAIN.run();' ) > $@

$(B)/qjsc: $(Q)/qjsc.c $(QSRC)
	$(HOSTCC) -O2 $(QDEFS) -o $@ $(Q)/qjsc.c $(QSRC) -lm -lpthread

$(B)/candybox2.c: $(B)/candybox2.mjs $(B)/qjsc
	$(B)/qjsc -e -m -N candybox2 -o $@ $(B)/candybox2.mjs

out/candybox2: $(B)/candybox2.c $(QSRC)
	mkdir -p out
	$(CC) $(CFLAGS) $(QDEFS) -I$(Q) $(LDFLAGS) -o $@ $(B)/candybox2.c $(QSRC) -lm -lpthread

clean:
	rm -rf $(B) out code/gen

.PHONY: all clean
