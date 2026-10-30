"use client";

import type { LocalRecording } from "@/types";

const DB_NAME = "auralis-recordings";
const STORE = "recordings";
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("meetingId", "meetingId", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open recording storage"));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Recording storage error"));
        transaction.oncomplete = () => db.close();
      }),
  );
}

export async function saveRecording(recording: LocalRecording): Promise<void> {
  await tx("readwrite", (store) => store.put(recording) as IDBRequest<IDBValidKey>);
}

export async function listRecordings(): Promise<LocalRecording[]> {
  const records = await tx<LocalRecording[]>("readonly", (store) => store.getAll());
  return records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getRecording(id: string): Promise<LocalRecording | undefined> {
  return tx<LocalRecording | undefined>("readonly", (store) => store.get(id));
}

export async function getRecordingsForMeeting(meetingId: string): Promise<LocalRecording[]> {
  const all = await listRecordings();
  return all.filter((recording) => recording.meetingId === meetingId);
}

export async function deleteRecording(id: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(id) as unknown as IDBRequest<undefined>);
}
