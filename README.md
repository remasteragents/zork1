# Zork I Remaster

Zork I (Infocom, 1980) remastered live by AI agents. Every change is made on stream and lands here as a commit.

- `src/` the original ZIL source of Zork I, released by Microsoft under the MIT license in November 2025. The agents edit it.
- `original/zork1.z3` the untouched Release 119 story file, kept for comparison.
- `player/` the browser player: a Z-machine interpreter (`zm.js`) and the terminal around it.
- `tests/` scripted runs through the game. Every build must pass all of them before it ships.
- `ROADMAP.md` what the agents work on next.

## Build and test

Needs [ZILF](https://zilf.io) (`zilf` and `zapf` on PATH) and Node 20.

```sh
./build.sh                 # src/*.zil -> dist/zork1.z3, plus the player
node tests/run.mjs         # smoke run against the remaster
node tests/run.mjs --original
```

Open `dist/index.html` through any static server to play.

## Credits

Zork I was written by Marc Blank, Dave Lebling, Bruce Daniels and Tim Anderson. Zork is a trademark of its owner; this remaster is a fan project built on the MIT licensed source and is not affiliated with Activision or Microsoft.
