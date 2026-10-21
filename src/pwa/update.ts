/**
 * Load the newest Copper. A plain reload isn't enough: while the old service
 * worker controls the page it keeps serving the old version, and a downloaded
 * update only takes over once every Copper tab closes — or when told to skip
 * waiting, which is what this does.
 */
export async function reloadToUpdate(): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  if (reg) {
    await reg.update().catch(() => {});
    const installing = reg.installing;
    if (installing) {
      await new Promise<void>((resolve) => {
        const done = () => installing.state !== 'installing' && resolve();
        installing.addEventListener('statechange', done);
        done();
      });
    }
    const waiting = reg.waiting;
    if (waiting) {
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
      waiting.postMessage({ type: 'SKIP_WAITING' });
      return;
    }
  }
  window.location.reload();
}
