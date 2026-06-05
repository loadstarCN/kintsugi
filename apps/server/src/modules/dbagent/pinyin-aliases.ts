/**
 * 国内 schema 高频 pinyin 缩写 → 候选语义同义词。
 *
 * 不少国内系统命名为 yh_id / cp_code / dd_xxx，相关表却叫 t_user / product / orders。
 * 纯英语启发式匹配会全 miss——列 prefix "yh" 永远命中不到 "user" 这种 base。
 *
 * 这里只列**业务高频 + 歧义低**的缩写：
 *   - 太短 (≤2) 容易撞，需要列里精确匹配；
 *   - 多义优先列出最常见的（"sp" 既可商品也可视频，按业务侧多数取"商品"）；
 *   - 不做"全量汉语→拼音"翻译——LLM 复核已经覆盖剩余部分，规则层只挑命中率高的。
 *
 * 期望同义词覆盖：英文表名 / 全拼表名 / 拼音首字母前缀本身。
 *
 * 后续策略：被 LLM 复核纠错的样本 ≥ 5 条 / 月 → 添加到此表。增改请同时跑 dbagent:eval。
 */

export const PINYIN_ALIASES: Record<string, string[]> = {
  yh: ['user', 'users', 'account', 'yonghu'],
  yhz: ['user_group', 'usergroup', 'yonghuzu'],
  cp: ['product', 'products', 'goods', 'item', 'chanpin'],
  dd: ['order', 'orders', 'dingdan'],
  ddx: ['order_item', 'order_items', 'order_detail', 'orderitem', 'dingdan_xiang'],
  sj: ['data', 'shuju'],
  sp: ['product', 'goods', 'shangpin'],
  fl: ['category', 'categories', 'fenlei'],
  pp: ['brand', 'brands', 'pinpai'],
  bm: ['department', 'dept', 'bumen'],
  gs: ['company', 'companies', 'gongsi'],
  zh: ['account', 'accounts', 'zhanghu'],
  jl: ['record', 'records', 'log', 'logs', 'jilu'],
  rz: ['log', 'logs', 'audit', 'rizhi'],
  ys: ['supplier', 'suppliers', 'yunshu'], // 运输/营收 多义；命中率最高的取"运输"
  kc: ['stock', 'inventory', 'kucun'],
  cz: ['operation', 'operations', 'caozuo'],
  jr: ['finance', 'financial', 'jinrong'],
  hy: ['member', 'members', 'huiyuan'],
  ck: ['warehouse', 'cangku'],
  ht: ['contract', 'contracts', 'hetong'],
  fp: ['invoice', 'invoices', 'fapiao'],
  tk: ['refund', 'refunds', 'tuikuan'],
  zf: ['payment', 'payments', 'zhifu'],
  pj: ['review', 'reviews', 'comment', 'comments', 'pingjia'],
  sc: ['favorite', 'favorites', 'shoucang'],
  gz: ['follow', 'follows', 'guanzhu'],
  xx: ['message', 'messages', 'notification', 'xinxi'],
  tz: ['notice', 'notices', 'tongzhi'],
  jl2: ['coupon', 'coupons', 'jiangli'], // 防与 'jl' 撞 key
};

/**
 * 给定列前缀，返回它本身 + 已知拼音同义词。
 * 若 prefix 不在缩写表，返回单元素数组（保持调用点单一路径）。
 */
export function expandPinyinPrefix(prefix: string): string[] {
  const low = prefix.toLowerCase();
  const aliases = PINYIN_ALIASES[low];
  if (!aliases) return [low];
  return [low, ...aliases];
}
