# 👻 Ghost Escape — Level 1 prototype

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
| Possess / toggle | `E`, `Space` | big button, bottom-right |
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
| 5 | `LightHazard`, `Possessable` (`FloorLamp`, `ToyCar`, `Fan`), `PressurePlate`, `ExitDoor`, `Ghost` |
| 6 | `buildLevel()` — all level-1 geometry in one place |
| 7 | `Draw` — procedural room rendering |
| 8 | `Game` — state machine, main loop, UI glue |

The whole level is data in `buildLevel()`: move a rect, move the furniture.
`window.GhostEscape` exposes the systems for poking around in a console.

## Known limitations (prototype)

* One level. `NEXT LEVEL` replays level 1.
* Audio is synthesised placeholder blips, no music.
* Collision is axis-aligned boxes and circles only — no slopes or rotation.
* The fan's wind is cosmetic; it does not push anything yet.
