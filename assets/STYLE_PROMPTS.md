# Duel Rogue 그래픽 스타일 프롬프트

모든 그래픽 생성의 기준 문서다. 이미지를 만들 때는 아래 순서로 문장을 이어 붙인다.

> 공통 스타일 + 장면 프롬프트 + 용도 규격

그리고 금지 요소(네거티브)를 함께 넣는다.
카드 일러스트는 이 문서의 범위가 아니다. 카드 설계를 고도화한 뒤에 따로 정한다.

## 0. 한 줄 콘셉트

> **확정 (2026-11-18): A안 "골목 토너먼트".** 다크 판타지안(고딕 결투장, 중세 광장 등)은 폐기했다.

2000년대 초반 TV 애니메이션 속 소도시의 번화한 뒷동네에서 길거리 카드 토너먼트가 열린다. 낮에는 골목의 카드샵과 오락실을 돌고, 밤에는 낡은 나무 테이블에서 결투한다.

**분위기: 신나는데 좀 불량하다.** 그라피티 벽, 지하철 입구, 공사장 비계, 쭈그려 앉은 동네 양아치와 펑크족이 흔하다. 하지만 위험하기보다 장난스럽고 활기차다. 낡은 온라인 게임의 '도둑들의 도시' 같은 뒷골목 번화가를 떠올리면 된다. (특정 작품 이름은 프롬프트에 쓰지 않는다.)

### 0.1 세계의 두 층

| 층 | 무엇이 해당하나 | 화풍 |
| --- | --- | --- |
| 현실 (기본) | 배경, NPC, UI, 카드 뒷면, 포털 아이콘, 듀얼 테이블 | 2000년대 애니메이션 배경화 + 셀 채색 인물 |
| 카드 속 판타지 | 카드 일러스트, 상품 키 아트, 타로 그림 | 판타지 일러스트 (진영 색 중심) |

- 판타지는 **카드 안에만** 있다. 현실 장면에 몬스터, 성, 마법진을 그리지 않는다.
- 예외는 연출뿐이다. 소환·공격·보스전 같은 순간에만 진영 색 빛이 테이블 위로 잠깐 번진다. 이것은 그림이 아니라 코드 이펙트로 처리한다.
- 보스 배경도 현실 공간(옥상, 폐공장, 불법 오락실)이다. 진영 색 조명과 공기의 일렁임 정도로만 긴장감을 준다.

### 0.2 진영 색

진영 색은 **배경 연출, 상품, 이펙트, 진영 탭**에만 쓴다. 카드 프레임에는 쓰지 않는다(4.2 참고).

| 진영 | 색 | 현실 쪽 상징물 |
| --- | --- | --- |
| 정의 BLUE | 사파이어 `#38bdf8` | 옥상 투광등, 방패 스티커 |
| 열의 RED | 진홍 `#f87171` | 경고등, 드럼통 불 |
| 혼돈 PURPLE | 자수정 `#c084fc` | 오락실 네온, 주사위 |
| 중립 WILD | 올리브 `#a3e635` | 보따리, 낡은 지도 |
| 전설 LEGEND | 금 `#facc15` | 시상대, 트로피 |

> 2026-11-18 사용자 지시: 따뜻한 노을 톤 대신 **하늘이 보이는 하늘색 톤**, 도시는 **한국·일본풍 골목**. 밤 장면(상인 노점, 덱 편집실, 보스)은 밤 그대로 두되 노을·황금빛 표현은 쓰지 않는다.

## 1. 공통 스타일 (모든 프롬프트 뒤에 붙인다)

```
early-2000s anime TV series background art, hand-painted cel-animation backgrounds,
soft painterly gouache texture with clean readable shapes, clear sky-blue color palette,
wide visible blue sky with soft white clouds, crisp bright daylight and cool airy tones, subtle film grain,
lived-in and slightly messy, rough-and-tumble downtown with playful rebellious energy,
lively and upbeat rather than dangerous, street card-game tournament culture,
original setting and original designs
```

## 2. 금지 요소 (네거티브)

```
no logos, no brand names, no readable text, no watermark, no existing franchise characters,
no copyrighted card frames, no photorealism, no 3D render look, no gore,
no oversaturated neon cyberpunk, no medieval fantasy castle
```

기존 작품의 이름(예: 특정 카드 게임의 도시 편)은 프롬프트에 넣지 않는다. 그런 분위기는 위의 묘사로만 낸다. 생성 결과가 특정 작품을 닮지 않도록 하기 위해서다.

## 3. 장면 계열 ① 소도시·골목·빌딩·가게

