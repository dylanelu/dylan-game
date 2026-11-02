"""Build the game's audio from the CC0 sources in tools/audio/raw.

Each clip is trimmed of leading silence (so hits land on the frame they're triggered), given a short
fade-out, peak-normalized, and encoded to mono AAC (.m4a plays in every browser, unlike .ogg on older
Safari). Loops get a baked crossfade so they repeat seamlessly. The runtime does the layering, pitch
variation and mixing; this script only prepares clean ingredients.

Needs: soundfile + numpy (pip), afconvert (ships with macOS).
"""
import json, os, subprocess, tempfile
import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
OUT = os.path.join(HERE, '..', '..', 'public', 'assets', 'audio')
K_IMP = 'impact-sounds/Audio'
K_RPG = 'rpg-audio/Audio'
K_SCI = 'sci-fi-sounds/Audio'
K_UI = 'interface-sounds/Audio'
C1, C2 = 'oga/80-CC0-creature-SFX_0', 'oga/80-CC0-creature-sfx-2'

# name -> list of (source, options). Variations of one sound share a name and get suffixes _0.._n.
# options: start/len trim in seconds, peak (normalize target), stereo for music/ambience
CLIPS = {
    # player
    'step':       [(f'{K_IMP}/footstep_concrete_00{i}.ogg', {'peak': 0.6}) for i in range(5)],
    'swish':      [(f'oga/swishes/swish-{i}.wav', {}) for i in (1, 2, 5, 8, 10, 11)],
    'swishHeavy': [(f'oga/swishes/swish-{i}.wav', {}) for i in (3, 4, 7, 9)],
    'cloth':      [(f'{K_RPG}/cloth{i}.ogg', {}) for i in (1, 2, 3)] + [(f'{K_RPG}/clothBelt.ogg', {})],
    'knife':      [(f'{K_RPG}/knifeSlice.ogg', {}), (f'{K_RPG}/knifeSlice2.ogg', {})],
    'draw':       [(f'{K_RPG}/drawKnife{i}.ogg', {}) for i in (1, 2, 3)],
    # impacts
    'punch':      [(f'{K_IMP}/impactPunch_medium_00{i}.ogg', {}) for i in range(5)],
    'punchHeavy': [(f'{K_IMP}/impactPunch_heavy_00{i}.ogg', {}) for i in range(5)],
    'soft':       [(f'{K_IMP}/impactSoft_heavy_00{i}.ogg', {}) for i in range(5)],
    'metal':      [(f'{K_IMP}/impactMetal_heavy_00{i}.ogg', {}) for i in range(5)],
    'plate':      [(f'{K_IMP}/impactPlate_medium_00{i}.ogg', {}) for i in range(5)],
    'bell':       [(f'{K_IMP}/impactBell_heavy_00{i}.ogg', {}) for i in range(4)],
    'glassTing':  [(f'{K_IMP}/impactGlass_light_00{i}.ogg', {'peak': 0.7}) for i in range(5)],
    'crunch':     [(f'{K_SCI}/explosionCrunch_00{i}.ogg', {}) for i in range(5)],
    'boom':       [(f'{K_SCI}/lowFrequency_explosion_00{i}.ogg', {}) for i in range(2)],
    'force':      [(f'{K_SCI}/forceField_00{i}.ogg', {}) for i in range(3)],
    'laser':      [(f'{K_SCI}/laserSmall_00{i}.ogg', {}) for i in range(5)],
    # magic
    'magic':      [(f'oga/magical_{i}.ogg', {}) for i in ('1_0', '2', '3', '4', '5')],
    'teleport':   [('oga/teleport.wav', {})],
    # creatures
    'grunt':      [(f'{C1}/grunt_0{i}.ogg', {}) for i in range(1, 6)] + [(f'{C2}/grunt_0{i}.ogg', {}) for i in range(6, 10)],
    'snarl':      [(f'{C2}/attack_0{i}.ogg', {}) for i in range(1, 6)],
    'die':        [(f'{C2}/die_0{i}.ogg', {}) for i in range(1, 5)],
    'hurtCreature': [(f'{C1}/hurt_0{i}.ogg', {}) for i in range(1, 6)],
    'roar':       [(f'{C2}/roar_0{i}.ogg', {}) for i in (4, 5, 6)],
    'bossRoar':   [('oga/monster_roar.wav', {'len': 2.8})],
    'stomp':      [(f'{C2}/stomp_01.ogg', {})],
    'breath':     [(f'{C2}/breath_02.ogg', {})],
    'monster':    [(f'oga/monster_sfx_pack/monster-{i}.wav', {}) for i in range(1, 11)],
    # ui
    'select':     [(f'{K_UI}/select_00{i}.ogg', {'peak': 0.5}) for i in range(1, 4)],
}
LOOPS = {
    'ambience':  ('oga/dark_cavern_ambient_002.ogg', {'xfade': 3.0, 'peak': 0.6}),
    'drip':      ('oga/dungeon002_0.ogg', {'xfade': 3.0, 'peak': 0.7, 'len': 90}),
    'bossMusic': ('oga/heavy_boss_battle_1_bpm200.ogg', {'xfade': 0.0, 'peak': 0.85}),
    'waveMusic': ('oga/boss_battle_loop.mp3', {'xfade': 0.0, 'peak': 0.85}),
}


