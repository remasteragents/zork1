// zm.js: a Z-machine version 3 interpreter (the format of Zork I, II and III).
// Runs the same way in the browser and in Node. No dependencies.
//
//   const vm = new ZMachine(storyBytes, { print: (s) => ..., status: (st) => ..., seed: 1 });
//   vm.run();            // runs until the game waits for a command
//   vm.input('open mailbox');
//
// State after run()/input(): vm.waiting (needs a command) or vm.halted (game over / quit).

const A0 = 'abcdefghijklmnopqrstuvwxyz';
const A1 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// alphabet 2 from z-char 7 (z-char 6 is the 10-bit ZSCII escape)
const A2 = '\n0123456789.,!?_#\'"/\\-:()';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const s16 = (v) => ((v & 0xffff) ^ 0x8000) - 0x8000;
const u16 = (v) => v & 0xffff;

export class ZMachine {
  constructor(story, io = {}) {
    this.story = Uint8Array.from(story);
    this.io = io;
    this.reset();
  }

  // ---- lifecycle -----------------------------------------------------------

  reset() {
    this.mem = Uint8Array.from(this.story);
    const m = this.mem;
    this.version = m[0];
    if (this.version !== 3) throw new Error(`Only version 3 story files are supported (got ${this.version})`);
    // status line available, screen splitting available
    m[1] = (m[1] & ~0x10) | 0x20;
    this.pc = this.rw(0x06);
    this.dict = this.rw(0x08);
    this.objTable = this.rw(0x0a);
    this.globals = this.rw(0x0c);
    this.staticBase = this.rw(0x0e);
    this.abbrTable = this.rw(0x18);
    this.stack = [];
    this.frames = [{ retPc: 0, store: null, locals: [], sp: 0 }];
    this.out = '';
    this.waiting = null;
    this.halted = false;
    this.seedRng(this.io.seed ?? (Date.now() & 0x7fffffff));
    this.loadDictionary();
  }

  seedRng(seed) {
    this.rng = mulberry32(seed || 1);
  }

  // ---- memory --------------------------------------------------------------

  rb(a) {
    return this.mem[a];
  }
  rw(a) {
    return (this.mem[a] << 8) | this.mem[a + 1];
  }
  wb(a, v) {
    this.mem[a] = v & 0xff;
  }
  ww(a, v) {
    this.mem[a] = (v >> 8) & 0xff;
    this.mem[a + 1] = v & 0xff;
  }

  // ---- variables -----------------------------------------------------------

  frame() {
    return this.frames[this.frames.length - 1];
  }
  readVar(v) {
    if (v === 0) {
      if (this.stack.length <= this.frame().sp) throw new Error('Stack underflow');
      return this.stack.pop();
    }
    if (v < 16) return this.frame().locals[v - 1];
    return this.rw(this.globals + 2 * (v - 16));
  }
  writeVar(v, value) {
    value = u16(value);
    if (v === 0) this.stack.push(value);
    else if (v < 16) this.frame().locals[v - 1] = value;
    else this.ww(this.globals + 2 * (v - 16), value);
  }
  // indirect references (store, load, inc, dec, pull...) use the top of the stack in place
  peekVar(v) {
    if (v === 0) return this.stack[this.stack.length - 1];
    return this.readVar(v);
  }
  pokeVar(v, value) {
    if (v === 0) this.stack[this.stack.length - 1] = u16(value);
    else this.writeVar(v, value);
  }

  // ---- text ----------------------------------------------------------------

