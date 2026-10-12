// The browser player: a terminal around the Z-machine.
import { ZMachine } from './zm.js';

const $ = (id) => document.getElementById(id);
const log = $('log');
const screen = $('screen');
const form = $('prompt');
const cmd = $('cmd');
const params = new URLSearchParams(location.search);
// one save slot per copy of the game, so the 1980 original and the remaster never overwrite each other
const SLOT = `remaster:save:${location.pathname.replace(/[^/]*$/, '')}`;
const history = [];
let back = 0;
let vm;

function write(text, cls) {
  if (!text) return;
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = text;
  log.appendChild(span);
  screen.scrollTop = screen.scrollHeight;
}

// the game prints its own ">" before every command; the input line shows it instead
function print(text) {
  write(text.replace(/\n?>\s*$/, '\n'));
}

function status(st) {
  $('room').textContent = st.room;
  $('score').textContent = 'score' in st ? `Score: ${st.score}   Moves: ${st.moves}` : `Time: ${st.hours}:${String(st.minutes).padStart(2, '0')}`;
  if (window.parent !== window) window.parent.postMessage({ type: 'remaster:status', status: st }, '*');
}

function save(snapshot) {
  try {
    localStorage.setItem(SLOT, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

function restore() {
  try {
    return JSON.parse(localStorage.getItem(SLOT) || 'null');
  } catch {
    return null;
  }
}

function afterTurn() {
  if (vm.halted) {
    write('\n[The game is over. Press Enter to play again.]\n');
  }
  cmd.focus({ preventScroll: true });
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = cmd.value;
  cmd.value = '';
  if (vm.halted) {
    log.textContent = '';
    vm.reset();
    vm.run();
    return afterTurn();
  }
  write(`>${text}\n`, 'cmd');
  if (text.trim()) history.push(text);
  back = history.length;
  vm.input(text);
  afterTurn();
});

cmd.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' && back > 0) {
    cmd.value = history[--back];
    e.preventDefault();
  } else if (e.key === 'ArrowDown') {
    back = Math.min(history.length, back + 1);
    cmd.value = history[back] ?? '';
    e.preventDefault();
  }
});

screen.addEventListener('click', () => {
  if (!window.getSelection()?.toString()) cmd.focus({ preventScroll: true });
});

async function boot() {
  const res = await fetch('zork1.z3', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load the story file (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const seed = params.has('seed') ? Number(params.get('seed')) : undefined;
  vm = new ZMachine(bytes, { print, status, save, restore, seed, restart: () => (log.textContent = '') });
  vm.run();
  afterTurn();
}

boot().catch((e) => write(`\n[${e.message}]\n`));
