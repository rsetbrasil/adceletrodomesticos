// /src/lib/firebase-client.ts
'use client';
import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { enableIndexedDbPersistence, initializeFirestore, Firestore, setLogLevel } from "firebase/firestore";
import { getAuth, Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyAb8vn7iQ43VwqIHBOHDVA0jnZE-LpFbXU",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "adc-eletro.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "adc-eletro",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "adc-eletro.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "387148226922",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:387148226922:web:6426088ebda884f8820513",
};

const CLIENT_APP_NAME = 'adc-client';

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let persistenceInit: Promise<void> | null = null;

function initClientFirebase() {
    if (typeof window === 'undefined') {
        throw new Error('getClientFirebase must be called on the client.');
    }

    if (app && auth && db) {
        return { app, auth, db };
    }

    const hasNamedApp = getApps().some((existing) => existing.name === CLIENT_APP_NAME);
    app = hasNamedApp ? getApp(CLIENT_APP_NAME) : initializeApp(firebaseConfig, CLIENT_APP_NAME);

    auth = getAuth(app);
    db = initializeFirestore(app, {
        experimentalForceLongPolling: true,
    });
    setLogLevel('error');

    if (!persistenceInit) {
        persistenceInit = enableIndexedDbPersistence(db).then(() => undefined).catch(() => undefined);
    }

    return { app, auth, db };
}

export function getClientFirebase() {
    return initClientFirebase();
}
