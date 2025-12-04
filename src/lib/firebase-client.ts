// /src/lib/firebase-client.ts
'use client';
import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { initializeFirestore, getFirestore, Firestore } from "firebase/firestore";
import { getAuth, Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

if (typeof window !== 'undefined' && !getApps().length) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = initializeFirestore(app, { experimentalForceLongPolling: true, useFetchStreams: false });
} else if (typeof window !== 'undefined') {
    app = getApp();
    auth = getAuth(app);
    db = initializeFirestore(app, { experimentalForceLongPolling: true, useFetchStreams: false });
}

export function getClientFirebase() {
    // This is a bit of a hack to ensure firebase is initialized on the client
    // without having to make every calling component a client component.
    if (typeof window !== 'undefined' && !getApps().length) {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = initializeFirestore(app, { experimentalForceLongPolling: true, useFetchStreams: false });
    } else if (typeof window !== 'undefined') {
        app = getApp();
        auth = getAuth(app);
        db = initializeFirestore(app, { experimentalForceLongPolling: true, useFetchStreams: false });
    }
    
    return { app, auth, db };
}
