/**
 * A connection between the host's phone and one player's.
 *
 * Two lanes: `reliable` (ordered JSON — the lobby, item events, claims) and
 * `fast` (binary snapshots and reports, unordered so one late packet never
 * holds up the next). In the browser a link is a pair of WebRTC data channels
 * (net/peer.ts); in tests and tools it is `memoryPair`, with latency, jitter
 * and dropped fast packets on a clock the caller controls.
 */

export interface Link {
  /** The other end's id (the host's code, or a player's peer id). */
  readonly id: string;
  sendReliable(msg: unknown): void;
  sendFast(data: ArrayBuffer): void;
  onReliable: (msg: unknown) => void;
  onFast: (data: ArrayBuffer) => void;
  onClose: () => void;
  close(): void;
}

/** Network conditions for a simulated link. */
export interface LinkProfile {
  /** One-way delay, s. */
  latency: number;
  /** Extra random delay, 0..jitter s. */
  jitter: number;
  /** Fraction of fast packets lost. */
  loss: number;
}

export const PROFILES: Record<string, LinkProfile> = {
  lan: { latency: 0.004, jitter: 0.002, loss: 0 },
  wifi: { latency: 0.02, jitter: 0.01, loss: 0.002 },
  '4g': { latency: 0.06, jitter: 0.04, loss: 0.01 },
  bad: { latency: 0.15, jitter: 0.1, loss: 0.05 },
};

/** A clock and timer queue the test or tool advances itself. */
export class ManualClock {
  t = 0;
  private queue: { at: number; seq: number; fn: () => void }[] = [];
  private seq = 0;

  now = (): number => this.t;

  later(delay: number, fn: () => void): void {
    this.queue.push({ at: this.t + delay, seq: this.seq++, fn });
  }

  /** Move time forward, running everything that falls due, in order. */
  advance(dt: number): void {
    const end = this.t + dt;
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.queue[0];
      if (!next || next.at > end) break;
      this.queue.shift();
      this.t = Math.max(this.t, next.at);
      next.fn();
    }
    this.t = end;
  }
}

/**
 * Two linked ends over a simulated network. Reliable messages keep their
 * order (like a data channel in reliable mode); fast ones may arrive out of
 * order or not at all.
 */
export function memoryPair(clock: ManualClock, idA: string, idB: string, profile: LinkProfile, random: () => number): [Link, Link] {
  type End = Link & { peer?: End; lastReliable: number; closed: boolean };
  const make = (id: string): End => ({
    id,
    lastReliable: 0,
    closed: false,
    onReliable: () => {},
    onFast: () => {},
    onClose: () => {},
    sendReliable(msg) {
      const to = this.peer!;
      if (this.closed) return;
      const copy = JSON.parse(JSON.stringify(msg)) as unknown;
      // In order: never earlier than the last one sent.
      const at = Math.max(to.lastReliable, clock.t + profile.latency + random() * profile.jitter);
      to.lastReliable = at;
      clock.later(at - clock.t, () => {
        if (!this.closed) to.onReliable(copy);
      });
    },
    sendFast(data) {
      const to = this.peer!;
      if (this.closed || random() < profile.loss) return;
      const copy = data.slice(0);
      clock.later(profile.latency + random() * profile.jitter, () => {
        if (!this.closed) to.onFast(copy);
      });
    },
    close() {
      if (this.closed) return;
      this.closed = true;
      const to = this.peer!;
      to.closed = true;
      clock.later(profile.latency, () => to.onClose());
      this.onClose();
    },
  });
  const a = make(idB);
  const b = make(idA);
  a.peer = b;
  b.peer = a;
  return [a, b];
}
