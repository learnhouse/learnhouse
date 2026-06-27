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
        },
    },
];