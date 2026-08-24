// Tiny console helpers. No dependencies — the POC should install in seconds.

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

export const dim = (s: string) => paint('2', s);
export const bold = (s: string) => paint('1', s);
export const green = (s: string) => paint('32', s);
export const yellow = (s: string) => paint('33', s);
export const red = (s: string) => paint('31', s);
export const cyan = (s: string) => paint('36', s);

export const step = (msg: string) => console.log(`${cyan('▸')} ${msg}`);
export const ok = (msg: string) => console.log(`${green('✓')} ${msg}`);
export const warn = (msg: string) => console.log(`${yellow('!')} ${msg}`);
export const fail = (msg: string) => console.log(`${red('✗')} ${msg}`);
export const info = (msg: string) => console.log(`  ${dim(msg)}`);

/** Exit with a clear one-line reason. Used for operator errors, not bugs. */
export function die(msg: string): never {
  fail(msg);
  process.exit(1);
}
