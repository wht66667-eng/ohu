package com.sunshinecampus.app;

import java.io.File;

/**
 * 在创建业务 WebView 之前执行的保守 Root 检查。
 * 只把明确的 su / Root 管理文件作为阻断证据；开发者选项、ADB、VPN 和模拟器不等于 Root。
 * 运行中的注入与更复杂的 Root 隐藏由 freeRASP 补充检测。
 */
final class DeviceIntegrityGate {
    private static final String[] ROOT_PATHS = {
        "/system/bin/su", "/system/xbin/su", "/sbin/su", "/su/bin/su",
        "/system/app/Superuser.apk", "/system/app/SuperSU.apk",
        "/data/adb/magisk", "/data/adb/ksu"
    };

    private DeviceIntegrityGate() {}

    static boolean hasConfirmedRoot() {
        for (String path : ROOT_PATHS) {
            try {
                if (new File(path).exists()) return true;
            } catch (SecurityException ignored) {
                // 不可读取并非 Root 证据；继续检查其他路径。
            }
        }
        return false;
    }
}
