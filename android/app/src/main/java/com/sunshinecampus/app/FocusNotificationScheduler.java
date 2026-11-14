package com.sunshinecampus.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

/** One wakeup performs native DND cleanup AND the notification, avoiding two idle alarms at the deadline. */
final class FocusNotificationScheduler {
    static final int FOCUS_ID = 840000001;
    static final int BREAK_ID = 840000002;
    private static final String STORE = "focus.native.notifications.v1";
    static final String ACTION = "com.sunshinecampus.FOCUS_NOTIFICATION";

    private static SharedPreferences store(Context ctx) { return ctx.getSharedPreferences(STORE, Context.MODE_PRIVATE); }

    private static JSONArray plans(Context ctx) {
        try { return new JSONArray(store(ctx).getString("plans", "[]")); }
        catch (JSONException ignored) { return new JSONArray(); }
    }

    static boolean exact(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        return am != null && (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms());
    }

    static synchronized List<Integer> schedule(Context ctx, JSONArray notifications, String reminder) throws JSONException {
        if (!"sound".equals(reminder) && !"vibrate".equals(reminder)) throw new IllegalArgumentException("invalid reminder");
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED)
            throw new IllegalStateException("通知权限未允许");
        if (notifications.length() > 2) throw new IllegalArgumentException("at most one focus and one break reminder");
        JSONArray validated = new JSONArray();
        List<Integer> ids = new ArrayList<>();
        for (int index = 0; index < notifications.length(); index++) {
            JSONObject item = notifications.getJSONObject(index);
            int id = item.getInt("id");
            String phase = item.getString("phase");
            if ((id != FOCUS_ID && id != BREAK_ID) || ids.contains(id) ||
                (id == FOCUS_ID && !"focus".equals(phase)) || (id == BREAK_ID && !"break".equals(phase)) ||
                item.getString("sessionId").isEmpty() || item.getLong("at") <= System.currentTimeMillis())
                throw new IllegalArgumentException("invalid focus notification plan");
            JSONObject next = new JSONObject();
            next.put("id", id); next.put("at", item.getLong("at")); next.put("phase", phase);
            next.put("sessionId", item.getString("sessionId"));
            next.put("title", item.optString("title", "专注完成")); next.put("body", item.optString("body", "休息一下吧"));
            validated.put(next); ids.add(id);
        }
        cancel(ctx);
        if (!store(ctx).edit().putString("plans", validated.toString()).putString("reminder", reminder).commit())
            throw new IllegalStateException("无法保存系统提醒计划");
        for (int index = 0; index < validated.length(); index++) arm(ctx, validated.getJSONObject(index));
        // The focus notification owns the same deadline cleanup; cancel the separate guard alarm.
        for (int index = 0; index < validated.length(); index++) {
            if (validated.getJSONObject(index).getInt("id") == FOCUS_ID) FocusSessionGuard.cancelDeadlineAlarm(ctx);
        }
        return ids;
    }

    static boolean hasCompletion(Context ctx, String sessionId, long at) {
        JSONArray pending = plans(ctx);
        for (int index = 0; index < pending.length(); index++) {
            JSONObject item = pending.optJSONObject(index);
            if (item != null && item.optInt("id") == FOCUS_ID && sessionId.equals(item.optString("sessionId")) && at == item.optLong("at")) return true;
        }
        return false;
    }

    static synchronized void cancel(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        for (int id : new int[] { FOCUS_ID, BREAK_ID }) {
            if (am != null) am.cancel(pending(ctx, id, "", 0));
            if (nm != null) nm.cancel(id);
        }
        store(ctx).edit().clear().commit();
        // If notification scheduling is denied/failed, a focus-owned DND rule still needs a deadline.
        FocusSessionGuard.reconcile(ctx);
    }

    static synchronized void restore(Context ctx) {
        JSONArray previous = plans(ctx);
        JSONArray future = new JSONArray();
        for (int index = 0; index < previous.length(); index++) {
            JSONObject item = previous.optJSONObject(index);
            if (item == null || item.optLong("at") <= System.currentTimeMillis()) continue;
            future.put(item);
            arm(ctx, item);
        }
        // Old missed notifications are reconciled by the UI, not replayed as fresh alarms on boot.
        store(ctx).edit().putString("plans", future.toString()).commit();
    }

    static synchronized void deliver(Context ctx, int id, String sessionId, long at) {
        JSONArray previous = plans(ctx);
        JSONArray remaining = new JSONArray();
        JSONObject target = null;
        for (int index = 0; index < previous.length(); index++) {
            JSONObject item = previous.optJSONObject(index);
            if (item == null) continue;
            if (id == item.optInt("id") && at == item.optLong("at") && sessionId.equals(item.optString("sessionId"))) target = item;
            else remaining.put(item);
        }
        if (target == null) return; // Cancelled, replaced, or already delivered.
        if (id == FOCUS_ID) FocusSessionGuard.expire(ctx, sessionId, at);
        // Storage failure may suppress notification delivery, but must never leave focus DND enabled.
        if (!store(ctx).edit().putString("plans", remaining.toString()).commit()) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) return;
        String reminder = store(ctx).getString("reminder", "sound");
        String channel = "vibrate".equals(reminder) ? "sc-focus-vibrate-v3" : "sc-focus-sound-v3";
        Intent launch = new Intent(ctx, SecurityEntryActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        launch.putExtra("focusNotificationRoute", "/study/focus");
        PendingIntent open = PendingIntent.getActivity(ctx, id, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, channel) : new Notification.Builder(ctx);
        builder.setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle(target.optString("title"))
            .setContentText(target.optString("body")).setContentIntent(open).setAutoCancel(true)
            .setCategory(Notification.CATEGORY_ALARM).setShowWhen(true).setWhen(at);
        if (Build.VERSION.SDK_INT < 26) {
            builder.setPriority(Notification.PRIORITY_HIGH);
            builder.setDefaults(Notification.DEFAULT_VIBRATE | ("sound".equals(reminder) ? Notification.DEFAULT_SOUND : 0));
        }
        try { nm.notify(id, builder.build()); } catch (SecurityException ignored) { /* Permission can change during delivery. */ }
    }

    private static PendingIntent pending(Context ctx, int id, String sessionId, long at) {
        Intent intent = new Intent(ctx, FocusSessionEndReceiver.class);
        intent.setAction(ACTION);
        intent.putExtra("notificationId", id); intent.putExtra("sessionId", sessionId); intent.putExtra("at", at);
        return PendingIntent.getBroadcast(ctx, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void arm(Context ctx, JSONObject item) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) throw new IllegalStateException("alarm manager unavailable");
        PendingIntent pending = pending(ctx, item.optInt("id"), item.optString("sessionId"), item.optLong("at"));
        try {
            if (exact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.optLong("at"), pending);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.optLong("at"), pending);
        } catch (SecurityException ignored) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.optLong("at"), pending);
        }
    }
}
