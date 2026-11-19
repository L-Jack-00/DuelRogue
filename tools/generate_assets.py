"""Unified Duel Rogue asset generator driven by assets/art_style.json & assets/asset_manifest.json."""

import argparse
import collections
import copy
import io
import json
import os
import time
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ASSETS_DIR = os.path.join(ROOT_DIR, 'assets')
WORKFLOW_DIR = os.path.join(ASSETS_DIR, 'workflows')
RAW_CACHE_DIR = os.path.join(ASSETS_DIR, '_raw_cache')
SAMPLE_OUT_DIR = os.path.join(ASSETS_DIR, 'style_samples')

with open(os.path.join(ASSETS_DIR, 'art_style.json'), 'r', encoding='utf-8') as f:
    STYLE = json.load(f)

with open(os.path.join(ASSETS_DIR, 'asset_manifest.json'), 'r', encoding='utf-8') as f:
    MANIFEST = json.load(f)

with open(os.path.join(WORKFLOW_DIR, 'sdxl_txt2img_template.json'), 'r', encoding='utf-8') as f:
    WF_TXT2IMG = json.load(f)

with open(os.path.join(WORKFLOW_DIR, 'sdxl_img2img_template.json'), 'r', encoding='utf-8') as f:
    WF_IMG2IMG = json.load(f)


def seed_for(item_id: str) -> int:
    h = 2166136261
    for ch in item_id:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return (h % 900000000) + 20260


def post_json(base_url: str, path: str, data: dict) -> dict:
    req = urllib.request.Request(
        base_url + path,
        data=json.dumps(data).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))


def get_json(base_url: str, path: str) -> dict:
    req = urllib.request.Request(base_url + path, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))


def upload_image(base_url: str, filepath: str, remote_name: str) -> str:
    boundary = f'----DRStyleBoundary{int(time.time() * 1000)}'
    with open(filepath, 'rb') as f:
        img_bytes = f.read()
    body = (
        f'--{boundary}\r\n'
        f'Content-Disposition: form-data; name="image"; filename="{remote_name}"\r\n'
        f'Content-Type: image/png\r\n\r\n'
    ).encode('utf-8') + img_bytes + (
        f'\r\n--{boundary}\r\n'
        f'Content-Disposition: form-data; name="overwrite"\r\n\r\ntrue'
        f'\r\n--{boundary}--\r\n'
    ).encode('utf-8')
    req = urllib.request.Request(
        base_url + '/upload/image',
        data=body,
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}', 'User-Agent': 'Mozilla/5.0'},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8')).get('name', remote_name)


def run_prompt(base_url: str, graph: dict, timeout: int = 600) -> tuple[bytes, float]:
    res = post_json(base_url, '/prompt', {'prompt': graph})
    pid = res['prompt_id']
    t0 = time.time()
    while time.time() - t0 < timeout:
        hist = get_json(base_url, f'/history/{pid}')
        if pid in hist:
            st = hist[pid].get('status', {})
            if st.get('status_str') == 'error':
                raise RuntimeError(f'ComfyUI error: {st}')
            for out in hist[pid].get('outputs', {}).values():
                if out.get('images'):
                    info = out['images'][0]
                    q = '/view?' + urllib.parse.urlencode({
                        'filename': info['filename'],
                        'subfolder': info.get('subfolder', ''),
                        'type': info.get('type', 'output'),
                    })
                    req = urllib.request.Request(base_url + q, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req, timeout=60) as r:
                        return r.read(), time.time() - t0
            raise RuntimeError(f'No output images for {pid}')
        time.sleep(1.5)
    raise TimeoutError(f'Timeout waiting for {pid}')


def build_txt2img(pos: str, neg: str, w: int, h: int, seed: int, prefix: str, override: dict | None = None) -> dict:
    cfg = {**STYLE['comfyui'], **(override or {})}
    g = copy.deepcopy(WF_TXT2IMG)
    g['1']['inputs']['ckpt_name'] = cfg['checkpoint']
    g['1b']['inputs']['vae_name'] = cfg['vae']
    g['3']['inputs']['text'] = pos
    g['4']['inputs']['text'] = neg
    g['5']['inputs']['width'] = w
    g['5']['inputs']['height'] = h
    g['6']['inputs'].update({
        'seed': seed,
        'steps': cfg['steps'],
        'cfg': cfg['cfg'],
        'sampler_name': cfg['sampler'],
        'scheduler': cfg['scheduler'],
    })
    g['10']['inputs']['filename_prefix'] = prefix
    return g


