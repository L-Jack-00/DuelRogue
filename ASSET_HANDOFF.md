# Duel Rogue 이미지 리소스 & 그래픽 컨벤션 인수인계서

> **목적**: 새 세션에서 이미지 리소스를 제작·교체·확장할 때 기존 화풍, 해상도, 파일명/경로, 투명화(누끼) 규칙, 코드 연동 포인트를 그대로 이어받을 수 있도록 정리한 기준 문서입니다.  
> **기준 커밋/시점**: 2026-11-18 (Windows 2000 벡터 UI + 어반 오컬트 셀 애니메이션 리소스 체계)

---

## 1. 전체 아트 디렉션 & 그래픽 지시사항 요약

1. **화풍 (Style Profile: `urban_occult_street_tournament`)**
   * **배경**: 2000년대 초반 일본 TV 애니메이션 손그림 과슈(gouache) 풍의 청명한 하늘색 도심/토너먼트 광장(낮) 및 네이비·바이올렛 야간 뒷골목/보스 씬(밤). 두꺼운 코믹스 펜 해칭, 실사 사진, 3D CGI, 텍스트/워터마크 배제.
   * **인물 초상화 (`npc`)**: 순백 스튜디오 배경(`#ffffff`) 위 상반신 단독 캐릭터, 굵고 끝이 가늘어지는 검은 외곽선, 각진 턱선과 90년대 후반 애니메이션 스타일 눈매, 플랫 하드 셀 셰이딩, 자연스러운 피부톤·현대 스트릿/캐주얼 복장(판타지 갑옷·괴물·무채색 피부 금지).
   * **UI 크롬 & 아이콘**:
     * UI 프레임 전체는 **Windows 2000 클래식 벡터 베벨(`#d4d0c8`, `#ffffff`/`#404040` 입체 테두리, `#0a246a → #7ac4fa` 캡션바)** 기반 (`theme-alley.css`).
     * **카드 뒷면**: 깨짐 방지를 위해 단순 명료한 순수 벡터 SVG(`assets/ui/card_back.svg`, `app_icon.svg` 참고) + 덱 편집실 커스텀 슬리브 빌더(`src/ui/cosmeticsSystem.js`) 사용.
     * **이모지/유니코드 아이콘**: 환경 간 표시 차이를 막기 위해 저작권 안전 폰트(`assets/fonts/Twemoji.Mozilla.ttf`) 내장 + 인라인 SVG(`src/ui/vectorIcons.js`, `whiteSkull`, 발톱 레벨 마크 `cardRenderer.js`).
     * **실내/듀얼 상하단 암막**: 검정 박스 대신 투명도 그라데이션 연출.

2. **렌더러 / 폴백 원칙 (`src/ui/sceneArt.js`)**
   * 모든 주요 배경·NPC·상품·타로 이미지는 `.webp`가 존재하면 우선 로드하고, 없으면 동일 이름의 `.svg` 또는 CSS 그라데이션으로 자동 폴백됩니다.
   * **주의**: 존재하지 않는 에셋을 사전에 무작정 `fetch/Image` 프로빙하지 않습니다 (헤드리스/콘솔 네트워크 에러 유발 방지).
   * **빌드 배포 제외 폴더 (`tools/prepare_tauri_dist.mjs`)**: `assets/_raw_cache`, `assets/style_samples`, `assets/workflows`는 `dist-web/` 및 Tauri 실행 파일에 포함되지 않습니다.

---

## 2. 디렉토리별 이미지 리소스 컨벤션

### 2.1 배경 (`assets/ui/bg_*.webp`)
* **규격**: **`1920 × 1200 px`**, **`.webp`**, `RGB` (불투명)
* **생성 원본 비율**: `1344 × 768 px` (생성 후 중앙 크롭/리사이즈 `1920×1200`)
* **낮(Day) 씬**:
  * `bg_lobby.webp` (`VIEW_TITLE_LOBBY`)
  * `bg_hub.webp` (`VIEW_CHECKPOINT`)
  * `bg_shop.webp` (`VIEW_CHECKPOINT_SHOP`, `VIEW_PACK_OPENING`)
  * `bg_encounter.webp` (`VIEW_CHECKPOINT_MERCHANT` 일반 인카운터)
  * `bg_duel.webp` (`VIEW_DUEL_ARENA` 일반 — 1인칭 탑뷰 원목 듀얼 테이블 텍스처)
  * `bg_victory.webp` (`VIEW_RUN_SUMMARY` 승리)
