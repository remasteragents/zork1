// The browser player: a terminal around the Z-machine, with the room drawn in 3D above it.
//   index.html               the full player: room view on top, terminal below
//   index.html?layout=text   only the terminal (tells a room view in another frame where you are)
//   index.html?layout=scene  only the room view (follows a terminal in another frame)
import { ZMachine } from './zm.js';
import { here, rooms as listRooms } from './world.js';

const $ = (id) => document.getElementById(id);
const log = $('log');
const screen = $('screen');
const form = $('prompt');
const cmd = $('cmd');
const params = new URLSearchParams(location.search);
const layout = ['text', 'scene'].includes(params.get('layout')) ? params.get('layout') : 'full';
document.body.classList.add(`layout-${layout}`);
const base = location.pathname.replace(/[^/]*$/, '');
// one save slot per copy of the game, so the 1980 original and the remaster never overwrite each other
const SLOT = `remaster:save:${base}`;
// the terminal and the room view of the same build talk over this channel when they live in separate frames
const channel = 'BroadcastChannel' in window ? new BroadcastChannel(`remaster:${base}`) : null;
const history = [];
let back = 0;
let vm;
// inside a frame on someone's page, never grab the keyboard before the player clicks in
const embedded = window.parent !== window;

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
  if (embedded) window.parent.postMessage({ type: 'remaster:status', status: st }, '*');
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

// ---- the room view -------------------------------------------------------------

let view = null;
let rooms = [];
const specs = new Map();

async function specFor(slug) {
  if (!specs.has(slug)) {
    specs.set(
      slug,
      fetch(`scenes/${slug}.json`, { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );
  }
  return specs.get(slug);
}

// rooms change faster than scene files load: only the latest room is drawn
let wanted = 0;
async function showRoom(info) {
  if (!view || !info) return;
  const ticket = ++wanted;
  const spec = await specFor(info.slug);
  if (ticket === wanted) view.show(info, spec);
}

async function startView(bytes, onCommand) {
  const [{ createScene }, index] = await Promise.all([
    import('./scene.js'),
    fetch('scenes/index.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []),
  ]);
  const mapVm = new ZMachine(bytes, { seed: 1 });
  rooms = listRooms(mapVm);
  view = createScene($('view'), { onCommand, rooms, remastered: new Set(index) });
}

// ---- the terminal ----------------------------------------------------------------

function announce() {
  if (!vm) return;
  const info = here(vm);
  if (view) showRoom(info);
  channel?.postMessage({ type: 'room', id: info.id });
}

function afterTurn(auto = false) {
  if (vm.halted) write('\n[The game is over. Press Enter to play again.]\n');
  announce();
  if (!(auto && embedded)) cmd.focus({ preventScroll: true });
}

function send(text) {
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
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = cmd.value;
  cmd.value = '';
  send(text);
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

  if (layout === 'scene') {
    // only the view: follow the terminal of the same build in another frame
    await startView(bytes, (text) => channel?.postMessage({ type: 'cmd', text }));
    const start = new ZMachine(bytes, { seed: 1 });
    start.run();
    let heard = false;
    channel?.addEventListener('message', (e) => {
      if (e.data?.type !== 'room') return;
      heard = true;
      showRoom(rooms.find((r) => r.id === e.data.id) ?? null);
    });
    channel?.postMessage({ type: 'hello' });
    setTimeout(() => !heard && showRoom(here(start)), 500);
    return;
  }

  vm = new ZMachine(bytes, { print, status, save, restore, seed, restart: () => (log.textContent = '') });
  channel?.addEventListener('message', (e) => {
    if (e.data?.type === 'cmd' && typeof e.data.text === 'string') send(e.data.text);
    if (e.data?.type === 'hello') announce();
  });
  if (layout === 'full') {
    try {
      await startView(bytes, send);
    } catch (e) {
      console.warn('room view unavailable', e);
    }
  }
  vm.run();
  afterTurn(true);
}

boot().catch((e) => write(`\n[${e.message}]\n`));
