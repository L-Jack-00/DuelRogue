/**
 * src/ui/vectorIcons.js
 * 아케인 고딕 & 포일 메탈릭 인라인 SVG 벡터 아이콘 시스템
 * - UI 기본 아이콘 (금화, 검, 방패, 하트, 해골, 가방, 상점, 트레이드, 수정, 왕관 등)
 * - 10종 키워드 배지 아이콘 (영문 ID 및 한글명 모두 지원)
 * - 7종 AI 성향(Mood) 아이콘
 * - 듀얼 보드 좌/우 마법 세트 슬롯용 회전 마법진 SVG
 */

const ICON_BODIES = {
  gold: `<circle cx="12" cy="12" r="9.5" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 1.5"/><polygon points="12,7.5 15.5,12 12,16.5 8.5,12" fill="currentColor"/>`,
  sword: `<path d="M19.5 4.5L15 5l-7.5 7.5-2-2-1.5 1.5 2.5 2.5-2.5 2.5 2 2 2.5-2.5 2.5 2.5 1.5-1.5-2-2L18 9l.5-4.5z" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><line x1="11" y1="13" x2="18.5" y2="5.5" stroke="currentColor" stroke-width="1.4"/>`,
  swords: `<path d="M19.5 4.5L15.5 5.3 8.5 12.7 11.3 15.5 18.7 8.5ZM4.5 4.5L8.5 5.3 15.5 12.7 12.7 15.5 5.3 8.5Z" fill="currentColor" fill-opacity="0.24" stroke="currentColor" stroke-width="1.55" stroke-linejoin="round"/><path d="M18.6 5.4L9.9 14.1M5.4 5.4L14.1 14.1" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/><path d="M7.2 11.4l5.4 5.4M9.9 14.1L4.8 19.2M16.8 11.4l-5.4 5.4M14.1 14.1l5.1 5.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="4.4" cy="19.6" r="1.25" fill="currentColor"/><circle cx="19.6" cy="19.6" r="1.25" fill="currentColor"/>`,
  shield: `<path d="M12 2.8L4.5 5.8v5.8c0 4.9 3.2 8.9 7.5 10.4 4.3-1.5 7.5-5.5 7.5-10.4V5.8L12 2.8z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 6.5v11.5M8 11h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`,
  heart: `<path d="M12 20.5s-7.5-4.8-9.2-9.5C1.7 7.8 3.9 4.5 7.3 4.5c2 0 3.7 1.1 4.7 2.6 1-1.5 2.7-2.6 4.7-2.6 3.4 0 5.6 3.3 4.5 6.5-1.7 4.7-9.2 9.5-9.2 9.5z" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`,
  skull: `<path d="M12 3C7.6 3 4 6.2 4 10.3c0 2.5 1.3 4.7 3.2 6v2.7h9.6v-2.7c1.9-1.3 3.2-3.5 3.2-6C20 6.2 16.4 3 12 3z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="9" cy="10.5" r="1.6" fill="currentColor"/><circle cx="15" cy="10.5" r="1.6" fill="currentColor"/><path d="M10 19v-2m2 2v-2m2 2v-2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`,
  bag: `<path d="M7 9V7a5 5 0 0 1 10 0v2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="4" y="9" width="16" height="11.5" rx="2.5" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.8"/><path d="M4 13.5h16M10 13.5v2.5h4v-2.5" stroke="currentColor" stroke-width="1.6"/>`,
  shop: `<path d="M4 9l1.5-5h13L20 9v2a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0V9z" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M5.5 13v7h13v-7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`,
  merchant: `<path d="M6 19c0-3.5 2.7-6 6-6s6 2.5 6 6" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M7 10.5C7 6.4 9.2 3.5 12 3.5s5 2.9 5 7c-1.5 1-3.3 1.4-5 1.4s-3.5-.4-5-1.4z" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="1.7"/><circle cx="10.3" cy="9" r="1" fill="currentColor"/><circle cx="13.7" cy="9" r="1" fill="currentColor"/>`,
  crystal: `<polygon points="12,2.5 18.5,8.5 16.5,20.5 7.5,20.5 5.5,8.5" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><polyline points="5.5,8.5 12,11.5 18.5,8.5" fill="none" stroke="currentColor" stroke-width="1.3"/><line x1="12" y1="2.5" x2="12" y2="20.5" stroke="currentColor" stroke-width="1.2"/>`,
  crown: `<path d="M3.5 17.5L5 7.5l4.5 4L12 5l2.5 6.5L19 7.5l1.5 10H3.5z" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><line x1="4" y1="20" x2="20" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  scroll: `<path d="M6 4h11a2.5 2.5 0 0 1 2.5 2.5V8H17v11.5a2 2 0 0 1-2 2H6.5a2.5 2.5 0 0 1-2.5-2.5V6.5A2.5 2.5 0 0 1 6 4z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 9h5M9 12.5h5M9 16h3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  pack: `<path d="M6 3.5h12l-1 3v11l1 3H6l1-3v-11l-1-3z" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><line x1="6.5" y1="6.5" x2="17.5" y2="6.5" stroke="currentColor" stroke-width="1.4"/><line x1="6.5" y1="17.5" x2="17.5" y2="17.5" stroke="currentColor" stroke-width="1.4"/><polygon points="12,9.2 14.5,12 12,14.8 9.5,12" fill="currentColor"/>`,
  binder: `<rect x="5" y="3.5" width="14" height="17" rx="2" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.7"/><line x1="9" y1="3.5" x2="9" y2="20.5" stroke="currentColor" stroke-width="1.6"/><line x1="12" y1="9" x2="16" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="12" y1="13" x2="16" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  gear: `<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v2.2m0 13.6V21m9-9h-2.2M5.2 12H3m15.4-6.4-1.6 1.6M7.2 16.8l-1.6 1.6m12.8 0-1.6-1.6M7.2 7.2 5.6 5.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="12" r="6.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 2.5"/>`,
  dice: `<rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor"/>`,
  flame: `<path d="M12.5 2.5c.8 3.2 4.5 5 4.5 9.5a5 5 0 1 1-10 0c0-2.4 1.3-4.6 3-6.2-.2 1.8.8 2.8 2 3.2-.5-2.2-.3-4.2.5-6.5z" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`,
  balance: `<line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="5" y1="7" x2="19" y2="7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="8" y1="20" x2="16" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M5 7l-2.2 6h4.4L5 7zm14 0l-2.2 6h4.4L19 7z" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
  trade: `<path d="M7 7h11l-3-3m3 3l-3 3M17 17H6l3-3m-3 3l3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  target: `<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>`,
  eye: `<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.8" fill="currentColor"/>`,
  spark: `<polygon points="12,2.5 14.3,9.7 21.5,12 14.3,14.3 12,21.5 9.7,14.3 2.5,12 9.7,9.7" fill="currentColor" fill-opacity="0.28" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
  droplet: `<path d="M12 3s6 6.8 6 11a6 6 0 1 1-12 0c0-4.2 6-11 6-11z" fill="currentColor" fill-opacity="0.26" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`,
  arrowPierce: `<path d="M4 12h15m-4-4.5L19.5 12 15 16.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"/>`,
  doubleSword: `<path d="M5 17L15 7l2 2-10 10H5v-2zm4 2l8-8 2 2-8 8H9v-2z" fill="currentColor" fill-opacity="0.24" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
  stealth: `<path d="M3.5 12s3.5-5.5 8.5-5.5 8.5 5.5 8.5 5.5-3.5 5.5-8.5 5.5S3.5 12 3.5 12z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.5 2"/><line x1="4.5" y1="19.5" x2="19.5" y2="4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  undying: `<path d="M12 4.5a7.5 7.5 0 1 1-6.5 3.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><polyline points="4.5,4.5 5.5,8.5 9.5,7.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><polygon points="12,8.5 15,12 12,15.5 9,12" fill="currentColor"/>`,
  divineHalo: `<ellipse cx="12" cy="6.5" rx="6.5" ry="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><polygon points="12,10 14.2,14.2 18.5,14.8 15.2,17.8 16,21.5 12,19.5 8,21.5 8.8,17.8 5.5,14.8 9.8,14.2" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
  retaliate: `<path d="M4.5 12h11l-3.5-3.5m3.5 3.5L12 15.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.5 6.5l-2 5.5 2 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  bulwark: `<rect x="4.5" y="6" width="15" height="13" rx="2" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.8"/><path d="M4.5 9h3V6m9 0v3h3M8.5 19v-5h7v5" stroke="currentColor" stroke-width="1.5"/>`,
  tauntBanner: `<path d="M6 3v18m0-16h12l-2.5 4 2.5 4H6" fill="currentColor" fill-opacity="0.24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  check: `<polyline points="5,12.5 9.5,17 19,7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  cross: `<line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
  warn: `<polygon points="12,3.5 21,19.5 3,19.5" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><line x1="12" y1="9.5" x2="12" y2="14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.8" r="1" fill="currentColor"/>`,
  compass: `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><polygon points="15.5,8.5 13.5,13.5 8.5,15.5 10.5,10.5" fill="currentColor" fill-opacity="0.3" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
  moon: `<path d="M17.5 15.2A7 7 0 0 1 9.8 6a7 7 0 1 0 7.7 9.2z" fill="currentColor" fill-opacity="0.24" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`,
  home: `<path d="M4 11l8-7 8 7v8.5a1 1 0 0 1-1 1h-4.5v-5.5h-5V20.5H5a1 1 0 0 1-1-1V11z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`,
  lock: `<rect x="5" y="10.5" width="14" height="9.5" rx="2" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.7"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="15.2" r="1.2" fill="currentColor"/>`,
  bulb: `<path d="M9 17.5h6m-5 3h4M8.2 14.5C6.8 13.4 6 11.8 6 10a6 6 0 1 1 12 0c0 1.8-.8 3.4-2.2 4.5-.5.4-.8 1-.8 1.7V17H9v-.8c0-.7-.3-1.3-.8-1.7z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`,
  trophy: `<path d="M7 4h10v6a5 5 0 0 1-10 0V4z" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M7 6H4.2a1.5 1.5 0 0 0-1.4 1.9l.8 2.6A2.5 2.5 0 0 0 6 12h1m10-6h2.8a1.5 1.5 0 0 1 1.4 1.9l-.8 2.6A2.5 2.5 0 0 1 18 12h-1M12 15v4m-3.5 1.5h7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`,
  speaker: `<polygon points="4,9.5 8.5,9.5 14,5 14,19 8.5,14.5 4,14.5" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M17.2 8.8a4.5 4.5 0 0 1 0 6.4m2.4-8.8a7.8 7.8 0 0 1 0 11.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`,
  flag: `<path d="M5.5 3.5v17m0-15.5h12l-2.8 4 2.8 4h-12" fill="currentColor" fill-opacity="0.24" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`,
  broom: `<path d="M15.5 4L10 12.5m-4.5 3l3.5-3.5 5 5-3.5 3.5a3.5 3.5 0 0 1-5-5zM18.5 7l-4 4" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`,
  wrench: `<path d="M14.7 6.3a4.5 4.5 0 0 0-5.4 5.9l-5 5a1.5 1.5 0 0 0 2.1 2.1l5-5a4.5 4.5 0 0 0 5.9-5.4l-2.6 2.6-2.6-2.6 2.6-2.6z" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
  play: `<polygon points="7,5 19,12 7,19" fill="currentColor" fill-opacity="0.3" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`,
  pause: `<rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" fill-opacity="0.28" stroke="currentColor" stroke-width="1.6"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" fill-opacity="0.28" stroke="currentColor" stroke-width="1.6"/>`,
  book: `<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v16.5H6.5A2.5 2.5 0 0 0 4 22V5.5zm16 0A2.5 2.5 0 0 0 17.5 3H12v16.5h5.5A2.5 2.5 0 0 1 20 22V5.5z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`,
  save: `<path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><rect x="8" y="4" width="6" height="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="8" y="13" width="8" height="7" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
  gift: `<rect x="4" y="9" width="16" height="11" rx="1.5" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.7"/><rect x="3" y="6" width="18" height="3.5" rx="1" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="1.5"/><line x1="12" y1="6" x2="12" y2="20" stroke="currentColor" stroke-width="1.6"/><path d="M12 6c-1.5-2.5-5-2.5-5-.5S10.5 6 12 6zm0 0c1.5-2.5 5-2.5 5-.5S13.5 6 12 6z" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
  campfire: `<path d="M12 3.5c2 3 4 5.2 4 8a4 4 0 1 1-8 0c0-2 1-3.5 2.2-4.8 0 1.4.8 2.2 1.8 2.5-.3-1.8-.2-3.7 0-5.7z" fill="currentColor" fill-opacity="0.26" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M5 19.5l14-3m-14 0l14 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  tombstone: `<path d="M7 19.5V10a5 5 0 0 1 10 0v9.5H7z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.7"/><line x1="5" y1="19.5" x2="19" y2="19.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="12" y1="8.5" x2="12" y2="14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="9.5" y1="11" x2="14.5" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  bolt: `<polygon points="13.5,3 6,13.5 11.5,13.5 10.5,21 18,10.5 12.5,10.5" fill="currentColor" fill-opacity="0.28" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
  star: `<polygon points="12,3 14.7,8.7 21,9.5 16.4,13.9 17.6,20.2 12,17.1 6.4,20.2 7.6,13.9 3,9.5 9.3,8.7" fill="currentColor" fill-opacity="0.32" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
  winMin: `<line x1="6" y1="12" x2="18" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  winMax: `<rect x="6" y="6" width="12" height="12" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.7"/>`,
  winRestore: `<rect x="5" y="8" width="10" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 8V5.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5H16" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
  winClose: `<line x1="6.5" y1="6.5" x2="17.5" y2="17.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="17.5" y1="6.5" x2="6.5" y2="17.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
};

