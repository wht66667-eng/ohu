package com.sunshinecampus.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * 运动中心 · 原生健康数据插件（Android）
 *
 * 提供：
 * 1. requestActivityRecognition —— 运行时申请 ACTIVITY_RECOGNITION 权限（Android 10+）
 * 2. getStepCount —— 读取系统计步传感器自开机以来的累计步数
 * 3. startStepListening / stopStepListening —— 监听计步传感器变化（仅前台生效）
 *
 * 合规：所有数据仅返回给 WebView 由前端本地存储，不主动上传。
 * Android 10+读取计步传感器需要ACTIVITY_RECOGNITION运行时权限。
 */
@CapacitorPlugin(
    name = "Health",
    permissions = {
        @Permission(
            strings = { Manifest.permission.ACTIVITY_RECOGNITION },
            alias = HealthPlugin.ACTIVITY_RECOGNITION
        )
    }
)
public class HealthPlugin extends Plugin implements SensorEventListener {

    static final String ACTIVITY_RECOGNITION = "activityRecognition";

    private SensorManager sensorManager;
    private Sensor stepCounter;
    private long lastStepCount = 0;
    private boolean listening = false;

    /**
     * 申请「活动识别」运行时权限（Android 10 / API 29+ 需要）。
     * 授权前弹窗由系统显示，文案来自 AndroidManifest 的 permission 声明。
     */
    @PluginMethod
    public void requestActivityRecognition(PluginCall call) {
        // Android 10 以下不需要运行时申请
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }

        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACTIVITY_RECOGNITION)
                == PackageManager.PERMISSION_GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }

        // 保存 call，在权限回调里 resolve
        requestPermissionForAlias(ACTIVITY_RECOGNITION, call, "activityRecognitionCallback");
    }

    @PermissionCallback
    private void activityRecognitionCallback(PluginCall call) {
        boolean granted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACTIVITY_RECOGNITION)
                == PackageManager.PERMISSION_GRANTED;
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    /**
     * 读取系统计步传感器自设备开机以来的累计步数。
     * 返回 steps（累计）、available（传感器是否存在）。
     * Android 10+需要先授予ACTIVITY_RECOGNITION权限。
     */
    @PluginMethod
    public void getStepCount(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            if (sensorManager == null) {
                sensorManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
            }
            if (sensorManager == null) {
                ret.put("available", false);
                ret.put("steps", 0);
                call.resolve(ret);
                return;
            }

            stepCounter = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
            if (stepCounter == null) {
                ret.put("available", false);
                ret.put("steps", 0);
                call.resolve(ret);
                return;
            }

            // 注册一次性监听从 onSensorChanged 拿当前值
            final long[] stepsHolder = {0};
            final boolean[] gotValue = {false};
            SensorEventListener oneShot = new SensorEventListener() {
                @Override
                public void onSensorChanged(SensorEvent event) {
                    if (event.sensor.getType() == Sensor.TYPE_STEP_COUNTER) {
                        stepsHolder[0] = (long) event.values[0];
                        gotValue[0] = true;
                        sensorManager.unregisterListener(this);
                    }
                }
                @Override
                public void onAccuracyChanged(Sensor sensor, int accuracy) {}
            };

            if (!sensorManager.registerListener(oneShot, stepCounter, SensorManager.SENSOR_DELAY_NORMAL)) {
                ret.put("available", false);
                ret.put("steps", 0);
                ret.put("error", "计步传感器未能注册");
                call.resolve(ret);
                return;
            }

            // 1.5 秒超时兜底：部分机型首次注册不立即回调
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                if (!gotValue[0]) {
                    sensorManager.unregisterListener(oneShot);
                }
                ret.put("available", gotValue[0]);
                ret.put("steps", stepsHolder[0]);
                call.resolve(ret);
            }, 1500);

        } catch (Throwable t) {
            ret.put("available", false);
            ret.put("steps", 0);
            ret.put("error", t.getMessage());
            call.resolve(ret);
        }
    }

    /**
     * 开始持续监听计步传感器。每次步数变化通过 stepCount 事件通知前端。
     * 仅前台生效，App 切后台后系统会停止回调。
     */
    @PluginMethod
    public void startStepListening(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            if (sensorManager == null) {
                sensorManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
            }
            if (sensorManager == null) {
                ret.put("ok", false);
                call.resolve(ret);
                return;
            }
            stepCounter = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
            if (stepCounter == null) {
                ret.put("ok", false);
                call.resolve(ret);
                return;
            }

            if (!listening) {
                listening = sensorManager.registerListener(this, stepCounter, SensorManager.SENSOR_DELAY_NORMAL);
            }
            ret.put("ok", listening);
            if (!listening) ret.put("error", "计步传感器未能注册");
        } catch (Throwable t) {
            ret.put("ok", false);
            ret.put("error", t.getMessage());
        }
        call.resolve(ret);
    }

    /** 停止计步监听 */
    @PluginMethod
    public void stopStepListening(PluginCall call) {
        if (sensorManager != null && listening) {
            sensorManager.unregisterListener(this);
            listening = false;
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() != Sensor.TYPE_STEP_COUNTER) return;
        long total = (long) event.values[0];
        // 第一次回调时记录基准值，只上报增量
        if (lastStepCount == 0) {
            lastStepCount = total;
            return;
        }
        long delta = total - lastStepCount;
        if (delta > 0) {
            JSObject data = new JSObject();
            data.put("steps", total);
            data.put("delta", delta);
            notifyListeners("stepCount", data);
        }
        lastStepCount = total;
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}
}
