// Configuration Firebase Web — REMPLACE LES VALEURS apiKey, messagingSenderId
// et appId par celles de ta console Firebase :
// console.firebase.google.com/project/axelrod-6f71e/settings/general
// Ces valeurs ne sont pas secrètes (la sécurité passe par les Firestore rules),
// elles peuvent rester committées dans le repo public.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyApN-eX720BrAl8bnYdONjs38TY5pUW2lc",
  authDomain: "axelrod-6f71e.firebaseapp.com",
  projectId: "axelrod-6f71e",
  storageBucket: "axelrod-6f71e.firebasestorage.app",
  messagingSenderId: "658894760207",
  appId: "1:658894760207:web:c1e32bee1920dc0ce4767a",
  measurementId: "G-197B03BQX2"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);