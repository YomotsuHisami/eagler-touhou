/** The reused DAT decoder has stable source labels. Translate presentation,
 * leaving raw player names and dates unchanged in the table renderer. */
const english: Record<string, string> = {
  '东风谷早苗': 'Sanae Kochiya', '河城荷取': 'Nitori Kawashiro', '帕秋莉': 'Patchouli Knowledge', '伊吹萃香': 'Suika Ibuki',
  '排行榜': 'Rankings', '各机体游玩统计': 'Play statistics by loadout', '游玩次数': 'Play counts', '各机体开局次数': 'Starts by loadout',
  '通关次数': 'Clear counts', '通关与关卡进度': 'Clears and stage progress', '单关练习': 'Stage practice', '时间与存档': 'Time and save details',
  '音乐解锁': 'Music unlocks', '符卡汇总': 'Spell card totals', '单局详细统计': 'Run details',
  '机体': 'Loadout', '角色': 'Character', '难度': 'Difficulty', '分数': 'Score', '进度／名次': 'Progress / place', '名字': 'Name',
  '日期': 'Date', '续关': 'Continues', '处理落率': 'Slowdown', '主线': 'Story', '练习': 'Practice', '关卡': 'Stage', '最高分': 'Highest score',
  '次数': 'Count', '项目': 'Field', '记录': 'Value', '开局': 'Starts', '开局次数': 'Starts', '重试': 'Retries', '通关': 'Clears',
  '人数': 'Players', '游玩帧数': 'Play frames', '点道具': 'Point items', '暂停': 'Pauses', '刻符': 'Time orbs', '人妖率（原值）': 'Human / youkai ratio (raw)',
  '游玩时间': 'Play time', '程序运行时间': 'Program running time', '游玩时间（字段含义待确认）': 'Play time (meaning unconfirmed)',
  '最近名字': 'Last name', '游戏版本': 'Game version', '曲目': 'Track', '状态': 'Status', '模式': 'Mode', '挑战次数': 'Attempts', '取得次数': 'Captures',
  '符卡练习': 'Spell practice', '对战开放': 'Versus unlocked', '主线标记': 'Story flags', 'Extra 标记': 'Extra flags', '开放': 'Unlocked',
  '合计': 'Total', '未记录': 'Not recorded', '未知': 'Unknown', '已通关': 'Cleared', '未开放': 'Locked', '已开放': 'Unlocked', '全部开放': 'All unlocked',
  '未填写': 'Not entered', '是': 'Yes', '否': 'No', '结界组': 'Border team', '咏唱组': 'Magic team', '红魔组': 'Scarlet team', '幽冥组': 'Ghost team',
  '灵梦': 'Reimu', '博丽灵梦': 'Reimu Hakurei', '魔理沙': 'Marisa', '雾雨魔理沙': 'Marisa Kirisame', '咲夜': 'Sakuya', '十六夜咲夜': 'Sakuya Izayoi',
  '妖梦': 'Youmu', '魂魄妖梦': 'Youmu Konpaku', '紫': 'Yukari', '八云紫': 'Yukari Yakumo', '爱丽丝': 'Alice', '蕾米莉亚': 'Remilia',
  '幽幽子': 'Yuyuko', '西行寺幽幽子': 'Yuyuko Saigyouji', '铃仙': 'Reisen', '琪露诺': 'Cirno', '莉莉卡': 'Lyrica', '梅露兰': 'Merlin', '露娜萨': 'Lunasa',
  '米斯蒂娅': 'Mystia', '因幡帝': 'Tewi', '射命丸文': 'Aya Shameimaru', '梅蒂欣': 'Medicine', '风见幽香': 'Yuuka Kazami', '小野塚小町': 'Komachi Onozuka', '四季映姬': 'Eiki Shiki',
  '包含存档中的默认排行槽位，不代表实际游玩局数。': 'Includes default ranking slots; these are not a count of played games.',
  '合计块保留存档原值，不与各机体重复相加。': 'Totals retain the saved values and are not added to individual loadouts again.',
  '花映冢的游玩时间字段含义尚未确认，保留原值供参考。': 'The TH09 play-time field is not fully understood; its original value is shown for reference.',
  '此存档没有普通排行榜记录。': 'This save contains no regular ranking records.',
};
export function scoreText(value: string, locale: string): string {
  if (locale !== 'en') return value;
  if (english[value]) return english[value];
  const duration = /^(\d+) 小时 (\d+) 分钟$/.exec(value);
  if (duration) return `${duration[1]} h ${duration[2]} min`;
  const loadout = /^(.+) ([ABC])$/.exec(value);
  if (loadout && english[loadout[1]!]) return `${english[loadout[1]!]!} ${loadout[2]}`;
  const unknown = /^存在尚未解释的 (.+) 记录，未推测其内容。$/.exec(value);
  if (unknown) return `The ${unknown[1]} record is not yet interpreted.`;
  return value.replace(/^机体 /, 'Loadout ').replace(/^难度 /, 'Difficulty ').replace('附加标记 ', 'Additional flags ');
}
