#!/usr/bin/env node
// Checks every room scene: valid JSON, a real room of the game, the right file name, only kit parts.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZMachine } from '../player/zm.js';
import { rooms, slug } from '../player/world.js';
import { EXITS, MATERIALS, PROPS, WALLS } from '../player/scene-kit.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vm = new ZMachine(readFileSync(resolve(root, 'dist/zork1.z3')), { seed: 1 });
const all = rooms(vm);
const names = new Set(all.map((r) => r.name));
// places, not room objects: rooms that share a name (the 15 maze rooms) are one place with one scene
const places = new Set(all.map((r) => r.slug));
const dir = resolve(root, 'player/scenes');
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
let bad = 0;
const fail = (f, why) => {
  bad++;
  console.log(`x   ${f}: ${why}`);
};
for (const f of files) {
  let s;
  try {
    s = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
  } catch (e) {
    fail(f, `not valid JSON (${e.message})`);
    continue;
  }
  if (!names.has(s.room)) fail(f, `"${s.room}" is not a room of the game`);
  else if (`${slug(s.room)}.json` !== f) fail(f, `should be named ${slug(s.room)}.json`);
  if (!['indoor', 'outdoor'].includes(s.kind)) fail(f, `kind must be indoor or outdoor`);
  for (const k of ['walls', 'floor', 'ceiling']) if (s[k] && !MATERIALS.includes(s[k])) fail(f, `unknown material "${s[k]}"`);
  for (const [d, e] of Object.entries(s.exits ?? {})) if (e.type && !EXITS.includes(e.type)) fail(f, `unknown exit type "${e.type}" (${d})`);
  for (const p of s.props ?? []) {
    if (!PROPS.includes(p.type)) fail(f, `unknown prop "${p.type}"`);
    if (p.wall && !WALLS.includes(p.wall)) fail(f, `unknown wall "${p.wall}"`);
  }
  if (!bad) console.log(`ok  ${f}`);
}
console.log(`${bad ? 'FAIL' : 'PASS'}  ${files.length} scenes, ${places.size} places in the game, ${bad} problems`);
process.exit(bad ? 1 : 0);
