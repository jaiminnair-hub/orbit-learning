import { describe, expect, it } from "vitest";
import { applyPatch, JsonPatchError, parsePatchBody, parsePointer } from "@/lib/authoring/json-patch";

describe("parsePointer", () => {
  it("returns no tokens for the whole-document pointer", () => {
    expect(parsePointer("")).toEqual([]);
  });

  it("splits a path into tokens", () => {
    expect(parsePointer("/sections/0/pages/1/blocks")).toEqual(["sections", "0", "pages", "1", "blocks"]);
  });

  it("unescapes ~1 as / and ~0 as ~, in that order", () => {
    expect(parsePointer("/a~1b")).toEqual(["a/b"]);
    expect(parsePointer("/a~0b")).toEqual(["a~b"]);
    // ~01 must decode to ~1 (a literal), not to / — the ordering is the trap.
    expect(parsePointer("/a~01b")).toEqual(["a~1b"]);
  });

  it("rejects a pointer that does not start with /", () => {
    expect(() => parsePointer("sections/0")).toThrow(JsonPatchError);
  });
});

describe("applyPatch", () => {
  const doc = () => ({
    meta: { title: "Original" },
    sections: [{ id: "s1", pages: [{ id: "p1", blocks: [{ id: "b1" }, { id: "b2" }, { id: "b3" }] }] }],
  });

  it("does not mutate the input document", () => {
    const original = doc();
    applyPatch(original, [{ op: "replace", path: "/meta/title", value: "Changed" }]);
    expect(original.meta.title).toBe("Original");
  });

  it("replaces a scalar field", () => {
    const out = applyPatch(doc(), [{ op: "replace", path: "/meta/title", value: "Changed" }]);
    expect(out.meta.title).toBe("Changed");
  });

  it("adds a block at an index, shifting the rest", () => {
    const out = applyPatch(doc(), [{ op: "add", path: "/sections/0/pages/0/blocks/1", value: { id: "new" } }]);
    expect(out.sections[0].pages[0].blocks.map((b) => b.id)).toEqual(["b1", "new", "b2", "b3"]);
  });

  it("appends with the '-' token", () => {
    const out = applyPatch(doc(), [{ op: "add", path: "/sections/0/pages/0/blocks/-", value: { id: "last" } }]);
    expect(out.sections[0].pages[0].blocks.map((b) => b.id)).toEqual(["b1", "b2", "b3", "last"]);
  });

  it("removes a block", () => {
    const out = applyPatch(doc(), [{ op: "remove", path: "/sections/0/pages/0/blocks/1" }]);
    expect(out.sections[0].pages[0].blocks.map((b) => b.id)).toEqual(["b1", "b3"]);
  });

  it("moves a block later in the same array — the reorder gesture", () => {
    const out = applyPatch(doc(), [
      { op: "move", from: "/sections/0/pages/0/blocks/0", path: "/sections/0/pages/0/blocks/2" },
    ]);
    expect(out.sections[0].pages[0].blocks.map((b) => b.id)).toEqual(["b2", "b3", "b1"]);
  });

  it("moves a block earlier", () => {
    const out = applyPatch(doc(), [
      { op: "move", from: "/sections/0/pages/0/blocks/2", path: "/sections/0/pages/0/blocks/0" },
    ]);
    expect(out.sections[0].pages[0].blocks.map((b) => b.id)).toEqual(["b3", "b1", "b2"]);
  });

  it("applies several operations in order", () => {
    const out = applyPatch(doc(), [
      { op: "replace", path: "/meta/title", value: "Two" },
      { op: "remove", path: "/sections/0/pages/0/blocks/0" },
      { op: "add", path: "/sections/0/pages/0/blocks/-", value: { id: "z" } },
    ]);
    expect(out.meta.title).toBe("Two");
    expect(out.sections[0].pages[0].blocks.map((b) => b.id)).toEqual(["b2", "b3", "z"]);
  });

  it("reports which operation failed, by index", () => {
    expect(() =>
      applyPatch(doc(), [
        { op: "replace", path: "/meta/title", value: "ok" },
        { op: "remove", path: "/sections/9/pages/0" },
      ])
    ).toThrow(/operation 1 \(remove\)/i);
  });

  it("refuses replace on a key that does not exist", () => {
    expect(() => applyPatch(doc(), [{ op: "replace", path: "/meta/subtitle", value: "x" }])).toThrow(JsonPatchError);
  });

  it("refuses an out-of-bounds array index", () => {
    expect(() => applyPatch(doc(), [{ op: "remove", path: "/sections/0/pages/0/blocks/9" }])).toThrow(JsonPatchError);
  });

  it("refuses moving a node into its own descendant", () => {
    expect(() => applyPatch(doc(), [{ op: "move", from: "/sections/0", path: "/sections/0/pages/0" }])).toThrow(
      /descendant/i
    );
  });

  it("refuses an operation on the whole document", () => {
    expect(() => applyPatch(doc(), [{ op: "replace", path: "", value: {} }])).toThrow(JsonPatchError);
  });
});

