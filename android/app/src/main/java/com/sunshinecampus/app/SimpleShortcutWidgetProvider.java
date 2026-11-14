package com.sunshinecampus.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

public final class SimpleShortcutWidgetProvider extends AppWidgetProvider {
    private static final int[] SLOTS = {
            R.id.widget_shortcut_1, R.id.widget_shortcut_2, R.id.widget_shortcut_3, R.id.widget_shortcut_4
    };

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) { update(context, manager, ids); }

    static void update(Context context, AppWidgetManager manager, int[] ids) {
        if (ids.length == 0) return;
        String[] routes = ScheduleWidgetStore.readShortcuts(context);
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_simple_shortcuts);
            for (int slot = 0; slot < SLOTS.length; slot++) {
                String route = routes[slot];
                views.setTextViewText(SLOTS[slot], WidgetLinks.label(route));
                views.setOnClickPendingIntent(SLOTS[slot], WidgetLinks.pending(context, "SHORTCUT", id, slot, route));
            }
            manager.updateAppWidget(id, views);
        }
    }
}
