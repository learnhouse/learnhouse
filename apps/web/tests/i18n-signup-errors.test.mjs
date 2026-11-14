import { describe, expect, test } from "bun:test";

import i18n, { changeLanguage } from "../lib/i18n.ts";
import { getErrorMessage, getFieldErrors } from "../services/utils/ts/errorMessage.ts";

// Locale bundles load after the first render. react-i18next only re-renders
// (and hands out a fresh `t`) on the events it is bound to, so the store event
// fired by addResourceBundle must be one of them, or anything memoized on `t`
// stays in English.
describe("lazy locale bundles reach useTranslation consumers", () => {
  test("react-i18next is bound to the store event addResourceBundle fires", async () => {
    const bound = (i18n.options.react?.bindI18nStore || "").split(" ");
    const fired = [];
    const onEvent = (name) => () => fired.push(name);
    const listeners = Object.fromEntries(bound.filter(Boolean).map((e) => [e, onEvent(e)]));
    for (const [event, fn] of Object.entries(listeners)) i18n.store.on(event, fn);
    try {
      await changeLanguage("es");
    } finally {
      for (const [event, fn] of Object.entries(listeners)) i18n.store.off(event, fn);
    }
    expect(i18n.hasResourceBundle("es", "common")).toBe(true);
    expect(fired.length).toBeGreaterThan(0);
    expect(i18n.t("auth.password_req_min_length")).not.toBe(
      i18n.getFixedT("en")("auth.password_req_min_length"),
    );
  });
});

describe("getErrorMessage localizes known API error codes", () => {
  const es = () => i18n.getFixedT("es");

  test("PROFILE_FIELD_INVALID names the fields in the active language", async () => {
    await changeLanguage("es");
    const detail = {
      code: "PROFILE_FIELD_INVALID",
      message: "Display name fields may not contain URLs or links",
      invalid_fields: ["username"],
    };
    const msg = getErrorMessage(detail, "fallback", es());
    expect(msg).toContain("Nombre de usuario");
    expect(msg).not.toContain("Display name fields");
  });

  test("other known codes use their translation", async () => {
    await changeLanguage("es");
    expect(getErrorMessage({ code: "WEAK_PASSWORD", message: "Password does not meet security requirements" }, "x", es()))
      .toBe(es()("auth.password_requirements_not_met"));
    expect(getErrorMessage({ code: "RATE_LIMITED", message: "Too many requests." }, "x", es()))
      .toBe(es()("auth.errors.rate_limited"));
  });

  test("unknown codes and plain strings keep the server message", () => {
    const t = i18n.getFixedT("es");
    expect(getErrorMessage({ code: "SOMETHING_NEW", message: "Server says no" }, "x", t)).toBe("Server says no");
    expect(getErrorMessage("Email or username is already in use", "x", t)).toBe("Email or username is already in use");
    expect(getErrorMessage({ code: "PROFILE_FIELD_INVALID", message: "Server text" }, "x", t)).toBe("Server text");
  });

  test("without t the behavior is unchanged", () => {
    expect(getErrorMessage({ code: "WEAK_PASSWORD", message: "Server text" }, "x")).toBe("Server text");
    expect(getErrorMessage(null, "fallback")).toBe("fallback");
  });
});

describe("getFieldErrors", () => {
  test("maps invalid_fields to a per-field message", () => {
    const t = i18n.getFixedT("en");
    expect(getFieldErrors({ code: "PROFILE_FIELD_INVALID", invalid_fields: ["username", "last_name"] }, t)).toEqual({
      username: "No links or email addresses",
      last_name: "No links or email addresses",
    });
  });

  test("ignores other errors", () => {
    const t = i18n.getFixedT("en");
    expect(getFieldErrors({ code: "WEAK_PASSWORD" }, t)).toEqual({});
    expect(getFieldErrors("nope", t)).toEqual({});
    expect(getFieldErrors(undefined, t)).toEqual({});
  });
});
