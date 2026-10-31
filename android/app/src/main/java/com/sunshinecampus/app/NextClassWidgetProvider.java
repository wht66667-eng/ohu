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
import org.json.JSONObject;

public final class NextClassWidgetProvider extends AppWidgetProvider {
    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) { update(context, manager, ids); }

    static void update(Context context, AppWidgetManager manager, int[] ids) {
        int now = Integer.parseInt(new SimpleDateFormat("HHmm", Locale.ROOT).format(new Date()));
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date());
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_next_class);
            JSONObject data = ScheduleWidgetStore.read(context);
            String title = "下一节课";
            String name = "打开哦狐同步课表";
            String time = "";
            String room = "";
            if (data != null && today.equals(data.optString("date", ""))) {
                String state = data.optString("state", "unavailable");
                JSONArray classes = data.optJSONArray("classes");
                if ("off".equals(state)) { title = "今日安排"; name = "今天休息"; }
                else if ("unavailable".equals(state)) { title = "今日安排"; }
                else if (classes == null || classes.length() == 0) { title = "今日安排"; name = "今天暂无课程"; }
                else {
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
                    if (next != null) {
                        title = ongoing ? "正在上课" : "下一节课";
                        name = ScheduleWidgetStore.safeText(next.optString("name", ""), 48);
                        time = next.optString("start", "") + "–" + next.optString("end", "");
                        room = ScheduleWidgetStore.safeText(next.optString("room", ""), 40);
                    } else { title = "今日安排"; name = "今天课程已结束"; }
                }
            }
            views.setTextViewText(R.id.widget_next_title, title);
            views.setTextViewText(R.id.widget_next_name, name);
            views.setTextViewText(R.id.widget_next_time, time);
            views.setTextViewText(R.id.widget_next_room, room);
            Intent intent = new Intent(context, MainActivity.class);
            intent.setAction("com.sunshinecampus.app.OPEN_NEXT_CLASS_WIDGET");
            intent.putExtra("scheduleWidgetRoute", "/schedule");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pending = PendingIntent.getActivity(context, id + 100000, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            views.setOnClickPendingIntent(R.id.widget_next_root, pending);
            manager.updateAppWidget(id, views);
        }
    }

    private static int timeValue(String value) {
        if (value == null || !value.matches("([01]\\d|2[0-3]):[0-5]\\d")) return Integer.MAX_VALUE;
        return Integer.parseInt(value.substring(0, 2) + value.substring(3, 5));
    }
}
