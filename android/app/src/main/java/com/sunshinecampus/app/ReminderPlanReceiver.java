package com.sunshinecampus.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.app.AlarmManager;
import android.os.Build;

public class ReminderPlanReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (AdminShellReminderCleanup.enforce(context)) return;
        if (intent == null) return;
        String action = intent.getAction();
        boolean restore = Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action);
        if (restore && !ReminderBootStore.allows(context, ReminderPlanStore.owner(context))) { ReminderPlanStore.pauseAfterBoot(context); return; }
        if (restore) { ReminderPlanStore.resume(context); return; }
        if ("android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED".equals(action)) {
            AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            // A grant broadcast can race a second revocation. Never treat it as permission by itself.
            if (alarms != null && (Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms())) ReminderPlanStore.recover(context);
            return;
        }
        if (ReminderPlanStore.ACTION.equals(action) || Intent.ACTION_TIME_CHANGED.equals(action) || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) ReminderPlanStore.replenish(context);
    }
}
