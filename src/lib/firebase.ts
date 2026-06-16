import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider, GithubAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyA8_jbPBQul87hDpKdO8C1bLhF6j02FvFg",
  authDomain: "hermesco-7080d.firebaseapp.com",
  projectId: "hermesco-7080d",
  storageBucket: "hermesco-7080d.firebasestorage.app",
  messagingSenderId: "676325564343",
  appId: "1:676325564343:web:a80714ca2e301567021232",
};

// Initialize Firebase only if it hasn't been initialized
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
export const githubProvider = new GithubAuthProvider();

export default app;
