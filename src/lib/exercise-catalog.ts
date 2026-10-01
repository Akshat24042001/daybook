/**
 * Bodyweight exercises Daybook knows how to explain: form cues, what the amount means, and an animated stick figure.
 *
 * The cues follow standard coaching guidance (ACE exercise library, NHS strength-exercise guides) and stay
 * deliberately conservative: starting position, the movement, what to avoid, an easier and a harder option.
 *
 * A figure is a rig of key poses. A pose places the hip, tilts the torso, and puts the hands and feet where they
 * should be; elbows and knees are solved with two-bone IK, so a foot on the floor stays exactly on the floor while
 * the body moves. No React here: the same solver runs in tests.
 */

export type Pt = readonly [number, number];
export type Unit = "reps" | "seconds";

/** Angles in degrees. Torso: 0 = upright, +90 = lying with the head to the right. */
export interface Pose {
  hip: Pt;
  t: number;
  /** neck-to-head direction, same convention as the torso (default: the torso's) */
  head?: number;
  /** hand and foot targets; N = near side (drawn solid), F = far side (drawn faint) */
  hN: Pt;
  hF: Pt;
  fN: Pt;
  fF: Pt;
  /** foot angle in the side view, 0 = flat pointing forward */
  ft?: number;
  /** lift the whole body (jumps) */
  lift?: number;
}

export type Prop =
  | { kind: "wall"; x: number }
  | { kind: "chair"; x: number; w: number; y: number }
  | { kind: "desk"; x: number; w: number; y: number }
  | { kind: "step"; x: number; w: number; y: number };

export interface Rig {
  view: "side" | "front";
  frames: Pose[];
  /** one full cycle through all frames */
  ms: number;
  prop?: Prop;
  /** +1 / -1 to flip which way an elbow (e) or knee (k) bends */
  bend?: Partial<Record<"eN" | "eF" | "kN" | "kF", 1 | -1>>;
}

export interface ExerciseInfo {
  key: string;
  name: string;
  /** other names this exercise goes by (matched loosely) */
  aliases: string[];
  unit: Unit;
  /** a sensible amount for one set */
  amount: number;
  level: "easy" | "medium" | "hard";
  /** equipment, if any */
  needs: string | null;
  muscles: string;
  /** what one rep, or the seconds, mean for this exercise */
  counts: string;
  steps: string[];
  avoid: string[];
  easier: string;
  harder: string;
  rig: Rig;
}

// ---------------------------------------------------------------- the catalogue

const STAND = { hip: [60, 56] as Pt, t: 0, hN: [61, 55] as Pt, hF: [59, 55] as Pt, fN: [61, 92] as Pt, fF: [59, 92] as Pt };
const FOURS = { hip: [52, 74] as Pt, t: 75, hN: [77, 92] as Pt, hF: [75, 92] as Pt, fN: [34, 92] as Pt, fF: [32, 92] as Pt };
const BACK = { hip: [60, 90] as Pt, t: -90, head: -90 };

