import js from '@eslint/js';
import globals from 'globals';
import nodePlugin from 'eslint-plugin-n';

const nodeRules = {
  'n/no-unsupported-features/node-builtins': [
    'error',
    {
      'allowExperimental': true
    }
  ]
};

export default [{
  name: 'global',
  ignores: [
    'coverage/**',
    'examples/dist/**',
    'node_modules/**'
  ]
}, {
  ...nodePlugin.configs['flat/recommended'],
  files: ['**/*.js']
}, {
  name: 'lib_and_tests',
  files: ['**/*.js'],
  languageOptions: {
    globals: {
      ...globals.node
    }
  },
  rules: {
    ...js.configs.recommended.rules,
    ...nodeRules,
    indent: [2, 2, {
      SwitchCase: 1,
      MemberExpression: 1
    }],
    quotes: [2, 'single'],
    'dot-notation': [2, {allowKeywords: true}]
  }
}, {
  name: 'mjs_entry_points',
  files: ['**/*.mjs'],
  plugins: {
    n: nodePlugin
  },
  languageOptions: {
    globals: {
      ...globals.node
    },
    sourceType: 'module'
  },
  rules: {
    ...js.configs.recommended.rules,
    ...nodeRules,
    indent: [2, 2, {
      SwitchCase: 1,
      MemberExpression: 1
    }],
    quotes: [2, 'single'],
    'dot-notation': [2, {allowKeywords: true}]
  }
}];
