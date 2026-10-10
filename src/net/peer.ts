/**
 * Phone-to-phone links over WebRTC (browser only), via PeerJS.
 *
 * The host's phone registers `jungle-jalopies-<code>` with a PeerJS signalling
 * server (the free public one by default) and players connect to it by code.
 * After the handshake the phones talk directly; PeerJS's public TURN servers
 * relay when two phones on mobile data can't reach each other directly.
 *
 * Each player opens two data channels to the host: 'r' (reliable, ordered,
 * JSON) and 'u' (unordered, binary) — together they are one `Link`.
 *
 * `?peer=host:port` points at another signalling server (a local `npm run
 * peer` for tests and offline development).
 */

import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import type { Link } from './link.js';

const PREFIX = 'jungle-jalopies-';
const JOIN_TIMEOUT = 12000;

function options(): PeerOptions {
  const custom = new URLSearchParams(location.search).get('peer');
  if (!custom) return { debug: 1 };
  const [host, port] = custom.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: location.protocol === 'https:' && host !== 'localhost', debug: 1 };
}

/** One player's two data channels as a Link. */
function makeLink(id: string, r: DataConnection, u: DataConnection): Link {
  let closed = false;
  const link: Link = {
    id,
    onReliable: () => {},
    onFast: () => {},
    onClose: () => {},
    sendReliable(msg) {
      if (!closed && r.open) void r.send(msg);
    },
    sendFast(data) {
      if (!closed && u.open) void u.send(data);
    },
    close() {
      if (closed) return;
      closed = true;
      r.close();
      u.close();
      link.onClose();
    },
  };
  r.on('data', (msg) => link.onReliable(msg));
  u.on('data', (data) => {
    if (data instanceof ArrayBuffer) link.onFast(data);
    else if (ArrayBuffer.isView(data)) link.onFast(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
    else if (data instanceof Blob) void data.arrayBuffer().then((b) => link.onFast(b));
  });
  const gone = () => {
    if (closed) return;
    closed = true;
    link.onClose();
  };
  for (const c of [r, u]) {
    c.on('close', gone);
    c.on('error', gone);
  }
  return link;
}

export interface HostedRoom {
  code: string;
  close(): void;
}

/** Open a room on this phone: a free four-digit code, and a Link per player who joins. */
export function hostRoom(onLink: (link: Link) => void): Promise<HostedRoom> {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = () => {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      const peer = new Peer(PREFIX + code, options());
      let opened = false;
      peer.on('open', () => {
        opened = true;
        resolve({ code, close: () => peer.destroy() });
      });
      peer.on('error', (err: { type?: string }) => {
        if (opened) return;
        peer.destroy();
        if (err.type === 'unavailable-id' && ++tries < 12) attempt();
        else reject(new Error(err.type === 'network' || err.type === 'server-error' ? 'Can’t reach the matchmaking server.' : 'Couldn’t open a room.'));
      });
      // Losing the signalling server doesn't drop players already connected; reconnect quietly for new ones.
      peer.on('disconnected', () => {
        if (!peer.destroyed) peer.reconnect();
      });
      const half = new Map<string, { r?: DataConnection; u?: DataConnection }>();
      peer.on('connection', (conn) => {
        const pair = half.get(conn.peer) ?? {};
        half.set(conn.peer, pair);
        conn.on('open', () => {
          if (conn.label === 'r') pair.r = conn;
          else pair.u = conn;
          if (pair.r && pair.u) {
            half.delete(conn.peer);
            onLink(makeLink(conn.peer, pair.r, pair.u));
          }
        });
      });
    };
    attempt();
  });
}

/** Join the room with this code. Resolves with the link to the host. */
export function joinRoom(code: string): Promise<{ link: Link; close(): void }> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(options());
    const fail = (why: string) => {
      clearTimeout(timer);
      peer.destroy();
      reject(new Error(why));
    };
    const timer = setTimeout(() => fail('No room with that code answered.'), JOIN_TIMEOUT);
    peer.on('error', (err: { type?: string }) => {
      if (err.type === 'peer-unavailable') fail('No room with that code.');
      else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') fail('Can’t reach the matchmaking server.');
      else fail('Couldn’t connect to that room.');
    });
    peer.on('open', () => {
      const host = PREFIX + code;
      const r = peer.connect(host, { label: 'r', reliable: true, serialization: 'json' });
      const u = peer.connect(host, { label: 'u', reliable: false, serialization: 'raw' });
      let open = 0;
      const ready = () => {
        if (++open < 2) return;
        clearTimeout(timer);
        resolve({ link: makeLink(host, r, u), close: () => peer.destroy() });
      };
      r.on('open', ready);
      u.on('open', ready);
    });
  });
}
