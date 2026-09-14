# 👻 Ghost Escape — prototype (6 levels)

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

## Level 5 flow — "Distraction"

Two sentries, each planted in front of a narrow doorway, never looking away.
No amount of waiting opens either one — the only thing that moves a sentry is
a noise somewhere else, and each noise is only loud enough to reach the guard
it is meant for.

1. Slip down the middle lane of the start room to the **radio** (it sits beyond
   the first sentry's reach, so ringing it is safe) and set it off.
2. They trudge down the middle lane to investigate. Go back up the **west
   lane** — the guard's route and yours never share a corridor — and through
   the first doorway behind them.
3. In the middle room, cross to the **alarm clock** on the east side and ring
   that. The second sentry leaves their doorway to look.
4. Take the southern way round while they walk east, then up through the second
   doorway and out.

Verified by simulation: with both sentries at their posts, every lane of both
doorways is seen at every point in their shuffle — so neither passage can be
crossed without its noise.

## Level 6 flow — "Light & Shadow"

Here the light **burns**. Both lamps have to be dealt with.

1. The only way out of the start room is a doorway flooded by a **standing
   lamp**, and the lit stretch beyond it is far too deep to sprint: every lane
   and both diagonals fill the danger timer before you are clear. Approach the
   lamp from below, where its beam does not reach, and switch it off.
2. Cross the hallway and go up to the **table lamp** at the mouth of the exit
   corridor. Their vision cone is a fixed size here — darkness hides you from
   the lamps, not from them.
3. Its beam starts pointing straight up that corridor, which makes the last
   stretch lethal on every lane. Possess it and **drag left or right**: swing
   the beam onto one side and the opposite lane of the corridor goes dark.
4. Walk up the dark lane to the door.

Every lamp you touch gives you away. Flicking lamp 1 either way, or swinging
lamp 2 by more than about ten degrees, makes the housemate stop, show a '?',
and come over: they walk a little faster than usual, look left, look right,
then go back to their round. While they are suspicious they also peer much
over, so the trick is **change the
light, leave the lamp, and hide** — the flower pot sits near lamp 1 and the
cardboard box near lamp 2. Sitting inside the lamp they are inspecting does
not work: you get one shouted warning and then you are caught.

## Light hazard

Standing in warm light starts a 1.5 second timer (shown as a bar over the
ghost, plus a red vignette). Leave the light and the ghost recovers. Stay, and
the level restarts. Levels 2–5 have no burning light (only being seen); level 6 brings it back as the core puzzle.

## Code layout

Everything lives in one file, `game.js`, split into commented sections:

| Section | Contents |
|---|---|
| 0 | constants, math helpers |
| 1 | `SFX` — tiny Web Audio blip synth, initialised on first user gesture |
| 2 | `Particles` — one flat pool |
| 3 | `Input` — keyboard + invisible drag-to-move (pointer events) |
| 4 | `Collide` — circle vs AABB / circle |
| 5 | `LightHazard`, `Possessable` (`FloorLamp`, `RotatingLamp`, `ToyCar`, `Fan`, `HideSpot`, `PushBox`, `DistractionObject`), `PressurePlate`, `Gate`, `KeyPickup`, `ExitDoor`, `Ghost`, `Human` |
| 6 | `buildLevel1()`…`buildLevel6()` and the `LEVELS` list |
| 7 | `Draw` — procedural room rendering |
| 8 | `Game` — state machine, main loop, UI glue |

Each level is data in its build function: move a rect, move the furniture. Add a
level by writing `buildLevel7()` and appending an entry to `LEVELS` — the loop,
the UI and the transition card pick it up automatically. Systems are opt-in per
level: a level with no `plate`/`car`/`lamp` simply omits them, and one with
`humans` gets patrol, vision cones and detection for free.
`window.GhostEscape` exposes the systems for poking around in a console.

## Known limitations (prototype)

* Six levels. Finishing the last one shows a PROTOTYPE COMPLETE screen.
* One housemate per level; they never search, chase or hear anything yet.
* Audio is synthesised placeholder blips, no music.
* Collision is axis-aligned boxes and circles only — no slopes or rotation.
* The fan's wind is cosmetic; it does not push anything yet.
