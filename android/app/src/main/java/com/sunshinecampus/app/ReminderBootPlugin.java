package com.sunshinecampus.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ReminderBoot")
public class ReminderBootPlugin extends Plugin {
    @PluginMethod public void getState(PluginCall call) { call.resolve(ReminderBootStore.state(getContext())); }
    @PluginMethod public void selectOwner(PluginCall call) {
        try { call.resolve(ReminderBootStore.selectOwner(getContext(), call.getString("ownerUid"))); }
        catch (RuntimeException failure) { call.reject(failure.getMessage(), failure); }
    }
    @PluginMethod public void setEnabled(PluginCall call) {
        Boolean value = call.getBoolean("enabled");
        if (value == null) { call.reject("missing enabled"); return; }
        try { call.resolve(ReminderBootStore.setEnabled(getContext(), call.getString("ownerUid"), value)); }
        catch (RuntimeException failure) { call.reject(failure.getMessage(), failure); }
    }
    @PluginMethod public void clearOwner(PluginCall call) {
        try { call.resolve(ReminderBootStore.clearOwner(getContext(), call.getString("ownerUid"))); }
        catch (RuntimeException failure) { call.reject(failure.getMessage(), failure); }
    }
}
