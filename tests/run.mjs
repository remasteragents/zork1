#!/usr/bin/env node
// Plays a scripted run through the game and checks what happens.
//
//   node tests/run.mjs                      # tests/smoke.txt against dist/zork1.z3
//   node tests/run.mjs --original           # same script against the untouched 1980s release
//   node tests/run.mjs --script tests/x.txt --seed 7 --transcript
//
// Script lines:
//   open mailbox                       a command
//   kill troll @until /dies/ @max 12   repeat the command until the reply matches (or max tries)
//   ? leaflet                          the last reply must match this regex (case-insensitive)
//   ?! you are dead                    the last reply must NOT match
//   ?score >= 40                       compare the score (==, >=, <=, >, <)
//   ?room West of House                the status line room must be exactly this
//   # comment
//
// Exit code 0 when every check passes.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZMachine } from '../player/zm.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const flag = (name) => args.includes(name);

const storyPath = resolve(root, flag('--original') ? 'original/zork1.z3' : opt('--story', 'dist/zork1.z3'));
const scriptPath = resolve(root, opt('--script', 'tests/smoke.txt'));
const seed = Number(opt('--seed', '1'));
const transcript = flag('--transcript');

let reply = '';
const vm = new ZMachine(readFileSync(storyPath), {
  seed,
  print: (s) => {
    reply += s;
  },
});

const show = (s) => transcript && process.stdout.write(s);
const checks = [];
const check = (ok, what) => {
  checks.push(ok);
  console.log(`${ok ? 'ok' : 'x '}  ${what}`);
};

vm.run();
show(reply);

const lines = readFileSync(scriptPath, 'utf8').split('\n');
let moves = 0;
for (const raw of lines) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  if (line.startsWith('?')) {
    const st = vm.status();
    if (line.startsWith('?score')) {
      const m = line.match(/^\?score\s*(==|>=|<=|>|<)\s*(-?\d+)/);
      if (!m) throw new Error(`Bad check: ${line}`);
      const want = Number(m[2]);
      const s = st.score;
      const ok = { '==': s === want, '>=': s >= want, '<=': s <= want, '>': s > want, '<': s < want }[m[1]];
      check(ok, `score ${s} ${m[1]} ${want}`);
    } else if (line.startsWith('?room')) {
      const want = line.slice(5).trim();
      check(st.room === want, `room is "${want}" (got "${st.room}")`);
    } else if (line.startsWith('?!')) {
      const re = new RegExp(line.slice(2).trim(), 'i');
      check(!re.test(reply), `reply does not say /${re.source}/`);
    } else {
      const re = new RegExp(line.slice(1).trim(), 'i');
      check(re.test(reply), `reply says /${re.source}/`);
    }
    continue;
  }
  const until = line.match(/@until\s+\/(.+?)\/(?:\s+@max\s+(\d+))?\s*$/);
  const command = until ? line.slice(0, until.index).trim() : line;
  const max = until ? Number(until[2] || 10) : 1;
  for (let i = 0; i < max; i++) {
    if (vm.halted) break;
    reply = '';
    show(`${command}\n`);
    vm.input(command);
    moves++;
    show(reply);
    if (until && new RegExp(until[1], 'i').test(reply)) break;
  }
  if (vm.halted) {
    check(false, `the game ended early after "${command}"`);
    break;
  }
}

const st = vm.status();
const passed = checks.filter(Boolean).length;
const ok = passed === checks.length;
console.log(`${ok ? 'PASS' : 'FAIL'}  ${passed}/${checks.length} checks, score ${st.score}, ${moves} commands, room "${st.room}"`);
process.exit(ok ? 0 : 1);
