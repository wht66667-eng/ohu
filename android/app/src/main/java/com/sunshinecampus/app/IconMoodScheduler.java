package com.sunshinecampus.app;

import android.content.Context;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import java.util.concurrent.TimeUnit;

public final class IconMoodScheduler {
    private IconMoodScheduler() {}

    /** 约每 12 小时检查一次离开天数（多邻国会在用户未打开时换图标） */
    public static boolean ensure(Context ctx) {
        if (!"user".equals(BuildConfig.SC_SHELL) || !IconMoodPrefs.isEnabled(ctx)) {
            return cancel(ctx);
        }
        try {
            PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(
                IconMoodWorker.class,
                12,
                TimeUnit.HOURS
            ).build();
            WorkManager.getInstance(ctx.getApplicationContext()).enqueueUniquePeriodicWork(
                IconMoodWorker.UNIQUE,
                ExistingPeriodicWorkPolicy.KEEP,
                req
            );
            return true;
        } catch (Throwable error) {
            IconMoodPrefs.setError(ctx, "系统未能安排图标变脸任务，请稍后重试");
            return false;
        }
    }

    /** 用户关闭变脸后：取消周期任务 */
    public static boolean cancel(Context ctx) {
        try {
            WorkManager.getInstance(ctx.getApplicationContext())
                .cancelUniqueWork(IconMoodWorker.UNIQUE);
            return true;
        } catch (Throwable error) {
            IconMoodPrefs.setError(ctx, "系统未能取消图标变脸任务，请稍后重试");
            return false;
        }
    }

    public static void runNow(Context ctx) {
        if (!"user".equals(BuildConfig.SC_SHELL) || !IconMoodPrefs.isEnabled(ctx)) {
            cancel(ctx);
            LauncherIconSwitcher.apply(ctx, "default");
            return;
        }
        try {
            androidx.work.OneTimeWorkRequest once =
                new androidx.work.OneTimeWorkRequest.Builder(IconMoodWorker.class).build();
            WorkManager.getInstance(ctx.getApplicationContext()).enqueue(once);
        } catch (Throwable error) {
            IconMoodPrefs.setError(ctx, "系统未能刷新桌面图标，请稍后重试");
        }
    }
}
