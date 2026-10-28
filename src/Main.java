import com.google.auth.oauth2.*;
import com.google.cloud.firestore.*;
import com.google.firebase.*;
import com.google.firebase.auth.*;
import com.google.firebase.cloud.*;
import com.google.gson.*;
import com.google.gson.reflect.*;
import com.sun.net.httpserver.*;

import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.nio.charset.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;

// Firebase Admin SDK uses null contracts that Eclipse's JDT analyzer cannot fully infer.
// Firestore values that affect money are checked explicitly by requiredBalance().
@SuppressWarnings("null")
public class Main {

    private static final Gson JSON = new Gson();
    private static Firestore db;

    public static void main(String[] args) throws Exception {

        String credentials = System.getenv("GOOGLE_APPLICATION_CREDENTIALS");

        if (credentials == null || credentials.trim().isEmpty()) {
            throw new IllegalStateException(
                    "Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service-account JSON path.");
        }

        FirebaseOptions options = FirebaseOptions.builder()
                .setCredentials(GoogleCredentials.getApplicationDefault())
                .build();

        FirebaseApp.initializeApp(options);

        db = FirestoreClient.getFirestore();

        HttpServer server = HttpServer.create(
                new InetSocketAddress(
                        Integer.parseInt(
                                System.getenv().getOrDefault("PORT", "8080"))),
                0);

        server.createContext("/api/", Main::handle);
        server.createContext("/", Main::staticFiles);
        server.setExecutor(Executors.newFixedThreadPool(8));

        server.start();

        System.out.println(
                "BankIt API listening on http://localhost:"
                        + server.getAddress().getPort());
    }

    private static void staticFiles(HttpExchange x) throws IOException {

        String path = x.getRequestURI().getPath();

        if (path.equals("/admin") || path.equals("/admin/")) {
            path = "/index.html";
        }

        if (path.equals("/")) {
            path = "/index.html";
        }

        Path root = Paths.get("web")
                .toAbsolutePath()
                .normalize();

        Path file = root.resolve(
                path.replaceFirst("^/", "")).normalize();

        if (!file.startsWith(root) || !Files.isRegularFile(file)) {

            byte[] b = "Not found".getBytes(StandardCharsets.UTF_8);

            x.sendResponseHeaders(404, b.length);
            x.getResponseBody().write(b);
            x.close();

            return;
        }

        String name = file.getFileName().toString();

        String type = name.endsWith(".js")
                ? "text/javascript; charset=utf-8"
                : name.endsWith(".css")
                        ? "text/css; charset=utf-8"
                        : name.endsWith(".html")
                                ? "text/html; charset=utf-8"
                                : "application/octet-stream";

        byte[] content = Files.readAllBytes(file);

        x.getResponseHeaders().set("Content-Type", type);
        x.sendResponseHeaders(200, content.length);

        try (OutputStream out = x.getResponseBody()) {
            out.write(content);
        }
    }