describe("parsePatchBody", () => {
  it("accepts the four supported operations", () => {
    const ops = parsePatchBody([
      { op: "add", path: "/a", value: 1 },
      { op: "remove", path: "/a" },
      { op: "replace", path: "/a", value: 2 },
      { op: "move", from: "/a", path: "/b" },
    ]);
    expect(ops).toHaveLength(4);
  });

  it("rejects a body that is not an array", () => {
    expect(() => parsePatchBody({ op: "add" })).toThrow(JsonPatchError);
  });

  it("rejects unsupported operations rather than ignoring them", () => {
    expect(() => parsePatchBody([{ op: "test", path: "/a", value: 1 }])).toThrow(/unsupported op/i);
    expect(() => parsePatchBody([{ op: "copy", from: "/a", path: "/b" }])).toThrow(/unsupported op/i);
  });

  it("rejects a move without a from", () => {
    expect(() => parsePatchBody([{ op: "move", path: "/b" }])).toThrow(/'from'/);
  });

  it("caps how many operations one patch may carry", () => {
    const many = Array.from({ length: 501 }, () => ({ op: "remove", path: "/a" }));
    expect(() => parsePatchBody(many)).toThrow(/at most 500/);
  });
});

// Security-audit finding (2026-09-16, Critical): `doc["__proto__"]` returns
// the real, shared Object.prototype, not a copy — walking into it and
// writing through it pollutes every plain object in the process, not just
// the patched document.
describe("applyPatch — prototype pollution", () => {
  it("refuses to add through a top-level __proto__ segment", () => {
    const before = ({} as Record<string, unknown>).polluted;
    expect(() =>
      applyPatch({ meta: { title: "x" } }, [{ op: "add", path: "/__proto__/polluted", value: "pwned" }])
    ).toThrow(JsonPatchError);
    expect(({} as Record<string, unknown>).polluted).toBe(before);
  });

  it("refuses to add through a nested __proto__ segment", () => {
    expect(() =>
      applyPatch({ meta: { title: "x" } }, [{ op: "add", path: "/meta/__proto__/polluted", value: "pwned" }])
    ).toThrow(JsonPatchError);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("refuses replace/remove through __proto__ as well", () => {
    expect(() =>
      applyPatch({ meta: { title: "x" } }, [{ op: "replace", path: "/__proto__/toString", value: "pwned" }])
    ).toThrow(JsonPatchError);
    expect(() =>
      applyPatch({ meta: { title: "x" } }, [{ op: "remove", path: "/__proto__/toString" }])
    ).toThrow(JsonPatchError);
  });

  it("refuses constructor/prototype segments defensively", () => {
    expect(() =>
      applyPatch({ meta: { title: "x" } }, [{ op: "add", path: "/meta/constructor/prototype/polluted", value: 1 }])
    ).toThrow(JsonPatchError);
  });

  it("still allows a legitimate key that merely contains the word proto", () => {
    const out = applyPatch({ meta: { title: "x" } }, [
      { op: "add", path: "/meta/protocol", value: "https" },
    ]);
    expect((out.meta as Record<string, unknown>).protocol).toBe("https");
  });
});
