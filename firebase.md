// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDBYMY_lrV_-c3ZSE_pAFdVaQBQ3NvT99c",
  authDomain: "suhree.firebaseapp.com",
  projectId: "suhree",
  storageBucket: "suhree.firebasestorage.app",
  messagingSenderId: "26503409881",
  appId: "1:26503409881:web:39b3154a9227c710d94ec8",
  measurementId: "G-XRX5ZE963L"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