    private static void handle(HttpExchange x) throws IOException {

        try {

            cors(x);

            if ("OPTIONS".equals(x.getRequestMethod())) {
                x.sendResponseHeaders(204, -1);
                return;
            }

            String path = x.getRequestURI().getPath();

            if ("/api/health".equals(path)) {
                send(x, 200, map("ok", true));
                return;
            }

            FirebaseToken token = verify(x);
            String uid = token.getUid();

            Map<String, Object> body = readBody(x);

            if ("POST".equals(x.getRequestMethod())
                    && "/api/register".equals(path)) {

                register(uid, body);
                send(x, 201, account(uid));
                return;
            }

            if ("GET".equals(x.getRequestMethod())
                    && "/api/me".equals(path)) {

                Map<String, Object> me = account(uid);

                if (!"active".equals(me.get("status"))) {
                    throw new SecurityException(
                            "This account is blocked.");
                }

                send(x, 200, me);
                return;
            }

            if ("GET".equals(x.getRequestMethod())
                    && "/api/transactions".equals(path)) {

                send(x, 200, transactions(uid));
                return;
            }

            if ("PUT".equals(x.getRequestMethod())
                    && "/api/profile".equals(path)) {

                updateProfile(uid, text(body, "fullName"), text(body, "mobile"));
                send(x, 200, account(uid));
                return;
            }

            if ("GET".equals(x.getRequestMethod())
                    && "/api/games".equals(path)) {

                send(x, 200, games(uid));
                return;
            }

            if ("POST".equals(x.getRequestMethod())
                    && "/api/cashin".equals(path)) {

                cashin(uid, amount(body));
                send(x, 200, account(uid));
                return;
            }

            if ("POST".equals(x.getRequestMethod())
                    && "/api/transfer".equals(path)) {

                transfer(
                        uid,
                        text(body, "mobile"),
                        amount(body));

                send(x, 200, account(uid));
                return;
            }

            if ("POST".equals(x.getRequestMethod())
                    && "/api/roulette".equals(path)) {

                send(x, 200, roulette(uid, body));
                return;
            }

            if ("DELETE".equals(x.getRequestMethod())
                    && "/api/account".equals(path)) {

                deleteAccount(uid);
                send(x, 200, map("ok", true));
                return;
            }

            // Admin endpoints
            if (path.startsWith("/api/admin")) {

                requireAdmin(token);

                if ("GET".equals(x.getRequestMethod())
                        && "/api/admin/summary".equals(path)) {

                    send(x, 200, adminSummary());
                    return;
                }

                if ("GET".equals(x.getRequestMethod())
                        && "/api/admin/users".equals(path)) {

                    send(x, 200, adminUsers());
                    return;
                }

                if ("GET".equals(x.getRequestMethod())
                        && "/api/admin/transactions".equals(path)) {

                    send(x, 200, adminTransactions());
                    return;
                }

                if ("GET".equals(x.getRequestMethod())
                        && "/api/admin/games".equals(path)) {

                    send(x, 200, adminGames());
                    return;
                }

                if ("GET".equals(x.getRequestMethod())
                        && "/api/admin/audit".equals(path)) {

                    send(x, 200, auditLogs());
                    return;
                }

                if ("POST".equals(x.getRequestMethod())
                        && path.matches("/api/admin/users/[^/]+/block")) {

                    block(
                            path.split("/")[4],
                            Boolean.TRUE.equals(body.get("blocked")),
                            uid);

                    send(x, 200, map("ok", true));
                    return;
                }

                if ("POST".equals(x.getRequestMethod())
                        && path.matches("/api/admin/users/[^/]+/adjust")) {

                    adjust(
                            path.split("/")[4],
                            amount(body),
                            text(body, "reason"),
                            uid,
                            token);

                    send(x, 200, map("ok", true));
                    return;
                }

                if ("PUT".equals(x.getRequestMethod())
                        && path.matches("/api/admin/users/[^/]+")) {

                    editUser(
                            path.split("/")[4],
                            text(body, "fullName"),
                            text(body, "mobile"),
                            uid);

                    send(x, 200, map("ok", true));
                    return;
                }

                if ("DELETE".equals(x.getRequestMethod())
                        && path.matches("/api/admin/users/[^/]+")) {

                    deleteAdminUser(path.split("/")[4], uid);

                    send(x, 200, map("ok", true));
                    return;
                }

                if ("GET".equals(x.getRequestMethod())
                        && path.matches("/api/admin/users/[^/]+/details")) {

                    send(
                            x,
                            200,
                            adminUserDetails(path.split("/")[4]));

                    return;
                }
            }

            send(x, 404, map("error", "Not found"));

        } catch (SecurityException e) {

            send(x, 401, map("error", e.getMessage()));

        } catch (IllegalArgumentException e) {

            send(x, 400, map("error", e.getMessage()));

        } catch (Exception e) {

            e.printStackTrace();
            send(x, 500, map("error", "Server error"));
        }
    }

