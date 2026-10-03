/** Character artwork is presentation metadata, never a Product/Runtime identity. */
export const CHARACTER_ART_SCHEMA = 'eagler-touhou/character-art/1';
export const CHARACTER_ART = {
  "reimu": {
    "name": "博丽灵梦",
    "aliases": [
      "灵梦",
      "博麗霊夢",
      "霊夢"
    ]
  },
  "marisa": {
    "name": "雾雨魔理沙",
    "aliases": [
      "魔理沙",
      "霧雨魔理沙"
    ]
  },
  "sakuya": {
    "name": "十六夜咲夜",
    "aliases": [
      "咲夜"
    ]
  },
  "youmu": {
    "name": "魂魄妖梦",
    "aliases": [
      "妖梦",
      "魂魄妖夢",
      "妖夢"
    ]
  },
  "yukari": {
    "name": "八云紫",
    "aliases": [
      "紫",
      "八雲紫"
    ]
  },
  "alice": {
    "name": "爱丽丝",
    "aliases": [
      "アリス",
      "アリス・マーガトロイド"
    ]
  },
  "remilia": {
    "name": "蕾米莉亚",
    "aliases": [
      "レミリア",
      "レミリア・スカーレット"
    ]
  },
  "yuyuko": {
    "name": "西行寺幽幽子",
    "aliases": [
      "幽幽子",
      "西行寺幽々子",
      "幽々子"
    ]
  },
  "reisen": {
    "name": "铃仙",
    "aliases": [
      "鈴仙",
      "鈴仙・優曇華院・イナバ"
    ]
  },
  "cirno": {
    "name": "琪露诺",
    "aliases": [
      "チルノ"
    ]
  },
  "lyrica": {
    "name": "莉莉卡",
    "aliases": [
      "リリカ",
      "リリカ・プリズムリバー"
    ]
  },
  "merlin": {
    "name": "梅露兰",
    "aliases": [
      "メルラン",
      "メルラン・プリズムリバー"
    ]
  },
  "lunasa": {
    "name": "露娜萨",
    "aliases": [
      "ルナサ",
      "ルナサ・プリズムリバー"
    ]
  },
  "mystia": {
    "name": "米斯蒂娅",
    "aliases": [
      "ミスティア",
      "ミスティア・ローレライ"
    ]
  },
  "tewi": {
    "name": "因幡帝",
    "aliases": [
      "帝",
      "因幡てゐ",
      "てゐ"
    ]
  },
  "aya": {
    "name": "射命丸文",
    "aliases": [
      "文"
    ]
  },
  "medicine": {
    "name": "梅蒂欣",
    "aliases": [
      "メディスン",
      "メディスン・メランコリー"
    ]
  },
  "yuuka": {
    "name": "风见幽香",
    "aliases": [
      "幽香",
      "風見幽香"
    ]
  },
  "komachi": {
    "name": "小野塚小町",
    "aliases": [
      "小町"
    ]
  },
  "eiki": {
    "name": "四季映姬",
    "aliases": [
      "映姬",
      "四季映姫",
      "四季映姫・ヤマザナドゥ"
    ]
  }
} as const;
export type CharacterArtId = keyof typeof CHARACTER_ART;
export const CHARACTER_ART_IDS = Object.freeze(Object.keys(CHARACTER_ART) as CharacterArtId[]);
export const TH09_CHARACTER_ART: readonly CharacterArtId[] = ['reimu','marisa','sakuya','youmu','reisen','cirno','lyrica','merlin','lunasa','mystia','tewi','aya','medicine','yuuka','komachi','eiki'];
export const CHARACTER_TEAMS: Readonly<Record<string, readonly CharacterArtId[]>> = {
  '结界组':['reimu','yukari'], '咏唱组':['marisa','alice'],
  '红魔组':['sakuya','remilia'], '幽冥组':['youmu','yuyuko'],
};
export function characterArtForName(name: string): CharacterArtId[] {
  if (CHARACTER_TEAMS[name]) return [...CHARACTER_TEAMS[name]!];
  const label = name.split(/[ ·]/)[0]!.replace(/[ABC]$/, '');
  return CHARACTER_ART_IDS.filter(id => id === label || CHARACTER_ART[id].name === label ||
    (CHARACTER_ART[id].aliases as readonly string[]).includes(label)).slice(0, 1);
}
export function defaultCharacterArt(game: string): CharacterArtId[] {
  return game === 'th08' ? ['reimu','yukari'] : ['reimu'];
}
