/**
 * src/ui/vectorIcons.js
 * 번들 오픈소스 이모지 폰트(Twemoji.Mozilla.ttf, 'DuelRogueEmoji') 기반 공용 이모지 시스템
 * + Windows 2000 타이틀바 제어 글리프 + 듀얼 필드 좌/우 마법 세트 회전 마법진 SVG
 */

const EMOJI_BODIES = {
  gold: '\u{1FA99}',        // 🪙
  sword: '\u{1F5E1}\uFE0F', // 🗡️
  swords: '\u2694\uFE0F',   // ⚔️
  shield: '\u{1F6E1}\uFE0F',// 🛡️
  heart: '\u2764\uFE0F',    // ❤️
  skull: '\u{1F480}',       // 💀
  bag: '\u{1F392}',         // 🎒
  shop: '\u{1F3EA}',        // 🏪
  merchant: '\u{1F575}\uFE0F', // 🕵️
  crystal: '\u{1F52E}',     // 🔮
  crown: '\u{1F451}',       // 👑
  scroll: '\u{1F4DC}',      // 📜
  pack: '\u{1F0CF}',        // 🃏
  binder: '\u{1F4D8}',      // 📘
  gear: '\u2699\uFE0F',     // ⚙️
  dice: '\u{1F3B2}',        // 🎲
  flame: '\u{1F525}',       // 🔥
  balance: '\u2696\uFE0F',  // ⚖️
  trade: '\u{1F504}',       // 🔄
  target: '\u{1F3AF}',      // 🎯
  eye: '\u{1F441}\uFE0F',   // 👁️
  spark: '\u2728',          // ✨
  droplet: '\u{1F4A7}',     // 💧
  arrowPierce: '\u{1F3F9}', // 🏹
  doubleSword: '\u2694\uFE0F', // ⚔️
  stealth: '\u{1F32B}\uFE0F', // 🌫️
  undying: '\u267E\uFE0F',  // ♾️
  divineHalo: '\u{1F607}',  // 😇
  retaliate: '\u{1F4A5}',   // 💥
  bulwark: '\u{1F3F0}',     // 🏰
  tauntBanner: '\u{1F6A9}', // 🚩
  check: '\u2705',          // ✅
  cross: '\u274C',          // ❌
  warn: '\u26A0\uFE0F',     // ⚠️
  compass: '\u{1F9ED}',     // 🧭
  moon: '\u{1F319}',        // 🌙
  home: '\u{1F3E0}',        // 🏠
  lock: '\u{1F512}',        // 🔒
  bulb: '\u{1F4A1}',        // 💡
  trophy: '\u{1F3C6}',      // 🏆
  speaker: '\u{1F50A}',     // 🔊
  flag: '\u{1F6A9}',        // 🚩
  broom: '\u{1F9F9}',       // 🧹
  wrench: '\u{1F527}',      // 🔧
  play: '\u25B6\uFE0F',     // ▶️
  pause: '\u23F8\uFE0F',    // ⏸️
  book: '\u{1F4D6}',        // 📖
  save: '\u{1F4BE}',        // 💾
  gift: '\u{1F381}',        // 🎁
  campfire: '\u{1F3D5}\uFE0F', // 🏕️
  tombstone: '\u{1FAA6}',   // 🪦
  bolt: '\u26A1',           // ⚡
  star: '\u2B50',           // ⭐
};

const WIN_CHROME_GLYPHS = {
  winMin: '−',
  winMax: '□',
  winRestore: '❐',
  winClose: '✕',
};

const WHITE_SKULL_SVG = `<svg viewBox="0 0 24 24" class="vicon vicon-white-skull" aria-hidden="true"><path d="M12 2.5C7.3 2.5 3.6 5.9 3.6 10.3c0 2.5 1.2 4.6 3.1 6v2.9a1 1 0 0 0 1 1h8.6a1 1 0 0 0 1-1v-2.9c1.9-1.4 3.1-3.5 3.1-6C20.4 5.9 16.7 2.5 12 2.5z" fill="#ffffff" stroke="#0f172a" stroke-width="1.75" stroke-linejoin="round"/><circle cx="8.9" cy="10.4" r="1.85" fill="#0f172a"/><circle cx="15.1" cy="10.4" r="1.85" fill="#0f172a"/><polygon points="12,12.7 10.9,15 13.1,15" fill="#0f172a"/><path d="M9.6 20.2v-2.7m2.4 2.7v-2.7m2.4 2.7v-2.7" stroke="#0f172a" stroke-width="1.5" stroke-linecap="round"/></svg>`;

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
  if (name === 'whiteSkull') {
    return WHITE_SKULL_SVG;
  }
  if (WIN_CHROME_GLYPHS[name]) {
    const cls = ['vicon', `vicon-${name}`, 'win-chrome-glyph', className].filter(Boolean).join(' ');
    return `<span class="${cls}" aria-hidden="true">${WIN_CHROME_GLYPHS[name]}</span>`;
  }
  const emoji = EMOJI_BODIES[name] || EMOJI_BODIES.spark;
  const cls = ['vicon', `vicon-${name}`, 'emoji-icon', className].filter(Boolean).join(' ');
  return `<span class="${cls}" aria-hidden="true">${emoji}</span>`;
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
