-- 1) "Show from": a time of day before which a task stays off Today's list (e.g. a daily task that only makes
--    sense after 18:00). Local wall-clock time, HH:MM.
alter table tasks add column if not exists show_from text
  check (show_from is null or show_from ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- 2) The exercise library: every exercise the app can demonstrate (src/lib/exercise-catalog.ts) joins the owner's
--    list, unless one with the same name (in any spelling: "Push-ups", "pushup", ...) is already there. Names are
--    compared the way normName() does: letters only, a trailing "s" and then "e" dropped.
insert into exercise_types (name, default_amount, unit, sort)
select v.name, v.amount, v.unit, coalesce((select max(sort) from exercise_types), 0) + v.ord
from (values
  ('Squats', 15, 'reps', 1, array['squat', 'airsquat', 'bodyweightsquat']),
  ('Push-ups', 10, 'reps', 2, array['pushup', 'pressup']),
  ('Plank', 30, 'seconds', 3, array['plank', 'forearmplank', 'plankhold']),
  ('Lunges', 12, 'reps', 4, array['lung', 'forwardlung', 'splitsquat', 'reverselung']),
  ('Jumping jacks', 30, 'reps', 5, array['jumpingjack', 'starjump']),
  ('Wall sit', 30, 'seconds', 6, array['wallsit', 'wallsquat']),
  ('Glute bridge', 15, 'reps', 7, array['glutebridg', 'hipbridg', 'bridg']),
  ('Calf raises', 20, 'reps', 8, array['calfrais', 'heelrais']),
  ('High knees', 30, 'seconds', 9, array['highkne', 'runninginplac', 'marching']),
  ('Mountain climbers', 30, 'seconds', 10, array['mountainclimber']),
  ('Burpees', 8, 'reps', 11, array['burpe']),
  ('Crunches', 15, 'reps', 12, array['crunch', 'situp']),
  ('Bicycle crunches', 20, 'reps', 13, array['bicyclecrunch', 'bicycl']),
  ('Side plank', 20, 'seconds', 14, array['sideplank']),
  ('Superman', 10, 'reps', 15, array['superman', 'backextension']),
  ('Leg raises', 12, 'reps', 16, array['legrais', 'lyinglegrais']),
  ('Chair dips', 10, 'reps', 17, array['chairdip', 'dip', 'tricepdip', 'tricepsdip', 'benchdip']),
  ('Incline push-ups', 12, 'reps', 18, array['inclinepushup', 'deskpushup']),
  ('Wall push-ups', 15, 'reps', 19, array['wallpushup', 'wallpres']),
  ('Sit-to-stand', 12, 'reps', 20, array['sittostand', 'chairsquat', 'chairstand']),
  ('Butt kicks', 30, 'seconds', 21, array['buttkick', 'heelflick']),
  ('Arm circles', 30, 'seconds', 22, array['armcircl']),
  ('Bird dog', 10, 'reps', 23, array['birddog']),
  ('Dead bug', 10, 'reps', 24, array['deadbug']),
  ('Good mornings', 12, 'reps', 25, array['goodmorning', 'hiphing']),
  ('Step-ups', 12, 'reps', 26, array['stepup', 'stairstep']),
  ('Squat jumps', 10, 'reps', 27, array['squatjump', 'jumpsquat']),
  ('Inchworms', 6, 'reps', 28, array['inchworm', 'walkout']),
  ('Shoulder blade squeeze', 15, 'reps', 29, array['shoulderbladesqueez', 'shoulderblad', 'scapularsqueez', 'scapulasqueez', 'shouldersqueez']),
  ('Hamstring stretch', 30, 'seconds', 30, array['hamstringstretch', 'toetouch', 'forwardfold']),
  ('Hollow hold', 20, 'seconds', 31, array['hollowhold', 'hollowbody', 'hollowbodyhold']),
  ('Pike push-ups', 8, 'reps', 32, array['pikepushup']),
  ('Side lunges', 10, 'reps', 33, array['sidelung', 'laterallung']),
  ('Glute kickbacks', 12, 'reps', 34, array['glutekickback', 'kickback', 'donkeykick']),
  ('Shadow boxing', 30, 'seconds', 35, array['shadowboxing', 'shadowbox', 'punch', 'boxing']),
  ('Seated leg extensions', 15, 'reps', 36, array['seatedlegextension', 'seatedlegext', 'legextension'])
) as v(name, amount, unit, ord, keys)
where not exists (
  select 1 from exercise_types t
  where regexp_replace(regexp_replace(regexp_replace(lower(t.name), '[^a-z]', '', 'g'), 's$', ''), 'e$', '') = any (v.keys)
);
