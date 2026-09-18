import { ScannedPage } from './types';

const DB_NAME = 'control_scanner_db';
const DB_VERSION = 1;
const STORE_NAME = 'scanner_pages';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB no está disponible'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Guarda las páginas escaneadas localmente para prevenir pérdida de datos.
 */
export async function saveOfflinePages(sessionId: string, pages: ScannedPage[]): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // Guardar paquete con clave asociada a la sesión
    await new Promise<void>((resolve, reject) => {
      const putReq = store.put({ id: sessionId, pages, savedAt: Date.now() });
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    });
  } catch (err) {
    console.warn('No se pudo guardar respaldo offline en IndexedDB:', err);
  }
}

/**
 * Recupera las páginas escaneadas de la sesión si existieran.
 */
export async function getOfflinePages(sessionId: string): Promise<ScannedPage[] | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return await new Promise<ScannedPage[] | null>((resolve) => {
      const getReq = store.get(sessionId);
      getReq.onsuccess = () => {
        if (getReq.result && Array.isArray(getReq.result.pages)) {
          resolve(getReq.result.pages);
        } else {
          resolve(null);
        }
      };
      getReq.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Limpia el respaldo offline tras completar la subida exitosamente.
 */
export async function clearOfflinePages(sessionId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(sessionId);
  } catch {
    // Silently ignore
  }
}
