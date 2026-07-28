import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  onSnapshot,
  updateDoc,
  deleteDoc,
  setDoc,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyABZUbOh9JXD84Z4xcA6_OQCfxlHXm-JOc',
  authDomain: 'larus-875e6.firebaseapp.com',
  projectId: 'larus-875e6',
  storageBucket: 'larus-875e6.firebasestorage.app',
  messagingSenderId: '629328903991',
  appId: '1:629328903991:web:3355f7d00fdc90f86324b2',
};

const SHARED_EMAIL = 'rktkbsk.pg831@gmail.com';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

setPersistence(auth, browserLocalPersistence).catch(() => {});

const recordsCol = collection(db, 'sharei_records');
const rosterDocRef = doc(db, 'sharei_meta', 'roster');
const contactsDocRef = doc(db, 'sharei_meta', 'contacts');

function fsDocToRecord(d) {
  return { id: d.id, ...d.data() };
}

window.FirebaseData = {
  onAuthChange(cb) {
    return onAuthStateChanged(auth, cb);
  },
  async signIn(password) {
    await signInWithEmailAndPassword(auth, SHARED_EMAIL, password);
  },
  async signOut() {
    await signOut(auth);
  },
  subscribeRecords(cb) {
    return onSnapshot(
      recordsCol,
      (snap) => cb(snap.docs.map(fsDocToRecord)),
      (err) => console.error('records subscription error', err)
    );
  },
  async addRecord(record) {
    const data = {};
    Object.keys(record).forEach((k) => {
      if (record[k] !== undefined) data[k] = record[k];
    });
    await addDoc(recordsCol, data);
  },
  async updateRecord(id, patch) {
    await updateDoc(doc(recordsCol, id), patch);
  },
  async deleteRecord(id) {
    await deleteDoc(doc(recordsCol, id));
  },
  subscribeRoster(cb) {
    return onSnapshot(
      rosterDocRef,
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        cb(data.names || []);
      },
      (err) => console.error('roster subscription error', err)
    );
  },
  async saveRoster(names) {
    await setDoc(rosterDocRef, { names });
  },
  subscribeContacts(cb) {
    return onSnapshot(
      contactsDocRef,
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        cb({ addresses: data.addresses || {}, phones: data.phones || {} });
      },
      (err) => console.error('contacts subscription error', err)
    );
  },
  async saveContacts(contacts) {
    await setDoc(contactsDocRef, contacts);
  },
};

window.dispatchEvent(new Event('firebasedata-ready'));