```
a Korean and Japanese style city back-alley neighborhood during a citywide street card tournament,
narrow alleys between 3-4 story mixed-use buildings, ground-floor hobby shops and
tiny card stores with hand-made posters, an arcade with glowing cabinet screens,
vending machines, utility poles with tangled overhead wires, rolled shutters,
potted plants, bicycles, tournament banners and paper flags strung across the street,
graffiti murals made of abstract shapes with no readable letters, a subway entrance,
construction scaffolding, dumpsters and stacked crates, pawn shops and arcades,
motorbikes parked crookedly, delinquent teens in tracksuits squatting by vending machines
and punks leaning on walls as small background silhouettes,
pedestrian bridge and rooftop water tanks in the distance, bright daytime with a wide blue sky visible above the alley
```

화면별 변주는 다음과 같다. 위 문장의 일부를 바꿔서 쓴다.

| 화면 | 바꿀 부분 |
| --- | --- |
| 타이틀 | 해 질 녘의 큰길을 넓게 내려다보는 구도. 토너먼트 깃발이 도시 전체에 걸려 있다. 하늘이 넓어 로고를 놓을 자리가 있다. |
| 거점 | 세 갈래 골목 교차로. 왼쪽은 카드샵 입구, 오른쪽은 어두운 뒷골목, 가운데는 결투장으로 가는 계단이다. 포털 세 개와 대응한다. |
| 상점 | 좁은 카드샵 내부. 유리 쇼케이스, 벽면 가득한 팩 진열대, 카운터 위의 금전등록기와 계산기, 형광등이 있다. |
| 수상한 상인 | 밤의 뒷골목. 녹슨 셔터 앞에 접이식 테이블 노점이 있다. 백열전구 하나, 비에 젖은 바닥, 자판기 불빛이 있다. |
| 덱 편집실 | 다락방 같은 자취방. 바닥에 펼친 카드, 바인더, 덱 케이스 탑, 창밖에 밤의 도시가 보인다. |
| 결투장 입구 | 상가 지하의 대회장 입구. 대진표 화이트보드, 접수 테이블, 줄 선 참가자의 실루엣이 있다. |
| 점쟁이 | 상가 2층 구석의 점집. 구슬 커튼, 보랏빛 스탠드, 타로가 놓인 작은 원탁이 있다. |
| 보스(정의/열의/혼돈) | 각각 옥상 헬리패드의 푸른 조명, 폐공장의 붉은 불빛, 불법 오락실의 보라 네온. 진영 색만 강하게 준다. |
| 승리 / 패배 | 승리: 시상대와 꽃가루, 노을. 패배: 비 오는 버스 정류장 벤치에 흩어진 카드. |

## 4. 장면 계열 ② 나무 테이블·소품·아케이드 조작부

```
a worn but well-loved wooden table seen from a slightly elevated three-quarter top-down view,
scratches, coffee-ring stains and old sticker residue, scattered six-sided dice,
a chunky pocket calculator used to track life points, a small pile of coins,
translucent plastic deck boxes and rubber bands, a few sleeved cards face-down,
the lower edge framed by a retro arcade cabinet control panel with a ball-top joystick,
colorful round push buttons and worn decals, bright cool daylight from a nearby window, cozy clutter at the edges,
clear empty play area in the center
```

**용도: 듀얼 화면 배경과 화면 틀(HUD).**
- 테이블 가운데는 카드를 놓을 자리라서 반드시 비운다. 소품은 가장자리에만 둔다.
- 아케이드 조작부는 화면 하단의 손패·버튼 영역이 된다.

이 계열에서 나오는 UI 아이디어는 다음과 같다.

| UI 요소 | 디자인 |
| --- | --- |
| LP 표시 | 계산기의 7세그먼트 LCD 숫자 |
| 버튼 | 아케이드의 둥근 플라스틱 버튼(진영 색) |
| 패널 | 나무 결 + 마스킹 테이프 + 스티커 |
| 탭 | 덱 케이스의 색 라벨 |
| 동전·주사위 | 골드 표시와 확률 효과 연출에 재사용 |

### 4.1 UI 키트 (코드로 구현하는 부분)

그림 생성 없이 CSS와 SVG로 만든다. 모든 화면이 같은 부품을 쓴다.

| 부품 | 모습 |
| --- | --- |
| 기본 패널 | 따뜻한 크림색 종이 또는 나무 결, 모서리에 마스킹 테이프 |
| 어두운 패널 | 밤 장면용. 남색 반투명 + 종이 질감, 테두리는 흰 크림 선 |
| 주 버튼 | 둥근 아케이드 버튼. 눌리면 아래로 꺼지는 입체감. 진영 색 |
| 보조 버튼 | 덱 케이스 색 라벨 모양의 납작한 탭 |
| 숫자(LP, 골드, 턴) | 계산기 7세그먼트 LCD. 연두빛 액정 바탕 |
| 제목 글자 | 굵은 손글씨풍 + 흰 외곽선. 대회 포스터 느낌 |
| 알림·배지 | 스티커(약간 기울어짐, 흰 테두리, 그림자) |
| 화면 전환 | 셔터가 내려왔다 올라가는 연출 |

