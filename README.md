# Sport Coach — Mesh Analysis

Local coaching program run from a terminal or VS Code. You upload a clip of a
professional and a clip of yourself performing the same motion. The program runs
3D pose estimation on both, aligns the
motions in time, compares every joint frame-by-frame, and produces a coaching
guide plus saveable workout plans that target the specific differences.

Everything runs on your machine. There is no account, no API key, and nothing
about your footage is uploaded (see "Network use").

## Using the program

The interface is a single window with a left navigation rail and six screens.

### Home

The landing screen. It opens with a one-line pitch and two primary actions —
"New analysis" and "My workouts" — followed by:

- A **sport quick-pick** grid (the most common sports). Selecting a card jumps
  straight into New Analysis with that sport pre-selected; "Open full picker"
  goes to New Analysis with the complete list.
- **Recent analyses** — your five most recent runs, each with a small skeleton
  thumbnail of your contact-moment pose, the sport and shot, the timestamp, and
  the similarity score. When you have more than five, a "View all" link jumps to
  History.
- **Saved workouts** — the most recent training plans you have saved.

### New Analysis

A three-step form:

1. **Sport** — pick from the chip list (Tennis, Basketball, Golf, Baseball /
   Softball, Soccer, Boxing, Volleyball, Swimming, or Custom for anything else).
2. **Shot / motion** — the chips update to the chosen sport's motions.
3. **Upload media** — two drop zones: a professional reference (image or short
   clip) and a video of you performing the same motion. Each zone accepts drag
   and drop or click/keyboard to browse, validates the file type immediately,
   previews the chosen media, and shows the file name and size. Images are
   limited to 50 MB / 50 megapixels; videos to 1 GB / 10 megapixels / 60 seconds
   (20 seconds is ideal). An inline tip explains how to film for the best result
   (side-on, whole body in frame, one clean rep, steady camera, good lighting,
   matched camera angle).

The "Run analysis" button stays disabled until both clips are present (with an
inline hint saying so). While a run is in progress a labelled progress bar
reports the live stage and percentage; you can stop it from the button or by
pressing **Esc**. Navigating away also cancels the run so two MediaPipe VIDEO
sessions cannot overlap and corrupt their monotonic tracking timestamps.

### Analysis Result

Opens automatically when a run finishes, or from Home/History. The header shows:

- A large **overall similarity** percentage, colour-coded (green / amber / red).
- The sport and shot, the comparison mode (sequence DTW vs single-frame), a
  **per-frame similarity ribbon** (labelled with similarity on the y-axis and
  motion progress on the x-axis), and — when relevant — a mirrored-comparison
  note and a low-pose-detection confidence caveat.

Below the header, five keyboard-navigable tabs (arrow keys move between them):

- **Summary** — the detected phases (with the biggest delta per phase) and the
  top joint differences.
- **Skeleton** — a scrubbable, side-by-side reconstruction of the pro's and your
  3D skeletons, time-aligned to the same moment, defaulting to contact/release
  with a "Jump to contact" shortcut.
- **Joint breakdown** — every compared joint with a significance chip, the pro
  vs your mean angle, a magnitude bar, and a plain-language "more/less than pro"
  line.
- **Coaching guide** — an overview, what you are doing well, focus areas (each
  with the measured mesh difference, what drives it, the fix to match the pro,
  and the muscle groups to train), recommended drills, and in-the-moment cues.
- **Workouts** — the generated training plans as expandable cards you can save.

You can regenerate the guide and workouts, or delete the analysis (two-step
confirm).

### Workout Library

Every workout you have saved, searchable by sport, shot, or focus. Each card
shows difficulty, duration, and context tags, expands to the full warm-up / main
set / cool-down, and can be removed (two-step confirm). Empty and no-results
states are spelled out.

### History

A reverse-chronological list of every run, each with its skeleton thumbnail,
sport, shot, timestamp, and similarity. Open one to return to its result screen,
or delete it (two-step confirm). All runs stay on the device.

