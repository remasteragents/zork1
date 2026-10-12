// The browser player: a terminal around the Z-machine, with the room drawn in 3D above it.
//   index.html                           the full player: room view on top, terminal below
//   index.html?layout=text               only the terminal
//   index.html?layout=scene              only the room view, showing the start room
//   index.html?layout=scene&room=cellar  only the room view of one place, drawn from the map (no game running)
//   ...&pair=<id>                        a text frame and a scene frame with the same pair follow each other over
//                                        a BroadcastChannel; without pair a frame uses no channel at all
//
// The page around a frame (same origin) drives and follows it with postMessage:
//   frame to page  { type: 'remaster:status', status, slug }               after every turn
//   frame to page  { type: 'remaster:room', id, name, slug, remastered }   on boot and after every turn
//   page to frame  { type: 'remaster:cmd', text }    terminal layouts: run a command as if typed
//   page to frame  { type: 'remaster:show', slug }   scene layout: show that place
import { ZMachine } from './zm.js';
import { here, rooms as listRooms, slug as slugOf } from './world.js';

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
// a terminal frame and a room view frame of the same build talk over this channel, only when the page pairs them
const pair = params.get('pair');
const channel = pair && 'BroadcastChannel' in window ? new BroadcastChannel(`remaster:${base}:${pair}`) : null;
const history = [];
let back = 0;
let vm;
// inside a frame on someone's page, never grab the keyboard before the player clicks in
const embedded = window.parent !== window;
const toParent = (msg) => embedded && window.parent.postMessage(msg, '/');
// slugs of the places that have a scene file (scenes/index.json); null while unknown
let remastered = null;

// keep the prompt in view and start the top line whole, right under the status bar
function scrollToEnd() {
  const line = parseFloat(getComputedStyle(log).lineHeight);
  const need = form.offsetTop + form.offsetHeight - screen.clientHeight;
  if (!(line > 0) || need <= 0) {
    screen.scrollTop = Math.max(0, need);
    return;
  }
  screen.scrollTop = log.offsetTop + Math.ceil((need - log.offsetTop) / line) * line;
}

function write(text, cls) {
  if (!text) return;
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = text;
  log.appendChild(span);
  scrollToEnd();
}

// the game prints its own ">" before every command; the input line shows it instead
function print(text) {
  write(text.replace(/\n?>\s*$/, '\n'));
}

function status(st) {
  $('room').textContent = st.room;
  $('score').textContent = 'score' in st ? `Score: ${st.score}   Moves: ${st.moves}` : `Time: ${st.hours}:${String(st.minutes).padStart(2, '0')}`;
  toParent({ type: 'remaster:status', status: st, slug: slugOf(st.room) });
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
  if (remastered && !remastered.has(slug)) return null;
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
  const { createScene } = await import('./scene.js');
  const mapVm = new ZMachine(bytes, { seed: 1 });
  rooms = listRooms(mapVm);
  view = createScene($('view'), { onCommand, rooms, remastered: remastered ?? new Set() });
}

// ---- the terminal ----------------------------------------------------------------

function announce() {
  if (!vm) return;
  const info = here(vm);
  if (view) showRoom(info);
  channel?.postMessage({ type: 'room', id: info.id });
  toParent({ type: 'remaster:room', id: info.id, name: info.name, slug: info.slug, remastered: !!remastered?.has(info.slug) });
}

function afterTurn(auto = false) {
  if (vm.halted) write('\n[The game is over. Press Enter to play again.]\n');
  announce();
  if (!(auto && embedded)) cmd.focus({ preventScroll: true });
}

// quiet: a command from the page around the frame, which keeps its own focus
function send(text, quiet = false) {
  if (vm.halted) {
    log.textContent = '';
    vm.reset();
    vm.run();
    return afterTurn(quiet);
  }
  write(`>${text}\n`, 'cmd');
  if (text.trim()) history.push(text);
  back = history.length;
  vm.input(text);
  afterTurn(quiet);
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

// ---- the page around the frame ------------------------------------------------------

// what the page asks for before the game or the view is ready waits here
const queued = [];
let ready = false;
let askedRoom = params.get('room');

function showPlace(slug) {
  const info = rooms.find((r) => r.slug === slug);
  if (info) showRoom(info);
}

window.addEventListener('message', (e) => {
  if (!embedded || e.source !== window.parent || e.origin !== location.origin) return;
  const m = e.data;
  if (layout === 'scene') {
    if (m?.type !== 'remaster:show' || typeof m.slug !== 'string') return;
    if (view) showPlace(m.slug);
    else askedRoom = m.slug;
  } else if (m?.type === 'remaster:cmd' && typeof m.text === 'string') {
    if (ready) send(m.text, true);
    else queued.push(m.text);
  }
});

async function boot() {
  const [res, index] = await Promise.all([
    fetch('zork1.z3', { cache: 'no-cache' }),
    fetch('scenes/index.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);
  if (!res.ok) throw new Error(`Could not load the story file (${res.status})`);
  if (Array.isArray(index)) remastered = new Set(index);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const seed = params.has('seed') ? Number(params.get('seed')) : undefined;

  if (layout === 'scene') {
    // only the view: one place from the map, or the terminal of the same pair in another frame
    await startView(bytes, (text) => channel?.postMessage({ type: 'cmd', text }));
    const startRoom = () => {
      const start = new ZMachine(bytes, { seed: 1 });
      start.run();
      return here(start);
    };
    if (askedRoom) showRoom(rooms.find((r) => r.slug === askedRoom) ?? startRoom());
    if (!channel) {
      if (!askedRoom) showRoom(startRoom());
      return;
    }
    let heard = false;
    channel.addEventListener('message', (e) => {
      if (e.data?.type !== 'room') return;
      heard = true;
      showRoom(rooms.find((r) => r.id === e.data.id) ?? null);
    });
    channel.postMessage({ type: 'hello' });
    if (!askedRoom) setTimeout(() => !heard && showRoom(startRoom()), 500);
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
  ready = true;
  for (const text of queued.splice(0)) send(text, true);
}

boot().catch((e) => write(`\n[${e.message}]\n`));
