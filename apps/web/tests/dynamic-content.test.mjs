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
          attrs: { rules, label: "Admins", hiddenMessage: "Later", openRules: null },
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
    expect(pasted.getJSON().content[0].attrs).toEqual({ rules, label: "Admins", hiddenMessage: "Later", openRules: null });
    editor.destroy();
    pasted.destroy();
  });
});

describe("round two", () => {
  test("new fields parse in code mode", () => {
    expect(
      parseRules('user.email_domain in ["acme.com"] and user.bucket lt 50 and course.completed is_false')
    ).toEqual({
      match: "all",
      conditions: [
        { field: "user.email_domain", op: "in", value: ["acme.com"] },
        { field: "user.bucket", op: "lt", value: 50 },
        { field: "course.completed", op: "is_false" },
      ],
    });
  });

  test("template fields are found and filled", async () => {
    const { templateFields, fillTemplateFields } = await import(
      "../components/Objects/Editor/Templates/templateContent.ts"
    );
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hi {{ field.company }}, see {{field.Link}} and {{ user.first_name }}" }] },
        { type: "paragraph", content: [{ type: "text", text: "{{field.company}}" }] },
      ],
    };
    expect(templateFields(doc)).toEqual(["company", "link"]);
    const filled = fillTemplateFields(doc, { company: "Acme" });
    expect(filled.content[0].content[0].text).toBe("Hi Acme, see  and {{ user.first_name }}");
    // An emptied text node is dropped, not left empty.
    expect(fillTemplateFields(doc, {}).content[1].content).toEqual([]);
    expect(doc.content[1].content[0].text).toBe("{{field.company}}");
  });
});

describe("round three", () => {
  test("every preset round-trips through code mode and reads well", async () => {
    const { PRESETS } = await import("../components/Objects/Editor/Extensions/Dynamic/dynamicRules.ts");
    for (const preset of PRESETS) {
      const rules = preset.rules();
      expect(parseRules(stringifyRules(rules))).toEqual(rules);
      expect(describeRules(rules)).not.toBe("Everyone");
    }
  });

  test("group rules describe with group names", () => {
    const rules = parseRules('user.groups contains_any ["usergroup_1"]');
    expect(describeRules(rules, { usergroups: { usergroup_1: "Team Leads" } })).toBe("User group is any of Team Leads");
  });

  test("starter templates are valid editor documents", async () => {
    const { STARTER_TEMPLATES, isStarter } = await import("../components/Objects/Editor/Templates/starterTemplates.ts");
    const { templateFields } = await import("../components/Objects/Editor/Templates/templateContent.ts");
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
    for (const tpl of STARTER_TEMPLATES) {
      expect(isStarter(tpl)).toBe(true);
      const editor = new Editor({ extensions: [StarterKit, Plain, VariableStub], content: tpl.content });
      // The editor fills in the transient openRules attribute; nothing else changes.
      const json = JSON.parse(JSON.stringify(editor.getJSON(), (k, v) => (k === "openRules" && v === null ? undefined : v)));
      expect(json).toEqual(tpl.content);
      editor.destroy();
    }
    expect(templateFields(STARTER_TEMPLATES.find((t) => t.template_uuid === "starter:buddy").content)).toEqual(["buddy_name"]);
  });

  test("insertABTest adds both versions with opposite rules", async () => {
    const { default: ConditionalBlock } = await import(
      "../components/Objects/Editor/Extensions/Dynamic/ConditionalBlock.ts"
    );
    const Plain = ConditionalBlock.extend({ addNodeView: () => null });
    const editor = new Editor({ extensions: [StarterKit, Plain], content: "<p>x</p>" });
    editor.commands.insertABTest();
    const blocks = editor.getJSON().content.filter((n) => n.type === "conditionalBlock");
    expect(blocks.map((b) => b.attrs.label)).toEqual(["Version A", "Version B"]);
    expect(blocks[1].attrs.rules.negate).toBe(true);
    editor.commands.insertConditionalBlock({ label: "L", hiddenMessage: "Later", openRules: true });
    const inserted = editor.getJSON().content.filter((n) => n.type === "conditionalBlock");
    expect(inserted.map((b) => b.attrs.openRules)).toEqual([null, null, true]);
    editor.destroy();
  });

  test("variable autocomplete filters by label and path", async () => {
    const { filterVariables } = await import("../components/Objects/Editor/Extensions/Dynamic/VariableSuggestion.ts");
    expect(filterVariables("").length).toBeGreaterThan(10);
    expect(filterVariables("first").map((v) => v.path)).toContain("user.first_name");
    expect(filterVariables("course.na}}").map((v) => v.path)).toEqual(["course.name"]);
    expect(filterVariables("zzz")).toEqual([]);
  });
});

describe("slash menu order", () => {
  test("filtered items come in the order the menu draws them", async () => {
    const { filterCommands, groupCommandsByCategory } = await import(
      "../components/Objects/Editor/Extensions/SlashCommands/slashCommandsConfig.tsx"
    );
    for (const query of ["", "ab", "group", "t"]) {
      const items = filterCommands(query);
      const drawn = [...groupCommandsByCategory(items).values()].flat();
      expect(items.map((i) => i.id)).toEqual(drawn.map((i) => i.id));
    }
  });
});