### Settings

Theme (dark or light), an explanation of the on-device, no-key privacy model,
and an About panel (application name, version, pose model, and where data is
stored). Saving shows a brief, screen-reader-announced confirmation.

## Program window and chrome

The window is frameless with a custom title bar, so its chrome matches the app
theme on every platform:

- **Window controls.** On Windows and Linux the app draws its own
  minimize / maximize-restore / close caption buttons at the top-right of the
  title bar (theme-aware, with the conventional red close hover). The
  maximize/restore glyph tracks the real window state, including OS-driven
  changes such as snap layouts, the maximize shortcut, or double-clicking the
  drag bar. On macOS the app defers to the native traffic lights and offsets the
  sidebar logo so they do not overlap it.
- **Moving the window.** Drag the title bar (the logo strip and the top bar are
  drag regions; the buttons are not). Double-clicking the drag bar toggles
  maximize.
- **Application menu.** Auto-hidden on Windows and Linux so it never clashes with
  the custom title bar (Alt still reveals it), with the standard editing
  accelerators (copy / paste / undo) always available and reload / dev-tools
  shortcuts present only in development. macOS gets the usual global menu bar.

## Design system, theming, and accessibility

- **Tokens and themes.** The entire palette (canvas surfaces, ink text, accent,
  and ok / warn / bad status colours) is defined as CSS variables and consumed
  through Tailwind, so dark and light themes are a runtime variable swap rather
  than duplicated styles. Shared component classes (`card`, `btn` variants,
  `chip`, `input`, `error-card`, the heading and label scales, and a single
  `focus-ring` treatment) keep the screens consistent.
- **Keyboard and screen-reader support.** Every interactive control has a
  visible `:focus-visible` ring; the result tabs use a proper
  tablist/tab/tabpanel structure with arrow-key navigation; the skeleton
  scrubber exposes a live frame position; errors use `role="alert"` and the
  settings save uses an `aria-live` status; the media drop zones are operable by
  keyboard; and toggles report their pressed state.
- **Motion.** A `prefers-reduced-motion` rule neutralizes animations (such as the
  regenerate spinner) and transitions for users who opt out of motion.
- **Responsiveness.** Multi-column layouts collapse to fewer columns as the
  window narrows (down to the 1100x720 minimum), and the result tab strip scrolls
  rather than overflowing.

## What it does, precisely

1. **3D pose extraction** (per frame) — MediaPipe BlazePose GHUM (heavy model),
   33 world landmarks in meters. Inference runs locally in the Electron renderer
   via WebAssembly, on the GPU delegate when a usable WebGL context is available
   and automatically falling back to the CPU delegate otherwise (so the pipeline
   runs everywhere, just slower). The pinned MediaPipe WASM runtime and pose
   model are bundled with the app, so inference works offline from first launch
   and no remote executable code is loaded.
2. **Signal cleanup** — before any geometry: (a) missing/occluded landmarks
   (including all-zero frames from detection dropouts) are repaired by
   per-landmark temporal interpolation so they can't inject phantom "fully
   extended" joint angles; (b) landmark trajectories are smoothed with a small
   binomial filter to remove single-frame detector jitter without blurring the
   velocity peak phase detection relies on.
3. **Normalization** — for each frame the pose is translated so the hip midpoint
   is at the origin and scaled so the shoulder-to-hip midpoint distance is 1.
   Rotation is preserved so handedness and facing stay meaningful.
4. **Joint angles** — 13 biomechanical features per frame: L/R elbow flexion,
   L/R shoulder abduction, L/R hip flexion, L/R knee flexion, L/R ankle
   dorsiflexion, trunk rotation (shoulders vs hips yaw), trunk lean (torso vs
   vertical) and shoulder-line tilt. Every feature is either an intra-body
   relative angle or measured against gravity, so all 13 are invariant to which
   way the athlete faces the camera.
