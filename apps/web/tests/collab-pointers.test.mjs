import { describe, expect, test } from "bun:test";

const {
  CARET_INTERVAL_MS,
  POINTER_INTERVAL_MS,
  createPresenceBatcher,
  fromAnchor,
  fromTextAnchor,
  movedEnough,
  parseBlockFocus,
  parsePointer,
  remoteBlocks,
  remotePointers,
  stepSpring,
  toAnchor,
  withTextAnchor,
} = await import("../components/Objects/Editor/Collab/pointerPresence.ts");

describe("pointer anchoring", () => {
  test("lands on the same spot of the same block at another width and scroll", () => {
    // Sender: 800px column, block 2 is 100px tall at y=300 on screen
    const anchor = toAnchor(2, { x: 500, y: 340 }, { left: 100, top: 0, width: 800, height: 2000 }, { left: 100, top: 300, width: 800, height: 100 });
    expect(anchor).toEqual({ b: 2, x: 0.5, y: 0.4 });
    // Receiver: narrower column (text reflowed, block 2 is taller) and scrolled
    const p = fromAnchor(anchor, { left: 40, top: -500, width: 400, height: 3000 }, { left: 40, top: -120, width: 400, height: 200 });
    expect(p).toEqual({ x: 240, y: -40 });
  });

  test("rounds and bounds what goes on the wire", () => {
    const a = toAnchor(1.7, { x: 123.456, y: 99999 }, { left: 0, top: 0, width: 333, height: 1 }, { left: 0, top: 0, width: 333, height: 7 });
    expect(a.b).toBe(1);
    expect(a.x).toBe(0.371);
    expect(a.y).toBe(5); // clamped far below the block
    expect(toAnchor(0, { x: -5000, y: 0 }, { left: 0, top: 0, width: 100, height: 0 }, { left: 0, top: 0, width: 100, height: 0 }).x).toBe(-0.5);
    // Zero-sized boxes don't divide by zero
    const z = toAnchor(0, { x: 10, y: 10 }, { left: 0, top: 0, width: 0, height: 0 }, { left: 0, top: 0, width: 0, height: 0 });
    expect(Number.isFinite(z.x) && Number.isFinite(z.y)).toBe(true);
    expect(JSON.stringify(a).length).toBeLessThan(32);
  });

  test("over text, follows the character under the pointer", () => {
    const base = { b: 2, x: 0.6, y: 0.5 };
    // Pointer 3px right of the caret box of position 57, on the line's middle
    const a = withTextAnchor(base, 57, { x: 403, y: 110 }, { left: 400, top: 100, bottom: 120 });
    expect(a).toEqual({ b: 2, x: 0.6, y: 0.5, p: 57, dx: 3, dy: 0 });
    // Elsewhere on screen (text wrapped differently), the same character
    expect(fromTextAnchor(a, { left: 120, top: 300, bottom: 318 })).toEqual({ x: 123, y: 309 });
    // Too far from the character (margin, end of a short line): block anchor only
    expect(withTextAnchor(base, 57, { x: 600, y: 110 }, { left: 400, top: 100, bottom: 120 })).toEqual(base);
    expect(withTextAnchor(base, 57, { x: 401, y: 160 }, { left: 400, top: 100, bottom: 120 })).toEqual(base);
    expect(withTextAnchor(base, -1, { x: 401, y: 110 }, { left: 400, top: 100, bottom: 120 })).toEqual(base);
    // Moving to another character is a move; a jitter on the same one is not
    expect(movedEnough(a, { ...a, p: 58 }, 800, 20)).toBe(true);
    expect(movedEnough(a, { ...a, dx: 4 }, 800, 20)).toBe(false);
    expect(movedEnough(a, { ...a, dx: 9 }, 800, 20)).toBe(true);
    expect(parsePointer({ b: 2, x: 0.5, y: 0.5, p: 57, dx: 99, dy: "x" })).toEqual({ b: 2, x: 0.5, y: 0.5, p: 57, dx: 32, dy: 0 });
    expect(parsePointer({ b: 2, x: 0.5, y: 0.5, p: 1.5 })).toEqual({ b: 2, x: 0.5, y: 0.5 });
    expect(JSON.stringify(a).length).toBeLessThan(48);
  });

  test("only moves of a few pixels are worth sending", () => {
    const prev = { b: 3, x: 0.5, y: 0.5 };
    expect(movedEnough(null, prev, 800, 100)).toBe(true);
    expect(movedEnough(prev, { b: 4, x: 0.5, y: 0.5 }, 800, 100)).toBe(true);
    expect(movedEnough(prev, { b: 3, x: 0.502, y: 0.5 }, 800, 100)).toBe(false); // 1.6px
    expect(movedEnough(prev, { b: 3, x: 0.51, y: 0.5 }, 800, 100)).toBe(true); // 8px
    expect(movedEnough(prev, { b: 3, x: 0.5, y: 0.52 }, 800, 100)).toBe(false); // 2px
    expect(movedEnough(prev, { b: 3, x: 0.5, y: 0.52 }, 800, 400)).toBe(true); // 8px in a tall block
  });

  test("reads peers' pointers defensively", () => {
    expect(parsePointer({ b: 2, x: 0.5, y: 0.1 })).toEqual({ b: 2, x: 0.5, y: 0.1 });
    expect(parsePointer({ b: 2, x: 9, y: -9 })).toEqual({ b: 2, x: 1.5, y: -5 });
    for (const bad of [null, undefined, "x", [], { b: -1, x: 0, y: 0 }, { b: 0.5, x: 0, y: 0 }, { b: 1, x: NaN, y: 0 }, { b: 1, x: 0 }, { b: 1e9, x: 0, y: 0 }]) {
      expect(parsePointer(bad)).toBe(null);
    }
  });

  test("lists other people's pointers, never my own tabs", () => {
    const states = new Map([
      [1, { user: { id: 7, name: "Me", color: "#111111" }, pointer: { b: 0, x: 0.1, y: 0.1 } }],
      [2, { user: { id: 7, name: "Me (tab 2)", color: "#111111" }, pointer: { b: 0, x: 0.2, y: 0.2 } }],
      [5, { user: { id: 9, name: "Bo", color: "#22aa33" }, pointer: { b: 1, x: 0.3, y: 0.3 } }],
      [4, { user: { id: 8, name: "Al", color: "red; background:url(x)" }, pointer: { b: 2, x: 0.4, y: 0.4 } }],
      [6, { user: { id: 10, name: "No pointer", color: "#000" } }],
      [7, { pointer: { b: 0, x: 0, y: 0 } }],
    ]);
    const list = remotePointers(states, 1, 7);
    expect(list.map((p) => p.clientId)).toEqual([4, 5]);
    expect(list[0].color).toBe("#64748b"); // unsafe colour replaced
    expect(list[1]).toEqual({ clientId: 5, userId: 9, name: "Bo", color: "#22aa33", pointer: { b: 1, x: 0.3, y: 0.3 } });
  });
});