const KEYWORD_ICON_MAP = {
  TAUNT: 'tauntBanner',
  '도발': 'tauntBanner',
  PIERCE: 'arrowPierce',
  '관통': 'arrowPierce',
  DIRECT: 'target',
  '직접공격': 'target',
  STEALTH: 'stealth',
  '은신': 'stealth',
  DOUBLE: 'doubleSword',
  '연속공격': 'doubleSword',
  LIFESTEAL: 'droplet',
  '흡혈': 'droplet',
  UNDYING: 'undying',
  '불굴': 'undying',
  DIVINE: 'divineHalo',
  '신성': 'divineHalo',
  RETALIATE: 'retaliate',
  '반격': 'retaliate',
  BULWARK: 'bulwark',
  '철벽': 'bulwark',
};

const MOOD_ICON_MAP = {
  AGGRESSIVE: 'swords',
  DEFENSIVE: 'shield',
  CALCULATING: 'eye',
  GAMBLER: 'dice',
  TRICKSTER: 'crystal',
  BERSERK: 'flame',
  PANIC: 'warn',
};

export function svgIcon(name, className = '') {
  const body = ICON_BODIES[name] || ICON_BODIES.spark;
  const cls = ['vicon', `vicon-${name}`, className].filter(Boolean).join(' ');
  return `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true">${body}</svg>`;
}

