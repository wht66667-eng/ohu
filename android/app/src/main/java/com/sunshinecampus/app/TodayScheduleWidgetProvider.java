package com.sunshinecampus.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public final class TodayScheduleWidgetProvider extends AppWidgetProvider {
    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) { update(context, manager, ids); }

    static void update(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today_schedule);
            JSONObject data = ScheduleWidgetStore.read(context);
            String today = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date());
            if (data == null || !today.equals(data.optString("date", ""))) {
                empty(views, "打开哦狐同步课表");
            } else {
                String state = data.optString("state", "unavailable");
                JSONArray classes = data.optJSONArray("classes");
                if ("off".equals(state)) empty(views, "今天休息 · " + data.optString("dayLabel", ""));
                else if ("unavailable".equals(state)) empty(views, "打开哦狐同步课表");
                else if (classes == null || classes.length() == 0) empty(views, "今天暂无课程");
                else {
                    views.setTextViewText(R.id.widget_day, data.optString("dayLabel", "今日课程"));
                    int shown = Math.min(3, classes.length());
                    for (int i = 0; i < 3; i++) {
                        int textId = i == 0 ? R.id.widget_course_1 : i == 1 ? R.id.widget_course_2 : R.id.widget_course_3;
                        if (i >= shown) { views.setTextViewText(textId, ""); continue; }
                        JSONObject item = classes.optJSONObject(i);
                        if (item == null) { views.setTextViewText(textId, ""); continue; }
                        String room = ScheduleWidgetStore.safeText(item.optString("room", ""), 36);
                        views.setTextViewText(textId, item.optString("start", "") + "  " + item.optString("name", "") + (room.isEmpty() ? "" : " · " + room));
                    }
                    views.setTextViewText(R.id.widget_footer, classes.length() > shown ? "还有 " + (classes.length() - shown) + " 节" : "和哦狐一起安排好今天");
                }
            }
            setOpenIntent(context, views, id);
            manager.updateAppWidget(id, views);
        }
    }

    private static void empty(RemoteViews views, String text) {
        views.setTextViewText(R.id.widget_day, "今日课表");
        views.setTextViewText(R.id.widget_course_1, text);
        views.setTextViewText(R.id.widget_course_2, "");
        views.setTextViewText(R.id.widget_course_3, "");
        views.setTextViewText(R.id.widget_footer, "轻触打开哦狐");
    }

    private static void setOpenIntent(Context context, RemoteViews views, int id) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction("com.sunshinecampus.app.OPEN_TODAY_SCHEDULE_WIDGET");
        intent.putExtra("scheduleWidgetRoute", "/schedule");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pending);
    }
}
