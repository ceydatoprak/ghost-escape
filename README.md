# 👻 Ghost Escape — prototype (2 levels)

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

## Light hazard

Standing in warm light starts a 1.5 second timer (shown as a bar over the
ghost, plus a red vignette). Leave the light and the ghost recovers. Stay, and
the level restarts.

## Code layout

Everything lives in one file, `game.js`, split into commented sections:

| Section | Contents |
|---|---|
| 0 | constants, math helpers |
| 1 | `SFX` — tiny Web Audio blip synth, initialised on first user gesture |
| 2 | `Particles` — one flat pool |
| 3 | `Input` — keyboard + invisible drag-to-move (pointer events) |
| 4 | `Collide` — circle vs AABB / circle |
| 5 | `LightHazard`, `Possessable` (`FloorLamp`, `ToyCar`, `Fan`, `HideSpot`), `PressurePlate`, `ExitDoor`, `Ghost`, `Human` |
| 6 | `buildLevel1()`, `buildLevel2()` and the `LEVELS` list |
| 7 | `Draw` — procedural room rendering |
| 8 | `Game` — state machine, main loop, UI glue |

Each level is data in its build function: move a rect, move the furniture. Add a
level by writing `buildLevel3()` and appending an entry to `LEVELS` — the loop,
the UI and the transition card pick it up automatically. Systems are opt-in per
level: a level with no `plate`/`car`/`lamp` simply omits them, and one with
`humans` gets patrol, vision cones and detection for free.
`window.GhostEscape` exposes the systems for poking around in a console.

## Known limitations (prototype)

* Two levels. On the last one `NEXT LEVEL` replays it.
* One housemate per level; they never search, chase or hear anything yet.
* Audio is synthesised placeholder blips, no music.
* Collision is axis-aligned boxes and circles only — no slopes or rotation.
* The fan's wind is cosmetic; it does not push anything yet.
