package ch.duartesantos.opengym;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.contract.ActivityResultContract;
import androidx.health.connect.client.HealthConnectClient;
import androidx.health.connect.client.HealthConnectFeatures;
import androidx.health.connect.client.PermissionController;
import androidx.health.connect.client.aggregate.AggregateMetric;
import androidx.health.connect.client.aggregate.AggregationResult;
import androidx.health.connect.client.aggregate.AggregationResultGroupedByPeriod;
import androidx.health.connect.client.records.BodyFatRecord;
import androidx.health.connect.client.records.BodyWaterMassRecord;
import androidx.health.connect.client.records.BoneMassRecord;
import androidx.health.connect.client.records.ExerciseSessionRecord;
import androidx.health.connect.client.records.HeartRateRecord;
import androidx.health.connect.client.records.HydrationRecord;
import androidx.health.connect.client.records.LeanBodyMassRecord;
import androidx.health.connect.client.records.NutritionRecord;
import androidx.health.connect.client.records.Record;
import androidx.health.connect.client.records.WeightRecord;
import androidx.health.connect.client.records.metadata.Metadata;
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest;
import androidx.health.connect.client.request.ReadRecordsRequest;
import androidx.health.connect.client.response.ReadRecordsResponse;
import androidx.health.connect.client.time.TimeRangeFilter;
import androidx.health.connect.client.units.Energy;
import androidx.health.connect.client.units.Mass;
import androidx.health.connect.client.units.Volume;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.Period;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlin.jvm.JvmClassMappingKt;
import kotlinx.coroutines.BuildersKt;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Writes finished workouts and weigh-ins to Health Connect (#200), the phone's own store for
 * health data, so other apps can read them. Write-only and off until the user turns it on in
 * Settings: no permission is asked for before that. What to write is worked out in JS
 * (lib/health-connect.js); this side only turns those plain objects into records.
 *
 * Every record carries openGym's own id as its clientRecordId, so writing it again replaces it,
 * and "remove" finds exactly the records openGym wrote. The version is the time of the write:
 * Health Connect keeps a rewritten record only when its version is higher than the stored one.
 *
 * The client's API is Kotlin suspend functions. They are called from a worker thread through
 * runBlocking, which keeps the Android project Java-only.
 *
 * The client library needs Android 8 (API 26) and Health Connect itself Android 9 (API 28); the
 * app supports Android 6, so every entry point checks the version before a Health Connect class
 * is touched, and answers "unsupported" below 9.
 *
 * Usage from JS (lib/health-sync.js):
 *   const HC = registerPlugin('HealthConnect');
 *   await HC.status();              // { status: 'available' | 'update' | 'missing' | 'unsupported', granted }
 *   await HC.requestPermissions();  // { granted }
 *   await HC.write({ sessions: [...], weights: [...] });
 *   await HC.remove({ sessions: [ids], weights: [ids] });
 *   await HC.openSettings();        // Health Connect's data screen, or its store page
 *
 * Reading back (v1.4.3), each only after the user turned it on and granted that one permission:
 *   await HC.requestPermissions({ read: ['heartRate'], write: [] });  // { granted, read: { heartRate, weight } }
 *   await HC.readHeartRate({ from, to });   // { samples: [[ms, bpm]], origins: [package] }
 *   await HC.readWeights({ since });        // { records: [{ t, kg, id, origin, clientId }] }
 * Since v1.4.6, from any app that saves them (a smart scale's, a food diary's, Google Health's):
 *   await HC.readBody({ since });           // { records: [{ type, t, value, id, origin, clientId }] }
 *     type: 'bodyFat' (percent) | 'leanMass' | 'boneMass' | 'bodyWater' (kg); only the granted ones
 *   await HC.readNutrition({ from, to, nutrition, water });  // { days: [{ d, kcal, protein, fat, carbs, water }] }
 *     per local day from `from` (YYYY-MM-DD) to `to` inclusive, grams and millilitres. Health
 *     Connect's own aggregate, so a meal two apps both saved is counted once, by the user's app
 *     priority in Health Connect.
 * Foreground only: no READ_HEALTH_DATA_IN_BACKGROUND. Without READ_HEALTH_DATA_HISTORY Health
 * Connect gives 30 days back from the first grant, plenty for the workout just done; weigh-ins
 * ask for it too (read: ['weight', 'history']) where Health Connect has the feature, which
 * status() says as `history`, so a scale's older weigh-ins come along (idea from #801).
 */
@CapacitorPlugin(name = "HealthConnect")
public class HealthConnectPlugin extends Plugin {

    private static final String PROVIDER = "com.google.android.apps.healthdata";
    // The literal permission names, as declared in AndroidManifest.xml.
    private static final String WRITE_EXERCISE = "android.permission.health.WRITE_EXERCISE";
    private static final String WRITE_WEIGHT = "android.permission.health.WRITE_WEIGHT";
    private static final String READ_HEART_RATE = "android.permission.health.READ_HEART_RATE";
    private static final String READ_WEIGHT = "android.permission.health.READ_WEIGHT";
    private static final String READ_HISTORY = "android.permission.health.READ_HEALTH_DATA_HISTORY";
    // The JS names of the body-composition reads, each its own permission (HealthRead.readPermission).
    private static final String[] BODY = { "bodyFat", "leanMass", "boneMass", "bodyWater" };
    // A day's totals are asked for at most this many days at once.
    private static final int MAX_DAYS = 400;
    // Records per page when reading, and pages at most: a few hours of heart rate fit easily.
    private static final int PAGE = 1000;
    private static final int MAX_PAGES = 50;
    // Health Connect takes at most this many records in one insert.
    private static final int CHUNK = 500;

    // One at a time, in order: a remove queued behind a write must not overtake it.
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private static boolean supported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P;
    }

    private static Set<String> permissions() {
        Set<String> p = new HashSet<>();
        p.add(WRITE_EXERCISE);
        p.add(WRITE_WEIGHT);
        return p;
    }

    private String sdkStatus() {
        if (!supported()) return "unsupported";
        int s = HealthConnectClient.Companion.getSdkStatus(getContext(), PROVIDER);
        if (s == HealthConnectClient.SDK_AVAILABLE) return "available";
        if (s == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return "update";
        // Android 13 and lower need the Health Connect app; 14 and up have it built in, so
        // "missing" there means the phone has no Health Connect at all (some Android Go builds).
        return Build.VERSION.SDK_INT >= 34 ? "unsupported" : "missing";
    }

    private HealthConnectClient client() {
        return HealthConnectClient.Companion.getOrCreate(getContext(), PROVIDER);
    }

    // Whether this Health Connect knows the history permission at all (newer provider versions
    // only). Asked before it is requested: an unknown permission is not offered in the dialog.
    private boolean historyAvailable() {
        try {
            return client().getFeatures().getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY)
                    == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE;
        } catch (Exception e) {
            return false;
        }
    }

    @SuppressWarnings("unchecked")
    private Set<String> granted() throws InterruptedException {
        PermissionController pc = client().getPermissionController();
        return (Set<String>) BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> pc.getGrantedPermissions(cont));
    }

    @PluginMethod
    public void status(PluginCall call) {
        String status = sdkStatus();
        if (!"available".equals(status)) {
            JSObject r = new JSObject();
            r.put("status", status);
            r.put("granted", false);
            call.resolve(r);
            return;
        }
        worker.execute(() -> {
            try {
                JSObject r = new JSObject();
                r.put("status", status);
                Set<String> got = granted();
                r.put("granted", got.containsAll(permissions()));
                r.put("read", readState(got));
                r.put("history", historyAvailable());
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        Set<String> asked;
        try {
            asked = asked(call);
        } catch (JSONException e) {
            call.reject(e.getMessage(), "failed");
            return;
        }
        if (!historyAvailable()) asked.remove(READ_HISTORY);
        ActivityResultContract<Set<String>, Set<String>> contract = PermissionController.createRequestPermissionResultContract(PROVIDER);
        Intent intent = contract.createIntent(getContext(), asked);
        startActivityForResult(call, intent, "permissionsResult");
    }

    @ActivityCallback
    private void permissionsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        ActivityResultContract<Set<String>, Set<String>> contract = PermissionController.createRequestPermissionResultContract(PROVIDER);
        Set<String> got = contract.parseResult(result.getResultCode(), result.getData());
        // The dialog answers only for this time; ask Health Connect what stands now, since the
        // user may also have granted one of the two and not the other.
        worker.execute(() -> {
            try {
                Set<String> now = new HashSet<>(granted());
                if (got != null) now.addAll(got);
                JSObject r = new JSObject();
                r.put("granted", now.containsAll(permissions()));
                r.put("read", readState(now));
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        JSArray sessions = call.getArray("sessions", new JSArray());
        JSArray weights = call.getArray("weights", new JSArray());
        worker.execute(() -> {
            try {
                long version = System.currentTimeMillis();
                List<Record> records = new ArrayList<>();
                for (int i = 0; i < sessions.length(); i++) records.add(session(sessions.getJSONObject(i), version));
                for (int i = 0; i < weights.length(); i++) records.add(weight(weights.getJSONObject(i), version));
                for (int from = 0; from < records.size(); from += CHUNK) {
                    List<Record> part = records.subList(from, Math.min(records.size(), from + CHUNK));
                    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().insertRecords(part, cont));
                }
                call.resolve();
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void remove(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        JSArray sessions = call.getArray("sessions", new JSArray());
        JSArray weights = call.getArray("weights", new JSArray());
        worker.execute(() -> {
            try {
                delete(ExerciseSessionRecord.class, ids(sessions));
                delete(WeightRecord.class, ids(weights));
                call.resolve();
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void readHeartRate(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        Long from = millis(call, "from"), to = millis(call, "to");
        if (from == null || to == null || to <= from) {
            call.reject("from and to are needed", "failed");
            return;
        }
        worker.execute(() -> {
            try {
                List<HeartRateRecord> recs = read(HeartRateRecord.class,
                        TimeRangeFilter.between(Instant.ofEpochMilli(from), Instant.ofEpochMilli(to)));
                JSArray samples = new JSArray();
                for (long[] s : HealthRead.samples(recs, from, to)) samples.put(new JSArray().put(s[0]).put(s[1]));
                Set<String> origins = new HashSet<>();
                for (HeartRateRecord r : recs) origins.add(r.getMetadata().getDataOrigin().getPackageName());
                JSObject out = new JSObject();
                out.put("samples", samples);
                out.put("origins", new JSArray(origins));
                call.resolve(out);
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void readWeights(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        Long since = millis(call, "since");
        if (since == null) {
            call.reject("since is needed", "failed");
            return;
        }
        worker.execute(() -> {
            try {
                List<WeightRecord> recs = read(WeightRecord.class, TimeRangeFilter.after(Instant.ofEpochMilli(since)));
                JSArray records = new JSArray();
                for (HealthRead.Weight w : HealthRead.weights(recs)) {
                    JSObject o = new JSObject();
                    o.put("t", w.t);
                    o.put("kg", w.kg);
                    o.put("id", w.id);
                    o.put("origin", w.origin);
                    o.put("clientId", w.clientId);
                    records.put(o);
                }
                JSObject out = new JSObject();
                out.put("records", records);
                call.resolve(out);
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void readBody(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        Long since = millis(call, "since");
        if (since == null) {
            call.reject("since is needed", "failed");
            return;
        }
        worker.execute(() -> {
            try {
                Set<String> got = granted();
                TimeRangeFilter range = TimeRangeFilter.after(Instant.ofEpochMilli(since));
                List<HealthRead.Body> found = new ArrayList<>();
                int asked = 0;
                // Only the types the user granted: a refused one would throw for the whole read.
                for (String type : BODY) {
                    if (!got.contains(HealthRead.readPermission(type))) continue;
                    asked++;
                    switch (type) {
                        case "bodyFat":
                            for (BodyFatRecord r : read(BodyFatRecord.class, range))
                                add(found, HealthRead.body(type, r.getTime().toEpochMilli(), r.getPercentage().getValue(), r.getMetadata()));
                            break;
                        case "leanMass":
                            for (LeanBodyMassRecord r : read(LeanBodyMassRecord.class, range))
                                add(found, HealthRead.body(type, r.getTime().toEpochMilli(), r.getMass().getKilograms(), r.getMetadata()));
                            break;
                        case "boneMass":
                            for (BoneMassRecord r : read(BoneMassRecord.class, range))
                                add(found, HealthRead.body(type, r.getTime().toEpochMilli(), r.getMass().getKilograms(), r.getMetadata()));
                            break;
                        case "bodyWater":
                            for (BodyWaterMassRecord r : read(BodyWaterMassRecord.class, range))
                                add(found, HealthRead.body(type, r.getTime().toEpochMilli(), r.getMass().getKilograms(), r.getMetadata()));
                            break;
                        default: break;
                    }
                }
                if (asked == 0) {
                    call.reject("No body measurement may be read", "permission");
                    return;
                }
                JSArray records = new JSArray();
                for (HealthRead.Body b : found) {
                    JSObject o = new JSObject();
                    o.put("type", b.type);
                    o.put("t", b.t);
                    o.put("value", b.value);
                    o.put("id", b.id);
                    o.put("origin", b.origin);
                    o.put("clientId", b.clientId);
                    records.put(o);
                }
                JSObject out = new JSObject();
                out.put("records", records);
                call.resolve(out);
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    private static void add(List<HealthRead.Body> to, HealthRead.Body b) {
        if (b != null) to.add(b);
    }

    @PluginMethod
    public void readNutrition(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        LocalDate from, to;
        try {
            from = LocalDate.parse(call.getString("from", ""));
            to = LocalDate.parse(call.getString("to", ""));
        } catch (Exception e) {
            call.reject("from and to are needed", "failed");
            return;
        }
        if (to.isBefore(from) || from.plusDays(MAX_DAYS).isBefore(to)) {
            call.reject("from and to are out of range", "failed");
            return;
        }
        boolean food = Boolean.TRUE.equals(call.getBoolean("nutrition", false));
        boolean water = Boolean.TRUE.equals(call.getBoolean("water", false));
        worker.execute(() -> {
            try {
                Set<String> got = granted();
                boolean readFood = food && got.contains(HealthRead.readPermission("nutrition"));
                boolean readWater = water && got.contains(HealthRead.readPermission("hydration"));
                if (!readFood && !readWater) {
                    call.reject("Neither nutrition nor water may be read", "permission");
                    return;
                }
                Set<AggregateMetric<?>> metrics = new HashSet<>();
                if (readFood) {
                    metrics.add(NutritionRecord.ENERGY_TOTAL);
                    metrics.add(NutritionRecord.PROTEIN_TOTAL);
                    metrics.add(NutritionRecord.TOTAL_FAT_TOTAL);
                    metrics.add(NutritionRecord.TOTAL_CARBOHYDRATE_TOTAL);
                }
                if (readWater) metrics.add(HydrationRecord.VOLUME_TOTAL);
                // Local days: the slicer cuts at midnight where the phone is.
                AggregateGroupByPeriodRequest req = new AggregateGroupByPeriodRequest(metrics,
                        TimeRangeFilter.between(from.atStartOfDay(), to.plusDays(1).atStartOfDay()),
                        Period.ofDays(1), Collections.emptySet());
                @SuppressWarnings("unchecked")
                List<AggregationResultGroupedByPeriod> groups = (List<AggregationResultGroupedByPeriod>) BuildersKt.runBlocking(
                        EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().aggregateGroupByPeriod(req, cont));
                JSArray days = new JSArray();
                for (AggregationResultGroupedByPeriod g : groups) {
                    LocalDateTime start = g.getStartTime();
                    AggregationResult r = g.getResult();
                    HealthRead.Day day = new HealthRead.Day(start.toLocalDate().toString());
                    if (readFood) {
                        Energy e = r.get(NutritionRecord.ENERGY_TOTAL);
                        Mass p = r.get(NutritionRecord.PROTEIN_TOTAL);
                        Mass f = r.get(NutritionRecord.TOTAL_FAT_TOTAL);
                        Mass c = r.get(NutritionRecord.TOTAL_CARBOHYDRATE_TOTAL);
                        day.kcal = HealthRead.total(e == null ? null : e.getKilocalories());
                        day.protein = HealthRead.total(p == null ? null : p.getGrams());
                        day.fat = HealthRead.total(f == null ? null : f.getGrams());
                        day.carbs = HealthRead.total(c == null ? null : c.getGrams());
                    }
                    if (readWater) {
                        Volume v = r.get(HydrationRecord.VOLUME_TOTAL);
                        day.water = HealthRead.total(v == null ? null : v.getMilliliters());
                    }
                    if (day.empty()) continue;
                    JSObject o = new JSObject();
                    o.put("d", day.d);
                    if (readFood) {
                        o.put("kcal", day.kcal == null ? JSONObject.NULL : day.kcal);
                        o.put("protein", day.protein == null ? JSONObject.NULL : day.protein);
                        o.put("fat", day.fat == null ? JSONObject.NULL : day.fat);
                        o.put("carbs", day.carbs == null ? JSONObject.NULL : day.carbs);
                    }
                    if (readWater) o.put("water", day.water == null ? JSONObject.NULL : day.water);
                    days.put(o);
                }
                JSObject out = new JSObject();
                out.put("days", days);
                out.put("nutrition", readFood);
                out.put("water", readWater);
                call.resolve(out);
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    // Every page of one record type in the window, oldest first.
    @SuppressWarnings("unchecked")
    private <T extends Record> List<T> read(Class<T> type, TimeRangeFilter range) throws InterruptedException {
        List<T> out = new ArrayList<>();
        String token = null;
        for (int page = 0; page < MAX_PAGES; page++) {
            ReadRecordsRequest<T> req = new ReadRecordsRequest<>(JvmClassMappingKt.getKotlinClass(type), range,
                    Collections.emptySet(), true, PAGE, token);
            ReadRecordsResponse<T> res = (ReadRecordsResponse<T>) BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
                    (scope, cont) -> client().readRecords(req, cont));
            out.addAll(res.getRecords());
            token = res.getPageToken();
            if (token == null || token.isEmpty()) break;
        }
        return out;
    }

    // What was asked for: { read: ['heartRate', 'weight'], write: ['exercise', 'weight'] }, each
    // optional. Without either, the two write permissions, as before v1.4.3.
    private static Set<String> asked(PluginCall call) throws JSONException {
        JSArray read = call.getArray("read", null), write = call.getArray("write", null);
        if (read == null && write == null) return permissions();
        Set<String> out = new HashSet<>();
        if (read != null) for (int i = 0; i < read.length(); i++) {
            String p = HealthRead.readPermission(read.getString(i));
            if (p != null) out.add(p);
        }
        if (write != null) for (int i = 0; i < write.length(); i++) {
            String p = HealthRead.writePermission(write.getString(i));
            if (p != null) out.add(p);
        }
        return out;
    }

    // A time from JS: a number that may arrive as an Integer, Long or Double (getLong takes only Long).
    private static Long millis(PluginCall call, String name) {
        Object v = call.getData().opt(name);
        return v instanceof Number ? ((Number) v).longValue() : null;
    }

    private static JSObject readState(Set<String> granted) {
        JSObject r = new JSObject();
        r.put("heartRate", granted.contains(READ_HEART_RATE));
        r.put("weight", granted.contains(READ_WEIGHT));
        r.put("history", granted.contains(READ_HISTORY));
        for (String type : BODY) r.put(type, granted.contains(HealthRead.readPermission(type)));
        r.put("nutrition", granted.contains(HealthRead.readPermission("nutrition")));
        r.put("hydration", granted.contains(HealthRead.readPermission("hydration")));
        return r;
    }

    // Health Connect's own screen for the data apps wrote, where the user can look at and delete
    // what openGym wrote. Without Health Connect (Android 13 and lower), its store page instead.
    @PluginMethod
    public void openSettings(PluginCall call) {
        String status = sdkStatus();
        if ("unsupported".equals(status)) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        try {
            Intent intent = "available".equals(status)
                    ? HealthConnectClient.Companion.getHealthConnectManageDataIntent(getContext(), PROVIDER)
                    : new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + PROVIDER + "&url=healthconnect%3A%2F%2Fonboarding"));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage(), "failed");
        }
    }

    private void delete(Class<? extends Record> type, List<String> clientIds) throws InterruptedException {
        for (int from = 0; from < clientIds.size(); from += CHUNK) {
            List<String> part = clientIds.subList(from, Math.min(clientIds.size(), from + CHUNK));
            BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) ->
                    client().deleteRecords(JvmClassMappingKt.getKotlinClass(type), Collections.emptyList(), part, cont));
        }
    }

    private static List<String> ids(JSArray array) throws JSONException {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) out.add(array.getString(i));
        return out;
    }

    // The offset in force at that moment where the phone is now: what Health Connect shows the
    // session's local time with.
    private static ZoneOffset offsetAt(Instant at) {
        return ZoneId.systemDefault().getRules().getOffset(at);
    }

    private static ExerciseSessionRecord session(JSONObject s, long version) throws JSONException {
        Instant start = Instant.ofEpochMilli(s.getLong("start"));
        Instant end = Instant.ofEpochMilli(s.getLong("end"));
        String title = s.optString("title", "");
        String notes = s.optString("notes", "");
        return new ExerciseSessionRecord(
                start, offsetAt(start), end, offsetAt(end),
                Metadata.manualEntry(s.getString("id"), version),
                exerciseType(s.optString("type")),
                title.isEmpty() ? null : title,
                notes.isEmpty() ? null : notes);
    }

    private static WeightRecord weight(JSONObject w, long version) throws JSONException {
        Instant time = Instant.ofEpochMilli(w.getLong("time"));
        return new WeightRecord(time, offsetAt(time), Mass.kilograms(w.getDouble("kg")),
                Metadata.manualEntry(w.getString("id"), version));
    }

    // The names lib/health-connect.js uses (SESSION_TYPES); anything else is "other".
    private static int exerciseType(String name) {
        switch (name) {
            case "strength_training": return ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING;
            case "walking": return ExerciseSessionRecord.EXERCISE_TYPE_WALKING;
            case "running": return ExerciseSessionRecord.EXERCISE_TYPE_RUNNING;
            case "biking_stationary": return ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY;
            case "elliptical": return ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL;
            case "stair_climbing_machine": return ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING_MACHINE;
            case "biking": return ExerciseSessionRecord.EXERCISE_TYPE_BIKING;
            case "rowing": return ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE;
            case "hiit": return ExerciseSessionRecord.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING;
            case "yoga": return ExerciseSessionRecord.EXERCISE_TYPE_YOGA;
            case "flexibility": return ExerciseSessionRecord.EXERCISE_TYPE_STRETCHING;
            // Health Connect has no jump rope and no mixed cardio: those are "other", as before.
            default: return ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT;
        }
    }
}
