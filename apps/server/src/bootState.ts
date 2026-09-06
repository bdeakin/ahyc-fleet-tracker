/**
 * Whether the boot work that must succeed — opening SQLite, running migrations, seeding the
 * club vessel — actually did. A container that dies on a bad volume tells you nothing from a
 * phone; one that stays up and reports the fault on /api/health (as a 503, so a broken deploy
 * is never promoted) tells you everything.
 */
let bootError: string | null = null;

export function setBootError(err: unknown): void {
  bootError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

export function getBootError(): string | null {
  return bootError;
}
