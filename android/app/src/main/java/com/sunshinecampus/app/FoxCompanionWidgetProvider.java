package com.sunshinecampus.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 哦狐桌面陪伴：狐狸形象 + 时段问候 + 课程状态 + 连续陪伴天数。
 * 课程数据复用课表快照（ScheduleWidgetStore），活跃天数复用变脸记录（IconMoodPrefs），
 * 不新增 WebView 推送链路；课表快照更新时由 ScheduleWidgetStore.updateAll 一并刷新。
 */
public final class FoxCompanionWidgetProvider extends AppWidgetProvider {
    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) { update(context, manager, ids); }

    static void update(Context context, AppWidgetManager manager, int[] ids) {
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date());
        int now = Integer.parseInt(new SimpleDateFormat("HHmm", Locale.ROOT).format(new Date()));
        int streak = IconMoodPrefs.streakCurrent(context);
        String status = statusLine(context, today, now);
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_fox_companion);
            views.setTextViewText(R.id.widget_fox_greeting, greeting());
            views.setTextViewText(R.id.widget_fox_status, status);
            views.setTextViewText(R.id.widget_fox_streak, streak > 0 ? "已连续陪伴 " + streak + " 天" : "轻触打开哦狐打卡吧");
            views.setImageViewResource(R.id.widget_fox_image, streak >= 3 ? R.drawable.widget_fox_happy : R.drawable.widget_fox_idle);
            Intent intent = new Intent(context, MainActivity.class);
            intent.setAction("com.sunshinecampus.app.OPEN_FOX_COMPANION_WIDGET");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pending = PendingIntent.getActivity(context, id + 200000, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            views.setOnClickPendingIntent(R.id.widget_fox_root, pending);
            manager.updateAppWidget(id, views);
        }
    }

    private static String greeting() {
        int hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
        if (hour >= 5 && hour < 11) return "早上好！";
        if (hour >= 11 && hour < 14) return "中午好！";
        if (hour >= 14 && hour < 18) return "下午好！";
        if (hour >= 18 && hour < 23) return "晚上好！";
        return "夜深了，早点休息";
    }

    private static String statusLine(Context context, String today, int now) {
        JSONObject data = ScheduleWidgetStore.read(context);
        if (data == null || !today.equals(data.optString("date", ""))) return "打开哦狐同步课表";
        String state = data.optString("state", "unavailable");
        if ("off".equals(state)) return "今天休息，好好放松";
        if ("unavailable".equals(state)) return "打开哦狐同步课表";
        JSONArray classes = data.optJSONArray("classes");
        if (classes == null || classes.length() == 0) return "今天暂无课程";
        JSONObject next = null;
        boolean ongoing = false;
        for (int i = 0; i < classes.length(); i++) {
            JSONObject item = classes.optJSONObject(i);
            if (item == null) continue;
            int start = timeValue(item.optString("start", ""));
            int end = timeValue(item.optString("end", ""));
            if (start <= now && now < end) { next = item; ongoing = true; break; }
            if (start > now && (next == null || start < timeValue(next.optString("start", "")))) next = item;
        }
        if (next == null) return "今天课程已结束";
        String name = ScheduleWidgetStore.safeText(next.optString("name", ""), 24);
        return ongoing ? "正在上：" + name : "下一节 " + next.optString("start", "") + " " + name;
    }

    private static int timeValue(String value) {
        if (value == null || !value.matches("([01]\\d|2[0-3]):[0-5]\\d")) return Integer.MAX_VALUE;
        return Integer.parseInt(value.substring(0, 2) + value.substring(3, 5));
    }
}
