package com.sunshinecampus.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Account-scoped bridge from the validated WebView timetable projection to Android widgets. */
@CapacitorPlugin(name = "ScheduleWidget")
public final class ScheduleWidgetPlugin extends Plugin {
    @PluginMethod
    public void setIdentity(PluginCall call) {
        String uid = call.getString("uid", "");
        String instanceId = call.getString("instanceId", "");
        Integer revision = call.getInt("revision");
        boolean signed = call.getBoolean("signed", false);
        if (uid == null || instanceId == null || instanceId.length() > 80 || revision == null || revision < 0) {
            call.reject("Invalid schedule widget identity");
            return;
        }
        ScheduleWidgetStore.setIdentity(getContext(), signed ? uid : "", revision, instanceId);
        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void setData(PluginCall call) {
        String uid = call.getString("uid", "");
        String instanceId = call.getString("instanceId", "");
        Integer revision = call.getInt("revision");
        String date = call.getString("date", "");
        String dayLabel = call.getString("dayLabel", "");
        String state = call.getString("state", "unavailable");
        JSObject result = new JSObject();
        if (uid == null || uid.isEmpty() || instanceId == null || revision == null || date == null
                || !date.matches("\\d{4}-\\d{2}-\\d{2}")
                || !("ready".equals(state) || "off".equals(state) || "empty".equals(state) || "unavailable".equals(state))) {
            result.put("ok", false);
            call.resolve(result);
            return;
        }
        boolean accepted = ScheduleWidgetStore.setData(getContext(), uid, revision, instanceId, date, dayLabel, state,
                call.getArray("classes"), call.getObject("todos"));
        result.put("ok", accepted);
        call.resolve(result);
    }

    @PluginMethod
    public void setShortcuts(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ok", ScheduleWidgetStore.setShortcuts(getContext(), call.getArray("routes")));
        call.resolve(result);
    }
}
