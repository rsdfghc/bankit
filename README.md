# BankIt App

Beginner Java banking demo with Firebase Authentication, Cloud Firestore, a Java API, an admin dashboard, and European roulette using virtual money only.

## 1. Create Firebase project

1. In Firebase Console, create a project and enable **Authentication → Email/Password**.
2. Create a **Cloud Firestore** database. In Firestore Rules, publish `firestore.rules` from this folder.
3. Add a Web app in Project settings and copy its config into `web/firebase-config.js`.
4. In Project settings → Service accounts, generate a private key. Keep the JSON private and outside the project folder.

## 2. Run

Install JDK 11+ and Maven. In PowerShell, from this `bankit` folder:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\path\to\your-service-account.json'
mvn compile exec:java
```

Open [http://localhost:8080](http://localhost:8080). The Java server serves the browser app and API. Registration and sign-in use email/password; the mobile number and full name are saved in Firestore. All banking writes and roulette results go through Java.

To create a separate administrator account, add an email/password user in Firebase Console under Authentication → Users → Add user. Copy its UID. The SetAdmin helper assigns the protected admin custom claim and creates the Firestore profile if it does not exist. Run the setup command with the `set-admin` Maven profile so it runs `SetAdmin` instead of starting the website server. The admin account signs in at `/admin`; an account with the admin claim is redirected there if it signs in on the regular site. A Firestore `role` field alone does not grant API access.

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\path\to\your-service-account.json'
mvn compile
mvn -Pset-admin exec:java "-Dexec.args=FIREBASE_UID --balance-adjuster"
```

Replace `FIREBASE_UID` with the Firebase UID, once. The profile explicitly selects `SetAdmin`, preventing the command from starting the website server. After the success message, sign out and back in at `/admin`. Never expose the service account JSON or grant admin permission from the browser.

## Included

- Permanent Firestore user profiles, transaction records, roulette game records, and admin audit entries for account block and balance adjustment actions.
- Token-protected Java API; Firestore client writes are denied by `firestore.rules`.
- Admin dashboard at `/admin` with Overview, Users, Transactions, and Games pages, plus account settings.
- European roulette outcomes are generated on the server. Even-money wins pay 2× stake total; a number hit pays 36× total. Zero loses red/black/odd/even.

## Notes

- This is a learning demo, not a real financial service. Cash-in creates virtual funds.
- Firebase Authentication email/password is used in place of the old demo mobile/PIN login. Mobile numbers are profile fields, not login credentials.
- Registration creates the Firebase account and profile, then returns to the sign-in form.
- Configure a trusted Firebase admin from the server command above; the web client cannot assign admin claims.
- Run from this folder so the server can find `web/`. This setup is intended for local demonstrations.
