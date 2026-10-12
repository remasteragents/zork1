#!/bin/sh
# Builds the remaster: compiles the ZIL source with ZILF and packs the browser player into dist/.
# Needs zilf and zapf on PATH (https://zilf.io).
set -e
cd "$(dirname "$0")"
rm -rf build dist
mkdir -p build dist
cp src/*.zil build/
cd build
zilf zork1.zil > zilf.log 2>&1 || { cat zilf.log; echo "x build failed: zilf"; exit 1; }
grep -E "error" zilf.log && { echo "x build failed: zilf reported errors"; exit 1; } || true
zapf zork1.zap > zapf.log 2>&1 || { cat zapf.log; echo "x build failed: zapf"; exit 1; }
cd ..
cp build/zork1.z3 dist/zork1.z3
cp -R player/. dist/
# the list of remastered rooms, and every room of the game, for the room view and the site
node --input-type=module -e "
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ZMachine } from './player/zm.js';
import { rooms } from './player/world.js';
const scenes = readdirSync('player/scenes').filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => f.slice(0, -5));
writeFileSync('dist/scenes/index.json', JSON.stringify(scenes));
const all = rooms(new ZMachine(readFileSync('dist/zork1.z3'), { seed: 1 })).map((r) => ({ id: r.id, name: r.name, slug: r.slug }));
writeFileSync('dist/rooms.json', JSON.stringify(all));
"

echo "build ok: dist/zork1.z3 is $(wc -c < dist/zork1.z3 | tr -d ' ') bytes, $(grep -c warning build/zilf.log || true) compiler warnings, $(ls player/scenes/*.json | wc -l | tr -d ' ') room scenes"