  decode(addr, depth = 0) {
    const z = [];
    let a = addr;
    for (;;) {
      const w = this.rw(a);
      a += 2;
      z.push((w >> 10) & 31, (w >> 5) & 31, w & 31);
      if (w & 0x8000) break;
    }
    let out = '';
    let alph = 0;
    for (let i = 0; i < z.length; i++) {
      const c = z[i];
      if (alph === 2 && c === 6) {
        if (i + 2 >= z.length) break;
        out += this.zscii((z[i + 1] << 5) | z[i + 2]);
        i += 2;
        alph = 0;
        continue;
      }
      if (c === 0) {
        out += ' ';
        alph = 0;
      } else if (c >= 1 && c <= 3) {
        if (i + 1 >= z.length) break;
        const entry = this.rw(this.abbrTable + 2 * (32 * (c - 1) + z[++i]));
        if (depth < 2) out += this.decode(entry * 2, depth + 1).text;
        alph = 0;
      } else if (c === 4) {
        alph = 1;
      } else if (c === 5) {
        alph = 2;
      } else {
        out += alph === 0 ? A0[c - 6] : alph === 1 ? A1[c - 6] : A2[c - 7];
        alph = 0;
      }
    }
    return { text: out, end: a };
  }

  zscii(code) {
    if (code === 13) return '\n';
    if (code >= 32 && code <= 126) return String.fromCharCode(code);
    return '?';
  }

  encodeWord(word) {
    const z = [];
    for (const ch of word) {
      if (z.length >= 6) break;
      let k = A0.indexOf(ch);
      if (k >= 0) {
        z.push(k + 6);
        continue;
      }
      k = A2.indexOf(ch);
      if (k > 0) {
        z.push(5, k + 7);
        continue;
      }
      const code = ch.charCodeAt(0) & 0x3ff;
      z.push(5, 6, (code >> 5) & 31, code & 31);
    }
    while (z.length < 6) z.push(5);
    return [(z[0] << 10) | (z[1] << 5) | z[2], 0x8000 | (z[3] << 10) | (z[4] << 5) | z[5]];
  }

  print(s) {
    this.out += s;
  }

  flush() {
    if (this.out) {
      const s = this.out;
      this.out = '';
      this.io.print?.(s);
    }
  }

  // ---- dictionary and input -------------------------------------------------

  loadDictionary() {
    const d = this.dict;
    const n = this.rb(d);
    this.separators = [];
    for (let i = 0; i < n; i++) this.separators.push(String.fromCharCode(this.rb(d + 1 + i)));
    this.entryLen = this.rb(d + 1 + n);
    this.entryCount = s16(this.rw(d + 2 + n));
    this.entries = d + 4 + n;
  }

  lookup(word) {
    const [w1, w2] = this.encodeWord(word);
    const count = Math.abs(this.entryCount);
    for (let i = 0; i < count; i++) {
      const a = this.entries + i * this.entryLen;
      if (this.rw(a) === w1 && this.rw(a + 2) === w2) return a;
    }
    return 0;
  }

