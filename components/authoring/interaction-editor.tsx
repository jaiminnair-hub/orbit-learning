"use client";

import type { CourseSpecType as CourseSpec, PageType as Page } from "@/lib/spec";
import type { Action, Trigger, Variable } from "@/lib/spec";
import { specId } from "@/lib/authoring/block-factory";
import { CheckboxField, Field, SelectField, TextField, fieldStyle, labelStyle } from "./fields";
import { boxStyle as rowBox, dangerButtonStyle as removeBtn, dangerColor, mutedTextStyle } from "./theme";

/**
 * The Storyline half of the editor: variables, triggers and conditions.
 *
 * Every control here is populated from what the specification actually
 * contains — you pick a block from the blocks on this page, a variable from
 * the declared variables. There is no free-text id field anywhere, which is
 * what makes it structurally hard to author a dangling reference that
 * validate.ts would then reject.
 */

const TRIGGER_EVENTS = [
  "pageEnter",
  "pageExit",
  "click",
  "doubleClick",
  "hover",
  "hoverOut",
  "focus",
  "blur",
  "mediaComplete",
  "mediaStart",
  "timelineCue",
  "timelineComplete",
  "blockComplete",
  "answerSubmitted",
  "layerShown",
  "layerHidden",
  "variableChange",
] as const;

const ACTION_KINDS = [
  "setVariable",
  "showBlock",
  "hideBlock",
  "showLayer",
  "hideLayer",
  "setState",
  "navigate",
  "playTimeline",
  "pauseTimeline",
  "markComplete",
  "emitStatement",
] as const;

const OPERATORS = [
  "equals",
  "notEquals",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "contains",
  "startsWith",
  "isEmpty",
  "isNotEmpty",
] as const;

interface PageTargets {
  blocks: { id: string; label: string }[];
  layers: { id: string; label: string }[];
  pages: { id: string; label: string }[];
  cuePoints: { id: string; label: string }[];
}

export function pageTargets(spec: CourseSpec, page: Page): PageTargets {
  const blocks: PageTargets["blocks"] = [];
  const layers: PageTargets["layers"] = [];
  for (const block of page.blocks) {
    blocks.push({ id: block.id, label: `${block.type} · ${block.id}` });
    for (const layer of block.layers ?? []) {
      layers.push({ id: layer.id, label: layer.name ?? layer.id });
      for (const lb of layer.blocks) blocks.push({ id: lb.id, label: `${lb.type} · ${lb.id} (layer)` });
    }
  }
  const pages = spec.sections.flatMap((s) => s.pages.map((p) => ({ id: p.id, label: p.title })));
  const cuePoints = (page.timeline?.cuePoints ?? []).map((c) => ({
    id: c.id,
    label: c.name ? `${c.name} (${(c.atMs / 1000).toFixed(1)}s)` : `${(c.atMs / 1000).toFixed(1)}s`,
  }));
  return { blocks, layers, pages, cuePoints };
}

// ------------------------------------------------------------- variables

export function VariablesEditor({
  variables,
  onChange,
}: {
  variables: Variable[];
  onChange: (next: Variable[]) => void;
}) {
  return (
    <div>
      <h4 style={{ margin: "0 0 8px", fontSize: ".85rem" }}>Variables</h4>
      {variables.length === 0 && <p style={{ ...mutedTextStyle, fontSize: ".8rem" }}>No variables yet.</p>}
      {variables.map((v, i) => (
        <div key={v.id} style={rowBox}>
          <TextField label="Name" value={v.name} onChange={(name) => onChange(replaceAt(variables, i, { ...v, name }))} />
          <SelectField
            label="Type"
            value={v.type}
            options={["number", "text", "boolean"] as const}
            onChange={(type) =>
              onChange(
                replaceAt(variables, i, {
                  ...v,
                  type,
                  // The initial value has to match the declared type or
                  // validate.ts flags VARIABLE_INITIAL_TYPE.
                  initial: type === "number" ? 0 : type === "boolean" ? false : "",
                })
              )
            }
          />
          <Field label="Starts as">
            {v.type === "boolean" ? (
              <select
                style={fieldStyle}
                value={String(v.initial ?? false)}
                onChange={(e) => onChange(replaceAt(variables, i, { ...v, initial: e.target.value === "true" }))}
              >
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            ) : (
              <input
                style={fieldStyle}
                type={v.type === "number" ? "number" : "text"}
                value={String(v.initial ?? "")}
                onChange={(e) =>
                  onChange(replaceAt(variables, i, { ...v, initial: v.type === "number" ? Number(e.target.value) : e.target.value }))
                }
              />
            )}
          </Field>
          <button type="button" style={removeBtn} onClick={() => onChange(removeAt(variables, i))}>
            Remove variable
          </button>
        </div>
      ))}
      <button
        type="button"
        style={{ fontSize: ".75rem", marginTop: 8 }}
        onClick={() => onChange([...variables, { id: specId("var"), name: "New variable", type: "number", scope: "course", initial: 0 }])}
      >
        + Variable
      </button>
    </div>
  );
}

