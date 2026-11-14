package com.sunshinecampus.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

public final class ClassicGreetingWidgetProvider extends AppWidgetProvider {
    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) { update(context, manager, ids); }

    static void update(Context context, AppWidgetManager manager, int[] ids) {
        if (ids.length == 0) return;
        Calendar calendar = Calendar.getInstance();
        Date now = calendar.getTime();
        int hour = calendar.get(Calendar.HOUR_OF_DAY);
        String greeting = hour < 11 ? "早上好" : hour < 17 ? "下午好" : "晚上好";
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(now);
        String dayLabel = new SimpleDateFormat("M月d日 · EEEE", Locale.SIMPLIFIED_CHINESE).format(now);
        JSONObject data = ScheduleWidgetStore.read(context);
        String courses = "打开哦狐同步课表";
        if (data != null && today.equals(data.optString("date"))) {
            String state = data.optString("state");
            JSONArray classes = data.optJSONArray("classes");
            if ("off".equals(state)) courses = "今天休息";
            else if ("ready".equals(state) || "empty".equals(state)) {
                int count = classes == null ? 0 : classes.length();
                courses = "今日 " + count + " 节课";
            }
        }
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_classic_greeting);
            views.setTextViewText(R.id.widget_classic_greeting, greeting + "，同学");
            views.setTextViewText(R.id.widget_classic_date, dayLabel);
            views.setTextViewText(R.id.widget_classic_courses, courses);
            views.setOnClickPendingIntent(R.id.widget_classic_root, WidgetLinks.pending(context, "CLASSIC", id, 0, "/schedule"));
            manager.updateAppWidget(id, views);
        }
    }
}
