package com.sunshinecampus.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.Calendar;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;

/** 原生侧持久化活跃日，供后台变脸（不依赖 WebView）。 */
public final class IconMoodPrefs {
    private static final String PREF = "sc_icon_mood_v1";
    private static final String K_LAST_ACTIVE = "last_active_date";
    private static final String K_LAST_CHECKIN = "last_checkin_date";
    private static final String K_STREAK = "streak_current";
    private static final String K_ICON = "icon_state";
    private static final String K_ENABLED = "enabled";
    private static final String K_ERROR = "last_error";

    private IconMoodPrefs() {}

    private static SharedPreferences sp(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    public static void save(
        Context ctx,
        String lastActiveDate,
        String lastCheckinDate,
        int streakCurrent,
        String iconState
    ) {
        sp(ctx).edit()
            .putString(K_LAST_ACTIVE, lastActiveDate == null ? "" : lastActiveDate)
            .putString(K_LAST_CHECKIN, lastCheckinDate == null ? "" : lastCheckinDate)
            .putInt(K_STREAK, streakCurrent)
            .putString(K_ICON, iconState == null ? "default" : iconState)
            .apply();
    }

    public static String lastActiveDate(Context ctx) {
        return sp(ctx).getString(K_LAST_ACTIVE, "");
    }

    public static String lastCheckinDate(Context ctx) {
        return sp(ctx).getString(K_LAST_CHECKIN, "");
    }

    public static int streakCurrent(Context ctx) {
        return sp(ctx).getInt(K_STREAK, 0);
    }

    public static String iconState(Context ctx) {
        return sp(ctx).getString(K_ICON, "default");
    }

    /** 仅保留用户显式开启的记录；首次安装和未选择的旧安装默认关闭。 */
    public static boolean isEnabled(Context ctx) {
        return sp(ctx).getBoolean(K_ENABLED, false);
    }

    public static void setEnabled(Context ctx, boolean enabled) {
        sp(ctx).edit().putBoolean(K_ENABLED, enabled).apply();
    }

    public static String lastError(Context ctx) {
        return sp(ctx).getString(K_ERROR, "");
    }

    public static void setError(Context ctx, String error) {
        sp(ctx).edit().putString(K_ERROR, error == null ? "" : error).apply();
    }

    public static String today() {
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("Asia/Shanghai"));
        return String.format(
            Locale.US,
            "%04d-%02d-%02d",
            c.get(Calendar.YEAR),
            c.get(Calendar.MONTH) + 1,
            c.get(Calendar.DAY_OF_MONTH)
        );
    }

    public static int daysBetween(String fromYmd, String toYmd) {
        if (fromYmd == null || fromYmd.length() < 10) return 999;
        if (toYmd == null || toYmd.length() < 10) return 999;
        try {
            String[] a = fromYmd.substring(0, 10).split("-");
            String[] b = toYmd.substring(0, 10).split("-");
            Calendar ca = Calendar.getInstance(TimeZone.getTimeZone("Asia/Shanghai"));
            ca.set(Integer.parseInt(a[0]), Integer.parseInt(a[1]) - 1, Integer.parseInt(a[2]), 0, 0, 0);
            ca.set(Calendar.MILLISECOND, 0);
            Calendar cb = Calendar.getInstance(TimeZone.getTimeZone("Asia/Shanghai"));
            cb.set(Integer.parseInt(b[0]), Integer.parseInt(b[1]) - 1, Integer.parseInt(b[2]), 0, 0, 0);
            cb.set(Calendar.MILLISECOND, 0);
            long ms = cb.getTimeInMillis() - ca.getTimeInMillis();
            return (int) Math.max(0, TimeUnit.MILLISECONDS.toDays(ms));
        } catch (Throwable t) {
            return 999;
        }
    }
}
