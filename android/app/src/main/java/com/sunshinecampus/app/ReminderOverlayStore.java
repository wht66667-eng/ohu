package com.sunshinecampus.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Account-bound, opt-in alarm mirror. Independent of audible LocalNotifications. */
final class ReminderOverlayStore {
    static final String ACTION = "com.sunshinecampus.REMINDER_OVERLAY";
    private static final String STORE = "reminder.overlay.v1";
    private static SharedPreferences prefs(Context context) { return context.getSharedPreferences(STORE, Context.MODE_PRIVATE); }
    static String owner(Context context) { return prefs(context).getString("ownerUid", ""); }
    static boolean enabled(Context context) { return prefs(context).getBoolean("enabled", false); }
    static boolean granted(Context context) { return Build.VERSION.SDK_INT >= 26 && Settings.canDrawOverlays(context); }
    static boolean exact(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return alarms != null && (Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms());
    }
    private static JSONArray plans(Context context) {
        try { return new JSONArray(prefs(context).getString("plans", "[]")); }
        catch (JSONException ignored) { return new JSONArray(); }
    }
    /** Overlay reminder mirrors expire one minute after their planned time, including legacy cards. */
    private static long expiresAt(JSONObject item) {
        long at = item.optLong("at", 0);
        long maxLateness = 60000L;
        if (at <= 0 || at > Long.MAX_VALUE - maxLateness) return -1;
        if (!item.has("expiresAt")) return at + maxLateness;
        long expiry = item.optLong("expiresAt", -1);
        return expiry > at ? Math.min(expiry, at + maxLateness) : -1;
    }
    static void error(Context context, String error) { prefs(context).edit().putString("lastError", error == null ? "" : error).apply(); }
    static String route(String value) {
        if (value == null || value.length() > 256 || !value.startsWith("/") || value.startsWith("//") || value.contains("\\") || value.contains("\n") || value.contains("\r")) return "/schedule";
        String path = value.split("[?#]", 2)[0];
        return path.equals("/schedule") || path.equals("/todo") || path.equals("/exams") || path.equals("/cert") || path.equals("/settings") || path.equals("/me/scores") ? value : "/schedule";
    }
    static synchronized JSObject state(Context context) {
        JSObject result = new JSObject();
        long now = System.currentTimeMillis(), next = Long.MAX_VALUE;
        int count = 0;
        boolean on = enabled(context), permission = granted(context);
        JSONArray future = plans(context);
        if (on && permission) for (int index = 0; index < future.length(); index++) {
            JSONObject item = future.optJSONObject(index);
            if (item != null && item.optLong("at") > now && expiresAt(item) > now && owner(context).equals(item.optString("ownerUid"))) { count++; next = Math.min(next, item.optLong("at")); }
        }
        String owner = owner(context), lastError = prefs(context).getString("lastError", "");
        result.put("supported", Build.VERSION.SDK_INT >= 26);
        result.put("enabled", on); result.put("permissionGranted", permission);
        result.put("ownerUid", owner.isEmpty() ? JSONObject.NULL : owner);
        result.put("pendingCount", count); result.put("nextAt", next == Long.MAX_VALUE ? JSONObject.NULL : next);
        result.put("exactAlarmGranted", exact(context));
        result.put("lastError", lastError.isEmpty() ? JSONObject.NULL : lastError);
        return result;
    }
    static synchronized JSObject sync(Context context, String ownerUid, JSONArray incoming) throws JSONException {
        if (ownerUid == null || ownerUid.trim().isEmpty() || ownerUid.length() > 128 || incoming.length() > 512) throw new IllegalArgumentException("桌面提醒计划无效");
        JSONArray validated = new JSONArray(); Set<Integer> ids = new HashSet<>();
        long now = System.currentTimeMillis(); int expired = 0;
        for (int index = 0; index < incoming.length(); index++) {
            JSONObject source = incoming.getJSONObject(index);
            long rawId = source.getLong("id"), at = source.getLong("at");
            String title = source.getString("title"), body = source.getString("body");
            if (rawId <= 0 || rawId > Integer.MAX_VALUE || !ids.add((int) rawId) || title.trim().isEmpty() || title.length() > 160 || body.length() > 600 || at <= 0) throw new IllegalArgumentException("桌面提醒条目无效");
            long expiry = expiresAt(source);
            if (source.has("expiresAt") && expiry <= 0) throw new IllegalArgumentException("桌面提醒有效期无效");
            if (at <= now || expiry <= now) { expired++; continue; }
            JSONObject item = new JSONObject(); item.put("id", rawId); item.put("at", at); item.put("ownerUid", ownerUid);
            item.put("title", title); item.put("body", body); item.put("route", route(source.optString("route", "/schedule")));
            if (source.has("expiresAt")) item.put("expiresAt", expiry);
            validated.put(item);
        }
        if (!owner(context).isEmpty() && !owner(context).equals(ownerUid)) throw new IllegalStateException("旧账号不能替换当前桌面提醒计划");
        cancelAlarms(context);
        SharedPreferences.Editor editor = prefs(context).edit().putString("ownerUid", ownerUid).putString("plans", validated.toString()).putString("lastError", "");
        if (!editor.commit()) throw new IllegalStateException("无法保存桌面提醒计划");
        int count = 0;
        if (enabled(context) && granted(context)) {
            try { for (int index = 0; index < validated.length(); index++) { arm(context, validated.getJSONObject(index)); count++; } }
            catch (RuntimeException failure) {
                cancelAlarms(context); prefs(context).edit().putString("plans", "[]").commit();
                error(context, "桌面提醒排程失败，请重试"); throw failure;
            }
        }
        JSObject result = state(context); result.put("scheduledCount", count); result.put("skippedExpired", expired); return result;
    }
    static synchronized JSObject setEnabled(Context context, boolean enabled) {
        if (enabled && !granted(context)) { error(context, "请先在系统设置允许显示在其他应用上层"); return state(context); }
        if (!prefs(context).edit().putBoolean("enabled", enabled).putString("lastError", "").commit()) throw new IllegalStateException("无法保存桌面提醒设置");
        if (enabled) restore(context);
        else { cancelAlarms(context); prefs(context).edit().putString("plans", "[]").commit(); ReminderOverlayWindow.dismiss(); }
        return state(context);
    }
    static synchronized JSObject clear(Context context, String expectedOwner, boolean preserveEnabled) {
        if (expectedOwner != null && !expectedOwner.equals(owner(context))) return state(context);
        cancelAlarms(context); ReminderOverlayWindow.dismiss();
        SharedPreferences.Editor editor = prefs(context).edit();
        if (preserveEnabled) editor.putString("plans", "[]").putString("lastError", "");
        else editor.clear();
        if (!editor.commit()) throw new IllegalStateException("无法清除桌面提醒计划");
        return state(context);
    }
    /** Boot restores future alarms only; it never launches permission UI or re-enables the feature. */
    static synchronized void restore(Context context) {
        JSONArray previous = plans(context), future = new JSONArray(); long now = System.currentTimeMillis();
        for (int index = 0; index < previous.length(); index++) {
            JSONObject item = previous.optJSONObject(index);
            if (item != null && item.optLong("at") > now && expiresAt(item) > now && !owner(context).isEmpty() && owner(context).equals(item.optString("ownerUid"))) future.put(item);
        }
        if (!prefs(context).edit().putString("plans", future.toString()).commit()) { error(context, "无法恢复桌面提醒计划"); return; }
        if (!enabled(context) || !granted(context)) return;
        try { for (int index = 0; index < future.length(); index++) arm(context, future.getJSONObject(index)); }
        catch (JSONException | RuntimeException failure) { cancelAlarms(context); prefs(context).edit().putString("plans", "[]").commit(); error(context, "恢复桌面提醒排程失败"); }
    }
    /** Consume before display so duplicate/stale broadcasts cannot replay a card. */
    static synchronized JSONObject consume(Context context, int id, String ownerUid, long at) {
        JSONArray previous = plans(context), remaining = new JSONArray(); JSONObject target = null;
        for (int index = 0; index < previous.length(); index++) {
            JSONObject item = previous.optJSONObject(index); if (item == null) continue;
            if (id == item.optInt("id") && at == item.optLong("at") && ownerUid.equals(item.optString("ownerUid"))) target = item; else remaining.put(item);
        }
        if (target == null || !prefs(context).edit().putString("plans", remaining.toString()).commit()) return null;
        long now = System.currentTimeMillis();
        if (!enabled(context) || !granted(context) || !ownerUid.equals(owner(context)) || at > now + 1000 || now >= expiresAt(target)) return null;
        return target;
    }
    private static PendingIntent pending(Context context, JSONObject item, int flags) {
        Intent intent = new Intent(context, ReminderOverlayReceiver.class).setAction(ACTION);
        intent.setData(new Uri.Builder().scheme("ohfox-reminder-overlay").authority("alarm").appendPath(item.optString("ownerUid")).appendPath(String.valueOf(item.optInt("id"))).appendPath(String.valueOf(item.optLong("at"))).build());
        intent.putExtra("id", item.optInt("id")); intent.putExtra("ownerUid", item.optString("ownerUid")); intent.putExtra("at", item.optLong("at"));
        return PendingIntent.getBroadcast(context, item.optInt("id"), intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }
    private static void cancelAlarms(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        JSONArray previous = plans(context);
        for (int index = 0; index < previous.length(); index++) {
            JSONObject item = previous.optJSONObject(index); if (item == null) continue;
            PendingIntent intent = pending(context, item, PendingIntent.FLAG_NO_CREATE);
            if (intent != null) { if (alarms != null) alarms.cancel(intent); intent.cancel(); }
        }
    }
    private static void arm(Context context, JSONObject item) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) throw new IllegalStateException("系统闹钟服务不可用");
        PendingIntent intent = pending(context, item, PendingIntent.FLAG_UPDATE_CURRENT);
        try { if (exact(context)) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.optLong("at"), intent); else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.optLong("at"), intent); }
        catch (SecurityException permissionChanged) { alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.optLong("at"), intent); }
    }
}
