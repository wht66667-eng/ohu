package com.sunshinecampus.app;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import com.capacitorjs.plugins.localnotifications.NotificationStorage;
import com.capacitorjs.plugins.localnotifications.StudentReminderPolicy;
import com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher;
import java.util.ArrayList;
import org.json.JSONObject;

/** Upgrade fence for old management APKs which previously shared the student runtime. */
final class AdminShellReminderCleanup {
    static boolean isManagement() { return "admin".equals(BuildConfig.SC_SHELL); }

    /** Returning true always blocks a student recovery entry, even if one cleanup step must be retried. */
    static synchronized boolean enforce(Context context) {
        if (!isManagement()) return false;
        try {
            context.getSharedPreferences("reminder.boot.v1", Context.MODE_PRIVATE).edit()
                .remove("ownerUid").putBoolean("enabled", false).commit();
            context.getSharedPreferences(KeepAliveBootReceiver.PREFS, Context.MODE_PRIVATE).edit()
                .putBoolean(KeepAliveBootReceiver.KEY_WANTED, false).commit();
        } catch (RuntimeException failure) { report(failure); }
        try { ReminderPlanStore.clear(context, null); } catch (RuntimeException failure) { report(failure); }
        try { ReminderOverlayStore.clear(context, null, false); } catch (RuntimeException failure) { report(failure); }
        try { context.stopService(new Intent(context, KeepAliveService.class)); } catch (RuntimeException failure) { report(failure); }
        KeepAliveService.running = false;
        try { KeepAliveService.cancelStandalone(context); } catch (RuntimeException failure) { report(failure); }
        try {
            NotificationStorage storage = new NotificationStorage(context);
            for (String rawId : new ArrayList<>(storage.getSavedNotificationIds())) {
                int id;
                try { id = Integer.parseInt(rawId); } catch (NumberFormatException invalidId) { continue; }
                JSONObject source = storage.getSavedNotificationAsJSObject(rawId);
                if (!StudentReminderPolicy.isStudent(source, id)) continue;
                cancelTimer(context, id);
                storage.deleteNotification(rawId);
                NotificationManager notifications = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (notifications != null) notifications.cancel(id);
            }
            NotificationManager notifications = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (notifications != null) {
                // Consumed notices no longer have storage rows. Reserved personal IDs still identify them.
                if (Build.VERSION.SDK_INT >= 23) for (StatusBarNotification active : notifications.getActiveNotifications()) {
                    if (Build.VERSION.SDK_INT >= 26 && "admin-work-v1".equals(active.getNotification().getChannelId())) continue;
                    if (StudentReminderPolicy.isStudent(null, active.getId())) notifications.cancel(active.getTag(), active.getId());
                }
                notifications.cancel(70501);
            }
        } catch (RuntimeException failure) { report(failure); }
        return true;
    }

    private static void cancelTimer(Context context, int id) {
        Intent intent = new Intent(context, TimedNotificationPublisher.class);
        int flags = PendingIntent.FLAG_NO_CREATE | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent timer = PendingIntent.getBroadcast(context, id, intent, flags);
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (timer != null) { if (alarms != null) alarms.cancel(timer); timer.cancel(); }
    }
    private static void report(RuntimeException failure) { Log.w("AdminReminderCleanup", "Legacy student reminder cleanup will retry", failure); }
}