    private static FirebaseToken verify(HttpExchange x) throws Exception {

        String header = x.getRequestHeaders().getFirst("Authorization");

        if (header == null || !header.startsWith("Bearer ")) {
            throw new SecurityException("Sign in first.");
        }

        return FirebaseAuth.getInstance()
                .verifyIdToken(header.substring(7));
    }

    private static void register(
            String uid,
            Map<String, Object> b) throws Exception {

        String name = text(b, "fullName");
        String mobile = text(b, "mobile");

        if (!mobile.matches("[0-9+() -]{7,20}")) {
            throw new IllegalArgumentException(
                    "Enter a valid mobile number.");
        }

        DocumentReference ref = db.collection("users").document(uid);

        if (ref.get().get().exists()) {
            throw new IllegalArgumentException(
                    "This account is already registered.");
        }

        Map<String, Object> user = map(
                "uid", uid,
                "fullName", name,
                "mobile", mobile,
                "balance", 0.0,
                "createdAt", Instant.now().toString(),
                "status", "active",
                "role", "user");

        ref.set(user).get();
    }

    private static Map<String, Object> account(String uid) throws Exception {

        DocumentSnapshot s = db.collection("users")
                .document(uid)
                .get()
                .get();

        if (!s.exists()) {
            throw new IllegalArgumentException(
                    "Account profile is missing. Register first.");
        }

        return s.getData();
    }

    private static List<Map<String, Object>> transactions(String uid)
            throws Exception {

        List<Map<String, Object>> out = new ArrayList<>();

        for (DocumentSnapshot d : db.collection("users")
                .document(uid)
                .collection("transactions")
                .orderBy(
                        "createdAt",
                        Query.Direction.DESCENDING)
                .limit(100)
                .get()
                .get()
                .getDocuments()) {

            out.add(d.getData());
        }

        return out;
    }

    private static List<Map<String, Object>> games(String uid)
            throws Exception {

        List<Map<String, Object>> out = new ArrayList<>();

        for (DocumentSnapshot d : db.collection("users")
                .document(uid)
                .collection("games")
                .orderBy(
                        "createdAt",
                        Query.Direction.DESCENDING)
                .limit(30)
                .get()
                .get()
                .getDocuments()) {

            out.add(d.getData());
        }

        return out;
    }

    private static void cashin(String uid, double amount) throws Exception {

        validateAmount(amount);

        DocumentReference u = db.collection("users").document(uid);

        db.runTransaction(t -> {

            DocumentSnapshot s = t.get(u).get();

            t.update(
                    u,
                    "balance",
                    requiredBalance(s) + amount);

            addTransaction(
                    t,
                    uid,
                    "CASH_IN",
                    amount,
                    "Virtual cash-in");

            return null;

        }).get();
    }

    private static void transfer(
            String uid,
            String mobile,
            double amount) throws Exception {

        validateAmount(amount);

        QuerySnapshot matches = db.collection("users")
                .whereEqualTo("mobile", mobile)
                .limit(1)
                .get()
                .get();

        if (matches.isEmpty()) {
            throw new IllegalArgumentException(
                    "Receiver account was not found.");
        }

        String receiver = matches.getDocuments()
                .get(0)
                .getId();

        if (uid.equals(receiver)) {
            throw new IllegalArgumentException(
                    "Cannot transfer to yourself.");
        }

        DocumentReference from = db.collection("users").document(uid);

        DocumentReference to = db.collection("users").document(receiver);

        db.runTransaction(t -> {

            DocumentSnapshot a = t.get(from).get();
            DocumentSnapshot b = t.get(to).get();

            active(b);
            double balance = requiredBalance(a);

            if (balance < amount) {
                throw new IllegalArgumentException(
                        "Insufficient balance.");
            }

            t.update(from, "balance", balance - amount);
            t.update(to, "balance", requiredBalance(b) + amount);

            addTransaction(
                    t,
                    uid,
                    "TRANSFER_SENT",
                    amount,
                    "Sent to " + mobile);

            addTransaction(
                    t,
                    receiver,
                    "TRANSFER_RECEIVED",
                    amount,
                    "Received from " + a.getString("mobile"));

            return null;

        }).get();
    }

