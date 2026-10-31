package com.sunshinecampus.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSArray;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class ScheduleWidgetStore {
    private static final String PREFS = "ohu_schedule_widget_v1";
    private static final String OWNER = "owner_hash";
    private static final String REVISION = "identity_revision";
    private static final String INSTANCE = "instance_id";
    private static final String DATA = "today_data";

    private ScheduleWidgetStore() {}

    static synchronized void setIdentity(Context context, String uid, int revision, String instanceId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String ownerHash = uid == null || uid.isEmpty() ? "" : hash(uid);
        String oldOwner = prefs.getString(OWNER, "");
        String oldInstance = prefs.getString(INSTANCE, "");
        // A WebView restart for the same signed-in account must keep the last
        // snapshot for offline widgets. Identity changes still clear it.
        boolean changed = !ownerHash.equals(oldOwner);
        prefs.edit().putString(OWNER, ownerHash).putString(INSTANCE, instanceId).putInt(REVISION, revision)
                .putString(DATA, changed ? "" : prefs.getString(DATA, "")).apply();
        if (changed) updateAll(context);
    }

    static synchronized boolean setData(Context context, String uid, int revision, String instanceId,
            String date, String dayLabel, String state, JSArray classes) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!hash(uid).equals(prefs.getString(OWNER, ""))
                || revision != prefs.getInt(REVISION, -1)
                || !instanceId.equals(prefs.getString(INSTANCE, ""))) return false;
        try {
            JSONObject data = new JSONObject();
            data.put("date", date);
            data.put("dayLabel", dayLabel == null ? "" : dayLabel.substring(0, Math.min(16, dayLabel.length())));
            data.put("state", state);
            JSONArray safeClasses = new JSONArray();
            if (classes != null) {
                for (int i = 0; i < Math.min(classes.length(), 18); i++) {
                    JSONObject item = classes.getJSONObject(i);
                    String name = safeText(item.optString("name", ""), 80);
                    String start = item.optString("start", "");
                    String end = item.optString("end", "");
                    if (name.isEmpty() || !start.matches("([01]\\d|2[0-3]):[0-5]\\d") || !end.matches("([01]\\d|2[0-3]):[0-5]\\d")) continue;
                    JSONObject safe = new JSONObject();
                    safe.put("name", name);
                    safe.put("room", safeText(item.optString("room", ""), 80));
                    safe.put("start", start);
                    safe.put("end", end);
                    safeClasses.put(safe);
                }
            }
            data.put("classes", safeClasses);
            prefs.edit().putString(DATA, data.toString()).apply();
            updateAll(context);
            return true;
        } catch (JSONException | RuntimeException ignored) {
            return false;
        }
    }

    static JSONObject read(Context context) {
        String raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(DATA, "");
        if (raw == null || raw.isEmpty()) return null;
        try { return new JSONObject(raw); } catch (JSONException ignored) { return null; }
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] today = manager.getAppWidgetIds(new ComponentName(context, TodayScheduleWidgetProvider.class));
        if (today != null && today.length > 0) TodayScheduleWidgetProvider.update(context, manager, today);
        int[] next = manager.getAppWidgetIds(new ComponentName(context, NextClassWidgetProvider.class));
        if (next != null && next.length > 0) NextClassWidgetProvider.update(context, manager, next);
    }

    static String safeText(String value, int max) {
        if (value == null) return "";
        String clean = value.replaceAll("[\\p{Cntrl}]", " ").trim();
        return clean.substring(0, Math.min(max, clean.length()));
    }

    private static String hash(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) out.append(String.format(Locale.ROOT, "%02x", b));
            return out.toString();
        } catch (Exception ignored) { return ""; }
    }
}