export const EXERCISES: ExerciseInfo[] = [
  {
    key: "squat", name: "Squats", aliases: ["squat", "air squat", "bodyweight squat"], unit: "reps", amount: 15, level: "easy", needs: null,
    muscles: "Thighs (quads), glutes, hamstrings",
    counts: "One rep = sit down into the squat and stand back up once.",
    steps: [
      "Stand with feet about shoulder-width apart, toes turned out slightly.",
      "Push your hips back and bend your knees as if sitting into a chair. Keep your chest up and heels down.",
      "Go down until your thighs are about parallel to the floor, or as low as feels comfortable.",
      "Push through your heels to stand back up.",
    ],
    avoid: ["Knees caving inwards: keep them in line with your toes.", "Heels lifting off the floor."],
    easier: "Squat only halfway, or sit down onto a chair and stand up.",
    harder: "Pause for 2 seconds at the bottom, or try squat jumps.",
    rig: {
      view: "side", ms: 2400,
      frames: [
        { ...STAND, hN: [66, 53], hF: [64, 53], fN: [63, 92], fF: [61, 92] },
        { hip: [47, 74], t: 38, hN: [88, 52], hF: [86, 52], fN: [63, 92], fF: [61, 92] },
      ],
    },
  },
  {
    key: "pushup", name: "Push-ups", aliases: ["push up", "pushup", "press up", "press-up"], unit: "reps", amount: 10, level: "medium", needs: null,
    muscles: "Chest, shoulders, triceps, core",
    counts: "One rep = lower your chest to just above the floor and press back up once.",
    steps: [
      "Start in a high plank: hands slightly wider than your shoulders, body in a straight line from head to heels.",
      "Brace your stomach and squeeze your glutes.",
      "Bend your elbows (about 45° from your body) and lower until your chest is just above the floor.",
      "Press the floor away to straighten your arms.",
    ],
    avoid: ["Hips sagging or sticking up.", "Elbows flaring straight out to the sides."],
    easier: "Do them with your knees on the floor, or with your hands on a desk (incline push-ups).",
    harder: "Lower slowly for 3 seconds, or put your feet up on a step.",
    rig: {
      view: "side", ms: 2200,
      frames: [
        { hip: [52.9, 77.4], t: 66, hN: [76.7, 92], hF: [74.7, 92], fN: [20, 92], fF: [19.5, 91.5] },
        { hip: [55.6, 87], t: 82, hN: [76.7, 92], hF: [74.7, 92], fN: [20, 92], fF: [19.5, 91.5] },
      ],
    },
  },
  {
    key: "plank", name: "Plank", aliases: ["plank", "forearm plank", "plank hold"], unit: "seconds", amount: 30, level: "medium", needs: null,
    muscles: "Core (abs and lower back), shoulders, glutes",
    counts: "Seconds = how long you hold the position without letting your hips drop.",
    steps: [
      "Put your forearms on the floor with your elbows right under your shoulders.",
      "Step your feet back so your body is a straight line from head to heels.",
      "Brace your stomach as if about to be poked, and squeeze your glutes.",
      "Hold the position and keep breathing steadily.",
    ],
    avoid: ["Hips sagging towards the floor or piking up.", "Holding your breath."],
    easier: "Hold it with your knees on the floor.",
    harder: "Lift one foot a few centimetres off the floor, then switch.",
    rig: {
      view: "side", ms: 3000,
      frames: [
        { hip: [57.2, 84.5], t: 78, hN: [94.6, 92], hF: [92.6, 92], fN: [22, 92], fF: [22.5, 91.5] },
        { hip: [57.2, 84], t: 77.4, hN: [94.6, 92], hF: [92.6, 92], fN: [22, 92], fF: [22.5, 91.5] },
      ],
    },
  },
  {
    key: "lunge", name: "Lunges", aliases: ["lunge", "forward lunge", "split squat", "reverse lunge"], unit: "reps", amount: 12, level: "medium", needs: null,
    muscles: "Thighs, glutes, balance",
    counts: "One rep = one lunge on one leg. Alternate legs, so 12 reps = 6 each side.",
    steps: [
      "Stand tall, hands on your hips.",
      "Take a long step forward and lower your hips until both knees are bent about 90°.",
      "Keep your front knee above your ankle; the back knee hovers just above the floor.",
      "Push through your front heel to come back up, then switch legs.",
    ],
    avoid: ["Front knee shooting far past your toes.", "Leaning your upper body forward."],
    easier: "Do shorter, shallower lunges and hold a wall for balance.",
    harder: "Pause at the bottom, or step backwards (reverse lunge) at a quicker pace.",
    rig: {
      view: "side", ms: 2600,
      frames: [
        { hip: [60, 60], t: 0, hN: [63, 58], hF: [61, 58], fN: [75, 92], fF: [44, 92] },
        { hip: [58, 74], t: 0, hN: [61, 72], hF: [59, 72], fN: [75, 92], fF: [44, 92] },
      ],
    },
  },
  {
    key: "jumpingjack", name: "Jumping jacks", aliases: ["jumping jack", "star jump", "jumping jacks"], unit: "reps", amount: 30, level: "easy", needs: null,
    muscles: "Whole body, heart rate (cardio)",
    counts: "One rep = jump out with arms up, and back in, once.",
    steps: [
      "Stand with your feet together and arms by your sides.",
      "Jump your feet out wider than your hips while swinging your arms overhead.",
      "Jump back to the start position.",
      "Keep a steady rhythm and land softly on the balls of your feet.",
    ],
    avoid: ["Landing flat-footed with locked knees."],
    easier: "Step one foot out at a time instead of jumping.",
    harder: "Go faster, or add a squat when your feet land wide.",
    rig: {
      view: "front", ms: 1100,
      frames: [
        { hip: [60, 56], t: 0, hN: [67, 55], hF: [53, 55], fN: [64, 92], fF: [56, 92] },
        { hip: [60, 58], t: 0, hN: [76, 9], hF: [44, 9], fN: [74, 92], fF: [46, 92], lift: 2 },
      ],
    },
  },
  {
    key: "wallsit", name: "Wall sit", aliases: ["wall sit", "wall squat", "wall sits"], unit: "seconds", amount: 30, level: "medium", needs: "A wall",
    muscles: "Thighs (quads), glutes",
    counts: "Seconds = how long you hold the seated position against the wall.",
    steps: [
      "Stand with your back flat against a wall, feet about 50 cm in front of you.",
      "Slide down until your knees are bent about 90°, thighs parallel to the floor.",
      "Keep your knees above your ankles and your back flat on the wall.",
      "Hold, breathing normally, then slide back up.",
    ],
    avoid: ["Knees drifting past your toes: move your feet further out.", "Pushing on your thighs with your hands."],
    easier: "Slide down only halfway.",
    harder: "Hold longer, or lift one heel.",
    rig: {
      view: "side", ms: 3000, prop: { kind: "wall", x: 32 },
      frames: [
        { hip: [37, 74], t: 0, hN: [50, 70], hF: [48, 70], fN: [55, 92], fF: [53, 92] },
        { hip: [37, 74.5], t: 1, hN: [50, 70.5], hF: [48, 70.5], fN: [55, 92], fF: [53, 92] },
      ],
    },
  },
  {
    key: "glutebridge", name: "Glute bridge", aliases: ["glute bridge", "hip bridge", "bridge", "glute bridges"], unit: "reps", amount: 15, level: "easy", needs: null,
    muscles: "Glutes, hamstrings, lower back",
    counts: "One rep = lift your hips up and lower them back down once.",
    steps: [
      "Lie on your back, knees bent, feet flat on the floor hip-width apart, arms by your sides.",
      "Squeeze your glutes and lift your hips until your body is straight from shoulders to knees.",
      "Pause for a second at the top.",
      "Lower slowly back to the floor.",
    ],
    avoid: ["Arching your lower back at the top: the lift comes from the glutes."],
    easier: "Lift only partway.",
    harder: "Do it on one leg, the other leg straight out.",
    rig: {
      view: "side", ms: 2400, bend: { eN: -1, eF: -1 },
      frames: [
        { ...BACK, hip: [58, 90], hN: [54, 92], hF: [52, 92], fN: [77, 92], fF: [75, 92] },
        { hip: [54.5, 77], t: -120, head: -90, hN: [54, 92], hF: [52, 92], fN: [77, 92], fF: [75, 92] },
      ],
    },
  },
  {
    key: "calfraise", name: "Calf raises", aliases: ["calf raise", "heel raise", "calf raises", "heel raises"], unit: "reps", amount: 20, level: "easy", needs: null,
    muscles: "Calves, ankles",
    counts: "One rep = rise up onto your toes and lower back down once.",
    steps: [
      "Stand tall with your feet hip-width apart. Hold a wall or desk for balance if needed.",
      "Rise up onto the balls of your feet as high as you can.",
      "Pause for a second at the top.",
      "Lower your heels slowly back to the floor.",
    ],
    avoid: ["Bouncing quickly: the slow lowering does the work."],
    easier: "Hold on to something and do fewer.",
    harder: "Do them on one leg, or on the edge of a stair.",
    rig: {
      view: "side", ms: 1800,
      frames: [
        { ...STAND },
        { ...STAND, hip: [60, 51], hN: [61, 50], hF: [59, 50], fN: [61, 87], fF: [59, 87], ft: 60 },
      ],
    },
  },
  {
    key: "highknees", name: "High knees", aliases: ["high knee", "high knees", "running in place", "marching"], unit: "seconds", amount: 30, level: "medium", needs: null,
    muscles: "Hip flexors, legs, heart rate (cardio)",
    counts: "Seconds = how long you keep running on the spot.",
    steps: [
      "Stand tall with your feet hip-width apart.",
      "Run on the spot, driving each knee up towards hip height.",
      "Pump your arms as if sprinting.",
      "Land softly on the balls of your feet and keep going for the time.",
    ],
    avoid: ["Leaning back.", "Landing heavily on your heels."],
    easier: "March instead of running: lift one knee at a time without the jump.",
    harder: "Go faster, knees higher.",
    rig: {
      view: "side", ms: 700,
      frames: [
        { hip: [60, 54], t: 0, hN: [54, 50], hF: [70, 38], fN: [68, 72], fF: [60, 90] },
        { hip: [60, 54], t: 0, hN: [70, 38], hF: [54, 50], fN: [60, 90], fF: [68, 72] },
      ],
    },
  },
  {
    key: "mountainclimber", name: "Mountain climbers", aliases: ["mountain climber", "mountain climbers"], unit: "seconds", amount: 30, level: "medium", needs: null,
    muscles: "Core, shoulders, legs, heart rate (cardio)",
    counts: "Seconds = how long you keep switching legs.",
    steps: [
      "Start in a high plank, hands under your shoulders, body straight.",
      "Drive one knee towards your chest.",
      "Switch legs quickly, as if running in the plank position.",
      "Keep your hips level with your shoulders the whole time.",
    ],
    avoid: ["Hips bouncing up high.", "Hands drifting in front of your shoulders."],
    easier: "Step each knee in slowly instead of switching quickly.",
    harder: "Go faster, or bring each knee towards the opposite elbow.",
    rig: {
      view: "side", ms: 1100,
      frames: [
        { hip: [52.9, 77.4], t: 66, hN: [78, 92], hF: [76, 92], fN: [64, 82], fF: [20, 92] },
        { hip: [52.9, 77.4], t: 66, hN: [78, 92], hF: [76, 92], fN: [44, 72], fF: [44, 72] },
        { hip: [52.9, 77.4], t: 66, hN: [78, 92], hF: [76, 92], fN: [20, 92], fF: [64, 82] },
        { hip: [52.9, 77.4], t: 66, hN: [78, 92], hF: [76, 92], fN: [44, 72], fF: [44, 72] },
      ],
    },
  },
  {
    key: "burpee", name: "Burpees", aliases: ["burpee", "burpees"], unit: "reps", amount: 8, level: "hard", needs: null,
    muscles: "Whole body, heart rate (cardio)",
    counts: "One rep = squat, kick back to plank, back in, and jump up once.",
    steps: [
      "From standing, squat down and place your hands on the floor.",
      "Jump or step your feet back into a high plank.",
      "Jump or step your feet back in towards your hands.",
      "Stand up and jump with your arms overhead.",
    ],
    avoid: ["Hips sagging in the plank.", "Landing stiff-legged from the jump."],
    easier: "Step back and in instead of jumping, and skip the jump at the top.",
    harder: "Add a push-up in the plank.",
    rig: {
      view: "side", ms: 4200,
      frames: [
        { ...STAND },
        { hip: [54, 80], t: 60, hN: [78, 92], hF: [76, 92], fN: [62, 92], fF: [60, 92] },
        { hip: [52, 67], t: 90, hN: [78, 92], hF: [76, 92], fN: [40, 82], fF: [38, 82] },
        { hip: [54.9, 77.4], t: 66, hN: [78, 92], hF: [76, 92], fN: [22, 92], fF: [21.5, 91.5] },
        { hip: [52, 67], t: 90, hN: [78, 92], hF: [76, 92], fN: [40, 82], fF: [38, 82] },
        { hip: [54, 80], t: 60, hN: [78, 92], hF: [76, 92], fN: [62, 92], fF: [60, 92] },
        { ...STAND, hN: [64, 6], hF: [62, 6], lift: 10 },
      ],
    },
  },
  {
    key: "crunch", name: "Crunches", aliases: ["crunch", "crunches", "sit up", "situp", "sit-ups"], unit: "reps", amount: 15, level: "easy", needs: null,
    muscles: "Abs (front of the stomach)",
    counts: "One rep = curl your shoulders up and lower them back down once.",
    steps: [
      "Lie on your back, knees bent, feet flat. Rest your fingertips lightly behind your head.",
      "Brace your stomach and curl your head and shoulders off the floor.",
      "Pause briefly at the top.",
      "Lower slowly with control.",
    ],
    avoid: ["Pulling on your neck with your hands.", "Swinging up using momentum."],
    easier: "Cross your arms on your chest and lift less.",
    harder: "Lower for 3 seconds, or hold your feet off the floor.",
    rig: {
      view: "side", ms: 2000,
      frames: [
        { ...BACK, hN: [30, 85], hF: [29, 86], fN: [78, 92], fF: [76, 92] },
        { hip: [60, 90], t: -65, head: -55, hN: [32, 74], hF: [31, 75], fN: [78, 92], fF: [76, 92] },
      ],
    },
  },
  {
    key: "bicycle", name: "Bicycle crunches", aliases: ["bicycle crunch", "bicycle crunches", "bicycles"], unit: "reps", amount: 20, level: "medium", needs: null,
    muscles: "Abs, obliques (sides of the stomach)",
    counts: "One rep = one elbow-to-knee on one side. Alternate, so 20 reps = 10 each side.",
    steps: [
      "Lie on your back, hands lightly behind your head, legs lifted with knees bent.",
      "Lift your shoulders and bring one elbow towards the opposite knee.",
      "At the same time, straighten the other leg out.",
      "Switch sides in a slow pedalling motion.",
    ],
    avoid: ["Pulling your head forward.", "Rushing: slow and controlled works the stomach harder."],
    easier: "Keep the straight leg higher off the floor.",
    harder: "Lower the straight leg closer to the floor.",
    rig: {
      view: "side", ms: 1800,
      frames: [
        { hip: [60, 90], t: -62, head: -55, hN: [33, 73], hF: [32, 74], fN: [66, 74], fF: [94, 82] },
        { hip: [60, 90], t: -62, head: -55, hN: [33, 73], hF: [32, 74], fN: [94, 82], fF: [66, 74] },
      ],
    },
  },
  {
    key: "sideplank", name: "Side plank", aliases: ["side plank", "side planks"], unit: "seconds", amount: 20, level: "medium", needs: null,
    muscles: "Obliques (sides of the stomach), shoulders, hips",
    counts: "Seconds = how long you hold on one side. Do the same on the other side.",
    steps: [
      "Lie on your side with your elbow under your shoulder and your legs stacked.",
      "Lift your hips so your body is a straight line from head to feet.",
      "Keep your hips pushed forward, not sagging back. Reach the top arm up or rest it on your hip.",
      "Hold, then switch sides.",
    ],
    avoid: ["Hips dropping towards the floor.", "Shoulder shrugging up to your ear."],
    easier: "Keep your bottom knee on the floor.",
    harder: "Lift the top leg.",
    rig: {
      view: "front", ms: 3000, bend: { eN: 1 },
      frames: [
        { hip: [55, 84], t: 70, hN: [93, 92], hF: [80, 46], fN: [20, 92], fF: [20, 89] },
        { hip: [55, 82.6], t: 70, hN: [93, 92], hF: [80, 45], fN: [20, 92], fF: [20, 89] },
      ],
    },
  },
  {
    key: "superman", name: "Superman", aliases: ["superman", "supermans", "back extension"], unit: "reps", amount: 10, level: "easy", needs: null,
    muscles: "Lower back, glutes, upper back",
    counts: "One rep = lift your arms, chest and legs, hold briefly, and lower once.",
    steps: [
      "Lie face down with your arms stretched out in front of you.",
      "Squeeze your glutes and lift your arms, chest and legs a few centimetres off the floor.",
      "Hold for 1 to 2 seconds, looking at the floor.",
      "Lower slowly.",
    ],
    avoid: ["Craning your neck up: keep it in line with your spine.", "Jerking up high."],
    easier: "Lift only your arms, or only your legs.",
    harder: "Hold each rep for 5 seconds.",
    rig: {
      view: "side", ms: 2400, bend: { eN: -1, eF: -1 },
      frames: [
        { hip: [58, 90], t: 90, head: 90, hN: [109, 90], hF: [107, 90], fN: [22, 91], fF: [22, 89] },
        { hip: [58, 90], t: 80, head: 76, hN: [107, 79], hF: [105, 80], fN: [24, 84], fF: [24, 82] },
      ],
    },
  },
  {
    key: "legraise", name: "Leg raises", aliases: ["leg raise", "leg raises", "lying leg raise"], unit: "reps", amount: 12, level: "medium", needs: null,
    muscles: "Lower abs, hip flexors",
    counts: "One rep = raise both legs up and lower them back down once.",
    steps: [
      "Lie on your back, legs straight, hands flat by your sides or under your hips.",
      "Press your lower back into the floor.",
      "Keeping your legs straight, lift them until they point at the ceiling.",
      "Lower slowly and stop just before your heels touch the floor.",
    ],
    avoid: ["Your lower back arching off the floor.", "Dropping your legs quickly."],
    easier: "Bend your knees.",
    harder: "Lower more slowly, or hold them just above the floor.",
    rig: {
      view: "side", ms: 2600, bend: { eN: -1, eF: -1 },
      frames: [
        { ...BACK, hN: [59, 91], hF: [57, 91], fN: [96, 90], fF: [96, 88] },
        { ...BACK, hN: [59, 91], hF: [57, 91], fN: [62, 54], fF: [60, 54] },
      ],
    },
  },
  {
    key: "chairdip", name: "Chair dips", aliases: ["dip", "dips", "tricep dip", "tricep dips", "triceps dip", "chair dip", "bench dip"], unit: "reps", amount: 10, level: "medium", needs: "A sturdy chair",
    muscles: "Triceps (back of the arms), shoulders, chest",
    counts: "One rep = lower your hips by bending your elbows and press back up once.",
    steps: [
      "Sit on the edge of a sturdy chair that will not slide, hands gripping the edge next to your hips.",
      "Slide your hips forward off the seat, feet flat, knees bent.",
      "Bend your elbows straight back to about 90°, lowering your hips.",
      "Press through your palms to straighten your arms.",
    ],
    avoid: ["Elbows flaring out to the sides.", "Going so low that your shoulders hurt.", "A chair on wheels."],
    easier: "Bring your feet closer to the chair.",
    harder: "Straighten your legs.",
    rig: {
      view: "side", ms: 2200, prop: { kind: "chair", x: 24, w: 22, y: 70 },
      frames: [
        { hip: [50, 72], t: 0, hN: [45, 70], hF: [43, 70], fN: [76, 92], fF: [74, 92] },
        { hip: [50, 84], t: 4, hN: [45, 70], hF: [43, 70], fN: [76, 92], fF: [74, 92] },
      ],
    },
  },
  {
    key: "inclinepushup", name: "Incline push-ups", aliases: ["incline push up", "incline pushup", "desk push up", "desk pushup"], unit: "reps", amount: 12, level: "easy", needs: "A desk or table",
    muscles: "Chest, shoulders, triceps",
    counts: "One rep = lower your chest to the desk edge and push back once.",
    steps: [
      "Put your hands on the edge of a sturdy desk, a little wider than your shoulders.",
      "Walk your feet back until your body is a straight line from head to heels.",
      "Bend your elbows to bring your chest towards the edge.",
      "Push back to straight arms.",
    ],
    avoid: ["A desk that can slide or tip.", "Bending at the hips."],
    easier: "Use a higher surface, such as a wall.",
    harder: "Use a lower surface, then the floor.",
    rig: {
      view: "side", ms: 2200, prop: { kind: "desk", x: 84, w: 34, y: 74 },
      frames: [
        { hip: [50.4, 69.9], t: 52.2, hN: [86.3, 73.8], hF: [84.3, 73.8], fN: [22, 92], fF: [20, 92] },
        { hip: [53.2, 74], t: 60, hN: [86.3, 73.8], hF: [84.3, 73.8], fN: [22, 92], fF: [20, 92] },
      ],
    },
  },
  {
    key: "wallpushup", name: "Wall push-ups", aliases: ["wall push up", "wall pushup", "wall press"], unit: "reps", amount: 15, level: "easy", needs: "A wall",
    muscles: "Chest, shoulders, triceps",
    counts: "One rep = bring your chest to the wall and push back once.",
    steps: [
      "Stand an arm's length from a wall, hands on it at shoulder height, shoulder-width apart.",
      "Keep your body straight and heels down.",
      "Bend your elbows to bring your chest towards the wall.",
      "Push back to straight arms.",
    ],
    avoid: ["Letting your hips sag towards the wall."],
    easier: "Stand closer to the wall.",
    harder: "Step further back, or move to a desk (incline push-ups).",
    rig: {
      view: "side", ms: 2000, prop: { kind: "wall", x: 97 },
      frames: [
        { hip: [65.8, 56.5], t: 9.3, hN: [95, 33], hF: [95, 35], fN: [60, 92], fF: [58, 92] },
        { hip: [72.3, 58.2], t: 20, hN: [95, 33], hF: [95, 35], fN: [60, 92], fF: [58, 92] },
      ],
    },
  },
  {
    key: "sittostand", name: "Sit-to-stand", aliases: ["sit to stand", "chair squat", "chair stand", "chair squats"], unit: "reps", amount: 12, level: "easy", needs: "A chair",
    muscles: "Thighs, glutes",
    counts: "One rep = stand up from the chair and sit back down once.",
    steps: [
      "Sit near the front of a chair, feet flat and hip-width apart, arms crossed on your chest.",
      "Lean forward slightly and stand up fully without using your hands.",
      "Squeeze your glutes at the top.",
      "Sit back down slowly, with control.",
    ],
    avoid: ["Dropping into the chair.", "Knees caving inwards."],
    easier: "Use your hands on your thighs to help.",
    harder: "Only touch the seat lightly before standing again, or hold the bottom for 2 seconds.",
    rig: {
      view: "side", ms: 2600, prop: { kind: "chair", x: 28, w: 22, y: 70 },
      frames: [
        { hip: [60, 56], t: 0, hN: [68, 40], hF: [66, 40], fN: [63, 92], fF: [61, 92] },
        { hip: [46, 67], t: 30, hN: [66, 53], hF: [64, 53], fN: [63, 92], fF: [61, 92] },
      ],
    },
  },
  {
    key: "buttkick", name: "Butt kicks", aliases: ["butt kick", "butt kicks", "heel flicks"], unit: "seconds", amount: 30, level: "easy", needs: null,
    muscles: "Hamstrings, calves, heart rate (cardio)",
    counts: "Seconds = how long you keep jogging on the spot.",
    steps: [
      "Stand tall with your feet hip-width apart.",
      "Jog on the spot, kicking each heel up towards your glutes.",
      "Stay on the balls of your feet and swing your arms.",
      "Keep going for the time.",
    ],
    avoid: ["Leaning forward.", "Landing heavily."],
    easier: "Walk it: lift one heel at a time.",
    harder: "Go faster.",
    rig: {
      view: "side", ms: 700,
      frames: [
        { hip: [60, 54], t: 3, hN: [66, 40], hF: [54, 50], fN: [52, 68], fF: [61, 90] },
        { hip: [60, 54], t: 3, hN: [54, 50], hF: [66, 40], fN: [61, 90], fF: [52, 68] },
      ],
    },
  },
  {
    key: "armcircle", name: "Arm circles", aliases: ["arm circle", "arm circles"], unit: "seconds", amount: 30, level: "easy", needs: null,
    muscles: "Shoulders, upper back",
    counts: "Seconds = how long you keep circling. Switch direction halfway.",
    steps: [
      "Stand tall and raise your arms straight out to the sides at shoulder height.",
      "Make small circles forwards.",
      "Gradually make the circles bigger.",
      "Halfway through, switch to circling backwards.",
    ],
    avoid: ["Shrugging your shoulders up.", "Letting your arms drop below shoulder height."],
    easier: "Rest your arms briefly when they tire.",
    harder: "Hold a water bottle in each hand.",
    rig: {
      view: "front", ms: 1400,
      frames: [
        { hip: [60, 56], t: 0, hN: [92, 27], hF: [28, 27], fN: [64, 92], fF: [56, 92] },
        { hip: [60, 56], t: 0, hN: [95, 30], hF: [25, 30], fN: [64, 92], fF: [56, 92] },
        { hip: [60, 56], t: 0, hN: [92, 33], hF: [28, 33], fN: [64, 92], fF: [56, 92] },
        { hip: [60, 56], t: 0, hN: [89, 30], hF: [31, 30], fN: [64, 92], fF: [56, 92] },
      ],
    },
  },
  {
    key: "birddog", name: "Bird dog", aliases: ["bird dog", "bird dogs", "birddog"], unit: "reps", amount: 10, level: "easy", needs: null,
    muscles: "Core, lower back, glutes, balance",
    counts: "One rep = extend one arm and the opposite leg, hold, and return. Alternate sides.",
    steps: [
      "Get on your hands and knees: hands under your shoulders, knees under your hips.",
      "Brace your stomach and keep your back flat.",
      "Reach one arm forward and the opposite leg straight back until both are in line with your body.",
      "Hold for 2 seconds, return, and switch sides.",
    ],
    avoid: ["Hips tilting or twisting.", "Arching your lower back when the leg goes back."],
    easier: "Move only the arm, or only the leg.",
    harder: "Hold each rep for 5 seconds.",
    rig: {
      view: "side", ms: 4400,
      frames: [
        { ...FOURS },
        { ...FOURS, hN: [102, 62], fF: [16, 70] },
        { ...FOURS },
        { ...FOURS, hF: [100, 62], fN: [16, 70] },
      ],
    },
  },
  {
    key: "deadbug", name: "Dead bug", aliases: ["dead bug", "dead bugs", "deadbug"], unit: "reps", amount: 10, level: "easy", needs: null,
    muscles: "Deep core, abs",
    counts: "One rep = lower one arm and the opposite leg and bring them back. Alternate sides.",
    steps: [
      "Lie on your back, arms pointing at the ceiling, knees bent 90° above your hips.",
      "Press your lower back gently into the floor.",
      "Slowly lower one arm overhead and the opposite leg towards the floor.",
      "Return to the start and switch sides.",
    ],
    avoid: ["Your lower back lifting off the floor.", "Moving fast."],
    easier: "Move only the legs, and tap your heel to the floor.",
    harder: "Move more slowly, or hold a water bottle in your hands.",
    rig: {
      view: "side", ms: 4400,
      frames: [
        { ...BACK, hN: [34, 65], hF: [36, 65], fN: [78, 72], fF: [76, 72] },
        { ...BACK, hN: [10, 86], hF: [36, 65], fN: [78, 72], fF: [95, 86] },
        { ...BACK, hN: [34, 65], hF: [36, 65], fN: [78, 72], fF: [76, 72] },
        { ...BACK, hN: [34, 65], hF: [10, 86], fN: [95, 86], fF: [76, 72] },
      ],
    },
  },
  {
    key: "goodmorning", name: "Good mornings", aliases: ["good morning", "good mornings", "hip hinge", "hip hinges"], unit: "reps", amount: 12, level: "easy", needs: null,
    muscles: "Hamstrings, glutes, lower back",
    counts: "One rep = hinge forward and stand back up once.",
    steps: [
      "Stand with your feet hip-width apart, hands lightly behind your head, knees soft.",
      "Push your hips back and tip your chest forward, keeping your back flat.",
      "Go until you feel a stretch in the back of your thighs, about parallel to the floor.",
      "Squeeze your glutes to stand back up.",
    ],
    avoid: ["Rounding your back.", "Bending your knees into a squat."],
    easier: "Hinge only partway.",
    harder: "Go slower, or do it on one leg.",
    rig: {
      view: "side", ms: 2600,
      frames: [
        { hip: [60, 56], t: 0, hN: [56, 23], hF: [55, 24], fN: [62, 92], fF: [60, 92] },
        { hip: [53, 58], t: 80, hN: [76, 47], hF: [75, 48], fN: [62, 92], fF: [60, 92] },
      ],
    },
  },
  {
    key: "stepup", name: "Step-ups", aliases: ["step up", "step ups", "stair step"], unit: "reps", amount: 12, level: "easy", needs: "A stair or sturdy step",
    muscles: "Thighs, glutes, balance",
    counts: "One rep = step up onto the step and back down once. Alternate the leading leg.",
    steps: [
      "Stand facing a stair or sturdy, low step.",
      "Place one whole foot on the step.",
      "Press through that heel to bring your body up, then bring the other foot up.",
      "Step back down one foot at a time and switch the leading leg.",
    ],
    avoid: ["Pushing off the bottom foot: let the top leg do the work.", "A wobbly step."],
    easier: "Use a lower step and hold a rail.",
    harder: "Use a higher step, or drive the knee up at the top.",
    rig: {
      view: "side", ms: 3600, prop: { kind: "step", x: 66, w: 36, y: 76 },
      frames: [
        { hip: [48, 56], t: 0, hN: [49, 55], hF: [47, 55], fN: [49, 92], fF: [47, 92] },
        { hip: [62, 58], t: 12, hN: [70, 57], hF: [62, 56], fN: [76, 76], fF: [52, 92] },
        { hip: [77, 40], t: 0, hN: [78, 39], hF: [76, 39], fN: [78, 76], fF: [76, 76] },
        { hip: [62, 58], t: 12, hN: [70, 57], hF: [62, 56], fN: [76, 76], fF: [52, 92] },
      ],
    },
  },
  {
    key: "squatjump", name: "Squat jumps", aliases: ["squat jump", "squat jumps", "jump squat", "jump squats"], unit: "reps", amount: 10, level: "hard", needs: null,
    muscles: "Thighs, glutes, calves, power",
    counts: "One rep = squat down and jump up once.",
    steps: [
      "Stand with your feet shoulder-width apart.",
      "Squat down, swinging your arms back.",
      "Jump straight up, swinging your arms up.",
      "Land softly with bent knees, going straight into the next squat.",
    ],
    avoid: ["Landing with straight legs.", "Knees caving in on landing."],
    easier: "Do regular squats and rise onto your toes at the top.",
    harder: "Jump higher, or pause in the squat before each jump.",
    rig: {
      view: "side", ms: 2000,
      frames: [
        { ...STAND },
        { hip: [48, 73], t: 40, hN: [48, 66], hF: [46, 66], fN: [61, 92], fF: [59, 92] },
        { ...STAND, hN: [63, 6], hF: [61, 6], lift: 14 },
      ],
    },
  },
  {
    key: "inchworm", name: "Inchworms", aliases: ["inchworm", "inchworms", "walkout", "walk out"], unit: "reps", amount: 6, level: "medium", needs: null,
    muscles: "Hamstrings, shoulders, core",
    counts: "One rep = walk your hands out to a plank and back to standing once.",
    steps: [
      "Stand tall, then hinge forward and put your hands on the floor (bend your knees if you need to).",
      "Walk your hands forward until you are in a high plank.",
      "Walk your hands back towards your feet.",
      "Roll up to standing.",
    ],
    avoid: ["Hips sagging when you reach the plank."],
    easier: "Bend your knees more and walk out only partway.",
    harder: "Add a push-up in the plank.",
    rig: {
      view: "side", ms: 4400,
      frames: [
        { hip: [30, 56], t: 0, hN: [31, 55], hF: [29, 55], fN: [31, 92], fF: [29, 92] },
        { hip: [28, 58], t: 145, hN: [50, 92], hF: [48, 92], fN: [31, 92], fF: [29, 92] },
        { hip: [63.9, 77.4], t: 66, hN: [88, 92], hF: [86, 92], fN: [31, 92], fF: [29, 92] },
        { hip: [28, 58], t: 145, hN: [50, 92], hF: [48, 92], fN: [31, 92], fF: [29, 92] },
      ],
    },
  },
  {
    key: "shoulderblade", name: "Shoulder blade squeeze", aliases: ["shoulder blade squeeze", "scapular squeeze", "scapula squeeze", "shoulder squeeze"], unit: "reps", amount: 15, level: "easy", needs: null,
    muscles: "Upper back, posture muscles",
    counts: "One rep = squeeze your shoulder blades together, hold, and release once.",
    steps: [
      "Sit or stand tall, arms bent 90° with elbows by your sides.",
      "Pull your elbows back and squeeze your shoulder blades together.",
      "Hold for about 3 seconds.",
      "Relax and repeat. Good for breaking up long desk sessions.",
    ],
    avoid: ["Shrugging your shoulders up to your ears.", "Arching your lower back."],
    easier: "Hold for a shorter time.",
    harder: "Hold for 5 to 10 seconds.",
    rig: {
      view: "side", ms: 2400,
      frames: [
        { ...STAND, hN: [72, 44], hF: [70, 44] },
        { ...STAND, hN: [62, 42], hF: [60, 42] },
      ],
    },
  },
  {
    key: "hamstringstretch", name: "Hamstring stretch", aliases: ["hamstring stretch", "toe touch", "toe touches", "forward fold"], unit: "seconds", amount: 30, level: "easy", needs: null,
    muscles: "Hamstrings, lower back (stretch)",
    counts: "Seconds = how long you hold the stretch.",
    steps: [
      "Stand with your feet hip-width apart and your knees soft.",
      "Hinge forward from your hips and let your hands reach towards your toes.",
      "Stop where you feel a gentle stretch in the back of your thighs.",
      "Hold and breathe slowly. Do not bounce.",
    ],
    avoid: ["Bouncing.", "Forcing it into pain."],
    easier: "Bend your knees more, or rest your hands on your shins.",
    harder: "Straighten your knees a little more over time.",
    rig: {
      view: "side", ms: 3600,
      frames: [
        { hip: [56, 57], t: 125, hN: [64, 89], hF: [62, 89], fN: [62, 92], fF: [60, 92] },
        { hip: [55, 57.5], t: 135, hN: [64, 91], hF: [62, 91], fN: [62, 92], fF: [60, 92] },
      ],
    },
  },
  {
    key: "hollowhold", name: "Hollow hold", aliases: ["hollow hold", "hollow body", "hollow body hold"], unit: "seconds", amount: 20, level: "hard", needs: null,
    muscles: "Abs, deep core",
    counts: "Seconds = how long you hold the shape with your lower back on the floor.",
    steps: [
      "Lie on your back and press your lower back into the floor.",
      "Lift your shoulders and straight legs off the floor.",
      "Reach your arms overhead (or keep them by your sides).",
      "Hold the banana shape, breathing steadily.",
    ],
    avoid: ["Your lower back lifting off the floor: raise your legs higher if it does."],
    easier: "Bend your knees, arms by your sides.",
    harder: "Lower your legs and arms closer to the floor.",
    rig: {
      view: "side", ms: 3000,
      frames: [
        { hip: [60, 89], t: -72, head: -65, hN: [12, 76], hF: [13, 74], fN: [95, 80], fF: [95, 78] },
        { hip: [60, 89], t: -74, head: -66, hN: [12, 77], hF: [13, 75], fN: [95, 81], fF: [95, 79] },
      ],
    },
  },
  {
    key: "pikepushup", name: "Pike push-ups", aliases: ["pike push up", "pike pushup", "pike push ups"], unit: "reps", amount: 8, level: "hard", needs: null,
    muscles: "Shoulders, triceps, upper chest",
    counts: "One rep = lower the top of your head towards the floor and press back up once.",
    steps: [
      "Start in an upside-down V: hands shoulder-width apart, hips high, legs as straight as is comfortable.",
      "Bend your elbows and lower the top of your head towards the floor between your hands.",
      "Keep your hips high the whole time.",
      "Press back up to straight arms.",
    ],
    avoid: ["Letting it turn into a normal push-up (hips dropping).", "Elbows flaring wide."],
    easier: "Do a smaller bend, or put your knees down.",
    harder: "Put your feet up on a step.",
    rig: {
      view: "side", ms: 2400,
      frames: [
        { hip: [58, 62], t: 105, hN: [90, 92], hF: [88, 92], fN: [40, 92], fF: [38, 92] },
        { hip: [60, 66], t: 125, hN: [90, 92], hF: [88, 92], fN: [40, 92], fF: [38, 92] },
      ],
    },
  },
  {
    key: "sidelunge", name: "Side lunges", aliases: ["side lunge", "side lunges", "lateral lunge", "lateral lunges"], unit: "reps", amount: 10, level: "medium", needs: null,
    muscles: "Inner and outer thighs, glutes",
    counts: "One rep = lunge to one side and push back to the middle. Alternate sides.",
    steps: [
      "Stand with your feet wide apart, toes forward, hands together at your chest.",
      "Shift your weight to one side, bending that knee and pushing your hips back.",
      "Keep the other leg straight and both feet flat on the floor.",
      "Push back to the middle and switch sides.",
    ],
    avoid: ["The bent knee caving in past your toes.", "Lifting the heel of the bent leg."],
    easier: "Go only halfway down.",
    harder: "Pause at the bottom for 2 seconds.",
    rig: {
      view: "front", ms: 3000,
      frames: [
        { hip: [60, 60], t: 0, hN: [63, 44], hF: [57, 44], fN: [76, 92], fF: [44, 92] },
        { hip: [68, 72], t: 0, hN: [71, 56], hF: [65, 56], fN: [76, 92], fF: [44, 92] },
        { hip: [60, 60], t: 0, hN: [63, 44], hF: [57, 44], fN: [76, 92], fF: [44, 92] },
        { hip: [52, 72], t: 0, hN: [55, 56], hF: [49, 56], fN: [76, 92], fF: [44, 92] },
      ],
    },
  },
  {
    key: "kickback", name: "Glute kickbacks", aliases: ["glute kickback", "glute kickbacks", "donkey kick", "donkey kicks", "kickbacks"], unit: "reps", amount: 12, level: "easy", needs: null,
    muscles: "Glutes, hamstrings",
    counts: "One rep = kick one leg back and up and bring it back once. Do all reps, then switch legs.",
    steps: [
      "Get on your hands and knees, hands under your shoulders, knees under your hips.",
      "Keep your back flat and your stomach braced.",
      "Kick one leg straight back and up until it is in line with your body, squeezing your glute.",
      "Lower it with control. Finish the set, then switch legs.",
    ],
    avoid: ["Arching your lower back to lift higher.", "Swinging the leg."],
    easier: "Keep the knee bent at 90° and lift the foot towards the ceiling.",
    harder: "Pause for 2 seconds at the top.",
    rig: {
      view: "side", ms: 2000,
      frames: [{ ...FOURS }, { ...FOURS, fN: [18, 62] }],
    },
  },
  {
    key: "shadowbox", name: "Shadow boxing", aliases: ["shadow boxing", "shadowbox", "punches", "boxing"], unit: "seconds", amount: 30, level: "easy", needs: null,
    muscles: "Shoulders, arms, core, heart rate (cardio)",
    counts: "Seconds = how long you keep punching.",
    steps: [
      "Stand with one foot in front, knees soft, fists up by your chin.",
      "Punch one arm straight out at shoulder height, turning your hips and shoulders slightly.",
      "Pull it back to your chin as the other arm punches.",
      "Keep moving on the balls of your feet for the time.",
    ],
    avoid: ["Locking your elbow hard at full reach.", "Dropping your guard hand."],
    easier: "Punch slower and keep your feet still.",
    harder: "Go faster and add squats between combinations.",
    rig: {
      view: "side", ms: 900,
      frames: [
        { hip: [58, 58], t: 5, hN: [85, 33], hF: [66, 28], fN: [70, 92], fF: [48, 92] },
        { hip: [58, 58], t: 5, hN: [68, 28], hF: [84, 33], fN: [70, 92], fF: [48, 92] },
      ],
    },
  },
  {
    key: "seatedlegext", name: "Seated leg extensions", aliases: ["seated leg extension", "seated leg extensions", "leg extension", "leg extensions"], unit: "reps", amount: 15, level: "easy", needs: "A chair",
    muscles: "Front of the thighs (quads)",
    counts: "One rep = straighten one knee, hold, and lower once. Do all reps, then switch legs.",
    steps: [
      "Sit tall near the front of a chair, hands holding the seat.",
      "Straighten one knee until your leg is straight out in front of you.",
      "Squeeze the front of your thigh for 2 seconds.",
      "Lower slowly. Finish the set, then switch legs. Easy to do at your desk.",
    ],
    avoid: ["Slouching back in the chair.", "Swinging the leg up."],
    easier: "Lift only partway.",
    harder: "Hold for 5 seconds at the top.",
    rig: {
      view: "side", ms: 2400, prop: { kind: "chair", x: 26, w: 22, y: 70 },
      frames: [
        { hip: [44, 68], t: -3, hN: [50, 68], hF: [48, 68], fN: [62, 92], fF: [60, 92] },
        { hip: [44, 68], t: -3, hN: [50, 68], hF: [48, 68], fN: [79, 64], fF: [60, 92] },
      ],
    },
  },
];