    private static Map<String, Object> roulette(
            String uid,
            Map<String, Object> b) throws Exception {

        double bet = amount(b);
        validateAmount(bet);

        String choice = text(b, "choice")
                .toLowerCase(Locale.ROOT);

        Integer number = null;

        try {
            number = Integer.valueOf(choice);
        } catch (NumberFormatException ignored) {
        }

        if (number == null
                && !Arrays.asList("red", "black", "odd", "even")
                        .contains(choice)) {

            throw new IllegalArgumentException(
                    "Choose red, black, odd, even, or a number from 0 to 36.");
        }

        if (number != null && (number < 0 || number > 36)) {
            throw new IllegalArgumentException(
                    "Number must be from 0 to 36.");
        }

        String requestId = text(b, "requestId");

        if (!requestId.matches("[A-Za-z0-9_-]{12,80}")) {
            throw new IllegalArgumentException(
                    "Invalid game request.");
        }

        DocumentReference u = db.collection("users").document(uid);

        DocumentReference gameRef = u.collection("games").document(requestId);

        final int outcome = new Random().nextInt(37);
        final Integer pick = number;

        return db.runTransaction(t -> {

            DocumentSnapshot previous = t.get(gameRef).get();
            DocumentSnapshot s = t.get(u).get();

            if (previous.exists()) {
                return map(
                        "game", previous.getData(),
                        "balance", requiredBalance(s));
            }

            double balance = requiredBalance(s);

            if (balance < bet) {
                throw new IllegalArgumentException(
                        "Insufficient balance.");
            }

            boolean red = Arrays.asList(
                    1, 3, 5, 7, 9, 12, 14, 16, 18,
                    19, 21, 23, 25, 27, 30, 32, 34, 36).contains(outcome);

            boolean win = pick != null
                    ? pick == outcome
                    : outcome != 0 && (choice.equals("red") ? red
                            : choice.equals("black") ? !red
                                    : choice.equals("odd") ? outcome % 2 == 1
                                            : outcome % 2 == 0);

            double payout = win
                    ? bet * (pick == null ? 2 : 36)
                    : 0;

            double net = payout - bet;
            double next = balance + net;

            Map<String, Object> game = map(
                    "gameId", requestId,
                    "choice", choice,
                    "bet", bet,
                    "result", outcome,
                    "win", win,
                    "payout", payout,
                    "net", net,
                    "createdAt", Instant.now().toString());

            t.update(u, "balance", next);
            t.set(gameRef, game);

            addTransaction(
                    t,
                    uid,
                    "ROULETTE_" + (win ? "WIN" : "LOSS"),
                    win ? net : bet,
                    "Bet " + choice
                            + ", result " + outcome
                            + ", payout " + payout
                            + ", net " + net);

            return map(
                    "game", game,
                    "balance", next);

        }).get();
    }

    private static void deleteAccount(String uid) throws Exception {

        DocumentReference u = db.collection("users").document(uid);

        QuerySnapshot tx = u.collection("transactions").get().get();

        for (DocumentSnapshot d : tx.getDocuments()) {
            d.getReference().delete().get();
        }

        QuerySnapshot games = u.collection("games").get().get();

        for (DocumentSnapshot d : games.getDocuments()) {
            d.getReference().delete().get();
        }

        u.delete().get();

        FirebaseAuth.getInstance().deleteUser(uid);
    }

