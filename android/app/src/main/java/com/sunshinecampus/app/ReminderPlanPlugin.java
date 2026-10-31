package com.sunshinecampus.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ReminderPlan")
public class ReminderPlanPlugin extends Plugin {
    @PluginMethod public void getState(PluginCall call) { call.resolve(ReminderPlanStore.state(getContext())); }
    @PluginMethod public void sync(PluginCall call) {
        JSArray notifications = call.getArray("notifications");
        if (notifications == null) { call.reject("missing notifications"); return; }
        try { call.resolve(ReminderPlanStore.sync(getContext(), call.getString("ownerUid"), notifications)); }
        catch (Exception failure) { call.reject(failure.getMessage(), failure); }
    }
    @PluginMethod public void clear(PluginCall call) {
        try { call.resolve(ReminderPlanStore.clear(getContext(), call.getString("ownerUid"))); }
        catch (RuntimeException failure) { call.reject(failure.getMessage(), failure); }
    }
}
