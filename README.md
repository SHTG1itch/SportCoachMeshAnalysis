# Sport Coach — Mesh Analysis

Desktop coaching tool. You upload a clip of a professional and a clip of yourself
performing the same motion. The app runs 3D pose estimation on both, aligns the
motions in time, compares every joint frame-by-frame, and produces a coaching
guide plus saveable workout plans that target the specific differences.

## What it does, precisely

1. **3D pose extraction** (per frame) — MediaPipe BlazePose GHUM (heavy model),
   33 world landmarks in meters. Runs locally in the Electron renderer via
   WebAssembly, with GPU delegate when available.
2. **Normalization** — for each frame the pose is translated so the hip midpoint
   is at the origin and scaled so the shoulder-to-hip midpoint distance is 1.
   Rotation is preserved so handedness and facing stay meaningful.
3. **Joint angles** — 13 biomechanical features per frame: L/R elbow flexion,
   L/R shoulder abduction, L/R hip flexion, L/R knee flexion, L/R ankle
   dorsiflexion, trunk rotation (shoulders vs hips yaw), hip rotation,
   shoulder-line tilt.
4. **Phase detection** — tracks the speed profile of the sport's key joint
   (e.g. the dominant wrist for a tennis forehand). The global peak marks the
   release/contact moment; half-peak crossings delimit it. The motion is split
   into preparation → load → release → follow-through.
5. **Temporal alignment** — Dynamic Time Warping with a Sakoe–Chiba band
   (default 25% of sequence length) aligns your sequence to the pro's along a
   monotonic path. For pro images (single-frame mode), the best-matching user
   frame is chosen by Euclidean distance on the angle vector.
6. **Comparison report** — paired samples along the DTW path produce per-joint
   mean/max/signed-bias deltas and a per-phase top-deltas summary. An overall
   similarity (0–1) is reported and a per-frame similarity timeline is drawn.
7. **Coaching guide and workouts** — the numeric report is handed to Claude
   (Anthropic API) which returns a structured JSON guide (strengths, key
   issues tied to joints, drills, cues) and 3–4 concrete warm-up / main /
   cool-down workouts that target the high-significance deltas.
8. **Persistence** — analyses, generated workouts, and settings are stored in a
   local SQLite DB under the Electron user-data directory. Nothing leaves your
   machine until the LLM step runs (and that only sends the numeric report, not
   the video).

## Stack

- **Electron 33** shell, frameless window with custom title bar.
- **Renderer**: React 18 + Vite + Tailwind. Pose extraction, normalization,
  joint-angle math, DTW alignment, and comparison all run here in TypeScript —
  no Python required.
- **Main**: Node. `better-sqlite3` for storage, `@anthropic-ai/sdk` for the LLM
  step. IPC bridge is the only seam between renderer and disk/network.
- **ML model**: `@mediapipe/tasks-vision` (PoseLandmarker, heavy float16).

## Run it

```bash
npm install
npm run dev
```

`npm run dev` starts Vite at :5173 and Electron, which loads the Vite URL in dev
and the built `dist/` in prod.

```bash
npm run build     # typecheck + vite build + electron tsc
npm run start     # runs Electron against the built bundle
npm run test      # vitest — 25 tests for vec / angles / dtw / normalize / compare
npm run typecheck # tsc --noEmit for both tsconfigs
```

### Native module note

`better-sqlite3` is a native module. On Windows it builds against the Node ABI
of your installed Node runtime. If installs fail on your machine, run
`npx electron-rebuild` after `npm install` or use a Node version manager that
matches the Electron ABI. The renderer code (the entire analysis pipeline) has
no native dependencies and will run under any Node for `npm test`.

### API key

The guide and workouts require an Anthropic API key. Either:

- Paste it into **Settings → Anthropic API key** in-app (stored in SQLite on
  this device), or
- Set `ANTHROPIC_API_KEY` in the environment before launching Electron.

The key is used only from the Electron main process. The renderer never sees it.

## What's verified vs. what needs a live run

- **Verified** in this repo:
  - Vector math, joint-angle math, DTW correctness, normalization
    invariance, and the compare() orchestration are all unit-tested (25
    passing Vitest tests).
  - Renderer + Electron both typecheck clean; renderer builds clean through
    Vite.
- **Not verified without real media and an API key**:
  - MediaPipe pose extraction on real video (requires a browser/Electron
    runtime with WASM + optional GPU delegate).
  - Anthropic API call for the guide/workouts.
  - UI walkthrough on real uploads.

## Source layout

```
electron/           main process (IPC, SQLite, Anthropic client)
renderer/src/
  App.tsx, main.tsx, styles.css
  lib/
    analyze.ts                  end-to-end orchestrator
    pose/
      types.ts                  landmark indices, skeleton edges
      vec.ts                    3D vector math
      normalize.ts              translation + scale normalization
      angles.ts                 13 joint-angle features
      phases.ts                 velocity-peak phase detection
      dtw.ts                    DTW with Sakoe–Chiba band
      compare.ts                report builder
      landmarker.ts             MediaPipe wrapper + video frame extractor
      *.test.ts                 unit tests
    sports.ts                   sport metadata registry
  components/                   Sidebar, TopBar, MediaDrop, PoseOverlay,
                                DeltaChart, JointBreakdown, GuideView,
                                WorkoutCard
  screens/                      Home, NewAnalysis, AnalysisResult,
                                WorkoutsLibrary, History, Settings
shared/types.ts                 IPC contract, domain types
```
