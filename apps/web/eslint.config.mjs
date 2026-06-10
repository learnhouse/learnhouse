import unusedImports from "eslint-plugin-unused-imports";
import nextConfig from "eslint-config-next";
import js from "@eslint/js";

export default [
    js.configs.recommended,
    ...nextConfig,
    {
        plugins: {
            "unused-imports": unusedImports,
        },
        rules: {
            "react/no-unescaped-entities": "off",
            "@next/next/no-page-custom-font": "off",
            "@next/next/no-img-element": "off",
            "unused-imports/no-unused-imports": "warn",
            "no-console": "warn",
        },
    },
    {
        // tsc already checks undefined identifiers in TS files; ESLint's
        // no-undef has no knowledge of TS global types (React, NodeJS,
        // RequestInit, ...) and only produces false positives here.
        // https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
        files: ["**/*.ts", "**/*.tsx"],
        rules: {
            "no-undef": "off",
        },
    },
];