    private static Map<String, Object> adminSummary() throws Exception {

        List<Map<String, Object>> users = allUsers();

        long tx = 0;
        long cash = 0;
        long transfers = 0;
        long games = 0;
        long wins = 0;
        long losses = 0;

        double bets = 0;
        double cashInAmount = 0;
        double transferAmount = 0;
        double totalBalance = 0;

        List<Map<String, Object>> recent = new ArrayList<>();

        for (Map<String, Object> u : users) {

            String id = (String) u.get("uid");
            totalBalance += numberValue(u.get("balance"));

            QuerySnapshot qs = db.collection("users")
                    .document(id)
                    .collection("transactions")
                    .get()
                    .get();

            for (DocumentSnapshot d : qs.getDocuments()) {

                tx++;

                String type = d.getString("type");

                if ("CASH_IN".equals(type)) {
                    cash++;
                    cashInAmount += numberValue(d.get("amount"));
                }

                if ("TRANSFER_SENT".equals(type)) {
                    transfers++;
                    transferAmount += numberValue(d.get("amount"));
                }

                recent.add(d.getData());
            }

            QuerySnapshot gs = db.collection("users")
                    .document(id)
                    .collection("games")
                    .get()
                    .get();

            for (DocumentSnapshot d : gs.getDocuments()) {

                games++;

                bets += requiredNumber(
                        d.getDouble("bet"),
                        "bet");

                if (Boolean.TRUE.equals(d.getBoolean("win"))) {
                    wins++;
                } else {
                    losses++;
                }
            }
        }

        recent.sort(
                (a, b) -> String.valueOf(b.get("createdAt"))
                        .compareTo(String.valueOf(a.get("createdAt"))));

        return map(
                "users", users.size(),
                "activeAccounts", users.stream()
                        .filter(u -> "active".equals(u.get("status")))
                        .count(),
                "transactions", tx,
                "cashIns", cash,
                "cashInAmount", cashInAmount,
                "transfers", transfers,
                "transferAmount", transferAmount,
                "totalBalance", totalBalance,
                "games", games,
                "totalBets", bets,
                "wins", wins,
                "losses", losses,
                "recent", recent.subList(
                        0,
                        Math.min(10, recent.size())));
    }

    private static List<Map<String, Object>> adminUsers() throws Exception {

        return allUsers();
    }

    private static List<Map<String, Object>> adminTransactions() throws Exception {

        List<Map<String, Object>> out = new ArrayList<>();

        for (Map<String, Object> user : allUsers()) {
            String id = String.valueOf(user.get("uid"));

            for (DocumentSnapshot d : db.collection("users")
                    .document(id)
                    .collection("transactions")
                    .orderBy("createdAt", Query.Direction.DESCENDING)
                    .limit(200)
                    .get()
                    .get()
                    .getDocuments()) {

                Map<String, Object> record = new LinkedHashMap<>(d.getData());
                record.put("uid", id);
                record.put("fullName", user.get("fullName"));
                record.put("email", user.get("email"));
                record.put("mobile", user.get("mobile"));
                out.add(record);
            }
        }

        out.sort((a, b) -> String.valueOf(b.get("createdAt"))
                .compareTo(String.valueOf(a.get("createdAt"))));

        return out;
    }

    private static List<Map<String, Object>> adminGames() throws Exception {

        List<Map<String, Object>> out = new ArrayList<>();

        for (Map<String, Object> user : allUsers()) {
            String id = String.valueOf(user.get("uid"));

            for (DocumentSnapshot d : db.collection("users")
                    .document(id)
                    .collection("games")
                    .orderBy("createdAt", Query.Direction.DESCENDING)
                    .limit(200)
                    .get()
                    .get()
                    .getDocuments()) {

                Map<String, Object> record = new LinkedHashMap<>(d.getData());
                record.put("uid", id);
                record.put("fullName", user.get("fullName"));
                record.put("email", user.get("email"));
                record.put("mobile", user.get("mobile"));
                out.add(record);
            }
        }

        out.sort((a, b) -> String.valueOf(b.get("createdAt"))
                .compareTo(String.valueOf(a.get("createdAt"))));

        return out;
    }

    private static Map<String, Object> adminUserDetails(String id)
            throws Exception {

        Map<String, Object> result = new LinkedHashMap<>(account(id));
        try {
            result.put("email", FirebaseAuth.getInstance().getUser(id).getEmail());
        } catch (FirebaseAuthException ignored) {
            result.put("email", "");
        }

        result.put("transactions", transactions(id));
        result.put("games", games(id));

        return result;
    }

