/**
 * Client entry point for the webapp example.
 * 
 * Bundled by the example's scripts stage (rollup). The literal
 * `process.env.NODE_ENV` reference below is replaced with the resolved build
 * mode at bundle time, so the shipped code contains no runtime env lookup.
 */
import { formatGreeting, sum } from './app.js';

const MODE = process.env.NODE_ENV;

function init () {
  const banner = document.getElementById('banner');
  if (banner) {
    banner.textContent = formatGreeting(MODE, sum(20, 6));
  }
}

document.addEventListener('DOMContentLoaded', init);
