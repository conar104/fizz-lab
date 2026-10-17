// Tiny zero-dependency test harness: loads the browser modules into Node and
// provides check() helpers that print a readable evidence table.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const MODULES = ['core/util.js', 'physics/constants.js', 'physics/properties.js', 'physics/nucleation.js',
  'physics/jet.js', 'physics/bubbles.js', 'physics/foam.js', 'physics/ice.js', 'physics/capillary.js', 'physics/tilt.js', 'physics/bottle.js', 'physics/slosh.js', 'physics/table.js', 'physics/stream.js',
  'physics/simulation.js'];

function load() {
  global.window = global;
  for (const f of MODULES) vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), { filename: f });
  return global.Fizz;
}

/** Deterministic RNG so trend tests are reproducible. */
function seed(s) {
  Math.random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const results = [];
function section(name) { results.push({ section: name }); console.log(`\n## ${name}`); }

/** Compare a model value with a reference value within a relative tolerance. */
function near(name, got, want, relTol, source) {
  const err = (got - want) / want;
  const ok = Math.abs(err) <= relTol;
  results.push({ name, ok, got, want, err, source });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} model ${fmt(got).padStart(10)}  ref ${fmt(want).padStart(10)}  ${(err * 100).toFixed(1).padStart(6)} %  (${source})`);
  return ok;
}

/** Assert a qualitative expectation (a trend) and print the numbers behind it. */
function expect(name, ok, detail, source) {
  results.push({ name, ok, detail, source });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        ${detail}${source ? `\n        evidence: ${source}` : ''}`);
  return ok;
}

function fmt(v) {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  return a !== 0 && (a < 1e-3 || a >= 1e5) ? v.toExponential(3) : v.toPrecision(4);
}

function summary() {
  const checks = results.filter(r => 'ok' in r);
  const failed = checks.filter(r => !r.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log('  - ' + f.name)); }
  return failed.length;
}

module.exports = { load, seed, section, near, expect, summary, results };
