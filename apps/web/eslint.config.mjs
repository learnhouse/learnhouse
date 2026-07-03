import unusedImports from "eslint-plugin-unused-imports";
import nextConfig from "eslint-config-next";
import js from "@eslint/js";

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
            },
        },
        plugins: {
            "unused-imports": unusedImports,
        },
        rules: {
            "react/no-unescaped-entities": "off",
            "@next/next/no-page-custom-font": "off",
            "@next/next/no-img-element": "off",
            "unused-imports/no-unused-imports": "warn",
            "no-console": "warn",
            "no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }],
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
];