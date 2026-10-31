package com.sunshinecampus.app;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/**
 * 后台按「多久没来」切换桌面图标——多邻国核心体验：不用打开 App 也会变脸。
 */
public class IconMoodWorker extends Worker {
    public static final String UNIQUE = "sc_icon_mood_daily";

    public IconMoodWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        /* 工作端（管理/骑手/商家/档口）不做多邻国缺勤变脸，只换默认满幅图标 */
        try {
            if (!"user".equals(BuildConfig.SC_SHELL)) {
                return Result.success();
            }
        } catch (Throwable ignored) {
            /* ignore */
        }
        /* 未明确开启时取消旧任务，并恢复旧安装可能留下的变脸图标。 */
        if (!IconMoodPrefs.isEnabled(ctx)) {
            IconMoodScheduler.cancel(ctx);
            return LauncherIconSwitcher.apply(ctx, "default") ? Result.success() : Result.retry();
        }
        String lastActive = IconMoodPrefs.lastActiveDate(ctx);
        String lastCheckin = IconMoodPrefs.lastCheckinDate(ctx);
        int streak = IconMoodPrefs.streakCurrent(ctx);
        // 尚无活跃记录时保持默认，不吓人
        if (lastActive == null || lastActive.isEmpty()) {
            return Result.success();
        }
        String next = LauncherIconSwitcher.resolve(lastActive, lastCheckin, streak);
        String prev = IconMoodPrefs.iconState(ctx);
        if (!next.equals(prev)) {
            if (!LauncherIconSwitcher.apply(ctx, next)) return Result.retry();
            IconMoodPrefs.save(ctx, lastActive, lastCheckin, streak, next);
        } else {
            // 仍强制应用一次，防止别名被系统重置
            if (!LauncherIconSwitcher.apply(ctx, next)) return Result.retry();
        }
        return Result.success();
    }
}
