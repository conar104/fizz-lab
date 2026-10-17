// Run every test file in sequence:  node tests/run-all.js
const { execFileSync } = require('child_process');
const path = require('path');

const files = ['reference.test.js', 'validation.test.js', 'trends.test.js', 'ice.test.js', 'capillary.test.js', 'motion.test.js'];
let failed = 0;
for (const f of files) {
  console.log(`\n================ ${f} ================`);
  try {
    execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  } catch (e) {
    failed++;
  }
}
console.log(failed ? `\n${failed} test file(s) had failures` : '\nAll test files passed');
process.exitCode = failed ? 1 : 0;