* **밤(Night) 씬**:
  * `bg_fortune.webp` (`VIEW_FORTUNE_TELLER`)
  * `bg_merchant.webp` (`VIEW_CHECKPOINT_MERCHANT` 거래상 출현 시 & `VIEW_MERCHANT_EVENT`)
  * `bg_deck.webp` (`VIEW_CHECKPOINT_DECK_EDITOR`)
  * `bg_boss_blue.webp` / `bg_boss_red.webp` / `bg_boss_purple.webp` (스테이지 5 최종 보스별 배경)
  * `bg_defeat.webp` (`VIEW_RUN_SUMMARY` 패배)

### 2.2 인물 초상화 (`assets/npc/*.webp`)
* **규격**: **`768 × 1024 px` (3:4)**, **`.webp`**, **`RGBA` (배경 투명 누끼 필수)**
* **생성 원본 비율**: `832 × 1152 px` (Hires 패스 적용 시 `1.25×` → `1040 × 1440 px` 후 리사이즈)
* **네이밍 규칙 (`src/ui/sceneArt.js` `NPC_CAST`)**:
  * 점술사: `fortune_teller.webp`
  * 상점 주인 5인 (`i = 1..5`): `shop_{i}_base.webp` (기본), `shop_{i}_excited.webp` (mood `2`: 레전드 팩 입고), `shop_{i}_tired.webp` (mood `3`: 매진)
  * 뒷골목 거래상 5인 (`i = 1..5`): `merchant_{i}_base.webp` (기본), `merchant_{i}_deal.webp` (mood `3`: 거래 1건 이상 성사)
* **캐릭터↔대사 매핑**: `npcCastIndex(kind, seed, round)`와 `npcDialogue()`(`src/ui/sceneArt.js`)가 인덱스 `1~5`별로 말투·성격이 연결되어 있으므로 인원 수(`count: 5`)를 바꾸면 `NPC_DIALOGUES`도 함께 맞춰야 합니다.

### 2.3 포탈 아이콘 (`assets/ui/portal_*.webp`)
* **규격**: **`512 × 512 px` (1:1)**, **`.webp`**, **`RGBA` (배경 투명 누끼 필수)**
* **대상 파일**: `portal_shop.webp`, `portal_alley.webp`, `portal_trunk.webp` (폴백: 동일명의 `.svg`, `portal_arena.svg`)

### 2.4 부스터 팩 (`assets/products/*.webp`)
* **규격**: **`1024 × 1536 px` (2:3)**, **`.webp`**, `RGB` (카드팩 래핑/상단 실링은 CSS로 처리되므로 **래퍼 가장자리/바코드/텍스트 없이** 일러스트만 꽉 채움)
* **생성 원본 비율**: `832 × 1216 px`
* **대상 파일**: `PACK_BLUE.webp`, `PACK_RED.webp`, `PACK_PURPLE.webp`, `PACK_WILD.webp`, `PACK_LEGEND.webp`

### 2.5 운명 타로 카드 (`assets/ui/tarot_*.webp`)
* **규격**: **`640 × 1024 px` (5:8)**, **`.webp`**, `RGB` (제로 텍스트)
* **생성 원본 비율**: `768 × 1216 px`
* **대상 파일**: `tarot_justice.webp`, `tarot_zeal.webp`, `tarot_chaos.webp` (폴백 `.svg` 존재)

