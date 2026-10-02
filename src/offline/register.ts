export async function prepareOffline(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return false;
  const registration = await navigator.serviceWorker.register(
    `${import.meta.env.BASE_URL}sw.js`,
    { scope: import.meta.env.BASE_URL },
  );
  await navigator.serviceWorker.ready;
  const worker = registration.active;
  if (!worker) return false;
  return new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => resolve(false), 30000);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timeout);
      resolve(
        event.data?.type === 'CACHE_VERIFIED' && event.data?.complete === true,
      );
      channel.port1.close();
    };
    worker.postMessage({ type: 'VERIFY_CACHE' }, [channel.port2]);
  });
}
