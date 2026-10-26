/** Web switches direction instantly; a restart is only a page reload. */
export async function restartApp(): Promise<void> {
  if (typeof window !== 'undefined') window.location.reload();
}
