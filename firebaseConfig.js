const admin = require("firebase-admin");
// const path = require("path");
const dotenv = require("dotenv");
dotenv.config();

// Get the path to the service account file
const serviceAccountJson = Buffer.from(process.env.SERVICE_BASE64, "base64").toString("utf8");
const serviceAccount = JSON.parse(serviceAccountJson);

// Initialize Firebase Admin SDK if not already initialized
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`,
    projectId: serviceAccount.project_id
  });
}

const db = admin.firestore();

console.log("Attempting to connect to Firebase project:", serviceAccount.project_id);
db.collection('test').add({
  timestamp: new Date().toISOString(),
  message: 'Connection test'
})
.then(docRef => {
  console.log("Firebase connection successful! Document written with ID:", docRef.id);
})
.catch(error => {
  console.error("Firebase connection failed:", error);
});

module.exports = { db, admin };