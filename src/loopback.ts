import type { AddressInfo, Server } from 'node:net';

/** Resolve with the OS-assigned loopback port, or reject if the host cannot bind it. */
export function listenLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}
