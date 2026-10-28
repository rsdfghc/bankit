import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.firestore.*;
import com.google.firebase.*;
import com.google.firebase.auth.*;
import com.google.firebase.cloud.*;

import java.time.Instant;
import java.util.*;

public class SetAdmin {

    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            throw new IllegalArgumentException(
                    "Usage: SetAdmin FIREBASE_UID [--balance-adjuster]");
        }

        FirebaseOptions options = FirebaseOptions.builder()
                .setCredentials(GoogleCredentials.getApplicationDefault())
                .build();
        FirebaseApp.initializeApp(options);

        String uid = args[0];
        UserRecord authUser = FirebaseAuth.getInstance().getUser(uid);
        Firestore db = FirestoreClient.getFirestore();
        DocumentReference profileRef = db.collection("users").document(uid);
        DocumentSnapshot profile = profileRef.get().get();

        if (profile.exists()) {
            profileRef.update("role", "admin").get();
        } else {
            Map<String, Object> adminProfile = new HashMap<>();
            adminProfile.put("uid", uid);
            String displayName = authUser.getDisplayName();
            adminProfile.put(
                    "fullName",
                    displayName == null || displayName.trim().isEmpty()
                            ? "BankIt Admin"
                            : displayName);
            adminProfile.put("mobile", "");
            adminProfile.put("balance", 0.0);
            adminProfile.put("createdAt", Instant.now().toString());
            adminProfile.put("status", "active");
            adminProfile.put("role", "admin");
            profileRef.set(adminProfile).get();
        }

        Map<String, Object> claims = new HashMap<>();
        if (authUser.getCustomClaims() != null) {
            claims.putAll(authUser.getCustomClaims());
        }
        claims.put("admin", true);
        if (args.length > 1 && "--balance-adjuster".equals(args[1])) {
            claims.put("balanceAdjuster", true);
        }

        FirebaseAuth.getInstance().setCustomUserClaims(uid, claims);

        System.out.println(
                "Admin role and Firestore profile set successfully. "
                        + "Sign out and sign in again to refresh the ID token.");
    }
}