### 2.6 카드 원화 & 프레임 (`assets/cards/`, `assets/frames/`)
* **개별 카드 원화 (`assets/cards/*.webp`)**:
  * **규격**: **`1024 × 1024 px` (1:1)**, **`.webp`**, `RGB`
  * **코드 등록 위치**: [src/ui/cardRenderer.js](file:///C:/Users/SBK/Documents/GitHub/deckbuilder-web/src/ui/cardRenderer.js) 상단 `CUSTOM_ART_MAP` (`{ [cardId]: 'assets/cards/<파일>.webp' }`)에 매핑. 미등록 카드는 `assets/placeholders/procedural_fallback.svg` + 세력 배지 사용.
* **카드 프레임 (`assets/frames/`)**:
  * **기준 비율**: `400 × 560` (고정 SVG `viewBox="0 0 400 560"` / 래스터 비교용 `800 × 1120 px RGBA`)
  * 실제 UI 사용 프레임: `card_frame_unit_blank.svg`, `card_frame_spell_blank.svg`, `card_frame_token_blank.svg`
  * 프레임 내부 슬롯 좌표(`400×560` 기준): 이름바 `(20, 14, 360×50)`, 일러스트 창 `(22, 70, 356×350)`, 스탯/효과 박스 `(24, 430, 168×112 / 208, 430, 168×112)`

### 2.7 내 필드 플레이매트 (`assets/mats/`)
* **개발자 전용 에셋 슬롯** (유저 파일 업로드 UI 없음, 기본값은 회색 단색)
* **권장 규격 ([assets/mats/README.txt](file:///C:/Users/SBK/Documents/GitHub/deckbuilder-web/assets/mats/README.txt) · `MAT_RECOMMENDED_SIZE`)**:
  * 표준 (`1280×800` 기준): **`920 × 146 px`** (가로:세로 ≈ `6.3 : 1`)
  * 고해상도 (`@2x`): **`1840 × 292 px`**
  * 권장 형식: `.webp` 또는 `.png`, `RGB` (게임 내 둥근 직사각형 `border-radius: 14px` 영역에 `background-size: cover` 적용)
* **등록 방법**: `assets/mats/<파일>.webp` 배치 후 [src/ui/cosmeticsSystem.js](file:///C:/Users/SBK/Documents/GitHub/deckbuilder-web/src/ui/cosmeticsSystem.js)의 `MAT_PRESETS`에 `{ id, label, color, borderTop, borderBottom, image: 'assets/mats/<파일>.webp' }` 추가.

### 2.8 카드 뒷면 / 커스텀 슬리브 / 룰북 / 폰트
* **카드 뒷면**: `assets/ui/card_back.svg` (순수 벡터) 및 `src/ui/cosmeticsSystem.js`의 4-색조 다이얼 SVG 빌더.
* **룰북 안내 이미지**: `assets/ui/rulebook_arena.png`, `rulebook_cards.png`, `rulebook_combat.png`, `rulebook_spells.png`
* **번들 폰트 (`assets/fonts/`)**: `Twemoji.Mozilla.ttf`(이모지 전용), `FixedsysExcelsior.ttf`, `DungGeunMo.woff` (`@font-face`로 `theme-alley.css`에 내장)

---

## 3. ComfyUI 생성 파이프라인 & 설정 (`assets/art_style.json` · `tools/generate_assets.py`)

### 3.1 공통 / 초상화 노드 파라미터
* **모델/VAE**: `sd_xl_base_1.0.safetensors` + `sdxl_vae.safetensors`
* **배경·팩·아이콘 기본**: `sampler: dpmpp_2m`, `scheduler: karras`, `steps: 24`, `cfg: 7.5`
* **인물 초상화 전용 (`comfyui.portrait`)**:
  * **Base (`txt2img`)**: `sampler: dpmpp_2m_sde`, `scheduler: karras`, `steps: 33`, `cfg: 7.3`, `832 × 1152 px`
  * **Hires 보정 (`img2img`)**: PIL LANCZOS **`1.25×` 업스케일(`1040 × 1440 px`)** → `steps: 16`, `denoise: 0.36`, `dpmpp_2m_sde + karras`
  * **표정 변형(`EXCITED`/`TIRED`/`DEAL` `img2img`)**: Base 원본(`_raw_cache/{BASE_ID}.png`) 입력 → `steps: 20`, `denoise: 0.54`, `dpmpp_2m_sde + karras`
* **결정론적 시드**: `seed_for(item_id)` (FNV-1a 해시 `% 900000000 + 20260`)
* **워크플로우 파일 (`assets/workflows/`)**:
  * API 실행 템플릿: `sdxl_txt2img_template.json`, `sdxl_img2img_template.json`
  * ComfyUI 웹 UI 불러오기용 그래프: `npc_character_comfyui.json` (`파일 → 열기`로 바로 로드 가능)

### 3.2 실행 명령 예시 (`tools/generate_assets.py`)
```bash
py -3 tools/generate_assets.py --server <COMFYUI_URL> --mode npc --force --ids NPC_SHOP_4_BASE
```
* `--mode`: `sample` | `bg` | `fantasy` | `icons` | `npc` | `all`
* `--ids`: 특정 에셋 ID만 선택 재생성
* 원본 PNG는 `assets/_raw_cache/{ID}.png`에 자동 캐시되므로, 누끼 파라미터(`assets/art_style.json`의 `cutout`)나 후처리만 수정할 때는 ComfyUI 재실행 없이 `_raw_cache`에서 즉시 재가공 가능합니다.

---

## 4. 주의사항 & 알려진 함정 (필수 체크)

1. **누끼(배경 투명화) 시 캐릭터 내부 흰색 영역 투명화 함정 (`cutout_flat_bg`)**
   * **원인**: 흰 셔츠·흰 재킷·흰 트렌치코트·은발이 이미지 **하단 테두리(`y = h - 1`)** 또는 **하부 측면 외곽**에 닿으면 홍수 채우기(BFS flood-fill)가 옷 안쪽으로 타고 들어가 캐릭터 몸통이 투명하게 뚫립니다.
   * **적용된 방지책**: `portrait` 모드(`includeBottom: false`)에서는 하단 테두리 시드를 완전히 차단하고, 좌우 측면도 상단 `45%` 영역(`y < h * 0.45`)까지만 시드를 허용하도록 `tools/generate_assets.py`를 수정해 두었습니다.
   * **생성 단계에서 막는 법**: 흰색 옷이 캔버스 테두리/어깨선 밖에서 끊기지 않게 닫힌 검은 외곽선을 유지해야 하며, 생성 모델이 `#ffffff` 배경 대신 유채색(올리브그린 등)이나 창틀 배경을 그리면 누끼가 실패하므로 **반드시 파란색/체커보드 배경 위에 올려 검수**해야 합니다.
2. **`img2img` 표정 변형 강도**
   * `img2imgDenoise: 0.54` / `steps: 20`에서는 기본 포즈를 잘 지키는 대신 표정 변화 폭이 다소 얌전하게 나옵니다. 표정 차이를 더 확실히 내고 싶으면 `denoise`를 `0.62~0.68` 범위로 높이되 얼굴 무너짐 여부를 함께 확인해야 합니다.
3. **로컬/일반 브라우저 `trycloudflare.com` 접속 제한**
   * ComfyUI 임시 터널 도메인(`trycloudflare.com`)은 국내 네트워크 환경에 따라 일반 브라우저에서는 차단될 수 있으나 Antigravity 내부 브라우저 또는 Python 실행으로 API 통신이 가능합니다.

---

## 5. 인물 초상화 재생성 진행 상태 (`26 / 26` 전체 완료)

* **나노바나나 스타일(`gemini-nano-banana-2.1` / 상반신 전체 `3:4` 구도) — 26종 전체 완료**:
  * 점술사: `NPC_FORTUNE` (`fortune_teller.webp`)
  * 상점 주인 1~5 (`base`, `excited`, `tired` 15종): `NPC_SHOP_1` ~ `NPC_SHOP_5`
  * 뒷골목 거래상 1~5 (`base`, `deal` 10종): `NPC_MERCHANT_1` ~ `NPC_MERCHANT_5`
  * 전 종 `cutout_flat_bg()` + 팔·몸통·머리카락 틈새 정밀 투명화 + 파란 배경(`#479be6`) 검수 시트 통과 후 `dist/DuelRogue.exe` 최종 빌드에 반영 완료.
* **추후 확장 작업 참고**:
  * 필요 시 `assets/mats/` 매트 이미지 추가 및 `MAT_PRESETS` 등록 (`920×146 px`).
  * 리소스 추가 후 `cargo tauri build --no-bundle` 실행 및 `src-tauri\target\release\duel-rogue.exe` → `dist\DuelRogue.exe` 교체.
