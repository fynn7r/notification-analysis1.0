import { ruleLayoutSchema, type RuleLayout } from '@shared/rule-document-contract';

export type StoredRuleLayout = RuleLayout & { filename: string };

async function accessLayout<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open('__app_notizhi_rule_layouts', 1); }
    catch { reject(new Error('无法打开排版存储，请检查浏览器是否允许本地存储；填写内容已保留。')); return; }
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开排版存储，请检查浏览器是否允许本地存储。'));
  });
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction('documents', mode);
    const request = operation(transaction.objectStore('documents'));
    transaction.oncomplete = () => { database.close(); resolve(request.result); };
    transaction.onabort = transaction.onerror = () => {
      database.close();
      reject(new Error('排版内容未保存，请检查浏览器存储空间后重试；填写内容已保留。'));
    };
  });
}

export function saveRuleLayout(id: string, layout: StoredRuleLayout) {
  ruleLayoutSchema.parse(layout);
  return accessLayout('readwrite', (store) => store.put(layout, id));
}

export async function getRuleLayout(id: string): Promise<StoredRuleLayout> {
  const layout = await accessLayout<StoredRuleLayout | undefined>('readonly', (store) => store.get(id));
  if (!layout || !ruleLayoutSchema.safeParse(layout).success) throw new Error('未找到这条规则的排版内容，请重新导入原文件。');
  return layout;
}

export function deleteRuleLayout(id: string) {
  return accessLayout('readwrite', (store) => store.delete(id));
}
