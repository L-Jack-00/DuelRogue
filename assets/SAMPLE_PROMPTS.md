# 샘플 4장 생성 요청문 (Claude 채팅용)

힉스필드 무제한 생성은 Claude Code에서는 쓸 수 없다. Claude 채팅(claude.ai), Claude Cowork, ChatGPT에서만 쓸 수 있다.
그래서 이 샘플은 Claude 채팅에서 만든다.

1. Claude 채팅에서 힉스필드 커넥터를 켠다.
2. 아래 요청문을 통째로 붙여 넣는다.
3. 결과 이미지를 받아 `assets/samples/` 폴더에 저장한다.

저장하면 이 세션에서 게임 화면에 대어 보고 방향을 확정한다.

---

```
힉스필드 nano_banana_pro 모델로, 무제한 생성(use_unlim: true)을 써서 아래 4장을 만들어줘.
4장 모두 16:9 비율, 2k 해상도로 만들어 줘.
1번 결과가 나오면, 2~4번은 1번 결과를 image_references로 넣어서 화풍을 통일해 줘.

[공통 스타일 — 모든 장면 뒤에 붙임]
Early-2000s anime TV series background art, hand-painted cel-animation backgrounds, soft painterly gouache texture with clean readable shapes, warm nostalgic color grading, golden-hour sunlight and glowing shop signs, subtle film grain and slight VHS warmth, lived-in and slightly messy but cozy, everyday small-town atmosphere, street card-game tournament culture, original setting and original designs. Wide 16:9 game background, no characters in focus, darker vignette at edges, calm center for UI overlay. No logos, no brand names, no readable text, no watermark, no existing franchise characters, no photorealism, no 3D render look, no medieval fantasy castle.

[1. 거점]
A three-way alley intersection in a compact Asian small city during a citywide street card tournament: on the left the glowing entrance of a tiny card shop with hand-made posters, on the right a dim narrow back alley with a single bare bulb, in the center concrete stairs leading down to an underground tournament hall. 3-4 story mixed-use buildings, vending machines, utility poles with tangled overhead wires, rolled shutters, bicycles, paper tournament flags strung across the street, warm late-afternoon light.

[2. 듀얼 테이블]
A worn but well-loved wooden table seen from a slightly elevated three-quarter top-down view, scratches, coffee-ring stains and old sticker residue, scattered six-sided dice, a chunky pocket calculator used to track life points, a small pile of coins, translucent plastic deck boxes and rubber bands, a few sleeved cards face-down, the lower edge framed by a retro arcade cabinet control panel with a ball-top joystick, colorful round push buttons and worn decals, warm desk-lamp lighting, cozy clutter only at the edges, clear empty play area in the center.

[3. 카드샵 내부]
Interior of a narrow, cramped small-town card shop: glass showcase counter with rare cards under a warm lamp, walls packed floor-to-ceiling with colorful booster pack displays (no readable text), an old cash register and a pocket calculator on the counter, flickering fluorescent tube light mixed with warm afternoon sun from the front window, cardboard boxes and tournament posters, cozy and slightly cluttered.

[4. 수상한 상인 노점]
A narrow back alley at night in a small city: a folding-table street stall set up in front of a rusty rolled shutter, a single bare incandescent bulb hanging from a wire, velvet cloth with card binders and locked cases on the table, rain-wet pavement reflecting the glow of a nearby vending machine, steam from a vent, mysterious but cozy mood, deep blue night with warm amber light.
```
