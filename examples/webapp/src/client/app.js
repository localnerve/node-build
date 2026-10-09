/**
 * Trivial client module imported by main.js so the rollup stage has a real
 * multi-module bundle to resolve.
 */

/**
 * Compose the greeting shown on the home page banner.
 *
 * @param {string} mode The resolved build mode (e.g. "production").
 * @param {number} value A number the entry point computed via sum().
 * @returns {string} The banner text.
 */
export function formatGreeting (mode, value) {
  return `${value === 26 ? 'It works' : 'Something is off'} in ${mode} mode`;
}

/**
 * Add two numbers.
 *
 * @param {number} a First addend.
 * @param {number} b Second addend.
 * @returns {number} The sum.
 */
export function sum (a, b) {
  return a + b;
}