5. **Handedness** — each athlete's dominant side is inferred from how much the
   sport's key joint moves (the racket wrist, the kicking ankle, …). If the user
   and the pro have opposite dominant sides, the user's angle features are
   mirrored to the pro's convention so a lefty is compared limb-for-limb against
   a righty. Phase detection anchors on the pro's actual dominant-side joint.
6. **Phase detection** — tracks the speed profile of the sport's key joint
   (e.g. the dominant wrist for a tennis forehand). The global peak marks the
   release/contact moment; half-peak crossings delimit it. The motion is split
   into preparation → load → release → follow-through.
7. **Temporal alignment** — Dynamic Time Warping with a Sakoe–Chiba band
   (default 25% of sequence length) aligns your sequence to the pro's along a
   monotonic path. For pro images (single-frame mode), the best-matching user
   frame is chosen by Euclidean distance on the angle vector.
8. **Comparison report** — alignment and scoring run on a per-feature
   *standardized* distance (each joint normalized by a fixed biomechanical scale
   and clamped) so no single wide-range joint dominates the warp path or the
   score. Per-joint deltas use robust, **confidence-weighted** statistics — a
   trimmed mean for the systematic offset and a 90th-percentile "worst typical"
   instead of a single-frame max, with every paired sample weighted by the
   minimum landmark visibility feeding that joint's angle — so a few
   mis-detected frames can't inflate the numbers and a motion-blurred or
   occluded stretch (a detector guess) can't fabricate or mask a fault.
   Frames where the torso reads as implausibly inverted (a MediaPipe depth-flip
   on fast/blurred contact frames) are detected and repaired by interpolation.
   Joint **significance is keyed on the systematic signed bias**, not the
   noise-inflated mean-abs delta, so two clips of the *same* athlete read as a
   close match while a real technique difference stands out. An overall
   similarity (0–1) and per-frame timeline are reported, with per-clip
   pose-detection coverage surfaced as a confidence caveat. (`trunk_lean` is
   measured against a data-derived "up" direction, so it is correct under
   MediaPipe's y-DOWN world-coordinate convention.)
9. **Coaching guide and workouts — sport-agnostic, mesh-mismatch driven.** A
   built-in biomechanics engine turns the numeric report into a structured guide
   and three workouts, grounded **entirely in the skeletal-mesh difference**
   between you and the pro — it contains NO sport-specific knowledge, so it works
   for every possible sport (and the "custom" sport for anything else). For each
   mismatched joint it states the measured difference ("your right elbow is bent
   118° where the pro's is 100° — about 18° more") and the physical change that
   matches the pro's mesh ("to match the pro, straighten your arm more fully
   through this position"). Each joint is mapped to the **muscle groups that
   govern it**, and the three workouts (mobility & activation, corrective
   strength, flexibility & position-matching) are built from the muscle groups
   behind your biggest mismatches — ranked by gap, with an extra strength set for
   the muscles driving a high-significance difference, plus "match-the-pro"
   position holds set to the pro's exact angles. Issues are collapsed to one per
   body-part group (the worse side) so left/right of the same joint don't surface
   as separate, contradictory items. It runs natively on-device with **no API key
   and no network call** — every statement is generated deterministically from
   the actual joint-delta numbers (direction-aware via the signed bias and
   phase-aware), so it never hallucinates angles that aren't in the data.
10. **Visual skeleton comparison** — the extracted 3D skeletons are persisted
   (downsampled and time-aligned) and shown on the result screen as a scrubbable
   side-by-side pro-vs-you mesh, defaulting to the contact/release moment. The
   user's key pose is also rendered as the history/home thumbnail. Projection
   auto-orients head-up from the data, so it is correct under MediaPipe's y-DOWN
   world coordinates.
11. **Persistence** — analyses, generated workouts, and settings are stored in a
   local SQLite DB under the Electron user-data directory. Your media, poses, and
   results never leave your machine — the analysis, bundled MediaPipe runtime
   and model, and coaching guide all run entirely on-device. SQLite corruption
   is checked at startup; damaged files are preserved in a timestamped backup
   before a fresh store is created.

## Stack

- **Electron 43** local runtime, frameless window with a custom title bar, theme-aware
  caption buttons on Windows/Linux, and an auto-hidden application menu. The
  context-isolated, sandboxed preload exposes a single namespaced `window.app`
  bridge (persistence, settings, and window controls).
- **Renderer**: React 18 + Vite + Tailwind, with Zustand for app state and
  `lucide-react` for icons. Pose extraction, normalization, joint-angle math,
  DTW alignment, and comparison all run here in TypeScript — no Python required.
- **Main**: Node. `better-sqlite3` for local storage only. The IPC bridge is the
  only seam between renderer and disk — there is no network seam. Every IPC
  payload is validated at the trust boundary before it reaches the database, and
  the window-control messages act on the sender's own window.
- **Coaching engine**: a dependency-free, deterministic biomechanics rule engine
  (`renderer/src/lib/coach.ts`). No LLM, no API key, no account.
- **ML model**: `@mediapipe/tasks-vision` (PoseLandmarker, heavy float16).

## Run it

```bash
npm install
npm start
```

`npm start` builds the source and launches the program locally. It does not
produce or install an executable, so code-signing credentials are not needed.
VS Code also discovers this command in its **NPM Scripts** view. For active
development with hot reload, use `npm run dev`; it starts Vite at :5173 and the
Electron window together.

```bash
npm run build     # Vite production bundle + clean Electron TypeScript build
npm start         # builds and runs Electron directly from this checkout
npm run dev       # live-reload development mode
npm run test      # Vitest — 188 active tests plus 6 gated real-footage evaluations
npm run test:database # native SQLite startup/recovery test under Electron's ABI
npm run test:startup  # production-mode source launch + preload/IPC smoke test
npm run typecheck # renderer, test, shared, and Electron TypeScript projects
```

### Native module note

`better-sqlite3` is a native module. `npm install` runs the official
`@electron/rebuild` tool automatically so the binary matches Electron's ABI. Use
`npm run rebuild` to repeat that step when troubleshooting. The renderer code
(the entire analysis pipeline) has no native dependencies and runs under Node
for `npm test`; `npm run test:database` deliberately runs under Electron.

### No API key, fully free

There is nothing to configure and no key to obtain. The coaching guide and
workouts are computed on-device by the built-in biomechanics engine at zero
cost, and your videos, poses, and results are never uploaded — no personal data
ever leaves the machine. The MediaPipe runtime and pose model are checked into
the local source tree, so there is no first-run download.

### Network use

The program makes **no API calls and uploads nothing** — your videos, extracted
poses, analyses, and the coaching guide all stay on your machine. The pinned
MediaPipe WASM runtime and BlazePose model are loaded from the local source
checkout. Analysis therefore works without a network connection, including on
the first run.

The tradeoff is deliberate: the engine is a deterministic rule system keyed by
joint, direction (signed bias), and magnitude, not a language model. It gains
reproducibility, privacy, and strict grounding in the measured numbers (it can
only describe deltas that are actually in the data), at the cost of the
open-ended, sport-specific prose an LLM could produce. The advice is trustworthy
and number-driven rather than free-form.

## What's verified vs. what needs a live run

- **Verified** in this repo:
  - Vector math, joint-angle math (incl. camera-yaw invariance and the
    y-DOWN/up-sign handling of trunk lean), DTW correctness, normalization
    invariance, gap-filling/smoothing, depth-flip frame repair, handedness
    mirroring, robust + bias-centric + confidence-weighted per-joint deltas
    (incl. a regression proving a low-visibility deviant segment cannot
    fabricate a coaching fault), the compare() orchestration (incl. a
    lefty-vs-righty end-to-end match), and the native coaching engine
    (group-deduped, direction-aware, number-grounded, severity-dosed, and
    **sport-agnostic** — verified to emit identical mesh-mismatch coaching across
    sports with no sport jargon, and to drive workouts off the muscle groups
    behind each mismatch) plus the skeleton-projection math (head-up
    auto-orientation under y-DOWN coords), persistence validation, media limits,
    crash-loop handling, and log rotation are covered by 188 passing Vitest
    tests. Six expensive real-footage evaluations remain opt-in.
  - Renderer + Electron both typecheck clean; the renderer builds through Vite,
    Electron output is cleaned before every compile, and a real native SQLite
    test proves startup, migration, WAL settings, integrity checking, corrupt
    file preservation, and fresh-store recovery under Electron's ABI.
  - The production-mode source command launches with the strict CSP, sandboxed
    renderer, context-isolated preload, working IPC persistence bridge, and a
    persistent main-process log. CI exercises this same terminal startup path on
    Windows after verifying native SQLite initialization and recovery.
  - The real analysis engine was validated on actual tennis footage (an amateur
    forehand vs. Novak Djokovic court-level practice, pulled from YouTube) via a
    browser harness that runs the live `compare()` + coaching pipeline on
    extracted poses. Self-consistency holds (a clip vs. itself ≈ 100%, vs. its
    mirror ≈ 100% with handedness flipped), a same-player reference scores higher
    than the amateur, and the amateur's flagged faults are biomechanically sound
    (less hip/knee load, smaller swing arc). Extraction in the harness uses
    MediaPipe IMAGE mode per frame; the shipped app uses VIDEO mode (temporal
    tracking) — the geometry/compare/coaching code is identical. The local,
    bundled single-frame path was also exercised end-to-end with a real pro
    image and 120 user frames: 113 poses were detected and the comparison,
    guide, and workouts completed without a CDN.
- **Still requiring manual environment validation**:
  - Interacting with the Electron upload/result UI on representative
    end-user machines and GPU/CPU configurations. Automated boot, unit,
    inference, and runtime checks cover the underlying paths but not every
    visual interaction.
  - Contact-instant-only faults remain a known limitation: per-frame confidence
    weighting now discounts low-visibility contact frames in every per-joint
    statistic (so they can no longer fabricate a fault), but significance still
    keys on the whole-stroke systematic difference — a fault that exists *only*
    at the blurred contact instant is reported descriptively via the per-phase
    breakdown rather than flagged on its own.

## Source layout

```
electron/           main process: IPC + payload validation, window controls and
                    application menu, SQLite (local only, no network), sandboxed
                    preload bridge
renderer/src/
  App.tsx, main.tsx
  styles.css                    Tailwind layers, theme CSS variables (dark +
                                light), shared component classes, focus-ring,
                                reduced-motion
  version.ts                    app version, injected from package.json by Vite
  lib/
    analyze.ts                  end-to-end orchestrator
    coach.ts                    native coaching-guide + workout engine
    pose/
      types.ts                  landmark indices, skeleton edges
      vec.ts                    3D vector math
      prepare.ts                gap-filling + temporal smoothing
      normalize.ts              translation + scale normalization
      angles.ts                 13 joint-angle features
      handedness.ts             dominant-side detection + angle mirroring
      phases.ts                 velocity-peak phase detection
      dtw.ts                    DTW with Sakoe–Chiba band
      compare.ts                report builder (+ persisted skeleton mesh)
      landmarker.ts             MediaPipe wrapper (GPU→CPU fallback) + extractor
      render.ts                 pure skeleton projection + canvas drawing
      *.test.ts                 unit tests
    sports.ts                   sport metadata registry
  components/                   Sidebar, TopBar, WindowControls (custom caption
                                buttons), MediaDrop, PoseOverlay,
                                MeshCompare (scrubbable pro-vs-you skeletons),
                                DeltaChart, JointBreakdown, GuideView,
                                WorkoutCard
  screens/                      Home, NewAnalysis, AnalysisResult,
                                WorkoutsLibrary, History, Settings
shared/types.ts                 IPC contract, domain types (guide/workout shapes,
                                window-control + platform API)
```
