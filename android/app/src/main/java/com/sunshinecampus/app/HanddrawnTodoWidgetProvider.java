package com.sunshinecampus.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

public final class HanddrawnTodoWidgetProvider extends AppWidgetProvider {
    private static final int[] ROWS = {R.id.widget_todo_first, R.id.widget_todo_second, R.id.widget_todo_third};

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) { update(context, manager, ids); }

    static void update(Context context, AppWidgetManager manager, int[] ids) {
        if (ids.length == 0) return;
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date());
        JSONObject data = ScheduleWidgetStore.read(context);
        JSONObject todos = data != null && today.equals(data.optString("date")) ? data.optJSONObject("todos") : null;
        JSONArray titles = todos == null ? null : todos.optJSONArray("titles");
        int total = todos == null ? 0 : todos.optInt("total");
        int completed = todos == null ? 0 : todos.optInt("completed");
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_handdrawn_todo);
            views.setTextViewText(R.id.widget_todo_progress, todos == null ? "打开哦狐刷新" : "完成 " + completed + "/" + total);
            views.setProgressBar(R.id.widget_todo_bar, Math.max(total, 1), completed, false);
            views.setViewVisibility(R.id.widget_todo_bar, todos == null ? View.GONE : View.VISIBLE);
            for (int index = 0; index < ROWS.length; index++) {
                String title = titles == null ? "" : titles.optString(index, "");
                if (title.isEmpty() && index == 0) {
                    title = todos == null ? "打开哦狐查看待办" : total > 0 && completed == total ? "今天都完成啦" : "今天暂无待办";
                } else if (!title.isEmpty()) {
                    title = "□ " + title;
                }
                views.setTextViewText(ROWS[index], title);
                views.setViewVisibility(ROWS[index], title.isEmpty() ? View.GONE : View.VISIBLE);
            }
            views.setOnClickPendingIntent(R.id.widget_todo_root, WidgetLinks.pending(context, "TODO", id, 0, "/todo"));
            manager.updateAppWidget(id, views);
        }
    }
}
