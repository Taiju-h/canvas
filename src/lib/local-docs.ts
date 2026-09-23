import type { CanvasDoc } from "@/lib/canvas";

export type LocalDoc = {
  id: string;
  title: string;
  content: CanvasDoc;
  base: CanvasDoc;
  revision: number;
  updated_at: number;
  dirty: boolean;
  owner: boolean;
  accountId?: string;
  shareToken?: string;
};

const databaseName = "canvas-offline-v1";
let opening: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  if (!opening) opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("documents")) db.createObjectStore("documents", { keyPath: "id" });
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => { opening = null; throw error; });
  return opening;
}

async function operation<T>(storeName: "documents" | "images", mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const getLocalDoc = (id: string) => operation<LocalDoc | undefined>("documents", "readonly", store => store.get(id));
export const listLocalDocs = () => operation<LocalDoc[]>("documents", "readonly", store => store.getAll());
export const putLocalDoc = (doc: LocalDoc) => operation<IDBValidKey>("documents", "readwrite", store => store.put(doc));
export const deleteLocalDoc = (id: string) => operation<undefined>("documents", "readwrite", store => store.delete(id));
export const getLocalImage = (id: string) => operation<Blob | undefined>("images", "readonly", store => store.get(id));
export const putLocalImage = (id: string, image: Blob) => operation<IDBValidKey>("images", "readwrite", store => store.put(image, id));
