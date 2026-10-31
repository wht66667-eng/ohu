package com.sunshinecampus.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.UserManager;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.CapConfig;
import com.getcapacitor.JSObject;
import com.capacitorjs.plugins.localnotifications.LocalNotification;
import com.capacitorjs.plugins.localnotifications.CourseReminderPolicy;
import com.capacitorjs.plugins.localnotifications.LocalNotificationManager;
import com.capacitorjs.plugins.localnotifications.NotificationStorage;
import com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Offline semester snapshot. One silent daily alarm replenishes a bounded seven-day active window. */
final class ReminderPlanStore {
    static final String ACTION = "com.sunshinecampus.REFRESH_COURSE_REMINDERS";
    private static final long DAY = 86400000L;
    private static final int LIMIT = 112;
    private static SharedPreferences prefs(Context context) { return context.getSharedPreferences("reminder.course-plan.v1", Context.MODE_PRIVATE); }
    static String owner(Context context) { return prefs(context).getString("ownerUid", ""); }
    private static JSONArray source(Context context) { try { return new JSONArray(prefs(context).getString("source", "[]")); } catch (Exception failure) { return new JSONArray(); } }
    private static void error(Context context, String message) { prefs(context).edit().putString("lastError", message == null ? "" : message).commit(); }
    static synchronized JSObject state(Context context) {
        String uid = owner(context), lastError = prefs(context).getString("lastError", "");
        long now = System.currentTimeMillis(); int planned = 0, active = 0;
        JSONArray entries = source(context);
        for (int i = 0; i < entries.length(); i++) if (entries.optJSONObject(i) != null && entries.optJSONObject(i).optLong("atMs") > now && !CourseReminderPolicy.isExpired(entries.optJSONObject(i), now)) planned++;
        NotificationStorage notifications = new NotificationStorage(context);
        for (String id : notifications.getSavedNotificationIds()) {
            JSONObject item = notifications.getSavedNotificationAsJSObject(id), extra = item == null ? null : item.optJSONObject("extra");
            if (extra != null && uid.equals(extra.optString("ownerUid")) && "class".equals(extra.optString("type"))) {
                LocalNotification parsed = notifications.getSavedNotification(id);
                if (parsed != null && parsed.getSchedule() != null && parsed.getSchedule().getAt() != null && parsed.getSchedule().getAt().getTime() > now) active++;
            }
        }
        JSObject result = new JSObject(); result.put("supported", true); result.put("atomicReplaceSupported", true); result.put("ownerUid", uid.isEmpty() ? JSONObject.NULL : uid);
        result.put("plannedCount", planned); result.put("activeCount", active);
        long next = prefs(context).getLong("nextRefreshAt", 0); result.put("nextRefreshAt", next > now ? next : JSONObject.NULL);
        result.put("lastError", lastError.isEmpty() ? JSONObject.NULL : lastError); return result;
    }
    static synchronized JSObject sync(Context context, String uid, JSONArray incoming) throws Exception {
        if (uid == null || uid.trim().isEmpty() || incoming == null || incoming.length() > 3360 || !uid.equals(ReminderBootStore.owner(context))) throw new IllegalArgumentException("后台课程账户或计划无效");
        long now = System.currentTimeMillis(); Set<Integer> ids = new HashSet<>(); JSONArray validated = new JSONArray(); ArrayList<JSONObject> sorted = new ArrayList<>();
        for (int i = 0; i < incoming.length(); i++) {
            JSONObject item = incoming.getJSONObject(i), extra = item.optJSONObject("extra");
            int id = item.getInt("id"); long at = item.getLong("atMs");
            if (id < 41000 || id >= 50000 || !ids.add(id) || extra == null || !uid.equals(extra.optString("ownerUid")) || !"class".equals(extra.optString("type")) || at > now + 211 * DAY) throw new IllegalArgumentException("后台课程条目无效");
            LocalNotification parsed = LocalNotification.buildNotificationFromJSObject(new JSObject(item.toString()));
            if (parsed.getSchedule() == null || parsed.getSchedule().getAt() == null || parsed.getSchedule().getAt().getTime() != at || item.optString("title").isEmpty() || item.optString("title").length() > 160 || item.optString("body").length() > 600) throw new IllegalArgumentException("后台课程时间或内容无效");
            if (at > now && !CourseReminderPolicy.isExpired(item, now)) sorted.add(item);
        }
        sorted.sort(Comparator.comparingLong(item -> item.optLong("atMs")));
        for (JSONObject item : sorted) validated.put(item);
        // Commit the recoverable source before touching any prior active alarm or refresh timer.
        if (!prefs(context).edit().putString("ownerUid", uid).putString("source", validated.toString()).putBoolean("pausedAfterBoot", false).putString("lastError", "").commit()) throw new IllegalStateException("后台课程计划保存失败");
        replenish(context); return state(context);
    }
    static synchronized JSObject clear(Context context, String expectedOwner) {
        String uid = owner(context);
        if (expectedOwner != null && !expectedOwner.equals(uid)) return state(context);
        cancelRefresh(context);
        if (!prefs(context).edit().clear().commit()) throw new IllegalStateException("后台课程计划清理失败");
        return state(context);
    }
    private static void cancelNotificationTimer(Context context, int id) {
        // Match the installed local-notifications plugin's broadcast identity without
        // depending on its private cancellation method or creating a new alarm.
        Intent intent = new Intent(context, TimedNotificationPublisher.class);
        int flags = PendingIntent.FLAG_NO_CREATE | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent action = PendingIntent.getBroadcast(context, id, intent, flags);
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (action != null) { if (alarms != null) alarms.cancel(action); action.cancel(); }
    }
    private static void preparationBlocked(Context context, String uid, String message) {
        // An unavailable permission/channel must not destroy a usable previous window.
        if (uid.equals(ReminderOverlayStore.owner(context))) ReminderOverlayStore.clear(context, uid, true);
        error(context, message);
        try { armRefresh(context); } catch (RuntimeException ignored) {}
    }
    private static boolean ownClass(JSONObject item, String uid) {
        JSONObject extra = item == null ? null : item.optJSONObject("extra");
        return extra != null && uid.equals(extra.optString("ownerUid")) && "class".equals(extra.optString("type"));
    }
    private static boolean sameJson(Object left, Object right) {
        if (left == right) return true;
        if (left == null || left == JSONObject.NULL) return right == null || right == JSONObject.NULL;
        if (right == null || right == JSONObject.NULL) return false;
        if (left instanceof JSONObject && right instanceof JSONObject) {
            JSONObject a = (JSONObject) left, b = (JSONObject) right;
            if (a.length() != b.length()) return false;
            Iterator<String> keys = a.keys();
            while (keys.hasNext()) { String key = keys.next(); if (!b.has(key) || !sameJson(a.opt(key), b.opt(key))) return false; }
            return true;
        }
        if (left instanceof JSONArray && right instanceof JSONArray) {
            JSONArray a = (JSONArray) left, b = (JSONArray) right;
            if (a.length() != b.length()) return false;
            for (int i = 0; i < a.length(); i++) if (!sameJson(a.opt(i), b.opt(i))) return false;
            return true;
        }
        if (left instanceof Number && right instanceof Number) return Double.compare(((Number) left).doubleValue(), ((Number) right).doubleValue()) == 0;
        return left.equals(right);
    }
    static synchronized void pauseAfterBoot(Context context) { cancelRefresh(context); prefs(context).edit().putBoolean("pausedAfterBoot", true).commit(); }
    static synchronized void resume(Context context) { prefs(context).edit().putBoolean("pausedAfterBoot", false).commit(); recover(context); }
    /** Saved plugin records do not prove an AlarmManager operation survived recovery. */
    static synchronized void recover(Context context) {
        String uid = owner(context);
        if (uid.isEmpty() || !uid.equals(ReminderBootStore.owner(context))) return;
        // Keep this marker until the whole rebuild succeeds, including a later daily retry.
        if (!prefs(context).edit().putBoolean("rearmRequired", true).commit()) {
            error(context, "无法保存课程闹钟恢复状态，请打开 App 检查");
            return;
        }
        replenish(context);
    }
    static synchronized void replenish(Context context) {
        String uid = owner(context); long now = System.currentTimeMillis();
        if (uid.isEmpty() || !uid.equals(ReminderBootStore.owner(context)) || prefs(context).getBoolean("pausedAfterBoot", false)) return;
        if (Build.VERSION.SDK_INT >= 24) {
            UserManager user = context.getSystemService(UserManager.class);
            if (user != null && !user.isUserUnlocked()) { error(context, "手机尚未解锁，课程计划已保存，解锁后请刷新提醒"); return; }
        }
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) { preparationBlocked(context, uid, "通知权限已关闭，新课程计划已保存；旧提醒未清除，开启后请打开 App 刷新"); return; }
        JSONArray future = new JSONArray(), overlay = new JSONArray();
        ArrayList<LocalNotification> add = new ArrayList<>();
        Map<Integer, JSONObject> previous = new LinkedHashMap<>();
        Set<Integer> desired = new HashSet<>();
        NotificationStorage storage = new NotificationStorage(context);
        android.app.NotificationManager system = (android.app.NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        boolean rearmRequired = prefs(context).getBoolean("rearmRequired", false), attempted = false;
        try {
            // A corrupt source is a failure to recover, never an intentional empty replacement.
            JSONArray entries = new JSONArray(prefs(context).getString("source", "[]"));
            // Finish validation and preflight for the whole desired window before scheduling or cancelling.
            for (int i = 0; i < entries.length(); i++) {
                JSONObject item = entries.getJSONObject(i); long at = item.getLong("atMs");
                if (!ownClass(item, uid)) throw new IllegalStateException("课程计划账号已变化");
                if (at <= now || CourseReminderPolicy.isExpired(item, now)) continue;
                future.put(item);
                if (at > now + 7 * DAY || desired.size() >= LIMIT) continue;
                if (Build.VERSION.SDK_INT >= 26 && system != null) {
                    android.app.NotificationChannel channel = system.getNotificationChannel(item.optString("channelId"));
                    if (channel == null || channel.getImportance() == 0) { preparationBlocked(context, uid, "上课通知渠道不可用，新计划已保存；旧提醒未清除，请检查渠道后刷新"); return; }
                }
                LocalNotification parsed = LocalNotification.buildNotificationFromJSObject(new JSObject(item.toString()));
                JSONObject saved = storage.getSavedNotificationAsJSObject(String.valueOf(parsed.getId()));
                if (saved != null && !ownClass(saved, uid)) throw new IllegalStateException("课程提醒编号与其他账号或提醒冲突");
                if (rearmRequired || saved == null || !sameJson(item, saved)) {
                    add.add(parsed);
                    if (saved != null) previous.put(parsed.getId(), new JSONObject(saved.toString()));
                }
                desired.add(parsed.getId());
                JSONObject card = new JSONObject(); card.put("id", parsed.getId()); card.put("at", at); card.put("title", item.optString("title")); card.put("body", item.optString("body")); card.put("route", "/schedule"); card.put("expiresAt", CourseReminderPolicy.expiresAt(item)); overlay.put(card);
            }
            if (!uid.equals(ReminderBootStore.owner(context))) throw new IllegalStateException("课程计划账号已变化");
            if (!add.isEmpty()) {
                attempted = true;
                LocalNotificationManager manager = new LocalNotificationManager(storage, null, context, CapConfig.loadDefault(context));
                JSONArray applied = manager.schedule(null, add);
                if (applied == null || applied.length() != add.size()) throw new IllegalStateException("系统未接收完整补排计划");
                if (!uid.equals(ReminderBootStore.owner(context))) throw new IllegalStateException("课程计划账号已变化");
                storage.appendNotifications(add);
            }
            if (!prefs(context).edit().putString("source", future.toString()).putBoolean("rearmRequired", false).putString("lastError", "").commit()) throw new IllegalStateException("后台课程计划更新失败");
        } catch (Exception failure) {
            boolean rollbackFailed = false;
            if (attempted && uid.equals(ReminderBootStore.owner(context))) {
                ArrayList<LocalNotification> restore = new ArrayList<>();
                for (LocalNotification item : add) {
                    JSONObject saved = storage.getSavedNotificationAsJSObject(String.valueOf(item.getId()));
                    // Never cancel or overwrite a record that now belongs to a different account/type.
                    if (saved != null && !ownClass(saved, uid)) { rollbackFailed = true; continue; }
                    JSONObject old = previous.get(item.getId());
                    if (old != null) {
                        try { restore.add(LocalNotification.buildNotificationFromJSObject(new JSObject(old.toString()))); }
                        catch (Exception invalid) { rollbackFailed = true; }
                    } else {
                        try { cancelNotificationTimer(context, item.getId()); storage.deleteNotification(String.valueOf(item.getId())); }
                        catch (RuntimeException cancelFailed) { rollbackFailed = true; }
                    }
                }
                if (!restore.isEmpty()) {
                    try {
                        JSONArray restored = new LocalNotificationManager(storage, null, context, CapConfig.loadDefault(context)).schedule(null, restore);
                        if (restored == null || restored.length() != restore.size()) rollbackFailed = true;
                    } catch (Exception restoreFailed) { rollbackFailed = true; }
                    // Keep the last confirmed metadata even when Android cannot restore its timer now.
                    storage.appendNotifications(restore);
                }
            }
            prefs(context).edit().putBoolean("rearmRequired", true).commit();
            error(context, rollbackFailed ? "课程刷新失败，部分旧闹钟恢复未完成；新计划已保存，请打开 App 重试" : "课程刷新失败，旧提醒已保留；新计划已保存，请打开 App 重试");
            try { armRefresh(context); } catch (RuntimeException ignored) {}
            return;
        }
        // Only a completely accepted new window may retire obsolete alarms for this owner/type.
        String followupError = "";
        for (String id : storage.getSavedNotificationIds()) {
            JSONObject saved = storage.getSavedNotificationAsJSObject(id);
            if (!ownClass(saved, uid)) continue;
            try {
                if (!desired.contains(Integer.parseInt(id))) { cancelNotificationTimer(context, Integer.parseInt(id)); storage.deleteNotification(id); }
            } catch (RuntimeException failure) { followupError = "新课程提醒已安排，部分旧提醒清理失败，请打开 App 重试"; }
        }
        if (!ReminderOverlayStore.owner(context).isEmpty() && !uid.equals(ReminderOverlayStore.owner(context))) ReminderOverlayStore.clear(context, ReminderOverlayStore.owner(context), false);
        if (ReminderOverlayStore.enabled(context)) try { ReminderOverlayStore.sync(context, uid, overlay); } catch (Exception failure) { followupError = "系统通知已补排，桌面镜像更新失败，请打开 App 检查"; }
        try { if (future.length() > 0) armRefresh(context); else cancelRefresh(context); }
        catch (RuntimeException failure) { followupError = "本次课程提醒已安排，下次自动补排时间保存失败，请打开 App 检查"; }
        if (!followupError.isEmpty()) error(context, followupError);
    }
    private static PendingIntent pending(Context context, int flags) {
        Intent intent = new Intent(context, ReminderPlanReceiver.class).setAction(ACTION).setData(Uri.parse("ohhu-course-plan://refresh"));
        return PendingIntent.getBroadcast(context, 70801, intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }
    private static void cancelRefresh(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE); PendingIntent previous = pending(context, PendingIntent.FLAG_NO_CREATE);
        if (previous != null) { if (alarms != null) alarms.cancel(previous); previous.cancel(); }
        prefs(context).edit().remove("nextRefreshAt").commit();
    }
    private static void armRefresh(Context context) {
        Calendar next = Calendar.getInstance(); next.add(Calendar.DAY_OF_YEAR, 1); next.set(Calendar.HOUR_OF_DAY, 1); next.set(Calendar.MINUTE, 5); next.set(Calendar.SECOND, 0); next.set(Calendar.MILLISECOND, 0);
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) throw new IllegalStateException("系统闹钟服务不可用");
        long at = next.getTimeInMillis(); PendingIntent action = pending(context, PendingIntent.FLAG_UPDATE_CURRENT);
        if (Build.VERSION.SDK_INT >= 31 && !alarms.canScheduleExactAlarms()) alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, action);
        else alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, action);
        if (!prefs(context).edit().putLong("nextRefreshAt", at).commit()) throw new IllegalStateException("无法保存下次后台补排时间");
    }
}
