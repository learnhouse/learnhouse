import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const domWindow = new Window({ url: "http://localhost/" });
for (const key of [
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Text",
  "DocumentFragment",
  "MutationObserver",
  "Range",
  "Selection",
  "DOMParser",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "CustomEvent",
  "Event",
  "KeyboardEvent",
  "MouseEvent",
  "InputEvent",
  "NodeFilter",
  "DOMException",
]) {
  if (domWindow[key] !== undefined && globalThis[key] === undefined) {
    globalThis[key] = domWindow[key];
  }
}
globalThis.window = domWindow;

const { Editor, Node } = await import("@tiptap/core");
const { default: StarterKit } = await import("@tiptap/starter-kit");
const {
  parseRules,
  stringifyRules,
  describeRules,
  negateRules,
  isFlatGroup,
  RuleSyntaxError,
  VARIABLE_INPUT_REGEX,
} = await import("../components/Objects/Editor/Extensions/Dynamic/dynamicRules.ts");
const { mediaNodeTypes } = await import(
  "../components/Objects/Editor/Templates/templateContent.ts"
);

describe("rule code mode", () => {
  test("parses and / or / not into the JSON tree", () => {
    const rules = parseRules(
      'user.groups contains_any ["usergroup_a", "usergroup_b"] and (progress.percent gte 50 or course.enrolled is_false)'
    );
    expect(rules).toEqual({
      match: "all",
      conditions: [
        { field: "user.groups", op: "contains_any", value: ["usergroup_a", "usergroup_b"] },
        {
          match: "any",
          conditions: [
            { field: "progress.percent", op: "gte", value: 50 },
            { field: "course.enrolled", op: "is_false" },
          ],
        },
      ],
    });
    expect(isFlatGroup(rules)).toBe(false);
  });

  test("flattens chains of the same operator", () => {
    expect(parseRules("user.signed_in is_true and (course.enrolled is_true and progress.percent lt 10)")).toEqual({
      match: "all",
      conditions: [
        { field: "user.signed_in", op: "is_true" },
        { field: "course.enrolled", op: "is_true" },
        { field: "progress.percent", op: "lt", value: 10 },
      ],
    });
  });

  test("not negates the group", () => {
    expect(parseRules('not user.role in ["admin"]')).toEqual({
      match: "all",
      negate: true,
      conditions: [{ field: "user.role", op: "in", value: ["admin"] }],
    });
  });

  test("empty source is everyone", () => {
    expect(parseRules("   ")).toEqual({ match: "all", conditions: [] });
  });

  test.each([
    ["user.password eq 1", /Unknown field/],
    ["progress.percent contains_any [1]", /doesn't apply/],
    ['user.groups contains_any ["a"', /Expected "\]"|Lists hold/],
    ["course.enrolled is_true and", /Expected a field/],
    ['date.today on_or_after "2026', /Unterminated/],
    ["user.role in eval()", /Expected a value/],
  ])("rejects %s", (source, message) => {
    expect(() => parseRules(source)).toThrow(RuleSyntaxError);
    expect(() => parseRules(source)).toThrow(message);
  });

  test("stringify round-trips", () => {
    for (const source of [
      'user.groups contains_any ["usergroup_a"] and progress.percent gte 50',
      "user.signed_in is_true or (course.enrolled is_true and enrollment.days gte 7)",
      'not (user.locale in ["fr", "de"] or date.today between ["2026-01-01", "2026-02-01"])',
      "not ()",
    ]) {
      const parsed = parseRules(source);
      expect(parseRules(stringifyRules(parsed))).toEqual(parsed);
    }
  });
});

describe("rule summaries", () => {
  test("uses group and activity names", () => {
    const rules = {
      match: "any",
      conditions: [
        { field: "user.groups", op: "contains_any", value: ["usergroup_a"] },
        { field: "progress.completed_activities", op: "contains_all", value: ["activity_1"] },
      ],
    };
    expect(
      describeRules(rules, { usergroups: { usergroup_a: "VIP" }, activities: { activity_1: "Intro" } })
    ).toBe("User group is any of VIP or Completed activities is all of Intro");
  });

  test("empty and negated", () => {
    expect(describeRules({ conditions: [] })).toBe("Everyone");
    expect(describeRules(negateRules({ conditions: [{ field: "user.signed_in", op: "is_true" }] }))).toBe(
      "Everyone except: Signed in: yes"
    );
  });
});

describe("variable input", () => {
  test("matches typed placeholders", () => {
    expect("Hello {{ user.first_name }}".match(VARIABLE_INPUT_REGEX)?.[1]).toBe("user.first_name");
    expect("{{x}}".match(VARIABLE_INPUT_REGEX)).toBeNull();
  });
});

describe("templates", () => {
  test("finds uploaded media blocks", () => {
    expect(
      mediaNodeTypes({
        type: "doc",
        content: [{ type: "paragraph" }, { type: "conditionalBlock", content: [{ type: "blockImage" }] }],
      })
    ).toEqual(["blockImage"]);
  });
});

describe("conditional block schema", () => {
  test("round-trips rules through the editor JSON", async () => {
    // The real node view needs React; the schema is what matters here.
    const { default: ConditionalBlock } = await import(
      "../components/Objects/Editor/Extensions/Dynamic/ConditionalBlock.ts"
    );
    const Plain = ConditionalBlock.extend({ addNodeView: () => null });
    const VariableStub = Node.create({
      name: "dynamicVariable",
      group: "inline",
      inline: true,
      atom: true,
      addAttributes: () => ({ path: { default: "user.first_name" }, fallback: { default: "" }, format: { default: null } }),
      parseHTML: () => [{ tag: "dynamic-variable" }],
      renderHTML: () => ["dynamic-variable"],
    });
    const rules = { match: "all", conditions: [{ field: "user.role", op: "in", value: ["admin"] }] };
    const content = {
      type: "doc",
      content: [
        {
          type: "conditionalBlock",
          attrs: { rules, label: "Admins" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Hi " }, { type: "dynamicVariable", attrs: { path: "user.first_name", fallback: "", format: "upper" } }],
            },
          ],
        },
      ],
    };
    const editor = new Editor({ extensions: [StarterKit, Plain, VariableStub], content });
    expect(editor.getJSON()).toEqual(content);

    // HTML (copy/paste) keeps the rules too.
    const html = editor.getHTML();
    const pasted = new Editor({ extensions: [StarterKit, Plain, VariableStub], content: html });
    expect(pasted.getJSON().content[0].attrs).toEqual({ rules, label: "Admins" });
    editor.destroy();
    pasted.destroy();
  });
});
