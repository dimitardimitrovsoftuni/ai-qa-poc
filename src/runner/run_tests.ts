// Runs a generated suite with pytest and writes the JUnit XML the healer reads.
//
//   npm run test -- --site <id>
//   npm run test -- --site <id> --file test_login.py --headed
//   npm run test -- --site <id> --test test_login_success_standard_user
//
// Exit code mirrors pytest, so this composes in a shell chain.

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { configuredPath, fromRoot } from '../lib/config.js';
import { loadSite, listSites } from '../sites/registry.js';
import { step, ok, fail, info, die, bold, dim } from '../lib/log.js';

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const site = get('--site');
  if (!site) die(`Usage: npm run test -- --site <id> [--file test_x.py] [--test name] [--headed]   (sites: ${listSites().join(', ') || 'none'})`);
  return {
    site: site!,
    file: get('--file'),
    test: get('--test'),
    headed: argv.includes('--headed'),
    verbose: argv.includes('--verbose'),
  };
}

const args = parseArgs();
const site = loadSite(args.site);

const reportsDir = configuredPath('reports');
mkdirSync(reportsDir, { recursive: true });
const xml = path.join(reportsDir, `${site.id}.xml`);

const target = args.file
  ? path.posix.join(site.testsDir.replace(/\\/g, '/'), args.file)
  : site.testsDir.replace(/\\/g, '/');

const pytestArgs = [
  '-m', 'pytest',
  target,
  `--junitxml=${xml}`,
  '-o', 'junit_family=xunit2',
  '-o', 'junit_logging=out-err',
  args.verbose ? '-vv' : '-v',
  '--tb=short',
  '-p', 'no:cacheprovider',
];
if (args.test) pytestArgs.push('-k', args.test);

const python = process.env.PYTEST_PYTHON || 'python';
step(`pytest ${bold(target)} ${dim(args.headed ? '(headed)' : '(headless)')}`);
info(dim(`report → ${path.relative(fromRoot(), xml)}`));

const result = spawnSync(python, pytestArgs, {
  cwd: fromRoot(),
  stdio: 'inherit',
  // HEADLESS is read by tests/conftest.py; nothing else switches this.
  env: { ...process.env, HEADLESS: args.headed ? '0' : '1' },
});

console.log();
if (result.status === 0) {
  ok(bold('suite green'));
} else {
  fail(bold(`pytest exited ${result.status}`));
  info(`Heal the failures with: npm run heal -- --site ${site.id}`);
}
process.exit(result.status ?? 1);