const BY_KEY = new Map(EXERCISES.map((e) => [e.key, e]));

export function exerciseByKey(key: string): ExerciseInfo | null {
  return BY_KEY.get(key) ?? null;
}

/** "Push-ups", "push ups", "Pushup" all become "pushup". */
export function normName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "").replace(/s$/, "").replace(/e$/, "");
}

const BY_NAME = new Map<string, ExerciseInfo>();
for (const e of EXERCISES) for (const n of [e.name, e.key, ...e.aliases]) if (!BY_NAME.has(normName(n))) BY_NAME.set(normName(n), e);

/** The catalogue entry for a user's exercise type, matched by name. Custom exercises return null. */
export function catalogFor(name: string): ExerciseInfo | null {
  return BY_NAME.get(normName(name)) ?? null;
}

// ---------------------------------------------------------------- the figure

export const LEN = { torso: 26, neck: 7, upper: 13, fore: 12, thigh: 18, shin: 18, foot: 5 };
export const GROUND = 92;
/** the top of the drawing area: jumps with arms overhead go above y = 0 */
export const TOP = -14;

/** Two-bone IK: the joint and the end point, reaching from root towards target. bend picks the side of the joint. */
export function reach(root: Pt, target: Pt, l1: number, l2: number, bend: number): [Pt, Pt] {
  const dx = target[0] - root[0];
  const dy = target[1] - root[1];
  const d = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / d;
  const uy = dy / d;
  const dc = Math.min(l1 + l2 - 1e-3, Math.max(Math.abs(l1 - l2) + 1e-3, d));
  const a = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc)))) * bend;
  const joint: Pt = [root[0] + l1 * (ux * Math.cos(a) - uy * Math.sin(a)), root[1] + l1 * (ux * Math.sin(a) + uy * Math.cos(a))];
  const ex = target[0] - joint[0];
  const ey = target[1] - joint[1];
  const e = Math.hypot(ex, ey) || 1e-6;
  return [joint, [joint[0] + (ex / e) * l2, joint[1] + (ey / e) * l2]];
}