def load(rel):
    data, sr = sf.read(os.path.join(RAW, rel), always_2d=True)
    return data.astype(np.float32), sr


def trim_lead(x, sr, thresh=0.02):
    env = np.abs(x).max(axis=1)
    idx = np.argmax(env > thresh * env.max()) if env.max() > 0 else 0
    return x[max(0, idx - int(sr * 0.002)):]


def trim_tail(x, sr, thresh=0.004):
    env = np.abs(x).max(axis=1)
    above = np.where(env > thresh * max(env.max(), 1e-9))[0]
    end = above[-1] + int(sr * 0.03) if len(above) else len(x)
    return x[:min(len(x), end)]


def fade_out(x, sr, sec=0.025):
    n = min(len(x), int(sr * sec))
    x[-n:] *= np.linspace(1, 0, n)[:, None]
    return x


def encode(x, sr, name, stereo=False, kbps=96):
    if not stereo:
        x = x.mean(axis=1, keepdims=True)
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        sf.write(tmp.name, np.clip(x, -1, 1), sr, subtype='PCM_16')
        dst = os.path.join(OUT, f'{name}.m4a')
        subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', str(kbps * 1000), tmp.name, dst], check=True)
    os.unlink(tmp.name)
    return os.path.getsize(dst)


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest, total = {'clips': {}, 'loops': {}}, 0
    for name, variants in CLIPS.items():
        files = []
        for i, (rel, o) in enumerate(variants):
            x, sr = load(rel)
            if 'start' in o: x = x[int(o['start'] * sr):]
            x = trim_lead(x, sr)
            if 'len' in o: x = x[:int(o['len'] * sr)]
            x = fade_out(trim_tail(x, sr), sr, 0.12 if 'len' in o else 0.025)
            x *= o.get('peak', 0.95) / max(np.abs(x).max(), 1e-9)
            fn = f'{name}_{i}'
            total += encode(x, sr, fn)
            files.append(fn)
        manifest['clips'][name] = files
    for name, (rel, o) in LOOPS.items():
        x, sr = load(rel)
        if 'len' in o: x = x[:int(o['len'] * sr)]
        n = int(o['xfade'] * sr)
        if n:
            # seamless loop: blend the tail into the head, then drop the head
            head, tail = x[:n].copy(), x[-n:].copy()
            t = np.linspace(0, 1, n)[:, None]
            x = x[n:].copy()
            x[-n:] = tail * (1 - t) + head * t
        x *= o['peak'] / max(np.abs(x).max(), 1e-9)
        if x.shape[1] == 1: x = np.repeat(x, 2, axis=1)
        total += encode(x, sr, name, stereo=True, kbps=128)
        manifest['loops'][name] = name
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    print(f'{sum(len(v) for v in manifest["clips"].values())} clips, {len(manifest["loops"])} loops, {total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
