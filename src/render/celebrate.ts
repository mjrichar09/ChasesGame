/**
 * Each gorilla's celebration, as procedural animation on the gorilla rig.
 *
 * One function per move, each a pose at time `t` (seconds), looping. They
 * play on the select podium, on the finish podium for the top three, and —
 * seated, a short burst — whenever a gorilla lands a snake whack or someone
 * slips on their peel.
 *
 * Rig reminders: arms[0] is the gorilla's left (+X), arms[1] its right.
 * Shoulder rotation x < 0 swings the arm forward (−π is straight up in
 * front); z swings it out sideways (+ for the left arm, − for the right).
 * Elbows bend the forearm the same way.
 */

import type { Celebration } from '../data/gorillas.js';
import type { GorillaRig } from './gorilla.js';

/** Sides: index 0 = left (+1), 1 = right (−1). */
const SIDE = [1, -1] as const;

type Pose = (r: GorillaRig, t: number) => void;

const arm = (r: GorillaRig, i: number, x: number, z: number, ex = 0, ez = 0) => {
  r.arms[i]!.rotation.set(x, 0, z);
  r.elbows[i]!.rotation.set(ex, 0, ez);
};

/** How high the gorilla stands up off the seat, m (scaled with the gorilla). */
const STAND = 0.32;

const POSES: Record<Celebration, { stand: number; pose: Pose }> = {
  // Big Boris: rises, pounds his chest left-right, roars at the sky.
  chestPound: {
    stand: STAND,
    pose: (r, t) => {
      const beat = Math.sin(t * 14);
      for (let i = 0; i < 2; i++) {
        const hit = Math.max(0, i === 0 ? beat : -beat);
        arm(r, i, -1.0 - hit * 0.25, SIDE[i]! * (0.5 - hit * 0.45), -1.9, -SIDE[i]! * 0.6);
      }
      r.head.rotation.set(-0.45 + Math.sin(t * 3) * 0.05, 0, 0);
      r.torso.rotation.set(-0.12, 0, 0);
      r.torso.scale.setScalar(1 + Math.abs(beat) * 0.04);
    },
  },
  // Koko Loco: arms windmilling like he still has no brakes.
  windmill: {
    stand: STAND * 0.6,
    pose: (r, t) => {
      for (let i = 0; i < 2; i++) arm(r, i, -t * 9 + i * Math.PI, SIDE[i]! * 0.5, -0.2);
      r.head.rotation.set(0, Math.sin(t * 6) * 0.4, 0);
      r.torso.rotation.set(0, 0, Math.sin(t * 9) * 0.12);
    },
  },
  // Professor Tumbles: polite, rapid applause and a satisfied nod.
  clap: {
    stand: STAND * 0.5,
    pose: (r, t) => {
      const c = (Math.sin(t * 16) + 1) / 2; // 1 = hands apart
      for (let i = 0; i < 2; i++) arm(r, i, -1.25, SIDE[i]! * (-0.25 + c * 0.45), -0.9, -SIDE[i]! * 0.3);
      r.head.rotation.set(Math.sin(t * 5) * 0.2, 0, 0);
      r.torso.rotation.set(0, 0, 0);
    },
  },
  // Mama Mango: one hand on the hip, the other waving to the crowd.
  wave: {
    stand: STAND,
    pose: (r, t) => {
      arm(r, 0, -0.2, 0.75, 0, -1.9); // hand on hip
      arm(r, 1, -0.3, -2.5, 0, Math.sin(t * 9) * 0.6);
      r.head.rotation.set(0, -0.25, Math.sin(t * 3) * 0.12);
      r.torso.rotation.set(0, 0, Math.sin(t * 3) * 0.08);
    },
  },
  // Tiny Tank: bouncing on the spot, both fists punching the air.
  jump: {
    stand: STAND,
    pose: (r, t) => {
      for (let i = 0; i < 2; i++) {
        const pump = Math.max(0, Math.sin(t * 10 + i * Math.PI));
        arm(r, i, -0.3, SIDE[i]! * (2.3 + pump * 0.5), 0, SIDE[i]! * (0.9 - pump * 0.9));
      }
      r.head.rotation.set(-0.25, 0, 0);
      r.torso.rotation.set(0, 0, 0);
    },
  },
  // DJ Banana: one hand cupping the headphones, the other scratching a record, head on the beat.
  scratch: {
    stand: STAND * 0.6,
    pose: (r, t) => {
      arm(r, 0, -0.6, 2.3, 0, 1.5); // hand to the left headphone
      arm(r, 1, -1.1 + Math.sin(t * 18) * 0.18, -0.3 + Math.sin(t * 9) * 0.15, -0.6);
      r.head.rotation.set(Math.abs(Math.sin(t * 6)) * 0.35, 0, 0.15);
      r.torso.rotation.set(Math.abs(Math.sin(t * 6)) * 0.1, 0, 0);
    },
  },
  // Smooth Steve: leans back, finger guns, pew pew.
  fingerGuns: {
    stand: STAND * 0.5,
    pose: (r, t) => {
      for (let i = 0; i < 2; i++) {
        const kick = Math.max(0, Math.sin(t * 7 + i * 1.5)) ** 4;
        arm(r, i, -1.45 - kick * 0.35, SIDE[i]! * 0.15, -0.15 - kick * 0.2);
      }
      r.head.rotation.set(-0.15, 0, -0.2);
      r.torso.rotation.set(-0.25, 0.15, 0);
    },
  },
  // Granite Gus: double-bicep flex, turning to show both sides.
  flex: {
    stand: STAND,
    pose: (r, t) => {
      const squeeze = (Math.sin(t * 5) + 1) / 2;
      for (let i = 0; i < 2; i++) arm(r, i, 0, SIDE[i]! * 1.45, 0, SIDE[i]! * (1.4 + squeeze * 0.4));
      r.torso.rotation.set(0, Math.sin(t * 1.6) * 0.45, 0);
      r.torso.scale.set(1 + squeeze * 0.05, 1, 1 + squeeze * 0.05);
      r.head.rotation.set(-0.1, -Math.sin(t * 1.6) * 0.3, 0);
    },
  },
};

/**
 * Pose the rig for celebration `kind` at time `t`. `weight` (0..1) blends in
 * and out of it; `seated` keeps the gorilla in the kart (mid-race).
 */
export function celebrate(r: GorillaRig, kind: Celebration, t: number, weight: number, seated: boolean, baseY: number): void {
  const move = POSES[kind];
  // Capture the current (driving/rest) pose to blend from.
  const from = {
    arms: r.arms.map((a) => a.rotation.clone()),
    elbows: r.elbows.map((e) => e.rotation.clone()),
    torso: r.torso.rotation.clone(),
    head: r.head.rotation.clone(),
    scale: r.torso.scale.clone(),
  };
  move.pose(r, t);
  const w = Math.min(1, Math.max(0, weight));
  const mix = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => unknown }) =>
    b.set(a.x + (b.x - a.x) * w, a.y + (b.y - a.y) * w, a.z + (b.z - a.z) * w);
  r.arms.forEach((a, i) => mix(from.arms[i]!, a.rotation));
  r.elbows.forEach((e, i) => mix(from.elbows[i]!, e.rotation));
  mix(from.torso, r.torso.rotation);
  mix(from.head, r.head.rotation);
  mix(from.scale, r.torso.scale);
  // Stand up out of the seat (and bounce, for the jumpers).
  const hop = kind === 'jump' ? Math.abs(Math.sin(t * 5)) * 0.35 : 0;
  r.root.position.y = baseY + (seated ? hop * 0.3 : move.stand + hop) * w;
}