    private static List<Map<String, Object>> allUsers() throws Exception {

        List<Map<String, Object>> out = new ArrayList<>();

        for (DocumentSnapshot d : db.collection("users").get().get().getDocuments()) {

            Map<String, Object> m = d.getData();

            if (m == null) {
                throw new IllegalStateException(
                        "User document has no data: " + d.getId());
            }

            m.put("uid", d.getId());
            try {
                UserRecord authUser = FirebaseAuth.getInstance().getUser(d.getId());
                m.put("email", authUser.getEmail());
            } catch (FirebaseAuthException ignored) {
                m.put("email", "");
            }
            out.add(m);
        }

        return out;
    }

    private static void block(
            String id,
            boolean blocked,
            String admin) throws Exception {

        db.collection("users")
                .document(id)
                .update(
                        "status",
                        blocked ? "blocked" : "active")
                .get();

        audit(
                admin,
                "BLOCK_USER",
                id,
                Boolean.toString(blocked));
    }

    private static void editUser(
            String id,
            String name,
            String mobile,
            String admin) throws Exception {

        if (!mobile.matches("[0-9+() -]{7,20}")) {
            throw new IllegalArgumentException(
                    "Enter a valid mobile number.");
        }

        db.collection("users")
                .document(id)
                .update(
                        "fullName", name,
                        "mobile", mobile)
                .get();

        audit(admin, "EDIT_USER", id, "Updated name/mobile");
    }

    private static void updateProfile(String id, String name, String mobile)
            throws Exception {

        if (name.trim().isEmpty() || name.length() > 80) {
            throw new IllegalArgumentException("Enter a name up to 80 characters.");
        }
        if (!mobile.matches("[0-9+() -]{7,20}")) {
            throw new IllegalArgumentException("Enter a valid mobile number.");
        }

        DocumentSnapshot existing = db.collection("users")
                .document(id)
                .get()
                .get();
        active(existing);

        db.collection("users").document(id)
                .update("fullName", name.trim(), "mobile", mobile.trim())
                .get();
    }

    private static void deleteAdminUser(
            String id,
            String admin) throws Exception {

        audit(admin, "DELETE_USER", id, "Deleted account");
        deleteAccount(id);
    }

    private static List<Map<String, Object>> auditLogs()
            throws Exception {

        List<Map<String, Object>> out = new ArrayList<>();

        for (DocumentSnapshot d : db.collection("auditLogs")
                .orderBy(
                        "createdAt",
                        Query.Direction.DESCENDING)
                .limit(100)
                .get()
                .get()
                .getDocuments()) {

            out.add(d.getData());
        }

        return out;
    }

    private static void adjust(
            String id,
            double delta,
            String reason,
            String admin,
            FirebaseToken token) throws Exception {

        if (!Boolean.TRUE.equals(
                token.getClaims().get("balanceAdjuster"))) {
            throw new SecurityException(
                    "Balance adjustment permission required.");
        }

        if (reason.trim().length() < 4) {
            throw new IllegalArgumentException(
                    "Provide an adjustment reason.");
        }

        DocumentReference u = db.collection("users").document(id);

        db.runTransaction(t -> {

            DocumentSnapshot s = t.get(u).get();

            double next = requiredBalance(s) + delta;

            if (next < 0) {
                throw new IllegalArgumentException(
                        "Adjustment would make balance negative.");
            }

            t.update(u, "balance", next);

            addTransaction(
                    t,
                    id,
                    "ADMIN_ADJUSTMENT",
                    Math.abs(delta),
                    reason);

            return null;

        }).get();

        audit(
                admin,
                "BALANCE_ADJUSTMENT",
                id,
                delta + ": " + reason);
    }