describe("block focus", () => {
  test("lists the blocks other people are working in", () => {
    const states = new Map([
      [1, { user: { id: 7, name: "Me", color: "#111111" }, block: { b: 2 } }],
      [3, { user: { id: 9, name: "Lea", color: "#22aa33" }, block: { b: 4 } }],
      [4, { user: { id: 10, name: "Sam", color: "#3355ff" }, block: { b: -2 } }],
      [5, { user: { id: 11, name: "Yuki", color: "#3355ff" } }],
    ]);
    expect(remoteBlocks(states, 1, 7)).toEqual([{ clientId: 3, userId: 9, name: "Lea", color: "#22aa33", b: 4 }]);
    expect(parseBlockFocus({ b: 0 })).toEqual({ b: 0 });
    for (const bad of [null, { b: 1.5 }, { b: "1" }, { b: 1e9 }, []]) expect(parseBlockFocus(bad)).toBe(null);
  });
});

describe("presence batching", () => {
  function harness() {
    let now = 0;
    const sent = [];
    const timers = [];
    const batcher = createPresenceBatcher(
      (patch) => sent.push([now, patch]),
      { pointer: POINTER_INTERVAL_MS, cursor: CARET_INTERVAL_MS },
      () => now,
      (fn, ms) => {
        const t = { fn, at: now + ms, live: true };
        timers.push(t);
        return t;
      },
      (t) => {
        t.live = false;
      },
    );
    const advance = (to) => {
      now = to;
      for (const t of timers) {
        if (t.live && t.at <= now) {
          t.live = false;
          t.fn();
        }
      }
    };
    return { batcher, sent, advance, timers, setNow: (t) => (now = t) };
  }

  test("a moving mouse sends at most ~15 updates a second, the latest position last", () => {
    const { batcher, sent, advance } = harness();
    // 120 Hz mouse for one second
    for (let t = 0; t <= 1000; t += 8) {
      advance(t);
      batcher.set("pointer", { b: 0, x: t / 1000, y: 0 });
    }
    advance(2000);
    expect(sent.length).toBeLessThanOrEqual(Math.ceil(1000 / POINTER_INTERVAL_MS) + 1);
    expect(sent.length).toBeGreaterThanOrEqual(14);
    expect(sent.at(-1)[1].pointer.x).toBe(1);
    for (let i = 1; i < sent.length; i++) expect(sent[i][0] - sent[i - 1][0]).toBeGreaterThanOrEqual(POINTER_INTERVAL_MS);
  });

  test("caret and pointer share one message", () => {
    const { batcher, sent, advance } = harness();
    batcher.set("pointer", { b: 0, x: 0, y: 0 }); // immediate
    advance(10);
    batcher.set("cursor", { anchor: 1, head: 1 });
    batcher.set("pointer", { b: 0, x: 0.5, y: 0 });
    advance(66);
    expect(sent).toEqual([
      [0, { pointer: { b: 0, x: 0, y: 0 } }],
      [66, { cursor: { anchor: 1, head: 1 }, pointer: { b: 0, x: 0.5, y: 0 } }],
    ]);
  });

  test("the caret alone keeps its slower pace", () => {
    const { batcher, sent, advance } = harness();
    batcher.set("cursor", "a");
    advance(20);
    batcher.set("cursor", "b");
    advance(66);
    expect(sent.length).toBe(1);
    advance(100);
    expect(sent).toEqual([[0, { cursor: "a" }], [100, { cursor: "b" }]]);
  });

  test("clearing goes out at once and nothing is left pending", () => {
    const { batcher, sent, advance } = harness();
    batcher.set("pointer", { b: 0, x: 0, y: 0 });
    advance(5);
    batcher.set("pointer", { b: 0, x: 0.3, y: 0 });
    batcher.set("pointer", null, true);
    expect(sent.at(-1)).toEqual([5, { pointer: null }]);
    advance(500);
    expect(sent.length).toBe(2);
  });

  test("cancel drops pending fields", () => {
    const { batcher, sent, advance } = harness();
    batcher.set("pointer", 1);
    batcher.set("pointer", 2);
    batcher.cancel();
    advance(1000);
    expect(sent).toEqual([[0, { pointer: 1 }]]);
  });
});

describe("pointer motion", () => {
  test("the spring settles on the target without overshooting far", () => {
    const s = { x: 0, y: 0, vx: 0, vy: 0 };
    let maxX = 0;
    let frames = 0;
    while (stepSpring(s, 100, 50, 1 / 60) && frames < 600) {
      maxX = Math.max(maxX, s.x);
      frames++;
    }
    expect(s).toEqual({ x: 100, y: 50, vx: 0, vy: 0 });
    expect(maxX).toBeLessThanOrEqual(100.5);
    expect(frames).toBeLessThan(60); // under a second
  });

  test("a long gap (background tab) jumps straight there", () => {
    const s = { x: 0, y: 0, vx: 3, vy: 3 };
    expect(stepSpring(s, 10, 20, 1)).toBe(false);
    expect(s).toEqual({ x: 10, y: 20, vx: 0, vy: 0 });
  });
});
