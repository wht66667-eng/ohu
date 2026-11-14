package com.sunshinecampus.app;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

/** 组件只可以打开学生端固定页面，所有入口先通过现有设备检查。 */
final class WidgetLinks {
    static final String ROUTE_EXTRA = "scheduleWidgetRoute";

    private WidgetLinks() {}

    static String label(String route) {
        if (route == null) return null;
        switch (route) {
            case "/schedule": return "课表";
            case "/todo": return "待办";
            case "/grades": return "成绩";
            case "/services": return "服务";
            case "/study/focus": return "专注";
            case "/calendar": return "校历";
            default: return null;
        }
    }

    static String safeRoute(String route) {
        return label(route) == null ? null : route;
    }

    static PendingIntent pending(Context context, String widget, int id, int slot, String route) {
        Intent intent = new Intent(context, SecurityEntryActivity.class);
        intent.setAction(context.getPackageName() + ".WIDGET." + widget + "." + slot);
        intent.putExtra(ROUTE_EXTRA, safeRoute(route));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
