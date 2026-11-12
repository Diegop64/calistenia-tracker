// Solo lo que usa la app: autenticación email/contraseña + Firestore (lectura de colección y de documento, y batch).
export { initializeApp } from 'firebase/app';
export { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
export { initializeFirestore, collection, doc, getDoc, getDocs, writeBatch } from 'firebase/firestore';
