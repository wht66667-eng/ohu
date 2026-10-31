package com.sunshinecampus.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 开机后重新挂上变脸任务，并立刻按离开天数刷新一次桌面图标。 */
public class IconMoodBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
            || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
            || Intent.ACTION_TIME_CHANGED.equals(action)
            || Intent.ACTION_TIMEZONE_CHANGED.equals(action)
            || Intent.ACTION_DATE_CHANGED.equals(action)) {
            /* 用户关闭变脸后，开机也不再重新挂任务 */
            if (!"user".equals(BuildConfig.SC_SHELL) || !IconMoodPrefs.isEnabled(context)) {
                IconMoodScheduler.cancel(context);
                LauncherIconSwitcher.apply(context, "default");
                return;
            }
            IconMoodScheduler.ensure(context);
            IconMoodScheduler.runNow(context);
        }
    }
}
