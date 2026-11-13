package ch.duartesantos.opengym;

import androidx.health.connect.client.records.HeartRateRecord;
import androidx.health.connect.client.records.WeightRecord;
import androidx.health.connect.client.records.metadata.Metadata;
import java.util.ArrayList;
import java.util.List;

/**
 * What HealthConnectPlugin hands to JS when it reads (v1.4.3): plain values, no Android classes,
 * so it is tested on the JVM (HealthReadTest). Heart rate as [ms, bpm] pairs inside the window
 * asked for; weigh-ins as { t, kg, id, origin, clientId }. Which of them openGym takes, and how,
 * is decided in JS (lib/health-read.js), which also skips openGym's own records.
 */
final class HealthRead {
    private HealthRead() {}

    // Beyond this no reading is plausible; lib/heart-rate.js applies the same bounds again.
    static final long BPM_MIN = 25;
    static final long BPM_MAX = 250;
    // A workout of a few hours at one sample a second is well under this.
    static final int MAX_SAMPLES = 50000;

    /** The samples of these records that lie in [from, to], oldest first. */
    static List<long[]> samples(List<HeartRateRecord> records, long from, long to) {
        List<long[]> out = new ArrayList<>();
        for (HeartRateRecord r : records) {
            for (HeartRateRecord.Sample s : r.getSamples()) {
                long t = s.getTime().toEpochMilli();
                long bpm = s.getBeatsPerMinute();
                if (t < from || t > to || bpm < BPM_MIN || bpm > BPM_MAX) continue;
                out.add(new long[] { t, bpm });
                if (out.size() >= MAX_SAMPLES) break;
            }
            if (out.size() >= MAX_SAMPLES) break;
        }
        out.sort((a, b) -> Long.compare(a[0], b[0]));
        return out;
    }

    /** One weigh-in as JS gets it. */
    static final class Weight {
        final long t;
        final double kg;
        final String id, origin, clientId;

        Weight(long t, double kg, String id, String origin, String clientId) {
            this.t = t; this.kg = kg; this.id = id; this.origin = origin; this.clientId = clientId;
        }
    }

    static List<Weight> weights(List<WeightRecord> records) {
        List<Weight> out = new ArrayList<>();
        for (WeightRecord r : records) {
            Metadata m = r.getMetadata();
            double kg = r.getWeight().getKilograms();
            if (!(kg > 0)) continue;
            out.add(new Weight(r.getTime().toEpochMilli(), kg, m.getId(),
                    m.getDataOrigin().getPackageName(), m.getClientRecordId()));
        }
        return out;
    }

    /** One body-composition reading as JS gets it: `type` is the measurement key openGym files it under. */
    static final class Body {
        final String type;
        final long t;
        final double value;
        final String id, origin, clientId;

        Body(String type, long t, double value, String id, String origin, String clientId) {
            this.type = type; this.t = t; this.value = value; this.id = id; this.origin = origin; this.clientId = clientId;
        }
    }

    /** A reading of `type` (bodyFat in percent, the masses in kg), or null when it is no reading. */
    static Body body(String type, long t, double value, Metadata m) {
        if (!(value > 0) || Double.isInfinite(value)) return null;
        if ("bodyFat".equals(type) && value > 100) return null;
        return new Body(type, t, value, m.getId(), m.getDataOrigin().getPackageName(), m.getClientRecordId());
    }

    /** One local day's totals as JS gets them; a metric that had no data stays null. */
    static final class Day {
        final String d;
        Double kcal, protein, fat, carbs, water;

        Day(String d) { this.d = d; }

        boolean empty() { return kcal == null && protein == null && fat == null && carbs == null && water == null; }
    }

    /** A total worth handing on: rounded to one decimal, and null for nothing or nonsense. */
    static Double total(Double v) {
        if (v == null || !(v > 0) || v.isInfinite()) return null;
        return Math.round(v * 10) / 10.0;
    }

    /** The JS names of the read permissions, as the manifest declares them. */
    static String readPermission(String name) {
        switch (name) {
            case "heartRate": return "android.permission.health.READ_HEART_RATE";
            case "weight": return "android.permission.health.READ_WEIGHT";
            case "bodyFat": return "android.permission.health.READ_BODY_FAT";
            case "leanMass": return "android.permission.health.READ_LEAN_BODY_MASS";
            case "boneMass": return "android.permission.health.READ_BONE_MASS";
            case "bodyWater": return "android.permission.health.READ_BODY_WATER_MASS";
            case "nutrition": return "android.permission.health.READ_NUTRITION";
            case "hydration": return "android.permission.health.READ_HYDRATION";
            // Not a data type: data older than 30 days before the first grant (#801).
            case "history": return "android.permission.health.READ_HEALTH_DATA_HISTORY";
            default: return null;
        }
    }

    static String writePermission(String name) {
        switch (name) {
            case "exercise": return "android.permission.health.WRITE_EXERCISE";
            case "weight": return "android.permission.health.WRITE_WEIGHT";
            default: return null;
        }
    }
}
