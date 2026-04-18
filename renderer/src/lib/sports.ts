import type { SportMeta } from "@shared/types";

export const SPORTS: SportMeta[] = [
  {
    id: "tennis",
    name: "Tennis",
    shots: ["Forehand", "Backhand", "Serve", "Volley", "Slice"],
    keyJoint: "right_wrist",
    description:
      "Racket sport. Strokes rely on kinetic-chain transfer from legs through trunk rotation to the racket arm.",
  },
  {
    id: "basketball",
    name: "Basketball",
    shots: ["Jump shot", "Free throw", "Layup", "Three-pointer"],
    keyJoint: "right_wrist",
    description:
      "Shooting mechanics emphasize vertical alignment, elbow-under-ball, and wrist snap on release.",
  },
  {
    id: "golf",
    name: "Golf",
    shots: ["Full swing — driver", "Full swing — iron", "Pitch", "Chip", "Putt"],
    keyJoint: "right_wrist",
    description:
      "Full-body rotational motion. Sequencing (hip-then-shoulder-then-arm) is the single largest source of power.",
  },
  {
    id: "baseball",
    name: "Baseball / Softball",
    shots: ["Swing", "Pitch — fastball", "Pitch — breaking"],
    keyJoint: "right_wrist",
    description:
      "Explosive rotational power. For hitting, lower-body load precedes bat speed; for pitching, lead-leg block drives arm whip.",
  },
  {
    id: "soccer",
    name: "Soccer",
    shots: ["Instep kick", "Inside-foot pass", "Volley", "Free kick"],
    keyJoint: "right_ankle",
    description:
      "Strike mechanics rely on plant-foot placement, hip rotation, and ankle locking at contact.",
  },
  {
    id: "boxing",
    name: "Boxing",
    shots: ["Jab", "Cross", "Hook", "Uppercut"],
    keyJoint: "right_wrist",
    description:
      "Punching power transfers from rear foot through hip rotation and shoulder drive into the lead knuckles.",
  },
  {
    id: "volleyball",
    name: "Volleyball",
    shots: ["Spike", "Serve — float", "Serve — jump", "Set"],
    keyJoint: "right_wrist",
    description:
      "Overhead attacks depend on approach jump mechanics, shoulder external rotation, and wrist snap.",
  },
  {
    id: "swimming",
    name: "Swimming",
    shots: ["Freestyle stroke", "Breaststroke", "Butterfly", "Backstroke"],
    keyJoint: "right_wrist",
    description:
      "Propulsion comes from high-elbow catch, body roll, and strong core-driven rotation.",
  },
  {
    id: "custom",
    name: "Custom",
    shots: ["Custom motion"],
    keyJoint: "right_wrist",
    description:
      "Any athletic motion. Phase detection will anchor on the key joint's speed peak.",
  },
];

export function findSport(id: string): SportMeta | undefined {
  return SPORTS.find((s) => s.id === id);
}
