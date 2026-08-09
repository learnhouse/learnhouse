import unusedImports from "eslint-plugin-unused-imports";
import nextConfig from "eslint-config-next";
import js from "@eslint/js";
import rtl from "./eslint-rules/no-physical-direction.mjs";

// Surfaces that are dir="ltr" by design, where physical utilities are correct.
// Each is locked in the component itself with the reasoning; keep this list in
// sync with the DENY list in scripts/codemod-logical.mjs.
const LTR_LOCKED = [
    // CodeMirror computes gutter/cursor/selection geometry physically, and code
    // reads left-to-right by language spec.
    "components/Objects/Editor/Extensions/CodePlayground/**",
    // video.js styles its controls physically throughout.
    "components/Objects/Activities/Video/**",
    // recharts emits absolute SVG x-coordinates; dir=rtl moves the labels but
    // not the ticks they belong to.
    "components/Dashboard/Analytics/**",
    // KaTeX is left-to-right by specification.
    "components/Objects/Editor/Extensions/MathEquation/**",
    // Rasterised to PDF by html2canvas, which reproduces logical properties
    // worst of all.
    "components/Dashboard/Pages/Course/EditCourseCertification/CertificatePreview.tsx",
];

export default [
    js.configs.recommended,
    ...nextConfig,
    {
        // DOM lib type-only names (used purely in TS type positions, with no
        // runtime global counterpart) are otherwise reported as `no-undef`
        // false positives. Declaring them keeps type annotations like
        // `HeadersInit` / `RequestInit` lint-clean.
        languageOptions: {
            globals: {
                HeadersInit: "readonly",
                BodyInit: "readonly",
                RequestInit: "readonly",
                ResponseInit: "readonly",
                RequestInfo: "readonly",
                RequestCredentials: "readonly",
                EventListener: "readonly",
                NodeJS: "readonly",
            },
        },
        plugins: {
            "unused-imports": unusedImports,
            rtl,
        },
        rules: {
            // Physical-direction utilities don't mirror under dir="rtl". This is
            // an error, not a warning: the whole codebase was converted in one
            // pass, so there is no backlog to stage around — anything this
            // catches is genuinely new.
            "rtl/no-physical-direction": "error",
            "react/no-unescaped-entities": "off",
            "@next/next/no-page-custom-font": "off",
            "@next/next/no-img-element": "off",
            "unused-imports/no-unused-imports": "warn",
            "no-console": "warn",
            // Same #800 backlog, and the same reasoning as the React Compiler
            // rules below: the changed-files gate lints WHOLE files, so a
            // repo-wide change makes CI fail on debt it merely walked past.
            //
            // Base ESLint also can't read TypeScript, so it reports the
            // parameter names inside type annotations — `onSelect: (id: string)
            // => void` — as unused variables. Those names are documentation,
            // not dead code, and renaming them to `_id` would be a regression
            // in readability. A real fix means adopting
            // @typescript-eslint/no-unused-vars, which is its own change.
            "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }],
            // React Compiler rules (eslint-plugin-react-hooks v6) flag a large
            // pre-existing backlog (#800) that the full-project lint already
            // reports. Keep them as warnings so the strict changed-files gate
            // enforces genuinely-new debt without blocking PRs on legacy code
            // they merely touch — matching the "don't block on pre-existing
            // issues" intent in web-lint.yaml.
            "react-hooks/refs": "warn",
            "react-hooks/set-state-in-effect": "warn",
            "react-hooks/immutability": "warn",
            "react-hooks/preserve-manual-memoization": "warn",
            "react-hooks/purity": "warn",
            "react-hooks/error-boundaries": "warn",
            "react-hooks/globals": "warn",
            "react-hooks/set-state-in-render": "warn",
        },
    },
    {
        files: LTR_LOCKED,
        rules: {
            "rtl/no-physical-direction": "off",
        },
    },
];