describe("round four: variables everywhere", () => {
  test("custom variables join the picker, autocomplete and labels", async () => {
    const { customVariableDef, variableDef, VARIABLES } = await import(
      "../components/Objects/Editor/Extensions/Dynamic/dynamicRules.ts"
    );
    const { filterVariables } = await import("../components/Objects/Editor/Extensions/Dynamic/VariableSuggestion.ts");
    const support = customVariableDef({ key: "support_email", label: "Support email", default_value: "help@acme.com" });
    expect(support).toEqual({
      path: "custom.support_email", label: "Support email", group: "custom", sample: "help@acme.com", description: undefined,
    });
    expect(variableDef("custom.support_email", [support])).toBe(support);
    expect(variableDef("custom.support_email")).toBeUndefined();
    expect(filterVariables("support", [support]).map((v) => v.path)).toEqual(["custom.support_email"]);
    expect(filterVariables("", [support]).length).toBe(VARIABLES.length + 1);
    expect(VARIABLES.map((v) => v.path)).toEqual(expect.arrayContaining(["course.chapter", "course.next_activity"]));
  });

  test("show values toggle is shared", async () => {
    const { setShowVariableValues } = await import(
      "../components/Objects/Editor/Extensions/Dynamic/variableDisplay.ts"
    );
    // The hook reads through useSyncExternalStore; the setter must not throw without subscribers.
    setShowVariableValues(true);
    setShowVariableValues(false);
  });
});

describe("community hashtags", () => {
  test("slugs, plain-text splitting and filtering", async () => {
    const { communitySlug, splitHashtags, filterCommunities } = await import(
      "../components/Objects/Communities/Tags/communityTags.ts"
    );
    const communities = [
      { community_uuid: "community_1", name: "Product Questions" },
      { community_uuid: "community_2", name: "Café Lounge" },
    ];
    expect(communitySlug("Product Questions")).toBe("product-questions");
    expect(communitySlug("Café Lounge!")).toBe("cafe-lounge");

    const parts = splitHashtags("Ask in #product-questions or #cafe-lounge, not #nope or a#b (#Product-Questions)", communities);
    expect(parts.filter((p) => "community" in p).map((p) => p.community.community_uuid)).toEqual([
      "community_1", "community_2", "community_1",
    ]);
    expect(parts.map((p) => ("text" in p ? p.text : p.raw)).join("")).toBe(
      "Ask in #product-questions or #cafe-lounge, not #nope or a#b (#Product-Questions)"
    );
    expect(splitHashtags("no tags here", communities)).toEqual([{ text: "no tags here" }]);
    expect(filterCommunities("prod", communities).map((c) => c.name)).toEqual(["Product Questions"]);
    expect(filterCommunities("", communities).length).toBe(2);
  });

  test("community tag round-trips through editor JSON and HTML", async () => {
    const { CommunityTag } = await import("../components/Objects/Communities/Tags/CommunityTag.ts");
    const Plain = CommunityTag.extend({ addNodeView: () => null });
    const content = {
      type: "doc",
      content: [{ type: "paragraph", content: [
        { type: "text", text: "Ask in " },
        { type: "communityTag", attrs: { communityUuid: "community_abc", name: "Product" } },
      ] }],
    };
    const editor = new Editor({ extensions: [StarterKit, Plain], content });
    expect(editor.getJSON()).toEqual(content);
    expect(editor.getText()).toBe("Ask in #Product");
    const pasted = new Editor({ extensions: [StarterKit, Plain], content: editor.getHTML() });
    expect(pasted.getJSON()).toEqual(content);
    editor.commands.insertCommunityTag({ community_uuid: "community_x", name: "X" });
    expect(editor.getJSON().content[0].content.some((n) => n.attrs?.communityUuid === "community_x")).toBe(true);
    editor.destroy();
    pasted.destroy();
  });
});

describe("community tag safety", () => {
  test("only well-formed community uuids are used", async () => {
    const { isCommunityUuid } = await import("../components/Objects/Communities/Tags/communityTags.ts");
    expect(isCommunityUuid("community_4bdcf7d0-e560-4e11-8f6c-9bab140ec078")).toBe(true);
    for (const bad of ["community_../../users/me", "../orgs/1", "community_a?b=c", "community_a/b", "", null, 3]) {
      expect(isCommunityUuid(bad)).toBe(false);
    }
  });
});

describe("learnhouse-native rules", () => {
  test("certificate, assignment and community rules parse and describe", () => {
    const rules = parseRules(
      'course.certified is_true and assignments.submitted contains_any ["assignment_1"] and community.active_in contains_any ["community_1"] and community.posts gte 2'
    );
    expect(parseRules(stringifyRules(rules))).toEqual(rules);
    const text = describeRules(rules, {
      assignments: { assignment_1: "Final project" },
      communities: { community_1: "Study hall" },
    });
    expect(text).toContain("Final project");
    expect(text).toContain("Study hall");
  });

  test("every field and variable is known to the API", async () => {
    const { FIELDS, VARIABLES } = await import("../components/Objects/Editor/Extensions/Dynamic/dynamicRules.ts");
    const { readFileSync } = await import("node:fs");
    const api = readFileSync(
      new URL("../../api/src/services/courses/activities/dynamic_content.py", import.meta.url),
      "utf8"
    );
    for (const def of FIELDS) expect(api).toContain(`"${def.field}"`);
    for (const v of VARIABLES) expect(api).toContain(`"${v.path}"`);
  });
});
