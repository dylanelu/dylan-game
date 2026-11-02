#!/usr/bin/env bash
# Downloads the CC0 source packs into tools/audio/raw (gitignored). build.py turns them into
# the trimmed, normalized .m4a files shipped in public/assets/audio.
set -euo pipefail
cd "$(dirname "$0")"
RAW=raw; mkdir -p "$RAW/oga" .dl
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# Kenney (kenney.nl), CC0. The site hands out short-lived signed links.
for p in impact-sounds rpg-audio interface-sounds sci-fi-sounds; do
  curl -sL -A "$UA" -c .dl/jar -b .dl/jar "https://kenney.nl/assets/$p" -o .dl/page.html
  id=$(grep -oE "data-download-id='[0-9a-f]+'" .dl/page.html | head -1 | cut -d"'" -f2)
  url=$(curl -s -A "$UA" -c .dl/jar -b .dl/jar "https://kenney.nl/download-link/$id" | python3 -c "import sys,json; print(json.load(sys.stdin)['url'])")
  curl -sL -A "$UA" "$url" -o ".dl/$p.zip"
  mkdir -p "$RAW/$p" && unzip -qo ".dl/$p.zip" -d "$RAW/$p" '*.ogg' '*.txt'
done

# OpenGameArt, all CC0 (see public/assets/audio/CREDITS.md)
B=https://opengameart.org/sites/default/files
for f in 80-CC0-creature-SFX_0.zip 80-CC0-creature-sfx-2.zip swishes.zip monster_sfx_pack.zip; do
  curl -sfL -A "$UA" "$B/$f" -o ".dl/$f" && unzip -qo ".dl/$f" -x '__MACOSX/*' -d "$RAW/oga"
done
for f in monster_roar.wav teleport.wav magical_1_0.ogg magical_2.ogg magical_3.ogg magical_4.ogg magical_5.ogg \
         dark_cavern_ambient_002.ogg dungeon002_0.ogg heavy_boss_battle_1_bpm200.ogg boss_battle_loop.mp3; do
  curl -sfL -A "$UA" "$B/$f" -o "$RAW/oga/$f"
done
rm -rf .dl
# Ninja Adventure (pixel-boy.itch.io/ninja-adventure-asset-pack, CC0) is an itch.io download with no direct link:
# get the pack by hand and copy its Audio/Jingles folder to raw/ninja/Jingles.
[ -d "$RAW/ninja/Jingles" ] || echo "note: copy Ninja Adventure's Audio/Jingles to tools/audio/$RAW/ninja/Jingles for the jingles"
echo "done: $(find $RAW -type f | wc -l) files"