export interface Skeleton {
  head: Pt;
  neck: Pt;
  hip: Pt;
  /** shoulder, elbow, hand / hip joint, knee, ankle, toe; near then far */
  arms: [Pt, Pt, Pt][];
  legs: [Pt, Pt, Pt, Pt | null][];
}

const rad = (d: number) => (d * Math.PI) / 180;
const up = (deg: number): Pt => [Math.sin(rad(deg)), -Math.cos(rad(deg))];

/** Joint positions for one pose. */
export function solve(rig: Rig, p: Pose): Skeleton {
  const lift = p.lift ?? 0;
  const hip: Pt = [p.hip[0], p.hip[1] - lift];
  const at = (q: Pt): Pt => [q[0], q[1] - lift];
  const td = up(p.t);
  const neck: Pt = [hip[0] + td[0] * LEN.torso, hip[1] + td[1] * LEN.torso];
  const hd = up(p.head ?? p.t);
  const head: Pt = [neck[0] + hd[0] * LEN.neck, neck[1] + hd[1] * LEN.neck];
  const front = rig.view === "front";
  // in the front view the two sides sit apart, across the torso
  const perp: Pt = [Math.cos(rad(p.t)), Math.sin(rad(p.t))];
  const off = (base: Pt, k: number): Pt => (front ? [base[0] + perp[0] * k, base[1] + perp[1] * k] : base);
  const b = rig.bend ?? {};
  const eN = b.eN ?? (front ? -1 : 1);
  const eF = b.eF ?? 1;
  const kN = b.kN ?? -1;
  const kF = b.kF ?? (front ? 1 : -1);
  const arm = (sh: Pt, target: Pt, bend: number): [Pt, Pt, Pt] => {
    const [elbow, hand] = reach(sh, at(target), LEN.upper, LEN.fore, bend);
    return [sh, elbow, hand];
  };
  const leg = (hp: Pt, target: Pt, bend: number): [Pt, Pt, Pt, Pt | null] => {
    const [knee, ankle] = reach(hp, at(target), LEN.thigh, LEN.shin, bend);
    const ft = rad(p.ft ?? 0);
    return [hp, knee, ankle, front ? null : [ankle[0] + Math.cos(ft) * LEN.foot, ankle[1] + Math.sin(ft) * LEN.foot]];
  };
  return {
    head,
    neck,
    hip,
    arms: [arm(off(neck, 5), p.hN, eN), arm(off(neck, -5), p.hF, eF)],
    legs: [leg(off(hip, 3), p.fN, kN), leg(off(hip, -3), p.fF, kF)],
  };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpPt = (a: Pt, b: Pt, k: number): Pt => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
const ease = (k: number) => 0.5 - Math.cos(Math.PI * k) / 2;

/** The pose at a point in the cycle (phase 0..1), easing between key poses. */
export function poseAt(rig: Rig, phase: number): Pose {
  const n = rig.frames.length;
  if (n === 1) return rig.frames[0];
  const x = (((phase % 1) + 1) % 1) * n;
  const i = Math.floor(x);
  const a = rig.frames[i];
  const b = rig.frames[(i + 1) % n];
  const k = ease(x - i);
  return {
    hip: lerpPt(a.hip, b.hip, k),
    t: lerp(a.t, b.t, k),
    head: lerp(a.head ?? a.t, b.head ?? b.t, k),
    hN: lerpPt(a.hN, b.hN, k),
    hF: lerpPt(a.hF, b.hF, k),
    fN: lerpPt(a.fN, b.fN, k),
    fF: lerpPt(a.fF, b.fF, k),
    ft: lerp(a.ft ?? 0, b.ft ?? 0, k),
    lift: lerp(a.lift ?? 0, b.lift ?? 0, k),
  };
}

/** A plain-language explanation of an amount, e.g. "20 reps per set" with what that means. */
export function amountMeaning(unit: Unit, amount: number, info?: ExerciseInfo | null): string {
  const base = unit === "seconds"
    ? `${amount} seconds per set: hold the position, or keep moving, for ${amount} seconds.`
    : `${amount} reps per set: do the movement ${amount} times in a row.`;
  return info ? `${base} ${info.counts}` : base;
}

// ---------------------------------------------------------------- 3D

export type P3 = readonly [number, number, number];

/** A body in 3D: X forward (where the person faces), Y up from the floor, Z to the person's left. */
export interface Body3 {
  head: P3;
  neck: P3;
  hip: P3;
  /** shoulder, elbow, hand; near (left) then far (right) */
  arms: [P3, P3, P3][];
  /** hip joint, knee, ankle, toe */
  legs: [P3, P3, P3, P3 | null][];
}

/** Half the shoulder and hip width, used to spread the side view's two arms and legs apart. */
const SHOULDER_HALF = 4.6;
const HIP_HALF = 3.2;

/**
 * Lifts a solved 2D skeleton into 3D. Side-view rigs move in the X/Y plane and their two sides sit apart along Z;
 * front-view rigs move in the Z/Y plane (their drawing's x is the person's left-right).
 */
export function toBody3(rig: Rig, s: Skeleton): Body3 {
  const front = rig.view === "front";
  const at = (p: Pt, z: number): P3 => (front ? [0, GROUND - p[1], -(p[0] - 60)] : [p[0] - 60, GROUND - p[1], z]);
  const side = (i: number, half: number) => (i === 0 ? half : -half);
  return {
    head: at(s.head, 0),
    neck: at(s.neck, 0),
    hip: at(s.hip, 0),
    arms: s.arms.map((a, i) => a.map((p) => at(p, side(i, SHOULDER_HALF))) as [P3, P3, P3]),
    legs: s.legs.map((l, i) => l.map((p) => (p ? at(p, side(i, HIP_HALF)) : null)) as [P3, P3, P3, P3 | null]),
  };
}

/** Props as boxes in the same 3D space: [x0, x1, y0, y1, z0, z1]. */
export function propBoxes(rig: Rig): [number, number, number, number, number, number][] {
  const p = rig.prop;
  if (!p) return [];
  const Y = (y: number) => GROUND - y;
  if (p.kind === "wall") return [[p.x - 60 - 0.8, p.x - 60 + 0.8, 0, 96, -24, 24]];
  if (p.kind === "step") return [[p.x - 60, p.x - 60 + p.w, 0, Y(p.y), -16, 16]];
  const top = Y(p.y);
  const x0 = p.x - 60;
  const x1 = x0 + p.w;
  const legs: [number, number, number, number, number, number][] = [];
  for (const lx of [x0 + 1, x1 - 2]) for (const lz of [-11, 10]) legs.push([lx, lx + 1, 0, top, lz, lz + 1]);
  const seat: [number, number, number, number, number, number] = [x0, x1, top - 1.6, top, -12, 12];
  if (p.kind === "desk") return [seat, ...legs];
  // chair: seat, legs, and a back on the side away from where the person faces
  return [seat, ...legs, [x0 - 1, x0 + 0.6, top, top + 24, -12, 12]];
}
