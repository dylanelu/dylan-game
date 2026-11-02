# Shadow Gate

A top-down pixel-art action game for phone and desktop: a Solo Leveling style hunter clearing a gate, with
Sekiro parries, Elden Ring rolls and bullet-hell bosses. Static site, no backend.

## Run

```bash
npm install
npm run dev        # prints a Network URL you can open on your phone (same Wi-Fi)
npm run build      # static output in dist/, deployable to GitHub Pages
```

## Controls

| | Phone | Desktop |
|---|---|---|
| Move | drag anywhere on the left side | WASD |
| Parry | release that thumb | right click (or K) |
| Shoot | tap or hold anywhere else | left click toward the cursor |
| Roll | flick with a second finger | Space / Shift |
| Pause | II button | Esc / P |

Perfect parry (first 0.15s): staggers normal enemies with a counter-strike, reflects bullets, refills mana and
charges empowered shots. Enemies killed by a counter-strike rise as shadow soldiers. Every attack can be
parried. A white glint is a normal attack; a red glint is heavy: perfect-parry it for a bigger payoff (a late guard
chips hard), or roll through it. Parrying the boss fills its posture bar; a full bar breaks it open.

Sandbox: `1` ghouls, `2` casters, `3` brute, `4` boss, `5` wave, `0` clear, `G` god mode, `H` hitboxes.

## Code map

- `dev/rig.html`: hero frame viewer (`npm run dev`, then open `/dev/rig.html`)
- `src/game/assets.ts`: the hero is 0x72's elf recolored and hand-edited into Dylan (`dylanize`), plus a shadow dagger

- `src/engine/renderer.ts`: low-res Canvas2D layers (scene, light, glow, ui) composited by a WebGL2 post shader
  (banded lighting, bloom, chromatic aberration, flashes, vignette, grain)
- `src/engine/input.ts`: touch gestures and mouse/keyboard, both mapped to the same actions
- `src/engine/audio.ts`: sample-based mixer (layered events, pitch variation, panning, reverb, muffle, music crossfades)
- `src/game/game.ts`: loop, combat resolution (`hitPlayer`), juice (hitstop, shake, slow-mo), rendering
- `src/game/player.ts`, `enemies.ts`, `boss.ts`, `level.ts`, `fx.ts`, `hud.ts`

## Credits

- Dungeon tiles and monsters: [0x72 DungeonTileset II](https://0x72.itch.io/dungeontileset-ii), CC0
- Audio: Kenney and OpenGameArt CC0 packs, see [public/assets/audio/CREDITS.md](public/assets/audio/CREDITS.md). Rebuild with `tools/audio/fetch.sh` then `tools/audio/build.py`
- Hero sprite: converted from Dylan's reference art (`tools/hero/`: `fit_grid.py` → `extract.py` → `face_fix.py`)
