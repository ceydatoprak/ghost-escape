# 👻 Ghost Escape — prototype (5 levels)

A cute, cozy little puzzle game for phones. You are a small ghost stuck in a
nighttime room. Warm light burns you, so you stay in the shadows — and when the
shadows run out, you **possess** the furniture and change the room instead.

Pure HTML5 + CSS + vanilla JavaScript. No frameworks, no build step, no npm.

## Play

Open `index.html` in any modern browser, or serve the folder:

```bash
npx serve .
```

It is also GitHub-Pages ready: push and enable Pages on the repository root.

## Controls

| | Desktop | Mobile |
|---|---|---|
| Move | `WASD` / arrow keys | drag anywhere in the play area (invisible, no on-screen stick) |
| Possess / toggle | `E`, `Space`, or click the object | big button, bottom-right, or tap the object |
| Release | `Q`, `Esc` | `RELEASE` button |
| Restart | ↻ button, top-right | ↻ button, top-right |
| Pick a level | number keys `1`–`9`, or the ⊞ button | ⊞ button, top-right (also on the title and finish screens) |

## Level 1 flow

1. Float up from the rug — the doorway is blocked by a wall of lamplight.
2. Approach the floor lamp from below (its light only shines upward) and
   **POSSESS** it.
3. **TURN OFF** the lamp. The light dies permanently, the doorway is safe.
4. **RELEASE**, slip through the doorway into the bedroom.
5. **POSSESS** the toy car and drive it onto the pressure plate — a ghost is far
   too light to press it itself.
6. The exit door unlocks. Release the car (it must stay on the plate) and float
   out the door.

The fan is a third possessable object; it is not needed to finish the level and
exists to show that different objects can do different things.

## Level 2 flow — "First Human"

Three rooms stacked bottom → middle → top, joined by two offset doorways. One
housemate paces the middle room and sweeps both doorways in turn. There is no
burning light here at all: the only danger is being looked at.

1. Start in the living room and slip into the **flower pot** beside the right
   doorway while they are looking that way.
2. When they wander off, cross into the middle room.
3. Hide in the **cardboard box** on their route until they walk back.
4. Cross to the far doorway — the **teddy bear** just beyond it is the last safe
   spot while they peek through.
5. Float out of the exit door.

Being seen restarts the level: they get a surprise "!", the cone flashes, then
the room resets. Walls block sight, so a doorway you cannot see through is a
doorway they cannot see through either.

## Level 3 flow — "Hide and Seek"

Same rules as level 2, turned into a timing puzzle. Four zones stacked bottom →
top, separated by three walls whose doorways alternate right, left, right, so
the route zig-zags. The housemate walks that same zig-zag the other way and
crosses your path at every doorway, ending with a look around the exit room
before turning back.

Four hiding places, one per exposed stretch:

1. **Flower pot** — before the first doorway.
2. **Cardboard box** — sitting right on their corridor.
3. **Teddy bear** — just past the left doorway.
4. **Laundry basket** — below the last doorway, before the run to the exit.

The start corner and the exit room are never patrolled, so you always get a
quiet moment to watch the route first. Every crossing has a window several
times longer than the ghost needs (9–18 s of clear time against 0.6–2.4 s of
travel), but the windows are in different parts of the cycle: sprinting the
whole route without hiding gets caught from most starting moments.

## Level 4 flow — "The Locked Door"

Three rooms, and this time the exit is visible from the start but **locked** —
bump into it and the door rattles, clicks, and shows a key. The key sits in a
walled alcove whose barred gate only opens while something heavy holds the
floor button down, and a wire along the floor spells out button → gate.

1. Cross into the middle room from the start room's doorway, using the **flower
   pot** by the door while the housemate is at that end.
2. Possess the **cardboard box** — this one you can *push*. It moves at about
   half the ghost's speed and collides with everything.
3. Shove it onto the **floor button**. The gate drops, for good.
4. Leave the box (the button stays held) and cross the room to the alcove.
5. Walk into the **key** to pick it up; it then trails along behind the ghost.
6. Hide in the **teddy bear** or **laundry basket** while the housemate sweeps,
   then slip up through the doorway to the exit. The key turns the lock as the
   ghost arrives.

Being seen resets everything: the box returns home, the gate re-closes, the key
goes back, and the door locks again.

## Level 5 flow — "Light & Shadow"

The lighting itself is the puzzle. Lit floor is dangerous at a distance — the
housemate sees 260px into it — while in darkness they only notice you inside
60px. Their vision cone shows both: the long reach is drawn *only over lit
floor*, with a short bright core that catches you anywhere. Two lamps are
yours to rearrange, and walls cast real shadows out of every light.

1. The start corner is dark. The only doorway out is washed in light from a
   **standing lamp** — approach it from below, where its beam does not reach.
2. Possess it and **TURN OFF**. The doorway goes dark; if they are close by
   they glance over with a "?" and lose a second before carrying on.
3. Cross, using the **laundry basket** and **cardboard box** while they pace.
4. Past the middle doorway sits the **table lamp**, right at the fork. Its beam
   starts aimed up the right-hand way. Possess it and **drag left or right** to
   swing the beam — the dial shows its limits.
5. Aim it at the way you are *not* taking, then walk up the dark one. Aiming it
   straight up is the trap: both ways go dark but the door itself lights up.

Measured over a full patrol, each gate roughly doubles your chances: the lit
doorway is caught from 6 of 24 start moments versus 3 in the dark, and a route
with the beam on it 14/24 versus 8/24 with the beam aimed away. Hiding and
timing still matter — the light only ever shifts the odds.

## Light hazard

Standing in warm light starts a 1.5 second timer (shown as a bar over the
ghost, plus a red vignette). Leave the light and the ghost recovers. Stay, and
the level restarts. (Levels 2–5 have no burning light — only being seen.)

## Code layout

Everything lives in one file, `game.js`, split into commented sections:

| Section | Contents |
|---|---|
| 0 | constants, math helpers |
| 1 | `SFX` — tiny Web Audio blip synth, initialised on first user gesture |
| 2 | `Particles` — one flat pool |
| 3 | `Input` — keyboard + invisible drag-to-move (pointer events) |
| 4 | `Collide` — circle vs AABB / circle |
| 5 | `LightHazard`, `Possessable` (`FloorLamp`, `RotatingLamp`, `ToyCar`, `Fan`, `HideSpot`, `PushBox`), `PressurePlate`, `Gate`, `KeyPickup`, `ExitDoor`, `Ghost`, `Human` |
| 6 | `buildLevel1()`…`buildLevel5()` and the `LEVELS` list |
| 7 | `Draw` — procedural room rendering |
| 8 | `Game` — state machine, main loop, UI glue |

Each level is data in its build function: move a rect, move the furniture. Add a
level by writing `buildLevel6()` and appending an entry to `LEVELS` — the loop,
the UI and the transition card pick it up automatically. Systems are opt-in per
level: a level with no `plate`/`car`/`lamp` simply omits them, and one with
`humans` gets patrol, vision cones and detection for free.
`window.GhostEscape` exposes the systems for poking around in a console.

## Known limitations (prototype)

* Five levels. On the last one `NEXT LEVEL` replays it.
* One housemate per level; they never search, chase or hear anything yet.
* Audio is synthesised placeholder blips, no music.
* Collision is axis-aligned boxes and circles only — no slopes or rotation.
* The fan's wind is cosmetic; it does not push anything yet.