### 4.2 카드 프레임 방향

일러스트 칸은 비워 두고(지금처럼 대체 그림 유지), 테두리만 바꾼다.

- **진영별로 프레임 색을 나누지 않는다. 몬스터와 마법만 구분한다.** 진영은 카드 안의 작은 진영 마크로만 표시한다.
  - 몬스터: 따뜻한 주황·갈색 계열 테두리
  - 마법: 청록 계열 테두리
  - 토큰: 회색 점선 테두리
- 금색 양피지 느낌 대신 **실제로 인쇄된 트레이딩 카드**처럼 보이게 한다. 크림색 카드지, 얇은 인쇄 망점 질감.
- 희귀도는 테두리의 박(은박, 금박, 홀로그램)으로 구분한다.
- 공·수 숫자 칸과 레벨 표시는 지금 배치를 유지해 가독성을 지킨다.

### 4.3 인물 규칙

- 인물은 동네 사람이다. 판타지 의상, 갑옷, 로브를 입히지 않는다.
- **상점 주인과 수상한 상인은 인카운터마다 다른 사람이 나온다.** 각각 여러 명을 만들고, 런마다 시드로 한 명씩 뽑는다.
- 한 사람은 표정 변주를 가진다. 변주는 그 사람의 기본 그림을 `image_references`로 넣어 같은 인물로 맞춘다.
  - 상점 주인: 기본 / 신남(전설 팩 입고) / 지침(매진)
  - 수상한 상인: 기본 / 거래 성사
- 출연진 목록은 `asset_manifest.json`의 `NPC_SHOP_*`, `NPC_MERCHANT_*`에 있다.
- 점쟁이: 상가 2층 점집 할머니. 보라 숄, 구슬 목걸이, 줄 달린 돋보기안경. 한 명만 둔다.

## 5. 용도 규격 (장면 뒤에 붙인다)

> 2026-11-18 샘플 결과: 'darker vignette'라고 쓰면 검은 둥근 테두리가 그려졌고, 'calm center'만으로는 가운데가 비지 않았다. 아래 문장으로 고쳤다. 불량한 분위기는 '작은 실루엣'으로 쓰면 동네 아이처럼 보이므로, 전경에 구체적인 인물 묘사를 넣는다.

| 용도 | 붙일 문장 |
| --- | --- |
| 화면 배경 | `wide 16:9 game background, no characters in focus, soft gradual darkening toward the edges with no drawn border or frame, the central third of the image kept open and uncluttered for UI overlay` |
| NPC 초상 | `waist-up character portrait, same character design across variations, plain transparent background, anime cel-shaded character over painted texture` |
| 아이콘 | `single game UI icon, centered, bold silhouette, isolated on transparent background` |
| UI 부품 | `flat front-facing UI element texture for 9-slice scaling, even lighting, no perspective, transparent background` |

## 6. 상품(부스터팩·스페셜·스트럭처 덱) 그림 규칙

**목표:** 그림 한 장만 만들어 넣으면 게임이 알아서 상품 모양으로 감싸 준다. 상품 디자인을 아직 고도화하지 않았기 때문이다.

- **그림 제작 규칙**
  - 상품 그림은 "카드 속 판타지" 층이다. 배경과 달리 판타지 일러스트로 그리고, 색은 해당 진영 색에 맞춘다.
  - 키 아트만 만든다. 글자·로고·테두리·포장 모양을 넣지 않는다.
  - 세로 2:3 비율로 만들고, 중요한 대상은 가운데 60% 안에 둔다. 위·아래 가장자리가 포장 이음매에 가려지기 때문이다.
  - 프롬프트 끝에 붙일 문장:
    ```
    key art only, vertical 2:3, centered subject inside the middle 60 percent,
    no text, no logo, no border, no packaging shape
    ```
- **게임 쪽 처리**: 포장 틀은 코드가 씌운다.
  - 부스터팩: 위아래 톱니 이음매와 포일 광택
  - 스페셜: 금박 테두리
  - 스트럭처 덱: 상자 입체감
  - 공통: 진영 색 띠, 상품 이름
- **파일 위치**: `assets/products/<상품ID>.webp`에 넣으면 자동으로 적용된다. 그림이 없으면 지금의 기본 디자인을 쓴다.
- 이 틀 씌우기 기능은 그래픽 작업의 첫 단계에서 구현한다.
