import type { CanvasDoc } from "@/lib/canvas";

export type LocalRevision={id:string;docId:string;createdAt:number;title:string;content:CanvasDoc;revision:number};

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
    const request = indexedDB.open(databaseName, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("documents")) db.createObjectStore("documents", { keyPath: "id" });
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images");
      if (!db.objectStoreNames.contains("revisions")) { const revisions=db.createObjectStore("revisions",{keyPath:"id"});revisions.createIndex("byDoc","docId"); }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => { opening = null; throw error; });
  return opening;
}

async function operation<T>(storeName: "documents" | "images" | "revisions", mode: IDBTransactionMode,
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

export const listLocalRevisions=(docId:string)=>operation<LocalRevision[]>("revisions","readonly",store=>store.index('byDoc').getAll(docId))
  .then(rows=>rows.sort((a,b)=>b.createdAt-a.createdAt));
export async function saveLocalRevision(doc:LocalDoc,limit=25){
  const latest=(await listLocalRevisions(doc.id))[0];
  if(latest&&latest.title===doc.title&&JSON.stringify(latest.content)===JSON.stringify(doc.content))return;
  const snapshot:LocalRevision={id:doc.id+':'+Date.now()+':'+Math.random().toString(36).slice(2,8),
    docId:doc.id,createdAt:Date.now(),title:doc.title,content:structuredClone(doc.content),revision:doc.revision};
  await operation<IDBValidKey>("revisions","readwrite",store=>store.put(snapshot));
  const rows=await listLocalRevisions(doc.id);
  for(const item of rows.slice(limit))await operation<undefined>("revisions","readwrite",store=>store.delete(item.id));
}

/** Preserve offline history when the server assigns a permanent document ID. */
export async function moveLocalRevisions(from:string,to:string){
  const db=await database();
  await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('revisions','readwrite'),store=tx.objectStore('revisions');
    const cursor=store.index('byDoc').openCursor(IDBKeyRange.only(from));
    cursor.onsuccess=()=>{const row=cursor.result;if(row){row.update({...row.value,docId:to});row.continue();}};
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
