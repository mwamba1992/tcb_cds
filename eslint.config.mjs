import nx from '@nx/eslint-plugin';

/**
 * GovSec lint baseline.
 *
 * The rules here are the enforceable half of docs/ENGINEERING_STANDARDS.md. Anything
 * in that document that could be a lint rule should become one — a standard nobody
 * can violate accidentally is worth more than a standard everyone has read.
 */
export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/src/generated',
      '**/*.config.mjs',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
    ],
  },
  {
    files: ['**/*.ts', '**/*.js', '**/*.vue'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // Shared libraries must stay leaf-ish: they may depend on each other but
            // never on an application, or the dependency graph inverts and a lib
            // change starts rebuilding every service.
            { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },

            // Applications may use shared libraries.
            { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['scope:shared', 'type:lib'] },

            // ─── The BoT boundary (TAD §7.3, ADR-04) ───
            //
            // Only bot-gateway talks to the Bank of Tanzania. libs/bot-client holds the
            // request signer and BoT's wire types, and carries `domain:bot-client`; every
            // other service is forbidden from importing it, so no service can sign a
            // request to BoT or parse a BoT payload except through bot-gateway's events.
            //
            // Weakening this rule is a change to the platform's security model, not a
            // lint tweak.
            {
              sourceTag: 'domain:bot-client',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            { sourceTag: 'scope:shared', notDependOnLibsWithTags: ['domain:bot-client'] },
            { sourceTag: 'domain:identity', notDependOnLibsWithTags: ['domain:bot-client'] },
            { sourceTag: 'domain:investor', notDependOnLibsWithTags: ['domain:bot-client'] },
            { sourceTag: 'domain:auction', notDependOnLibsWithTags: ['domain:bot-client'] },
            { sourceTag: 'domain:cbs-gateway', notDependOnLibsWithTags: ['domain:bot-client'] },
            { sourceTag: 'domain:settlement', notDependOnLibsWithTags: ['domain:bot-client'] },
            { sourceTag: 'domain:notification', notDependOnLibsWithTags: ['domain:bot-client'] },
            { sourceTag: 'domain:portal', notDependOnLibsWithTags: ['domain:bot-client'] },

            { sourceTag: '*', onlyDependOnLibsWithTags: ['*'] },
          ],
        },
      ],

      // --- money and randomness ------------------------------------------------
      'no-restricted-globals': [
        'error',
        {
          name: 'parseFloat',
          message: 'Money must never touch floats. Use Money.parse() from @govsec/money.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message:
            'Math.random() is not cryptographically secure. Use randomInt/randomUUID from node:crypto ' +
            'for OTPs, tokens, and anything an attacker benefits from predicting.',
        },
        {
          selector:
            "CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']",
          message: 'Money must never touch floats. Use Money.parse() from @govsec/money.',
        },
        {
          selector: "MemberExpression[object.name='console']",
          message: 'Use the Nest Logger so output is structured and correlatable (TAD §16.1).',
        },
      ],

      // --- correctness ---------------------------------------------------------
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',

      // NOT enabled: @typescript-eslint/consistent-type-imports.
      //
      // Nest resolves constructor injection from `design:paramtypes` metadata, which
      // needs the injected class present as a runtime *value*. The rule sees a class
      // used only in a constructor parameter annotation, calls it type-only, and its
      // autofix rewrites it to `import type` — erasing the DI token. The result still
      // type-checks and still builds, then fails at boot with "Nest can't resolve
      // dependencies". Same reason `verbatimModuleSyntax` stays off.

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // Tests may reach for shapes that production code must not.
    files: ['**/*.spec.ts', '**/*.test.ts', '**/*.e2e-spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
