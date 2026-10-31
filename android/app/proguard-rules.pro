# Capacitor / 阳光校园 Release 混淆规则
# 开启 minifyEnabled 后必须保留 Bridge 与插件入口，否则 WebView 桥接会挂。

-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod
-keepattributes SourceFile,LineNumberTable

# Capacitor 核心与插件
-keep class com.getcapacitor.** { *; }
-keep class org.apache.cordova.** { *; }
-keep class com.capacitorjs.** { *; }
-dontwarn com.getcapacitor.**
-dontwarn org.apache.cordova.**

# freeRASP / Talsec
-keep class com.aheaditec.** { *; }
-keep class com.talsec.** { *; }
-dontwarn com.aheaditec.**
-dontwarn com.talsec.**

# Capgo live update（JDK17 兼容补丁见 patches/）
-keep class ee.forgr.capacitor_updater.** { *; }
-keep class app.capgo.** { *; }
-dontwarn ee.forgr.capacitor_updater.**

# 应用主 Activity（五端同 namespace）
-keep class com.sunshinecampus.app.** { *; }

# 保留 JNI / 反射常用
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# 压缩时去掉日志（可选，降低信息泄露）
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
    public static *** i(...);
}
