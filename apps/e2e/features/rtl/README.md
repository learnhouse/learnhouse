# RTL

Checks that Arabic renders as a right-to-left product, not just Arabic text in
a left-to-right layout.

Three things are worth automating here, because all three fail silently:

1. **`dir` on first paint.** Direction is set by a blocking `<head>` script
   (`public/dir-init.js`), because the server cannot read the localStorage key
   i18next detects from. If that script regresses, the app still works — it
   just flashes an LTR layout before React corrects it. Asserted at
   `domcontentloaded`, deliberately not `networkidle`, which would wait past
   the exact window under test.

2. **Live language switch.** Direction has to follow a switch with no reload.

3. **No horizontal overflow.** The highest-value check in the suite: a single
   physical margin that escaped the logical-property sweep pushes the layout
   sideways, and this catches it on any route without maintaining screenshots.

Run against a branch-built image rather than the published one, since the
published image lags this branch:

    E2E_BASE_URL=http://localhost:8080 bunx playwright test features/rtl