  tokenize(text, parseBuf) {
    const words = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === ' ') {
        i++;
        continue;
      }
      if (this.separators.includes(ch)) {
        words.push({ w: ch, pos: i });
        i++;
        continue;
      }
      let j = i;
      while (j < text.length && text[j] !== ' ' && !this.separators.includes(text[j])) j++;
      words.push({ w: text.slice(i, j), pos: i });
      i = j;
    }
    const max = this.rb(parseBuf);
    const n = Math.min(max, words.length);
    this.wb(parseBuf + 1, n);
    for (let k = 0; k < n; k++) {
      const e = parseBuf + 2 + 4 * k;
      this.ww(e, this.lookup(words[k].w));
      this.wb(e + 2, words[k].w.length);
      this.wb(e + 3, words[k].pos + 1);
    }
  }

  /** Give the game the command it is waiting for, then run until it waits again. */
  input(line) {
    if (!this.waiting) return this.state();
    const { textBuf, parseBuf } = this.waiting;
    this.waiting = null;
    const max = Math.max(1, this.rb(textBuf) - 1);
    const text = String(line)
      .toLowerCase()
      .replace(/[^\x20-\x7e]/g, '')
      .slice(0, max);
    for (let i = 0; i < text.length; i++) this.wb(textBuf + 1 + i, text.charCodeAt(i));
    this.wb(textBuf + 1 + text.length, 0);
    this.tokenize(text, parseBuf);
    return this.run();
  }

  // ---- objects -------------------------------------------------------------

  objAddr(n) {
    return this.objTable + 31 * 2 + (n - 1) * 9;
  }
  attr(n, a) {
    if (!n) return false;
    return (this.rb(this.objAddr(n) + (a >> 3)) & (0x80 >> (a & 7))) !== 0;
  }
  setAttr(n, a, on) {
    if (!n) return;
    const addr = this.objAddr(n) + (a >> 3);
    const bit = 0x80 >> (a & 7);
    this.wb(addr, on ? this.rb(addr) | bit : this.rb(addr) & ~bit);
  }
  parent(n) {
    return n ? this.rb(this.objAddr(n) + 4) : 0;
  }
  sibling(n) {
    return n ? this.rb(this.objAddr(n) + 5) : 0;
  }
  child(n) {
    return n ? this.rb(this.objAddr(n) + 6) : 0;
  }
  setParent(n, v) {
    this.wb(this.objAddr(n) + 4, v);
  }
  setSibling(n, v) {
    this.wb(this.objAddr(n) + 5, v);
  }
  setChild(n, v) {
    this.wb(this.objAddr(n) + 6, v);
  }
  propTable(n) {
    return this.rw(this.objAddr(n) + 7);
  }
  objName(n) {
    if (!n) return '';
    const t = this.propTable(n);
    return this.rb(t) ? this.decode(t + 1).text : '';
  }
  firstProp(n) {
    const t = this.propTable(n);
    return t + 1 + 2 * this.rb(t);
  }
  findProp(n, p) {
    let a = this.firstProp(n);
    for (;;) {
      const sb = this.rb(a);
      if (!sb) return null;
      const num = sb & 31;
      const len = (sb >> 5) + 1;
      if (num === p) return { addr: a + 1, len };
      if (num < p) return null;
      a += 1 + len;
    }
  }
  removeObj(n) {
    const p = this.parent(n);
    if (!p) return;
    if (this.child(p) === n) {
      this.setChild(p, this.sibling(n));
    } else {
      let c = this.child(p);
      while (c && this.sibling(c) !== n) c = this.sibling(c);
      if (c) this.setSibling(c, this.sibling(n));
    }
    this.setParent(n, 0);
    this.setSibling(n, 0);
  }
  insertObj(n, dest) {
    this.removeObj(n);
    this.setSibling(n, this.child(dest));
    this.setChild(dest, n);
    this.setParent(n, dest);
  }

  /** What the status line shows: the room and the score and moves. */
  status() {
    const room = this.objName(this.rw(this.globals));
    const a = s16(this.rw(this.globals + 2));
    const b = this.rw(this.globals + 4);
    const timed = (this.mem[1] & 0x02) !== 0;
    return timed ? { room, hours: a, minutes: b } : { room, score: a, moves: b };
  }

  state() {
    return { waiting: !!this.waiting, halted: this.halted, status: this.status() };
  }

  // ---- save / restore --------------------------------------------------------

  snapshot(branchPc) {
    return {
      v: 1,
      release: this.rw(0x02),
      serial: String.fromCharCode(...this.mem.slice(0x12, 0x18)),
      dyn: Array.from(this.mem.slice(0, this.staticBase)),
      stack: this.stack.slice(),
      frames: this.frames.map((f) => ({ ...f, locals: f.locals.slice() })),
      pc: branchPc,
    };
  }

  loadSnapshot(s) {
    if (!s || s.v !== 1 || s.release !== this.rw(0x02)) return false;
    // header flags 2 (transcript and fixed pitch) survive a restore
    const flags2 = this.rw(0x10);
    this.mem.set(s.dyn, 0);
    this.ww(0x10, flags2);
    this.stack = s.stack.slice();
    this.frames = s.frames.map((f) => ({ ...f, locals: f.locals.slice() }));
    this.pc = s.pc;
    return true;
  }

  // ---- execution -----------------------------------------------------------

  fetchOperand(type) {
    if (type === 0) {
      const v = this.rw(this.pc);
      this.pc += 2;
      return v;
    }
    if (type === 1) return this.rb(this.pc++);
    return this.readVar(this.rb(this.pc++));
  }

  readStore() {
    return this.rb(this.pc++);
  }

  branch(cond) {
    const b = this.rb(this.pc++);
    let offset;
    if (b & 0x40) {
      offset = b & 0x3f;
    } else {
      offset = ((b & 0x3f) << 8) | this.rb(this.pc++);
      if (offset & 0x2000) offset -= 0x4000;
    }
    if (!!(b & 0x80) !== cond) return;
    if (offset === 0) this.ret(0);
    else if (offset === 1) this.ret(1);
    else this.pc += offset - 2;
  }

  call(packed, args, store) {
    if (packed === 0) {
      if (store !== null) this.writeVar(store, 0);
      return;
    }
    const addr = packed * 2;
    const n = this.rb(addr);
    const locals = [];
    for (let i = 0; i < n; i++) locals.push(this.rw(addr + 1 + 2 * i));
    for (let i = 0; i < Math.min(n, args.length); i++) locals[i] = u16(args[i]);
    this.frames.push({ retPc: this.pc, store, locals, sp: this.stack.length });
    this.pc = addr + 1 + 2 * n;
  }

  ret(value) {
    const f = this.frames.pop();
    if (!this.frames.length) throw new Error('Return from the main routine');
    this.stack.length = f.sp;
    this.pc = f.retPc;
    if (f.store !== null) this.writeVar(f.store, value);
  }

  random(n) {
    n = s16(n);
    if (n > 0) return 1 + Math.floor(this.rng() * n);
    if (n < 0) this.seedRng(-n);
    else this.seedRng(this.io.seed ?? (Date.now() & 0x7fffffff));
    return 0;
  }

  /** Runs until the game waits for a command or stops. */
  run(maxSteps = 5_000_000) {
    if (this.halted || this.waiting) return this.state();
    for (let i = 0; i < maxSteps; i++) {
      this.step();
      if (this.waiting || this.halted) break;
    }
    this.flush();
    return this.state();
  }

  step() {
    const at = this.pc;
    const op = this.rb(this.pc++);
    let ops;
    let code;
    let kind;
    if (op < 0x80) {
      // long form: 2OP with small constants or variables
      kind = 2;
      code = op & 0x1f;
      ops = [this.fetchOperand(op & 0x40 ? 2 : 1), this.fetchOperand(op & 0x20 ? 2 : 1)];
    } else if (op < 0xc0) {
      code = op & 0x0f;
      const t = (op >> 4) & 3;
      if (t === 3) {
        kind = 0;
        ops = [];
      } else {
        kind = 1;
        ops = [this.fetchOperand(t)];
      }
    } else {
      kind = op & 0x20 ? 3 : 2;
      code = op & 0x1f;
      const types = this.rb(this.pc++);
      ops = [];
      for (let s = 6; s >= 0; s -= 2) {
        const t = (types >> s) & 3;
        if (t === 3) break;
        ops.push(this.fetchOperand(t));
      }
    }
    try {
      if (kind === 2) this.op2(code, ops);
      else if (kind === 1) this.op1(code, ops[0]);
      else if (kind === 0) this.op0(code);
      else this.opVar(code, ops);
    } catch (e) {
      e.message = `${e.message} (at 0x${at.toString(16)}, opcode 0x${op.toString(16)})`;
      throw e;
    }
  }

  op2(code, [a, b, ...rest]) {
    switch (code) {
      case 1: // je
        this.branch(a === b || rest.includes(a));
        return;
      case 2: // jl
        this.branch(s16(a) < s16(b));
        return;
      case 3: // jg
        this.branch(s16(a) > s16(b));
        return;
      case 4: {
        // dec_chk
        const v = s16(this.peekVar(a)) - 1;
        this.pokeVar(a, v);
        this.branch(s16(v) < s16(b));
        return;
      }
      case 5: {
        // inc_chk
        const v = s16(this.peekVar(a)) + 1;
        this.pokeVar(a, v);
        this.branch(s16(v) > s16(b));
        return;
      }
      case 6: // jin
        this.branch(this.parent(a) === b);
        return;
      case 7: // test
        this.branch((a & b) === b);
        return;
      case 8: // or
        this.writeVar(this.readStore(), a | b);
        return;
      case 9: // and
        this.writeVar(this.readStore(), a & b);
        return;
      case 10: // test_attr
        this.branch(this.attr(a, b));
        return;
      case 11: // set_attr
        this.setAttr(a, b, true);
        return;
      case 12: // clear_attr
        this.setAttr(a, b, false);
        return;
      case 13: // store
        this.pokeVar(a, b);
        return;
      case 14: // insert_obj
        this.insertObj(a, b);
        return;
      case 15: // loadw
        this.writeVar(this.readStore(), this.rw(u16(a + 2 * s16(b))));
        return;
      case 16: // loadb
        this.writeVar(this.readStore(), this.rb(u16(a + s16(b))));
        return;
      case 17: {
        // get_prop
        const st = this.readStore();
        const p = this.findProp(a, b);
        if (!p) this.writeVar(st, this.rw(this.objTable + 2 * (b - 1)));
        else this.writeVar(st, p.len === 1 ? this.rb(p.addr) : this.rw(p.addr));
        return;
      }
      case 18: {
        // get_prop_addr
        const st = this.readStore();
        const p = a ? this.findProp(a, b) : null;
        this.writeVar(st, p ? p.addr : 0);
        return;
      }
      case 19: {
        // get_next_prop
        const st = this.readStore();
        if (b === 0) {
          const sb = this.rb(this.firstProp(a));
          this.writeVar(st, sb & 31);
          return;
        }
        const p = this.findProp(a, b);
        if (!p) throw new Error(`get_next_prop: object ${a} has no property ${b}`);
        this.writeVar(st, this.rb(p.addr + p.len) & 31);
        return;
      }
      case 20:
        this.writeVar(this.readStore(), s16(a) + s16(b));
        return;
      case 21:
        this.writeVar(this.readStore(), s16(a) - s16(b));
        return;
      case 22:
        this.writeVar(this.readStore(), Math.imul(s16(a), s16(b)));
        return;
      case 23:
        if (s16(b) === 0) throw new Error('Division by zero');
        this.writeVar(this.readStore(), Math.trunc(s16(a) / s16(b)));
        return;
      case 24:
        if (s16(b) === 0) throw new Error('Division by zero');
        this.writeVar(this.readStore(), s16(a) % s16(b));
        return;
      default:
        throw new Error(`Unknown 2OP opcode ${code}`);
    }
  }

  op1(code, a) {
    switch (code) {
      case 0: // jz
        this.branch(a === 0);
        return;
      case 1: {
        // get_sibling
        const v = this.sibling(a);
        this.writeVar(this.readStore(), v);
        this.branch(v !== 0);
        return;
      }
      case 2: {
        // get_child
        const v = this.child(a);
        this.writeVar(this.readStore(), v);
        this.branch(v !== 0);
        return;
      }
      case 3: // get_parent
        this.writeVar(this.readStore(), this.parent(a));
        return;
      case 4: // get_prop_len
        this.writeVar(this.readStore(), a === 0 ? 0 : (this.rb(a - 1) >> 5) + 1);
        return;
      case 5: // inc
        this.pokeVar(a, s16(this.peekVar(a)) + 1);
        return;
      case 6: // dec
        this.pokeVar(a, s16(this.peekVar(a)) - 1);
        return;
      case 7: // print_addr
        this.print(this.decode(a).text);
        return;
      case 9: // remove_obj
        this.removeObj(a);
        return;
      case 10: // print_obj
        this.print(this.objName(a));
        return;
      case 11: // ret
        this.ret(a);
        return;
      case 12: // jump
        this.pc += s16(a) - 2;
        return;
      case 13: // print_paddr
        this.print(this.decode(a * 2).text);
        return;
      case 14: // load
        this.writeVar(this.readStore(), this.peekVar(a));
        return;
      case 15: // not
        this.writeVar(this.readStore(), ~a);
        return;
      default:
        throw new Error(`Unknown 1OP opcode ${code}`);
    }
  }

  op0(code) {
    switch (code) {
      case 0: // rtrue
        this.ret(1);
        return;
      case 1: // rfalse
        this.ret(0);
        return;
      case 2: {
        // print
        const { text, end } = this.decode(this.pc);
        this.pc = end;
        this.print(text);
        return;
      }
      case 3: {
        // print_ret
        const { text, end } = this.decode(this.pc);
        this.pc = end;
        this.print(text + '\n');
        this.ret(1);
        return;
      }
      case 4: // nop
        return;
      case 5: {
        // save (branches on success)
        const snap = this.snapshot(this.pc);
        let ok = false;
        try {
          ok = !!this.io.save?.(snap);
        } catch {
          ok = false;
        }
        this.branch(ok);
        return;
      }
      case 6: {
        // restore: on success the game continues from the save, which branches as if it succeeded
        let snap = null;
        try {
          snap = this.io.restore?.() ?? null;
        } catch {
          snap = null;
        }
        if (snap && this.loadSnapshot(snap)) {
          this.branch(true);
          return;
        }
        this.branch(false);
        return;
      }
      case 7: {
        // restart
        const flags2 = this.rw(0x10);
        this.flush();
        const seed = this.io.seed;
        this.reset();
        if (seed !== undefined) this.seedRng(seed);
        this.ww(0x10, flags2);
        this.io.restart?.();
        return;
      }
      case 8: // ret_popped
        this.ret(this.readVar(0));
        return;
      case 9: // pop
        this.readVar(0);
        return;
      case 10: // quit
        this.halted = true;
        return;
      case 11: // new_line
        this.print('\n');
        return;
      case 12: // show_status
        this.io.status?.(this.status());
        return;
      case 13: // verify
      case 15: // piracy
        this.branch(true);
        return;
      default:
        throw new Error(`Unknown 0OP opcode ${code}`);
    }
  }

  opVar(code, ops) {
    switch (code) {
      case 0: // call
        this.call(ops[0], ops.slice(1), this.readStore());
        return;
      case 1: // storew
        this.ww(u16(ops[0] + 2 * s16(ops[1])), ops[2]);
        return;
      case 2: // storeb
        this.wb(u16(ops[0] + s16(ops[1])), ops[2]);
        return;
      case 3: {
        // put_prop
        const p = this.findProp(ops[0], ops[1]);
        if (!p) throw new Error(`put_prop: object ${ops[0]} has no property ${ops[1]}`);
        if (p.len === 1) this.wb(p.addr, ops[2]);
        else this.ww(p.addr, ops[2]);
        return;
      }
      case 4: // sread
        this.io.status?.(this.status());
        this.flush();
        this.waiting = { textBuf: ops[0], parseBuf: ops[1] };
        return;
      case 5: // print_char
        this.print(this.zscii(ops[0]));
        return;
      case 6: // print_num
        this.print(String(s16(ops[0])));
        return;
      case 7: // random
        this.writeVar(this.readStore(), this.random(ops[0]));
        return;
      case 8: // push
        this.writeVar(0, ops[0]);
        return;
      case 9: {
        // pull
        const v = this.readVar(0);
        this.pokeVar(ops[0], v);
        return;
      }
      case 10: // split_window
      case 11: // set_window
      case 19: // output_stream
      case 20: // input_stream
      case 21: // sound_effect
        return;
      default:
        throw new Error(`Unknown VAR opcode ${code}`);
    }
  }
}
