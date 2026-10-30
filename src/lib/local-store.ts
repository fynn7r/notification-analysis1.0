/**
 * @file local-store.ts
 * @description 浏览器本地存储的物理层，取代原先依赖 `@lark-apaas/client-toolkit-lite`
 * 的 `scopedStorage`。
 *
 * 原先业务数据都躺在平台 SDK 的命名空间前缀下（`__miaoda___global__:xxx`），
 * 这意味着「待办存在哪、叫什么名字」这件事的地基不归自己管。换成这 60 行之后，
 * 键名、迁移、配额处理都回到自己手里。
 *
 * ## 为什么不换一套新前缀
 *
 * 曾经试过统一加成 `__notizhi__:`，结果是：物理键变成 `__notizhi__:__app_notizhi_rules`，
 * 而所有「已经在用户浏览器里的数据」还在 `__app_notizhi_rules`，等于强制做一次全量搬迁；
 * 更麻烦的是回归测试、开发者工具里的手工改写、以及用户自己写的脚本，认的都是
 * `__app_notizhi_*` 这个物理键名 —— 前缀不是实现细节，它是既成契约。
 *
 * 所以这里的取舍是：**统一，但不改写**。`__app_notizhi_` 就是本应用的键空间，
 * 由本文件的调用方（storage.ts 的 STORAGE_KEYS）集中定义，local-store 只负责
 * 「安全地落到 localStorage 上」这一件事。
 *
 * 三个必须处理的老问题：
 * 1. **旧 SDK 前缀迁移**。平台版用户的数据在 `__miaoda___global__:` 下面，不搬就是
 *    「用户数据全没了」。这里按需扫描并搬到裸键，旧键不删（留作兜底）。
 * 2. **JSON 容错**。任何一个键被写坏都不该让整个应用白屏，读失败由上层回退默认值。
 * 3. **配额溢出**。写失败必须让人知道，否则用户以为存上了 —— 由 storage.ts 提示。
 */

/**
 * 本应用所有持久化键的公共前缀。
 * 导出它是为了让导出/清理功能有据可依，而不是散落一堆字符串匹配。
 */
export const KEY_PREFIX = '__app_notizhi_';

/** 历史 SDK 命名空间前缀，只用于迁移读取，不用于写入。 */
const LEGACY_PREFIXES = ['__miaoda_'];

const SCHEMA_VERSION = 1;

function backend(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // Safari 隐私模式访问 localStorage 会直接抛异常
    return null;
  }
}

const legacyScanDone = new Set<string>();

/**
 * 把旧 SDK 命名空间下的数据搬到裸键。
 * 只对每个逻辑键做一次，避免每次读写都全量扫 localStorage。
 *
 * 旧物理键形如 `__miaoda___global__:__app_notizhi_rules`，因此用 `endsWith(key)`
 * 匹配而不是等值比较。
 */
function migrateLegacyKey(key: string): void {
  if (legacyScanDone.has(key)) return;
  legacyScanDone.add(key);
  const store = backend();
  if (!store) return;
  try {
    if (store.getItem(key) !== null) return;
    for (let index = 0; index < store.length; index += 1) {
      const physical = store.key(index);
      if (!physical || physical === key) continue;
      if (!physical.endsWith(key)) continue;
      if (!LEGACY_PREFIXES.some((prefix) => physical.startsWith(prefix))) continue;
      const value = store.getItem(physical);
      if (value !== null) {
        store.setItem(key, value);
        return;
      }
    }
  } catch {
    /* 迁移失败不影响后续读写 */
  }
}

export const localStore = {
  getItem(key: string): string | null {
    migrateLegacyKey(key);
    try {
      return backend()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },

  setItem(key: string, value: string): void {
    migrateLegacyKey(key);
    const store = backend();
    if (!store) return;
    store.setItem(key, value);
  },

  removeItem(key: string): void {
    try {
      backend()?.removeItem(key);
    } catch {
      /* ignore */
    }
  },

  /** 列出本应用命名空间下的所有键，供导出与调试用。 */
  keys(): string[] {
    const store = backend();
    if (!store) return [];
    const result: string[] = [];
    try {
      for (let index = 0; index < store.length; index += 1) {
        const physical = store.key(index);
        if (physical?.startsWith(KEY_PREFIX)) result.push(physical);
      }
    } catch {
      /* ignore */
    }
    return result;
  },
};

export const LOCAL_STORE_SCHEMA_VERSION = SCHEMA_VERSION;