// -------------------------------------------------------------- triggers

export function TriggersEditor({
  triggers,
  targets,
  variables,
  onChange,
  scopeLabel,
}: {
  triggers: Trigger[];
  targets: PageTargets;
  variables: Variable[];
  onChange: (next: Trigger[]) => void;
  scopeLabel: string;
}) {
  return (
    <div>
      <h4 style={{ margin: "12px 0 8px", fontSize: ".85rem" }}>Triggers ({scopeLabel})</h4>
      {triggers.length === 0 && <p style={{ ...mutedTextStyle, fontSize: ".8rem" }}>No triggers yet.</p>}

      {triggers.map((trigger, i) => (
        <div key={trigger.id} style={rowBox}>
          <SelectField
            label="When"
            value={trigger.when}
            options={TRIGGER_EVENTS}
            onChange={(when) => onChange(replaceAt(triggers, i, { ...trigger, when }))}
          />

          <Field label="On">
            <select
              style={fieldStyle}
              value={trigger.onId ?? ""}
              onChange={(e) => onChange(replaceAt(triggers, i, { ...trigger, onId: e.target.value || undefined }))}
            >
              {trigger.when === "timelineCue" ? (
                <>
                  {targets.cuePoints.length === 0 && <option value="">(no cue points on this page&apos;s timeline)</option>}
                  {targets.cuePoints.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </>
              ) : (
                <>
                  <option value="">(this page)</option>
                  {targets.blocks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                  {targets.layers.map((l) => (
                    <option key={l.id} value={l.id}>
                      layer · {l.label}
                    </option>
                  ))}
                </>
              )}
            </select>
          </Field>

          <span style={labelStyle}>Do</span>
          {trigger.actions.map((action, ai) => (
            <ActionEditor
              key={ai}
              action={action}
              targets={targets}
              variables={variables}
              onChange={(next) => onChange(replaceAt(triggers, i, { ...trigger, actions: replaceAt(trigger.actions, ai, next) }))}
              onRemove={
                trigger.actions.length > 1
                  ? () => onChange(replaceAt(triggers, i, { ...trigger, actions: removeAt(trigger.actions, ai) }))
                  : undefined
              }
            />
          ))}
          <button
            type="button"
            style={{ fontSize: ".75rem", marginTop: 6 }}
            onClick={() => onChange(replaceAt(triggers, i, { ...trigger, actions: [...trigger.actions, defaultAction(targets)] }))}
          >
            + Action
          </button>

          <ConditionEditor
            condition={trigger.condition}
            variables={variables}
            targets={targets}
            onChange={(condition) => onChange(replaceAt(triggers, i, { ...trigger, condition }))}
          />

          <CheckboxField
            label="Only once per session"
            checked={trigger.once ?? false}
            onChange={(once) => onChange(replaceAt(triggers, i, { ...trigger, once: once || undefined }))}
          />

          <button type="button" style={removeBtn} onClick={() => onChange(removeAt(triggers, i))}>
            Remove trigger
          </button>
        </div>
      ))}

      <button
        type="button"
        style={{ fontSize: ".75rem", marginTop: 8 }}
        onClick={() =>
          onChange([...triggers, { id: specId("trig"), when: "pageEnter", actions: [defaultAction(targets)] }])
        }
      >
        + Trigger
      </button>
    </div>
  );
}

function defaultAction(targets: PageTargets): Action {
  const first = targets.blocks[0]?.id;
  return first ? { kind: "showBlock", blockId: first } : { kind: "navigate", target: { kind: "next" } };
}

function ActionEditor({
  action,
  targets,
  variables,
  onChange,
  onRemove,
}: {
  action: Action;
  targets: PageTargets;
  variables: Variable[];
  onChange: (a: Action) => void;
  onRemove?: () => void;
}) {
  return (
    <div style={{ ...rowBox, background: "var(--color-muted)", marginTop: 6 }}>
      <Field label="Action">
        <select style={fieldStyle} value={action.kind} onChange={(e) => onChange(convertAction(e.target.value, targets, variables))}>
          {ACTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </Field>

      {(action.kind === "showBlock" || action.kind === "hideBlock") && (
        <Field label="Block">
          <select style={fieldStyle} value={action.blockId} onChange={(e) => onChange({ ...action, blockId: e.target.value })}>
            {targets.blocks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {(action.kind === "showLayer" || action.kind === "hideLayer") && (
        <Field label="Layer">
          <select style={fieldStyle} value={action.layerId} onChange={(e) => onChange({ ...action, layerId: e.target.value })}>
            {targets.layers.length === 0 && <option value="">(no layers on this page)</option>}
            {targets.layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {action.kind === "setVariable" && (
        <>
          <Field label="Variable">
            <select style={fieldStyle} value={action.variableId} onChange={(e) => onChange({ ...action, variableId: e.target.value })}>
              {variables.length === 0 && <option value="">(no variables declared)</option>}
              {variables.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <SelectField
            label="Operation"
            value={action.operation}
            options={["set", "add", "subtract", "multiply", "divide", "toggle", "append"] as const}
            onChange={(operation) => onChange({ ...action, operation })}
          />
          {action.operation !== "toggle" && (
            <TextField
              label="Value"
              value={String(action.value ?? "")}
              onChange={(v) => {
                const variable = variables.find((x) => x.id === action.variableId);
                const typed = variable?.type === "number" ? Number(v) : variable?.type === "boolean" ? v === "true" : v;
                onChange({ ...action, value: typed });
              }}
            />
          )}
        </>
      )}

      {action.kind === "setState" && (
        <Field label="Block">
          <select style={fieldStyle} value={action.blockId} onChange={(e) => onChange({ ...action, blockId: e.target.value })}>
            {targets.blocks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {action.kind === "navigate" && (
        <Field label="Go to">
          <select
            style={fieldStyle}
            value={action.target.kind === "page" ? `page:${action.target.pageId}` : action.target.kind}
            onChange={(e) => {
              const v = e.target.value;
              onChange({
                ...action,
                target: v.startsWith("page:")
                  ? { kind: "page", pageId: v.slice(5) }
                  : ({ kind: v } as Extract<Action, { kind: "navigate" }>["target"]),
              });
            }}
          >
            <option value="next">Next page</option>
            <option value="previous">Previous page</option>
            <option value="firstPage">First page</option>
            <option value="exit">Exit course</option>
            {targets.pages.map((p) => (
              <option key={p.id} value={`page:${p.id}`}>
                Page: {p.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {action.kind === "emitStatement" && (
        <SelectField
          label="Verb"
          value={action.verb}
          options={["experienced", "interacted", "answered", "completed", "passed", "failed", "progressed"] as const}
          onChange={(verb) => onChange({ ...action, verb })}
        />
      )}

      {onRemove && (
        <button type="button" style={removeBtn} onClick={onRemove}>
          Remove action
        </button>
      )}
    </div>
  );
}

function convertAction(kind: string, targets: PageTargets, variables: Variable[]): Action {
  const firstBlock = targets.blocks[0]?.id ?? "";
  const firstLayer = targets.layers[0]?.id ?? "";
  const firstVar = variables[0]?.id ?? "";
  switch (kind) {
    case "hideBlock":
      return { kind: "hideBlock", blockId: firstBlock };
    case "showLayer":
      return { kind: "showLayer", layerId: firstLayer };
    case "hideLayer":
      return { kind: "hideLayer", layerId: firstLayer };
    case "setVariable":
      return { kind: "setVariable", variableId: firstVar, operation: "add", value: 1 };
    case "setState":
      return { kind: "setState", blockId: firstBlock, stateId: "" };
    case "navigate":
      return { kind: "navigate", target: { kind: "next" } };
    case "playTimeline":
      return { kind: "playTimeline" };
    case "pauseTimeline":
      return { kind: "pauseTimeline" };
    case "markComplete":
      return { kind: "markComplete" };
    case "emitStatement":
      return { kind: "emitStatement", verb: "interacted" };
    default:
      return { kind: "showBlock", blockId: firstBlock };
  }
}

function ConditionEditor({
  condition,
  variables,
  targets,
  onChange,
}: {
  condition: Trigger["condition"];
  variables: Variable[];
  targets: PageTargets;
  onChange: (c: Trigger["condition"]) => void;
}) {
  const all = condition?.all ?? [];
  return (
    <div style={{ marginTop: 8 }}>
      <span style={labelStyle}>Only if (all must be true)</span>
      {all.map((c, i) => (
        <div key={i} style={{ display: "flex", gap: 4, marginTop: 4, alignItems: "center" }}>
          {c.kind === "variable" ? (
            <>
              <select
                style={{ ...fieldStyle, flex: 2 }}
                value={c.variableId}
                onChange={(e) => onChange({ ...condition, all: replaceAt(all, i, { ...c, variableId: e.target.value }) })}
              >
                {variables.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <select
                style={{ ...fieldStyle, flex: 2 }}
                value={c.operator}
                onChange={(e) => onChange({ ...condition, all: replaceAt(all, i, { ...c, operator: e.target.value as (typeof OPERATORS)[number] }) })}
              >
                {OPERATORS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <input
                style={{ ...fieldStyle, flex: 1 }}
                value={String(c.value ?? "")}
                onChange={(e) => {
                  const variable = variables.find((x) => x.id === c.variableId);
                  const typed = variable?.type === "number" ? Number(e.target.value) : variable?.type === "boolean" ? e.target.value === "true" : e.target.value;
                  onChange({ ...condition, all: replaceAt(all, i, { ...c, value: typed }) });
                }}
              />
            </>
          ) : (
            <select
              style={{ ...fieldStyle, flex: 5 }}
              value={"blockId" in c ? c.blockId : ""}
              onChange={(e) => onChange({ ...condition, all: replaceAt(all, i, { ...c, blockId: e.target.value } as typeof c) })}
            >
              {targets.blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          )}
          <button type="button" style={{ color: dangerColor, fontSize: ".75rem" }} onClick={() => onChange(nextCondition(condition, removeAt(all, i)))}>
            ✕
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button
          type="button"
          style={{ fontSize: ".75rem" }}
          disabled={variables.length === 0}
          title={variables.length === 0 ? "Declare a variable first" : undefined}
          onClick={() =>
            onChange({ ...condition, all: [...all, { kind: "variable", variableId: variables[0].id, operator: "equals", value: variables[0].type === "number" ? 0 : "" }] })
          }
        >
          + Variable check
        </button>
        <button
          type="button"
          style={{ fontSize: ".75rem" }}
          disabled={targets.blocks.length === 0}
          onClick={() => onChange({ ...condition, all: [...all, { kind: "blockCompleted", blockId: targets.blocks[0].id }] })}
        >
          + Block completed
        </button>
      </div>
    </div>
  );
}

/** Drops the condition entirely when its last comparison goes, rather than leaving `{ all: [] }`. */
function nextCondition(condition: Trigger["condition"], all: NonNullable<Trigger["condition"]>["all"]): Trigger["condition"] {
  if (!all || all.length === 0) {
    const rest = { ...condition, all: undefined };
    return rest.any?.length || rest.none?.length ? rest : undefined;
  }
  return { ...condition, all };
}

function replaceAt<T>(arr: T[], index: number, value: T): T[] {
  const next = [...arr];
  next[index] = value;
  return next;
}

function removeAt<T>(arr: T[], index: number): T[] {
  return arr.filter((_, i) => i !== index);
}