export function keywordIcon(idOrName, className = '') {
  const key = String(idOrName || '').trim();
  const iconName = KEYWORD_ICON_MAP[key] || KEYWORD_ICON_MAP[key.toUpperCase()] || 'spark';
  return svgIcon(iconName, ['vicon-keyword', className].filter(Boolean).join(' '));
}

export function moodIcon(moodId, className = '') {
  const key = String(moodId || '').trim().toUpperCase();
  const iconName = MOOD_ICON_MAP[key] || 'crystal';
  return svgIcon(iconName, ['vicon-mood', `vicon-mood-${key.toLowerCase()}`, className].filter(Boolean).join(' '));
}

export function magicCircleSvg(side = 'left') {
  const isLeft = side === 'left';
  const stroke = isLeft ? '#38bdf8' : '#c084fc';
  const accent = isLeft ? '#bae6fd' : '#f5d0fe';
  return `
    <svg viewBox="0 0 120 120" class="magic-circle-svg magic-circle-${side}" aria-hidden="true">
      <g class="mc-ring-outer" fill="none" stroke="${stroke}">
        <circle cx="60" cy="60" r="52" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.72" />
        <circle cx="60" cy="60" r="45" stroke-width="0.9" opacity="0.5" />
      </g>
      <g class="mc-ring-inner" fill="none" stroke="${accent}">
        <polygon points="60,18 96,82 24,82" stroke-width="1.2" opacity="0.6" />
        <polygon points="60,102 96,38 24,38" stroke-width="1.2" opacity="0.6" />
        <circle cx="60" cy="60" r="18" stroke-width="1.4" opacity="0.82" />
      </g>
      <polygon points="60,48 69,60 60,72 51,60" fill="${stroke}" fill-opacity="0.35" stroke="${accent}" stroke-width="1.1" />
    </svg>
  `.trim();
}

export function hydrateVectorIcons(root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const targets = root.querySelectorAll('[data-vicon]');
  targets.forEach((el) => {
    const name = el.getAttribute('data-vicon');
    const extraClass = el.getAttribute('data-vicon-class') || '';
    if (!name) return;
    el.innerHTML = svgIcon(name, extraClass);
  });
}
