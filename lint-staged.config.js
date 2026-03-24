export default {
  "packages/*/src/**/*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "packages/*/src/**/*.{json,css}": ["prettier --write"],
};
