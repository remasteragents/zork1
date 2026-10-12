// world.js: reads the map of the game straight from the story file's object table.
// Works with a ZMachine from zm.js, running or not.

// Zork I declares <DIRECTIONS NORTH EAST WEST SOUTH NE NW SE SW UP DOWN IN OUT LAND>;
// the compiler numbers direction properties from 31 downward in that order.
export const DIRS = ['north', 'east', 'west', 'south', 'ne', 'nw', 'se', 'sw', 'up', 'down', 'in', 'out', 'land'];
const dirProp = (i) => 31 - i;

// exit property length tells the kind of exit (gparser.zil: UEXIT 1, NEXIT 2, FEXIT 3, CEXIT 4, DEXIT 5)
const KIND = { 1: 'open', 2: 'blocked', 3: 'special', 4: 'conditional', 5: 'door' };

export const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function exitsOf(vm, obj) {
  const out = {};
  DIRS.forEach((dir, i) => {
    const p = vm.findProp(obj, dirProp(i));
    if (!p) return;
    const kind = KIND[p.len] || 'special';
    const to = p.len === 1 || p.len === 4 || p.len === 5 ? vm.rb(p.addr) : 0;
    out[dir] = { kind, to: to || null, toName: to ? vm.objName(to) : null, door: p.len === 5 ? vm.objName(vm.rb(p.addr + 1)) : null };
  });
  return out;
}

/** Every room: a named object with at least one direction property (the nameless LOCAL-GLOBALS only looks like one). */
export function rooms(vm) {
  const count = Math.min(255, (vm.rw(vm.objAddr(1) + 7) - vm.objAddr(1)) / 9);
  const list = [];
  for (let o = 1; o <= count; o++) {
    const name = vm.objName(o);
    if (!name) continue;
    const exits = exitsOf(vm, o);
    if (Object.keys(exits).length) list.push({ id: o, name, slug: slug(name), exits });
  }
  return list;
}

/** The room the player is in, with its exits and what lies in it. */
export function here(vm) {
  const id = vm.rw(vm.globals);
  return { id, name: vm.objName(id), slug: slug(vm.objName(id)), exits: exitsOf(vm, id) };
}
