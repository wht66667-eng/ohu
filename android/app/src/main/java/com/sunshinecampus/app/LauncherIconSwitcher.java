package com.sunshinecampus.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;

/**
 * 多邻国式：只启用一个 activity-alias，桌面图标立即变脸。
 */
public final class LauncherIconSwitcher {

    /**
     * 前台禁止切换桌面别名：部分厂商 ROM 会在「启动别名被 disable」时
     * 直接杀掉刚启动的 Activity（首次登录变脸 → 立即闪退一次的根因）。
     * 前台只记录待切换状态，退到后台（onPause）时真正落位。
     */
    private static volatile boolean appInForeground = false;
    private static volatile String pendingState = null;

    private LauncherIconSwitcher() {
    }

    public static void setAppInForeground(boolean v) {
        appInForeground = v;
    }

    public static boolean isPending() { return pendingState != null; }

    public static boolean isKnownState(String name) {
        return "default".equals(name) || !"LauncherDefault".equals(aliasFor(name));
    }

    /** 退到后台时应用挂起的图标状态（由 MainActivity.onPause 调用） */
    public static void onAppBackground(Context ctx) {
        String p = pendingState;
        if (p != null) {
            pendingState = null;
            apply(ctx, p);
        }
    }

    public static final String[] ALIASES = {
        "LauncherDefault",
        "LauncherStreak1",
        "LauncherStreak3",
        "LauncherStreak7",
        "LauncherStreak14",
        "LauncherAway2",
        "LauncherAway5",
        "LauncherAway8",
        "LauncherAway12",
        "LauncherAway15",
        "LauncherAway20",
        "LauncherAway25",
        "LauncherAway30"
    };

    public static String aliasFor(String name) {
        if (name == null) return "LauncherDefault";
        switch (name) {
            case "streak_1": return "LauncherStreak1";
            case "streak_3": return "LauncherStreak3";
            case "streak_7": return "LauncherStreak7";
            case "streak_14": return "LauncherStreak14";
            case "away_2": return "LauncherAway2";
            case "away_5": return "LauncherAway5";
            case "away_8": return "LauncherAway8";
            case "away_12": return "LauncherAway12";
            case "away_15": return "LauncherAway15";
            case "away_20": return "LauncherAway20";
            case "away_25": return "LauncherAway25";
            case "away_30": return "LauncherAway30";
            default: return "LauncherDefault";
        }
    }

    public static boolean apply(Context context, String iconState) {
        if (!isKnownState(iconState)) {
            IconMoodPrefs.setError(context, "此版本不支持该桌面图标");
            return false;
        }
        String enable = aliasFor(iconState);
        PackageManager pm = context.getPackageManager();
        String pkg = context.getPackageName();
        /* 前台只挂起待切换状态，退后台再真正切换（防厂商 ROM 杀 Activity 首登闪退） */
        if (appInForeground) {
            pendingState = iconState;
            IconMoodPrefs.setError(context, "");
            return true;
        }
        try {
            // 先启用目标，避免中途失败时所有桌面入口都被关闭。
            pm.setComponentEnabledSetting(new ComponentName(pkg, pkg + "." + enable),
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
            for (String a : ALIASES) {
                if (a.equals(enable)) continue;
                ComponentName cn = new ComponentName(pkg, pkg + "." + a);
                int state = a.equals(enable)
                    ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                    : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
                pm.setComponentEnabledSetting(cn, state, PackageManager.DONT_KILL_APP);
            }
            IconMoodPrefs.setError(context, "");
            return true;
        } catch (Throwable error) {
            IconMoodPrefs.setError(context, "系统未能切换桌面图标，请稍后重试");
            return false;
        }
    }

    /** 按离开天数 / 连击解析多邻国式图标态 */
    public static String resolve(String lastActiveDate, String lastCheckinDate, int streakCurrent) {
        if (lastActiveDate == null || lastActiveDate.isEmpty()) return "default";
        String today = IconMoodPrefs.today();
        boolean checkedInToday = today.equals(lastCheckinDate);
        int away = checkedInToday ? 0 : IconMoodPrefs.daysBetween(lastActiveDate, today);
        if (checkedInToday || away == 0) {
            int streak = Math.max(1, streakCurrent);
            // 旧 alias 名保留兼容安装；此状态现对应连续登录 30 天。
            if (streak >= 30) return "streak_14";
            if (streak >= 7) return "streak_7";
            if (streak >= 3) return "streak_3";
            return "streak_1";
        }
        if (away >= 30) return "away_30";
        if (away >= 15) return "away_15";
        if (away >= 7) return "away_12";
        if (away >= 3) return "away_8";
        if (away >= 2) return "away_5";
        return "away_2";
    }
}
