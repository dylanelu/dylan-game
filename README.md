# Shadow Gate

A top-down pixel-art action game for phone and desktop: a Solo Leveling style hunter clearing a gate, with
Sekiro parries, Elden Ring rolls and bullet-hell bosses, structured like one Nightreign night. Static site, no backend.

## A night

About 10 minutes on one huge fixed map (the same layout every run):

1. Drop into a quiet room on the rim.
2. Clear camps and the night's three active mini-boss arenas (Orc Warlords) to level up and find gear. Cleared camps
   leave a chest. Loot is sparse and stands in a beam of its rarity color.
3. The shadow storm closes in stages toward the gate at the center; standing in it hurts more as the night goes on.
4. At 9:00 the gate opens: anyone outside is pulled in and the Crimson Warden rises. Kill it to clear the gate.

Enemy levels are hidden. The marker over an enemy says how bad it is for you: white is a fair fight, red is well
above you, a purple skull means you will die. Solo gets one revival per night; in co-op you come back beside a teammate.

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

Sandbox (spawns near you): `1` ghouls, `2` casters, `3` brute, `4` boss, `5` wave, `0` clear, `G` god mode, `H` hitboxes. `R` starts a new night after one ends.

## Co-op (up to 6, no server)

Press **Co-op** to create a room; the invite link is copied (`…/#room=CODE`). Friends open it and drop in.
Peers find each other through public Nostr relays via [Trystero](https://github.com/dmotz/trystero), then all
traffic is direct WebRTC, so it works from GitHub Pages with no backend.

- The earliest joiner hosts: enemies, the boss and enemy bullets run there and stream out at 15 Hz.
- Everyone simulates their own character, so movement and parry timing never wait on the network. Attacks on a
  remote player are resolved on that player's machine, with a little lag compensation on the parry window.
- If the host leaves, the next player in line takes over the enemies.
- Test locally with two players in one page: `npm run dev`, then open `/dev/coop.html`.

## Code map

- `dev/rig.html`: hero frame viewer (`npm run dev`, then open `/dev/rig.html`)
- `src/game/assets.ts`: the hero is 0x72's elf recolored and hand-edited into Dylan (`dylanize`), plus a shadow dagger

- `src/engine/renderer.ts`: low-res Canvas2D layers (scene, light, glow, ui) composited by a WebGL2 post shader
  (banded lighting, bloom, chromatic aberration, flashes, vignette, grain)
- `src/engine/input.ts`: touch gestures and mouse/keyboard, both mapped to the same actions
- `src/engine/audio.ts`: sample-based mixer (layered events, pitch variation, panning, reverb, muffle, music crossfades)
- `src/game/game.ts`: loop, combat resolution (`hitPlayer`), progression, juice (hitstop, shake, slow-mo), rendering
- `src/game/world.ts`: the fixed map (rooms, corridors, autotiled walls, chunked drawing, minimap)
- `src/game/night.ts`: the night's clock, storm, camps, mini-bosses, chests, the gate; `src/game/items.ts`: loot tables
- `src/game/player.ts`, `enemies.ts`, `boss.ts`, `fx.ts`, `hud.ts`
- `src/net/net.ts`: Trystero room, join order, host election; `src/net/coop.ts`: what's synced and how

## Credits

- Dungeon tiles and monsters: [0x72 DungeonTileset II](https://0x72.itch.io/dungeontileset-ii), CC0
- Audio: Kenney and OpenGameArt CC0 packs, see [public/assets/audio/CREDITS.md](public/assets/audio/CREDITS.md). Rebuild with `tools/audio/fetch.sh` then `tools/audio/build.py`
- Hero sprite: converted from Dylan's reference art (`tools/hero/`: `fit_grid.py` → `extract.py` → `face_fix.py`)
