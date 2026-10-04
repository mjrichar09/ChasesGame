/**
 * Driver controls, normalised. The only thing that drives a kart.
 *
 * Buttons are carried as *held* state, never as "pressed this frame" events:
 * the sim runs several fixed steps per rendered frame, and a one-shot flag
 * would fire once per step. Each kart detects its own rising edges inside the
 * sim, which also keeps replays and (later) netcode a plain stream of states.
 */
export interface DriverInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 — brakes, then reverses once stopped. */
  brake: number;
  /**
   * -1 (left) .. 1 (right), from the driver's point of view.
   *
   * The sim frame has the kart's local +X on its *left* (right-handed, Y-up,
   * nose along +Z), so this is negated exactly once, where the kart consumes
   * it. Everything above the sim, the AI included, speaks driver: right is right.
   */
  steer: number;
  /** Held: use the item (eat a banana). */
  item: boolean;
  /** Held: swing the snake to the left / right. */
  whackLeft: boolean;
  whackRight: boolean;
}

export const NEUTRAL_INPUT: DriverInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  item: false,
  whackLeft: false,
  whackRight: false,
};
