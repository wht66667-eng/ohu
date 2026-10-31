package com.sunshinecampus.app;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/** Native ownership survives WebView/Activity loss; it never cancels somebody else's DND rule. */
final class FocusSessionGuard {
    private static final String STORE = "focus.native.session.v1";
    private static final int REQUEST = 42071;

    private static SharedPreferences store(Context ctx) {
        return ctx.getSharedPreferences(STORE, Context.MODE_PRIVATE);
    }

    static synchronized boolean begin(Context ctx, String id, long endsAt, boolean wantDnd) {
        if (id == null || id.isEmpty() || endsAt <= System.currentTimeMillis()) return false;
        SharedPreferences p = store(ctx);
        if (!id.equals(p.getString("id", ""))) finish(ctx);
        if (!p.edit().putString("id", id).putLong("endsAt", endsAt)
            .putBoolean("wantDnd", wantDnd).putBoolean("cleanupPending", false).putBoolean("releasedAtEnd", false).commit()) return false;
        if (!wantDnd) releaseDnd(ctx, p);
        schedule(ctx, id, endsAt);
        return applyDnd(ctx, p);
    }

    static synchronized void sync(Context ctx, String id, long endsAt) {
        if (id == null || id.isEmpty()) return;
        SharedPreferences p = store(ctx);
        String storedId = p.getString("id", "");
        if (!storedId.isEmpty() && !storedId.equals(id)) return; // Ignore a late command from an old session.
        if (storedId.isEmpty()) p.edit().putString("id", id).putBoolean("wantDnd", false).commit();
        cancelAlarm(ctx);
        p.edit().putLong("endsAt", endsAt).putBoolean("releasedAtEnd", false).commit();
        if (endsAt <= 0) {
            releaseDnd(ctx, p); // Pause releases the app's rule, preserving the requested mode for resume.
            return;
        }
        if (endsAt <= System.currentTimeMillis() + 1000) {
            expire(ctx, id, endsAt);
            return;
        }
        schedule(ctx, id, endsAt);
        applyDnd(ctx, p);
    }

    static synchronized void finish(Context ctx) {
        cancelAlarm(ctx);
        SharedPreferences p = store(ctx);
        releaseDnd(ctx, p);
        if (p.getBoolean("ownedDnd", false)) {
            p.edit().putBoolean("wantDnd", false).putBoolean("cleanupPending", true).putLong("endsAt", 0).commit();
        } else p.edit().clear().commit();
    }

    static synchronized void expire(Context ctx, String id, long endsAt) {
        SharedPreferences p = store(ctx);
        if (!id.equals(p.getString("id", "")) || endsAt != p.getLong("endsAt", 0)) return;
        releaseDnd(ctx, p);
        p.edit().putBoolean("releasedAtEnd", true).commit();
        cancelAlarm(ctx);
    }

    static synchronized void reconcile(Context ctx) {
        SharedPreferences p = store(ctx);
        if (p.getBoolean("cleanupPending", false)) {
            releaseDnd(ctx, p);
            if (!p.getBoolean("ownedDnd", false)) p.edit().clear().commit();
            return;
        }
        String id = p.getString("id", "");
        long endsAt = p.getLong("endsAt", 0);
        if (p.getBoolean("releasedAtEnd", false)) { releaseDnd(ctx, p); return; }
        if (id.isEmpty() || endsAt <= 0) return;
        if (endsAt <= System.currentTimeMillis() + 1000) expire(ctx, id, endsAt);
        else schedule(ctx, id, endsAt);
    }

    private static boolean applyDnd(Context ctx, SharedPreferences p) {
        if (!p.getBoolean("wantDnd", false) || p.getBoolean("releasedAtEnd", false)) return false;
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (Build.VERSION.SDK_INT >= 31 && (am == null || !am.canScheduleExactAlarms())) return false;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || !nm.isNotificationPolicyAccessGranted()) return false;
        if (p.getBoolean("ownedDnd", false)) return true;
        try {
            int previous = nm.getCurrentInterruptionFilter();
            // Persist BEFORE applying: a process loss between calls must still leave a cleanup record.
            if (!p.edit().putInt("previousFilter", previous).putBoolean("ownedDnd", true).commit()) return false;
            nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_NONE);
            return true;
        } catch (RuntimeException ignored) {
            p.edit().putBoolean("ownedDnd", false).commit();
            return false;
        }
    }

    private static void releaseDnd(Context ctx, SharedPreferences p) {
        if (!p.getBoolean("ownedDnd", false)) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || !nm.isNotificationPolicyAccessGranted()) return;
        try {
            if (Build.VERSION.SDK_INT >= 35 && ctx.getApplicationInfo().targetSdkVersion >= 35) {
                // API 35: ALL deactivates THIS APP's implicit AutomaticZenRule; it does not change global DND.
                nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL);
            } else if (nm.getCurrentInterruptionFilter() == NotificationManager.INTERRUPTION_FILTER_NONE) {
                // Older Android: preserve any different mode the user selected after focus started.
                int previous = p.getInt("previousFilter", NotificationManager.INTERRUPTION_FILTER_ALL);
                nm.setInterruptionFilter(previous > 0 ? previous : NotificationManager.INTERRUPTION_FILTER_ALL);
            }
            p.edit().putBoolean("ownedDnd", false).commit();
        } catch (RuntimeException ignored) {
            // Keep ownership so a later resume/permission restoration can retry cleanup.
        }
    }

    private static PendingIntent alarmIntent(Context ctx, String id, long endsAt) {
        Intent intent = new Intent(ctx, FocusSessionEndReceiver.class);
        intent.setAction("com.sunshinecampus.FOCUS_END");
        intent.putExtra("sessionId", id);
        intent.putExtra("endsAt", endsAt);
        return PendingIntent.getBroadcast(ctx, REQUEST, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void cancelAlarm(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(alarmIntent(ctx, "", 0));
    }

    static void cancelDeadlineAlarm(Context ctx) { cancelAlarm(ctx); }

    private static void schedule(Context ctx, String id, long endsAt) {
        SharedPreferences preferences = store(ctx);
        if (!preferences.getBoolean("wantDnd", false) && !preferences.getBoolean("ownedDnd", false)) { cancelAlarm(ctx); return; }
        if (FocusNotificationScheduler.hasCompletion(ctx, id, endsAt)) { cancelAlarm(ctx); return; }
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long at = Math.max(System.currentTimeMillis(), endsAt - 1000);
        PendingIntent pending = alarmIntent(ctx, id, endsAt);
        // Release just before the independently scheduled completion notification.
        try {
            if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            }
        } catch (SecurityException ignored) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        }
    }
}
