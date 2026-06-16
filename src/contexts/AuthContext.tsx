"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  browserLocalPersistence,
  setPersistence,
} from "firebase/auth";
import { doc, setDoc, getDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { auth, db, googleProvider, githubProvider } from "@/lib/firebase";
import { checkEmailDomain } from "@/lib/disposable-domains";

interface UserData {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  credits: number;
  creditsRemaining?: number;
  creditsPerMonth?: number;
  creditsResetAt?: number;
  plan: "free" | "agent" | "network" | "permanent" | "pro" | "scale" | "gifted";
  createdAt: Date;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  subscriptionCancelAtPeriodEnd?: boolean;
  subscriptionCancelDate?: Date;
  recoveryFileDownloaded?: boolean;
}

interface AuthContextType {
  user: User | null;
  userData: UserData | null;
  loading: boolean;
  emailVerified: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithGithub: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Enable local persistence
    setPersistence(auth, browserLocalPersistence).catch(console.error);

    let unsubscribeUserData: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      
      // Cleanup previous user listener
      if (unsubscribeUserData) {
        unsubscribeUserData();
        unsubscribeUserData = null;
      }
      
      if (user) {
        // Spam gate: reject disposable-domain OAuth signups before creating the Firestore user doc.
        // Email/password signups are blocked earlier in signUpWithEmail.
        if (user.email) {
          const check = checkEmailDomain(user.email);
          if (!check.ok) {
            console.warn("Blocked disposable-domain signup:", user.email, check.reason);
            await firebaseSignOut(auth);
            setUser(null);
            setUserData(null);
            setLoading(false);
            return;
          }
        }

        const userRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userRef);
        
        if (!userDoc.exists()) {
          // Create new user document.
          // Grant credits only when email is verified (Google/GitHub OAuth users
          // arrive pre-verified; email/password users must click the verification link).
          const verified = !!user.emailVerified;
          const newUserData: UserData = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            credits: verified ? 100 : 0,
            creditsRemaining: verified ? 100 : 0,
            creditsPerMonth: 100,
            plan: "free",
            createdAt: new Date(),
          };
          await setDoc(userRef, {
            ...newUserData,
            createdAt: serverTimestamp(),
          });
          
          // Provision agent keypair + send welcome email (fire and forget)
          Promise.all([
            fetch("/api/user/provision-keys", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${await user.getIdToken()}` },
            }).catch(console.error),
            user.email ? fetch("/api/email/welcome", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: user.email, name: user.displayName?.split(" ")[0] }),
            }).catch(console.error) : Promise.resolve(),
          ]);
        }
        
        // Set up real-time listener for user data changes
        unsubscribeUserData = onSnapshot(userRef, (snapshot) => {
          if (snapshot.exists()) {
            setUserData(snapshot.data() as UserData);
          }
        });
      } else {
        setUserData(null);
      }
      
      setLoading(false);
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeUserData) unsubscribeUserData();
    };
  }, []);

  const signInWithGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const signInWithGithub = async () => {
    await signInWithPopup(auth, githubProvider);
  };

  const signInWithEmail = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signUpWithEmail = async (email: string, password: string) => {
    const check = checkEmailDomain(email);
    if (!check.ok) {
      throw new Error(
        check.reason === "disposable-domain" || check.reason === "disposable-tld"
          ? "This email provider isn't allowed. Please use a primary email address."
          : "Please enter a valid email address."
      );
    }
    const result = await createUserWithEmailAndPassword(auth, email, password);
    const actionCodeSettings = {
      url: `${window.location.origin}/__/auth/action`,
      handleCodeInApp: true,
    };
    // Send verification email — user gets 0 credits until they click the link.
    await sendEmailVerification(result.user, actionCodeSettings);
  };

  const resendVerificationEmail = async () => {
    if (user && !user.emailVerified) {
      const actionCodeSettings = {
        url: `${window.location.origin}/__/auth/action`,
        handleCodeInApp: true,
      };
      await sendEmailVerification(user, actionCodeSettings);
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        userData,
        loading,
        emailVerified: user?.emailVerified ?? false,
        signInWithGoogle,
        signInWithGithub,
        signInWithEmail,
        signUpWithEmail,
        signOut,
        resetPassword,
        resendVerificationEmail,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
