// The trail is personal. Signed out, it used to render a page of loading
// placeholders that never filled in; it now sends the visitor to login and
// back, like the account pages.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../app/orgs/[orgslug]/(withmenu)/trail/page.tsx", import.meta.url),
  "utf8",
);

describe("trail page", () => {
  test("checks the session on the server", () => {
    expect(src).toMatch(/import \{ getServerSession \} from '@\/lib\/auth\/server'/);
    expect(src).toMatch(/if \(!\(await getServerSession\(\)\)\)/);
  });

  test("redirects signed-out visitors to login with a way back", () => {
    // Browser-relative: the proxy adds the /orgs/{slug} prefix.
    expect(src).toMatch(/redirect\('\/login\?redirect=\/trail'\)/);
  });
});
