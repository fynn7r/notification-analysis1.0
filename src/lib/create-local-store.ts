import { useEffect, useState } from 'react';
import { genId } from '@/lib/utils';

/**
 * 创建一个基于 localStorage 的单例 store。
 * 所有组件实例共享同一份状态，避免多实例状态分裂导致的写回覆盖问题。
 *
 * 使用模式：
 *   const { useStore, addItem, updateItem, deleteItem } = createLocalStore({...});
 *   function useMyData() { const { items } = useStore(); ... }
 */
export interface CreateLocalStoreOptions<T> {
  /** 存储 key */
  storageKey: string;
  /** 初始化标记 key（防止重复注入 mock） */
  initFlagKey: string;
  /** 初始 mock 数据，仅首次使用时注入 */
  mockData: T[];
  /** 从存储中读取（需自行 JSON.parse） */
  get: () => T[] | null;
  /** 写入存储（需自行 JSON.stringify）。返回 false 表示没写进去（如配额溢出）。 */
  set: (value: T[]) => boolean | void;
  /** 读取初始化标记 */
  getInitFlag: () => boolean;
  /** 写入初始化标记 */
  setInitFlag: (value: boolean) => void;
  /** 生成 id */
  genId?: (item: T) => string;
  /**
   * 每次写入后被调用，用来把变更同步到服务端。
   * 读路径始终同步命中内存，所以 useAlarm 这类定时器回调不需要改成异步。
   */
  onChange?: (change: { type: 'add' | 'update' | 'delete'; id: string; item?: T }) => void;
}

export interface LocalStoreApi<T> {
  /** React hook：订阅 store，返回最新 items 与加载状态 */
  useStore: () => { items: T[]; loading: boolean };
  /** 直接读取当前 items（非 hook 场景用） */
  getItems: () => T[];
  /** 全量替换 items */
  setItems: (items: T[]) => void;
  /** 函数式更新 items */
  updateItems: (updater: (prev: T[]) => T[]) => void;
  /** 添加一项 */
  addItem: (item: Omit<T, 'id' | 'createdAt'> & { id?: string; createdAt?: number }) => T;
  /** 根据 id 更新一项 */
  updateItem: (id: string, updates: Partial<T>) => void;
  /** 根据 id 删除一项 */
  deleteItem: (id: string) => void;
  /** 根据 id 查找一项 */
  findItem: (id: string) => T | undefined;
  /**
   * 用外部数据（服务端）替换内存副本。
   * 与 setItems 的区别：不触发 onChange，避免「拉取下来的数据又被推回去」的死循环。
   */
  hydrate: (items: T[]) => void;
  /**
   * 最近一次写回底层存储是否成功。
   *
   * 存在的理由：内存是权威副本，所以 `findItem` 只能回答「我记不记得这条」，
   * 回答不了「它到底落盘了没有」。配额满的时候这两件事会分叉：
   * 内存里有、localStorage 里没有、刷新就没了。调用方在做「已保存」这种承诺之前，
   * 需要一次能问到真实结果的信号，否则就变成误报成功。
   *
   * 语义只保证「最近一次写入」，所以必须在写入之后、下一次写入之前立即读。
   */
  getLastPersistOk: () => boolean;
}

export function createLocalStore<T extends { id: string; createdAt?: number }>(
  opts: CreateLocalStoreOptions<T>
): LocalStoreApi<T> {
  const { get, set, getInitFlag, setInitFlag, mockData, onChange } = opts;

  // 模块级共享状态（单例）
  let state: T[] = [];
  let initialized = false;
  let loading = true;
  /** 最近一次写回底层存储的结果，见 LocalStoreApi.getLastPersistOk 的说明。 */
  let lastPersistOk = true;
  const listeners = new Set<(items: T[], isLoading: boolean) => void>();

  function notify() {
    listeners.forEach((fn) => fn(state, loading));
  }

  function init() {
    if (initialized) return;
    initialized = true;

    const stored = get();
    const hasInit = getInitFlag();

    if (hasInit) {
      state = stored ?? [];
    } else {
      state = mockData;
      set(mockData);
      setInitFlag(true);
    }
    loading = false;
    notify();
  }

  function writeToStorage() {
    // set 会返回 false 表示写入失败（配额溢出等）；老实现返回 void，按成功处理。
    lastPersistOk = set(state) !== false;
    return lastPersistOk;
  }

  function useStore() {
    const [items, setLocalItems] = useState<T[]>(state);
    const [isLoading, setIsLoading] = useState<boolean>(loading);

    useEffect(() => {
      init();
      const listener = (newItems: T[], newLoading: boolean) => {
        setLocalItems(newItems);
        setIsLoading(newLoading);
      };
      listeners.add(listener);
      // 初始化后同步一次
      if (!loading) {
        setLocalItems(state);
        setIsLoading(false);
      }
      return () => {
        listeners.delete(listener);
      };
    }, []);

    return { items, loading: isLoading };
  }

  function getItems(): T[] {
    init();
    return state;
  }

  function setItems(items: T[]) {
    init();
    state = items;
    writeToStorage();
    notify();
  }

  function updateItems(updater: (prev: T[]) => T[]) {
    init();
    state = updater(state);
    writeToStorage();
    notify();
  }

  function addItem(
    item: Omit<T, 'id' | 'createdAt'> & { id?: string; createdAt?: number }
  ): T {
    init();
    const newItem = {
      ...item,
      id: item.id ?? genId('item'),
      createdAt: item.createdAt ?? Date.now(),
    } as unknown as T;
    state = [newItem, ...state];
    writeToStorage();
    notify();
    onChange?.({ type: 'add', id: newItem.id, item: newItem });
    return newItem;
  }

  function updateItem(id: string, updates: Partial<T>) {
    init();
    state = state.map((item) => (item.id === id ? { ...item, ...updates } : item));
    writeToStorage();
    notify();
    const updated = state.find((item) => item.id === id);
    if (updated) onChange?.({ type: 'update', id, item: updated });
  }

  function deleteItem(id: string) {
    init();
    state = state.filter((item) => item.id !== id);
    writeToStorage();
    notify();
    onChange?.({ type: 'delete', id });
  }

  function hydrate(items: T[]) {
    init();
    state = items;
    writeToStorage();
    notify();
  }

  function findItem(id: string): T | undefined {
    init();
    return state.find((item) => item.id === id);
  }

  return {
    useStore,
    getItems,
    setItems,
    updateItems,
    addItem,
    updateItem,
    deleteItem,
    findItem,
    hydrate,
    getLastPersistOk: () => lastPersistOk,
  };
}