def build_img2img(
    remote_name: str,
    pos: str,
    neg: str,
    seed: int,
    prefix: str,
    steps: int | None = None,
    denoise: float | None = None,
    override: dict | None = None,
) -> dict:
    cfg = {**STYLE['comfyui'], **(override or {})}
    g = copy.deepcopy(WF_IMG2IMG)
    g['1']['inputs']['ckpt_name'] = cfg['checkpoint']
    g['1b']['inputs']['vae_name'] = cfg['vae']
    g['3']['inputs']['text'] = pos
    g['4']['inputs']['text'] = neg
    g['5']['inputs']['image'] = remote_name
    g['6']['inputs'].update({
        'seed': seed,
        'steps': steps if steps is not None else cfg['img2imgSteps'],
        'cfg': cfg['cfg'],
        'sampler_name': cfg['sampler'],
        'scheduler': cfg['scheduler'],
        'denoise': denoise if denoise is not None else cfg['img2imgDenoise'],
    })
    g['10']['inputs']['filename_prefix'] = prefix
    return g


def center_crop_resize(im: Image.Image, target_w: int, target_h: int) -> Image.Image:
    sw, sh = im.size
    tr = target_w / target_h
    sr = sw / sh
    if sr > tr:
        nw = int(round(sh * tr))
        left = (sw - nw) // 2
        im = im.crop((left, 0, left + nw, sh))
    elif sr < tr:
        nh = int(round(sw / tr))
        top = (sh - nh) // 2
        im = im.crop((0, top, sw, top + nh))
    return im.resize((target_w, target_h), Image.Resampling.LANCZOS)


