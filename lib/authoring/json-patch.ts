/**
 * A deliberately small RFC 6902 subset: `add`, `remove`, `replace`, `move`.
 *
 * Why a subset rather than a dependency: those four are exactly what a block
 * editor produces — insert a block, delete a block, edit a field, reorder —
 * and every one of them is applied to a document that is then re-validated
 * against the CourseSpec schema before it is allowed anywhere near the
 * database. `test` and `copy` have no editor gesture behind them, so
 * supporting them would be surface area with no caller.
 *
 * Applying a patch never mutates its input (docs/PHASE3_API_EVENTS.md §1
 * requires validate-then-write, which means the candidate document has to
 * exist separately from the stored one before anything is committed).
 */

export type JsonPatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: unknown }
  | { op: "move"; from: string; path: string };

export class JsonPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonPatchError";
  }
}

/** RFC 6901 pointer -> tokens, unescaping `~1` (/) and `~0` (~) in that order. */
export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new JsonPatchError(`JSON Pointer '${pointer}' must be empty or start with '/'.`);
  }
  return pointer
    .slice(1)
    .split("/")
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
}

type Container = Record<string, unknown> | unknown[];

function isContainer(value: unknown): value is Container {
  return typeof value === "object" && value !== null;
}

// `__proto__` as an object key is not a property lookup, it's the accessor
// inherited from Object.prototype — `doc["__proto__"]` returns the real,
// shared Object.prototype, and assigning through it pollutes every object
// in the process, not just `doc`. `constructor`/`prototype` are blocked
// defensively alongside it: today they're incidentally stopped by
// isContainer() rejecting functions, but that's a side effect of that
// check's own purpose, not a guarantee, so this denylist doesn't rely on it.
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function assertSafeKey(key: string, pointer: string): void {
  if (UNSAFE_KEYS.has(key)) {
    throw new JsonPatchError(`Path '${pointer}' uses the disallowed key '${key}'.`);
  }
}

/** Structural clone deep enough to copy-on-write the path being edited. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Walks to the parent of `tokens`, returning it plus the final key. */
function resolveParent(doc: unknown, tokens: string[], pointer: string): { parent: Container; key: string } {
  if (tokens.length === 0) {
    throw new JsonPatchError(`Operation on the whole document ('${pointer}') is not supported; replace the spec instead.`);
  }
  let current: unknown = doc;
  for (const token of tokens.slice(0, -1)) {
    if (!isContainer(current)) {
      throw new JsonPatchError(`Path '${pointer}' does not exist: '${token}' has no parent object or array.`);
    }
    if (Array.isArray(current)) {
      current = current[arrayIndex(token, current.length, pointer, false)];
    } else {
      assertSafeKey(token, pointer);
      current = current[token];
    }
  }
  if (!isContainer(current)) {
    throw new JsonPatchError(`Path '${pointer}' does not exist.`);
  }
  const key = tokens[tokens.length - 1];
  if (!Array.isArray(current)) assertSafeKey(key, pointer);
  return { parent: current, key };
}

function arrayIndex(token: string, length: number, pointer: string, allowAppend: boolean): number {
  if (token === "-") {
    if (!allowAppend) throw new JsonPatchError(`'-' is only valid when appending, not in '${pointer}'.`);
    return length;
  }
  if (!/^(0|[1-9][0-9]*)$/.test(token)) {
    throw new JsonPatchError(`Array index '${token}' in '${pointer}' is not a non-negative integer.`);
  }
  const index = Number(token);
  const limit = allowAppend ? length : length - 1;
  if (index > limit) {
    throw new JsonPatchError(`Array index ${index} in '${pointer}' is out of bounds.`);
  }
  return index;
}

function getAt(doc: unknown, pointer: string): unknown {
  const tokens = parsePointer(pointer);
  let current: unknown = doc;
  for (const token of tokens) {
    if (!isContainer(current)) {
      throw new JsonPatchError(`Path '${pointer}' does not exist.`);
    }
    if (Array.isArray(current)) {
      current = current[arrayIndex(token, current.length, pointer, false)];
    } else {
      assertSafeKey(token, pointer);
      if (!(token in current)) throw new JsonPatchError(`Path '${pointer}' does not exist.`);
      current = current[token];
    }
  }
  return current;
}

function applyOne(doc: unknown, op: JsonPatchOp): unknown {
  switch (op.op) {
    case "add": {
      const { parent, key } = resolveParent(doc, parsePointer(op.path), op.path);
      if (Array.isArray(parent)) parent.splice(arrayIndex(key, parent.length, op.path, true), 0, op.value);
      else parent[key] = op.value;
      return doc;
    }
    case "remove": {
      const { parent, key } = resolveParent(doc, parsePointer(op.path), op.path);
      if (Array.isArray(parent)) parent.splice(arrayIndex(key, parent.length, op.path, false), 1);
      else {
        if (!(key in parent)) throw new JsonPatchError(`Path '${op.path}' does not exist.`);
        delete parent[key];
      }
      return doc;
    }
    case "replace": {
      const { parent, key } = resolveParent(doc, parsePointer(op.path), op.path);
      if (Array.isArray(parent)) parent[arrayIndex(key, parent.length, op.path, false)] = op.value;
      else {
        if (!(key in parent)) throw new JsonPatchError(`Path '${op.path}' does not exist; use 'add' to create it.`);
        parent[key] = op.value;
      }
      return doc;
    }
    case "move": {
      if (op.path === op.from) return doc;
      if (op.path.startsWith(`${op.from}/`)) {
        throw new JsonPatchError(`Cannot move '${op.from}' into its own descendant '${op.path}'.`);
      }
      const value = clone(getAt(doc, op.from));
      const afterRemove = applyOne(doc, { op: "remove", path: op.from });
      return applyOne(afterRemove, { op: "add", path: op.path, value });
    }
    default: {
      const unknownOp = (op as { op?: unknown }).op;
      throw new JsonPatchError(`Unsupported operation '${String(unknownOp)}'. Supported: add, remove, replace, move.`);
    }
  }
}

/** Applies every operation in order to a copy of `doc`. Throws on the first failure. */
export function applyPatch<T>(doc: T, ops: JsonPatchOp[]): T {
  let next: unknown = clone(doc);
  for (const [i, op] of ops.entries()) {
    try {
      next = applyOne(next, op);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new JsonPatchError(`Patch operation ${i} (${op.op}) failed: ${reason}`);
    }
  }
  return next as T;
}

/** Shape-checks an untrusted patch body before it is applied. */
export function parsePatchBody(candidate: unknown): JsonPatchOp[] {
  if (!Array.isArray(candidate)) {
    throw new JsonPatchError("A JSON-Patch body must be an array of operations.");
  }
  if (candidate.length > 500) {
    throw new JsonPatchError("A single patch may contain at most 500 operations.");
  }
  return candidate.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) {
      throw new JsonPatchError(`Operation ${i} is not an object.`);
    }
    const { op, path, from, value } = raw as Record<string, unknown>;
    if (typeof path !== "string") throw new JsonPatchError(`Operation ${i} needs a string 'path'.`);
    switch (op) {
      case "add":
      case "replace":
        return { op, path, value } as JsonPatchOp;
      case "remove":
        return { op, path } as JsonPatchOp;
      case "move":
        if (typeof from !== "string") throw new JsonPatchError(`Operation ${i} ('move') needs a string 'from'.`);
        return { op, path, from } as JsonPatchOp;
      default:
        throw new JsonPatchError(`Operation ${i} has unsupported op '${String(op)}'.`);
    }
  });
}