    private static void audit(
            String admin,
            String action,
            String target,
            String details) throws Exception {

        db.collection("auditLogs")
                .add(map(
                        "adminUid", admin,
                        "action", action,
                        "targetUid", target,
                        "details", details,
                        "createdAt", Instant.now().toString()))
                .get();
    }

    private static void addTransaction(
            Transaction t,
            String uid,
            String type,
            double amount,
            String details) {

        DocumentReference r = db.collection("users")
                .document(uid)
                .collection("transactions")
                .document();

        t.set(
                r,
                map(
                        "type", type,
                        "amount", amount,
                        "details", details,
                        "createdAt", Instant.now().toString()));
    }

    private static void active(DocumentSnapshot s) {

        if (!s.exists()) {
            throw new IllegalArgumentException(
                    "Account not found.");
        }

        if (!"active".equals(s.getString("status"))) {
            throw new SecurityException(
                    "This account is blocked.");
        }
    }

    private static double requiredBalance(DocumentSnapshot snapshot) {

        active(snapshot);

        return requiredNumber(
                snapshot.getDouble("balance"),
                "balance");
    }

    private static double requiredNumber(
            Double value,
            String field) {

        if (value == null || !Double.isFinite(value)) {
            throw new IllegalStateException(
                    "Account data is missing or invalid: " + field);
        }

        return value;
    }

    private static double numberValue(Object value) {
        return value instanceof Number
                ? ((Number) value).doubleValue()
                : 0.0;
    }

    private static void requireAdmin(FirebaseToken t) {

        if (!Boolean.TRUE.equals(t.getClaims().get("admin"))) {
            throw new SecurityException(
                    "Administrator access required.");
        }
    }

    private static double amount(Map<String, Object> b) {

        Object v = b.get("amount");

        if (!(v instanceof Number)) {
            throw new IllegalArgumentException(
                    "Amount is required.");
        }

        return ((Number) v).doubleValue();
    }

    private static void validateAmount(double v) {

        if (!Double.isFinite(v) || v <= 0 || v > 1000000) {
            throw new IllegalArgumentException(
                    "Enter an amount greater than zero (maximum PHP 1,000,000).");
        }
    }

    private static String text(
            Map<String, Object> b,
            String key) {

        Object v = b.get(key);

        if (v == null || v.toString().trim().isEmpty()) {
            throw new IllegalArgumentException(
                    key + " is required.");
        }

        return v.toString().trim();
    }

    private static Map<String, Object> map(Object... values) {

        Map<String, Object> m = new LinkedHashMap<>();

        for (int i = 0; i < values.length; i += 2) {
            m.put((String) values[i], values[i + 1]);
        }

        return m;
    }

    private static Map<String, Object> readBody(HttpExchange x)
            throws IOException {

        try (Reader r = new InputStreamReader(
                x.getRequestBody(),
                StandardCharsets.UTF_8)) {

            Type bodyType = new TypeToken<Map<String, Object>>() {
            }.getType();

            Map<String, Object> body = JSON.fromJson(r, bodyType);

            return body == null ? new HashMap<>() : body;
        }
    }

    private static void cors(HttpExchange x) {

        x.getResponseHeaders().set(
                "Access-Control-Allow-Origin",
                System.getenv().getOrDefault(
                        "BANKIT_WEB_ORIGIN",
                        "http://localhost:8080"));

        x.getResponseHeaders().set(
                "Access-Control-Allow-Headers",
                "Authorization, Content-Type");

        x.getResponseHeaders().set(
                "Access-Control-Allow-Methods",
                "GET, POST, PUT, DELETE, OPTIONS");
    }

    private static void send(
            HttpExchange x,
            int status,
            Object body) throws IOException {

        byte[] b = JSON.toJson(body)
                .getBytes(StandardCharsets.UTF_8);

        x.getResponseHeaders().set(
                "Content-Type",
                "application/json; charset=utf-8");

        x.sendResponseHeaders(status, b.length);

        try (OutputStream o = x.getResponseBody()) {
            o.write(b);
        }
    }
}
