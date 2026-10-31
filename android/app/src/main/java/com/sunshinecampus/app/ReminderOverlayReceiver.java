package com.sunshinecampus.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import org.json.JSONObject;

/** Explicit private alarms and system restore broadcasts only. No service or activity is auto-started. */
public class ReminderOverlayReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (AdminShellReminderCleanup.enforce(context)) return;
        if (intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action) || Intent.ACTION_TIME_CHANGED.equals(action) || Intent.ACTION_TIMEZONE_CHANGED.equals(action) || "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED".equals(action)) {
            if ((Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) && !ReminderBootStore.allows(context, ReminderOverlayStore.owner(context))) return;
            ReminderOverlayStore.restore(context); return;
        }
        if (!ReminderOverlayStore.ACTION.equals(action)) return;
        String owner = intent.getStringExtra("ownerUid"); if (owner == null || owner.isEmpty()) return;
        JSONObject item = ReminderOverlayStore.consume(context, intent.getIntExtra("id", 0), owner, intent.getLongExtra("at", 0));
        if (item != null) ReminderOverlayWindow.show(context.getApplicationContext(), item.optString("title"), item.optString("body"), item.optString("route", "/schedule"), owner, false);
    }
}