def cutout_flat_bg(im: Image.Image, mode_key: str, extra_seeds: list[tuple[int, int]] | None = None) -> Image.Image:
    params = STYLE['cutout'][mode_key]
    include_bottom = params['includeBottom']
    hard_tol = params['hardTol']
    soft_tol = params['softTol']
    edge_wall_thr = params['edgeWall']

    rgb = np.array(im.convert('RGB'), dtype=np.float32)
    h, w, _ = rgb.shape

    # Sample top corners inset by 64px to avoid thick border frames (e.g., white frame around flat bg)
    inner_samples = np.concatenate([
        rgb[64:80, 64:w // 5, :].reshape(-1, 3),
        rgb[64:80, (4 * w) // 5:w - 64, :].reshape(-1, 3),
    ], axis=0)
    bg_color = np.median(inner_samples, axis=0)

    border_samples = rgb[0:6, :, :].reshape(-1, 3)
    border_color = np.median(border_samples, axis=0)
    has_outer_frame = float(np.linalg.norm(bg_color - border_color)) > hard_tol

    dist_bg = np.linalg.norm(rgb - bg_color, axis=2)
    if has_outer_frame:
        dist_border = np.linalg.norm(rgb - border_color, axis=2)
        dist = np.minimum(dist_bg, dist_border)
    else:
        dist = dist_bg

    gy = np.zeros((h, w), dtype=np.float32)
    gx = np.zeros((h, w), dtype=np.float32)
    gy[1:, :] = np.linalg.norm(rgb[1:, :, :] - rgb[:-1, :, :], axis=2)
    gx[:, 1:] = np.linalg.norm(rgb[:, 1:, :] - rgb[:, :-1, :], axis=2)
    edge = np.maximum(gx, gy)

    # Strong 2px sealed barrier prevents flood-fill from leaking through hairline ink breaks
    wall_raw = edge >= max(5.5, edge_wall_thr * 0.72)
    wall_seal = wall_raw.copy()
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            if dy == 0 and dx == 0:
                continue
            src_y0 = max(0, -dy)
            src_y1 = h - max(0, dy)
            src_x0 = max(0, -dx)
            src_x1 = w - max(0, dx)
            dst_y0 = max(0, dy)
            dst_y1 = h - max(0, -dy)
            dst_x0 = max(0, dx)
            dst_x1 = w - max(0, -dx)
            wall_seal[dst_y0:dst_y1, dst_x0:dst_x1] |= wall_raw[src_y0:src_y1, src_x0:src_x1]

    visited = np.zeros((h, w), dtype=bool)
    q = collections.deque()

    def try_seed(y: int, x: int) -> None:
        if 0 <= y < h and 0 <= x < w and not visited[y, x] and dist[y, x] <= soft_tol:
            visited[y, x] = True
            q.append((y, x))

    for x in range(w):
        try_seed(0, x)
        if has_outer_frame:
            try_seed(72, x)
        if include_bottom:
            try_seed(h - 1, x)
    for y in range(h):
        if include_bottom or y < int(h * 0.45):
            try_seed(y, 0)
            try_seed(y, w - 1)
            if has_outer_frame:
                try_seed(y, 72)
                try_seed(y, w - 73)
    if extra_seeds:
        for sx, sy in extra_seeds:
            try_seed(int(sy), int(sx))

    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                if wall_seal[ny, nx]:
                    continue
                if dist[ny, nx] <= hard_tol or (dist[ny, nx] <= soft_tol and edge[ny, nx] < edge_wall_thr):
                    visited[ny, nx] = True
                    q.append((ny, nx))

    # Step 2: expand 2px right up to actual ink border so sealed buffer leaves zero halo
    for _ in range(2):
        expand = np.zeros((h, w), dtype=bool)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            if dy == -1:
                expand[1:, :] |= visited[:-1, :]
            elif dy == 1:
                expand[:-1, :] |= visited[1:, :]
            elif dx == -1:
                expand[:, 1:] |= visited[:, :-1]
            else:
                expand[:, :-1] |= visited[:, 1:]
        step_ok = expand & (~visited) & (dist <= hard_tol) & (edge < edge_wall_thr)
        visited |= step_ok

    alpha = np.where(visited, 0.0, 255.0)
    adj = np.zeros((h, w), dtype=bool)
    adj[1:, :] |= visited[:-1, :]
    adj[:-1, :] |= visited[1:, :]
    adj[:, 1:] |= visited[:, :-1]
    adj[:, :-1] |= visited[:, 1:]

    fringe = (~visited) & adj
    t = np.clip((dist - hard_tol) / max(1.0, soft_tol - hard_tol), 0.0, 1.0)
    alpha[fringe] = 255.0 * (1.0 - 0.65 * (1.0 - t[fringe]))

    out_rgb = rgb.copy()
    f_idx = fringe & (alpha > 8.0)
    if np.any(f_idx):
        a_norm = alpha[f_idx, None] / 255.0
        est_fg = (rgb[f_idx] - (1.0 - a_norm) * bg_color) / np.maximum(0.28, a_norm)
        out_rgb[f_idx] = np.clip(est_fg, 0, 255)

    rgba = np.dstack([out_rgb.astype(np.uint8), np.clip(alpha, 0, 255).astype(np.uint8)])
    return Image.fromarray(rgba, mode='RGBA')


def save_webp(im: Image.Image, abs_path: str) -> None:
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    im.save(abs_path, format='WEBP', quality=90, method=6)


def make_prompt_for_item(item: dict) -> tuple[str, str, int, int, int, int]:
    anchors = STYLE['styleAnchors']
    bg_cfg = STYLE['backgrounds']
    iid = item['id']

    if item['type'] == 'background':
        if iid == 'BG_DUEL':
            pos = (
                "flat overhead top-down 2D anime gouache wood planks surface texture filling the entire frame edge to edge, "
                "close-up flat warm oak wooden board grain pattern, clean calm empty bare wooden tabletop background texture, "
                "a tiny pair of metal dice at far upper-right edge, flat directional sunlight shadow across wood planks, orthographic flat surface"
            )
            neg = (
                "(photorealistic, photograph, 3d render, interior room, house, kitchen, sink, building, architecture, wall, window, door, ceiling, horizon, floor, chair, perspective view:1.4), "
                "playing cards, poker cards, spades, hearts, cards on table, sewing buttons, coins pile, cluttered middle, readable text, logo, people, silhouettes"
            )
            return pos, neg, 1344, 768, 1920, 1200
        if iid in bg_cfg['nightIds']:
            st = anchors['background_night']
        elif iid in bg_cfg['indoorDayIds']:
            st = anchors['background_day_indoor']
        else:
            st = anchors['background_day_outdoor']
        subject = bg_cfg['promptOverrides'].get(iid, item['aiPromptHint'])
        crowd = f", {bg_cfg['silhouettePrompt']}" if iid in bg_cfg.get('silhouetteCrowdIds', []) else ', completely empty unoccupied scene with zero people'
        neg = st['negative'] if iid in bg_cfg.get('silhouetteCrowdIds', []) else st['negative'] + ', people, person, silhouettes, crowd'
        extra_neg = bg_cfg.get('perItemNegative', {}).get(iid, '')
        if extra_neg:
            neg = f"{neg}, {extra_neg}"
        return f"{subject}{crowd}, {st['positive']}", neg, 1344, 768, 1920, 1200

    if item['type'] == 'portrait':
        st = anchors['character']
        base_key = 'NPC_FORTUNE' if iid == 'NPC_FORTUNE' else '_'.join(iid.split('_')[:3])
        char_desc = STYLE['characters'][base_key]
        mood = ''
        for m_key, m_txt in STYLE['moodBoosts'].items():
            if iid.endswith('_' + m_key):
                mood = f"({m_txt}:1.35), "
        pos = f"{st['positive']}, {mood}{char_desc}"
        neg = st['negative']
        if base_key == 'NPC_FORTUNE':
            neg += ', unhooded, hair, bangs, bright sunlit face, bare face'
        elif base_key == 'NPC_SHOP_4':
            neg += ', window, window frame, grid, black rectangle, black background behind head, dark corner'
        return pos, neg, 832, 1152, 768, 1024

    if item['type'] == 'icon':
        st = anchors['icon']
        hint = item['aiPromptHint']
        neg = st['negative'] + ', brown halo, glow halo, soft aura, radial aura, oval shadow, grunge ring, vignette'
        if iid == 'UI_PORTAL_SHOP':
            hint = 'miniature painted wooden hobby storefront booth with striped awning, tiny glowing shop windows, hanging brass bell, and a blank blue-and-gold playing card emblem signboard with NO words'
        elif iid == 'UI_PORTAL_ALLEY':
            hint = 'single cozy amber glowing light bulb hanging over a single sealed brown kraft paper envelope tied with string'
            neg += ', card, playing card, portrait, character, collage, campfire, fire, flame, burning, shopping bag, cord loop to floor'
        elif iid == 'UI_PORTAL_TRUNK':
            hint = 'a closed translucent blue plastic card deck storage box strapped tightly with a red elastic band, isometric three-quarter view'
            neg += ', scattered cards, tile pattern, wallpaper, yellow background, circle halo, brown glow, circular brush aura, sticker circle'
        extra_neg = bg_cfg.get('perItemNegative', {}).get(iid, '')
        if extra_neg:
            neg = f"{neg}, {extra_neg}"
        return f"{hint}, {st['positive']}", neg, 1024, 1024, 512, 512

    if iid.startswith('PACK_'):
        st = anchors['product_fantasy']
        return f"{item['aiPromptHint']}, {st['positive']}", st['negative'], 832, 1216, 1024, 1536

    if iid.startswith('UI_TAROT_'):
        st = anchors['tarot']
        return f"{item['aiPromptHint']}, {st['positive']}", st['negative'], 768, 1216, 640, 1024

    st = anchors['card_back']
    return f"{item['aiPromptHint']}, {st['positive']}", st['negative'], 832, 1152, 640, 896


def generate_item(base_url: str, item: dict, out_abs: str, force: bool = False) -> None:
    if os.path.exists(out_abs) and not force:
        print(f"SKIP {item['id']}")
        return

    os.makedirs(RAW_CACHE_DIR, exist_ok=True)
    pos, neg, gw, gh, tw, th = make_prompt_for_item(item)
    ref_id = item.get('reference')
    is_portrait = item['type'] == 'portrait'
    portrait_cfg = STYLE['comfyui'].get('portrait') if is_portrait else None

    item_seed = seed_for(item['id']) + (404 if item['id'].startswith('NPC_SHOP_4') else 0)

    if ref_id and is_portrait:
        ref_raw = os.path.join(RAW_CACHE_DIR, f'{ref_id}.png')
        if not os.path.exists(ref_raw):
            raise RuntimeError(f"Missing cached raw base image: {ref_raw}")
        remote_name = upload_image(base_url, ref_raw, f'{ref_id}.png')
        wf = build_img2img(remote_name, pos, neg, item_seed, prefix=item['id'], override=portrait_cfg)
        raw, dt = run_prompt(base_url, wf)
    else:
        wf = build_txt2img(pos, neg, gw, gh, item_seed, prefix=item['id'], override=portrait_cfg)
        raw, dt = run_prompt(base_url, wf)
        if is_portrait and portrait_cfg and float(portrait_cfg.get('hiresScale', 1.0)) > 1.0:
            scale = float(portrait_cfg['hiresScale'])
            base_im = Image.open(io.BytesIO(raw)).convert('RGB')
            hw = int(round((base_im.width * scale) / 8.0)) * 8
            hh = int(round((base_im.height * scale) / 8.0)) * 8
            up_im = base_im.resize((hw, hh), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            up_im.save(buf, format='PNG')
            hires_in = os.path.join(RAW_CACHE_DIR, f"{item['id']}_pre_hires.png")
            with open(hires_in, 'wb') as hf:
                hf.write(buf.getvalue())
            remote_up = upload_image(base_url, hires_in, f"{item['id']}_pre_hires.png")
            wf_hi = build_img2img(
                remote_up,
                pos,
                neg,
                item_seed + 1,
                prefix=f"{item['id']}_HIRES",
                steps=int(portrait_cfg.get('hiresSteps', 20)),
                denoise=float(portrait_cfg.get('hiresDenoise', 0.38)),
                override=portrait_cfg,
            )
            raw, dt2 = run_prompt(base_url, wf_hi)
            dt += dt2

    raw_path = os.path.join(RAW_CACHE_DIR, f"{item['id']}.png")
    with open(raw_path, 'wb') as f:
        f.write(raw)

    im = Image.open(io.BytesIO(raw))
    if item['type'] in ('portrait', 'icon'):
        cut = cutout_flat_bg(im, item['type'])
        out_im = center_crop_resize(cut, tw, th) if cut.size != (tw, th) else cut
    else:
        out_im = center_crop_resize(im, tw, th)

    save_webp(out_im, out_abs)
    print(f"OK {item['id']} -> {os.path.relpath(out_abs, ROOT_DIR)} ({out_im.size}) in {dt:.1f}s")


def collect_items() -> list[dict]:
    items = [copy.deepcopy(x) for x in MANIFEST['images'] if x['path'].endswith('.webp')]
    for pr in MANIFEST['products']['items']:
        items.append({
            'id': pr['id'],
            'type': 'product',
            'path': f"assets/products/{pr['id']}.webp",
            'aiPromptHint': pr['aiPromptHint'],
        })
    return items


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--server', required=True, help='ComfyUI base URL')
    ap.add_argument('--mode', choices=['sample', 'bg', 'fantasy', 'icons', 'npc', 'all'], required=True)
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--ids', nargs='*', help='Optional specific item IDs to generate')
    args = ap.parse_args()
    base_url = args.server.rstrip('/')

    all_items = collect_items()
    by_id = {x['id']: x for x in all_items}

    if args.mode == 'sample':
        sample_ids = ['BG_HUB', 'BG_LOBBY', 'BG_MERCHANT', 'NPC_FORTUNE', 'NPC_MERCHANT_3_BASE']
        for iid in sample_ids:
            it = by_id[iid]
            out_abs = os.path.join(SAMPLE_OUT_DIR, f"{iid.lower()}.webp")
            generate_item(base_url, it, out_abs, force=args.force)
        return

    if args.mode == 'bg':
        targets = [x for x in all_items if x['type'] == 'background']
    elif args.mode == 'fantasy':
        targets = [x for x in all_items if x['type'] in ('product', 'illustration')]
    elif args.mode == 'icons':
        targets = [x for x in all_items if x['type'] == 'icon']
    elif args.mode == 'npc':
        targets = [x for x in all_items if x['type'] == 'portrait']
        targets.sort(key=lambda x: (0 if 'reference' not in x else 1, x['id']))
    else:
        targets = all_items
        targets.sort(key=lambda x: (0 if x['type'] != 'portrait' else (1 if 'reference' not in x else 2), x['id']))

    if args.ids:
        id_set = set(args.ids)
        targets = [x for x in targets if x['id'] in id_set]

    for it in targets:
        generate_item(base_url, it, os.path.join(ROOT_DIR, it['path']), force=args.force)


if __name__ == '__main__':
    main()
