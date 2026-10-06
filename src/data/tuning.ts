/**
 * Every kart, item and race number in one place.
 *
 * All gorillas drive identically (looks are cosmetic), so there is a single
 * kart tuning. The suspension is deliberately soft and under-damped: the
 * bounce is the point of the game, not a bug to be tuned out.
 */

export const SIM = {
  /** Fixed physics rate. */
  hz: 120,
  gravity: 16,
} as const;

export const KART = {
  mass: 220,
  /** Chassis collider half extents, m (x = width, y = height, z = length). */
  half: { x: 0.8, y: 0.32, z: 1.15 },
  /** Centre of mass sits this far below the chassis centre — keeps it planted. */
  comDrop: 0.35,

  /** Wheel mount offsets from the chassis centre, m. */
  wheelX: 0.78,
  wheelFrontZ: 0.95,
  wheelRearZ: -0.85,
  wheelMountY: -0.1,
  wheelRadius: 0.38,

  /** Suspension: long, soft, springy. */
  restLength: 0.6,
  maxTravel: 0.55,
  spring: 7200,
  /** Damping in compression and rebound, N·s/m. Low = bouncy. */
  damper: 220,
  /** Extra spring rate once the travel is nearly used up, so landings rebound rather than bottom out. */
  bumpStop: 60000,

  /** Drive force at standstill, N, falling linearly to zero at top speed. */
  engineForce: 7400,
  topSpeed: 34,
  reverseForce: 3200,
  reverseTopSpeed: 9,
  brakeForce: 9000,
  /** Gentle coast-down when nothing is pressed. */
  rollingDrag: 380,
  airDrag: 0.45,

  /** Front wheel lock at low speed, rad, easing toward `steerHigh` at top speed. */
  steerLow: 0.62,
  steerHigh: 0.22,
  steerRate: 4.5,
  /** How hard each tyre fights sideways sliding (N per m/s of slip), and its friction cap. */
  lateralGain: 1500,
  gripMu: 1.2,
  /** Grip left once a tyre is sliding well past its limit (fraction of peak). */
  slideGrip: 0.62,
  /** Rear grip multiplier — slightly under 1 lets the tail step out playfully. */
  rearGrip: 1.15,

  /** In the air: target pitch from throttle (nose down) and brake (nose up), rad. */
  airPitchDown: 0.12,
  airPitchUp: 0.35,
  /** Yaw torque from steering in the air, N·m. */
  airYaw: 700,
  /** PD gains holding roll and pitch toward the target in the air. */
  airLevel: 2600,
  airDamp: 620,

  /**
   * Hitting a barrier hard (closing faster than `bonkSpeed`, m/s) keeps only
   * `bonkKeep` of the kart's speed and wobbles it — the arcade price of
   * overcooking a corner. Gentle grazes just scrape.
   */
  bonkSpeed: 4,
  bonkKeep: 0.55,
  /** Seconds upside-down (or stuck) before the kart is set back on its wheels. */
  flipDelay: 1.4,
} as const;

/** Fording a stream: speed bleeds away and the tyres lose some bite. */
export const WATER = {
  /** Fraction of speed lost per second while wheels are in the water. */
  drag: 1.1,
  grip: 0.78,
} as const;

export const ITEMS = {
  boostTime: 3,
  boostForce: 1.9,
  boostTopSpeed: 1.42,
  bananasPerBunch: 3,

  peelRadius: 1.25,
  /** Your own peel ignores you for this long after you drop it. */
  peelGrace: 1.0,
  /** Peels have no timer — this only bounds how many the track can hold. */
  maxPeels: 40,
  spinTime: 1.2,
  spinTurns: 2,

  snakeSwings: 3,
  swingTime: 0.35,
  swingCooldown: 0.45,
  /** Hit box beside the attacker: lateral min..max, and ± along the kart. */
  whackLateralMin: 0.4,
  whackLateralMax: 3.4,
  whackLong: 2.3,
  /** Fraction of speed kept by a whacked kart. */
  whackKeep: 0.6,
  wobbleTime: 0.9,
  whackShove: 900,

  pickupRadius: 1.9,
  pickupRespawn: 5,
  /** Chance a respawned pickup comes back as a snake rather than bananas. */
  snakeChance: 0.35,
} as const;

export const RACE = {
  laps: 3,
  karts: 8,
  countdown: 3,
  /** Seconds off the road (or fallen) before a respawn. */
  offTrackTime: 1.2,
  stuckTime: 3,
  respawnGrace: 1.5,
} as const;
