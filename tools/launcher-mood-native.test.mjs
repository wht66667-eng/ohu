import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const jdk = ['javac', 'java'].every(cmd => spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0)
// Compile the real icon preference, plugin, switcher and scheduler classes with
// inert Android/Capacitor bridges. No APK, device, notifications or network.
const fixtures = {
  'android/content/SharedPreferences.java': `package android.content;
    public interface SharedPreferences {
      String getString(String key, String fallback); int getInt(String key, int fallback);
      boolean getBoolean(String key, boolean fallback); Editor edit();
      interface Editor { Editor putString(String k,String v); Editor putInt(String k,int v); Editor putBoolean(String k,boolean v); void apply(); }
    }`,
  'android/content/Context.java': `package android.content;
    import java.util.*; import android.content.pm.PackageManager;
    public class Context {
      public static final int MODE_PRIVATE=0; public final PackageManager pm=new PackageManager();
      public final Map<String,Object> data=new HashMap<>();
      public Context getApplicationContext(){return this;} public PackageManager getPackageManager(){return pm;}
      public String getPackageName(){return "com.sunshinecampus.app";}
      public SharedPreferences getSharedPreferences(String name,int mode){return new SharedPreferences(){
        public String getString(String k,String f){return (String)data.getOrDefault(k,f);}
        public int getInt(String k,int f){return (Integer)data.getOrDefault(k,f);}
        public boolean getBoolean(String k,boolean f){return (Boolean)data.getOrDefault(k,f);}
        public Editor edit(){return new Editor(){
          public Editor putString(String k,String v){data.put(k,v);return this;}
          public Editor putInt(String k,int v){data.put(k,v);return this;}
          public Editor putBoolean(String k,boolean v){data.put(k,v);return this;}
          public void apply(){}
        };}
      };}
    }`,
  'android/content/ComponentName.java': `package android.content;
    public class ComponentName { public final String name; public ComponentName(String pkg,String name){this.name=name;} }`,
  'android/content/pm/PackageManager.java': `package android.content.pm;
    import java.util.*; import android.content.ComponentName;
    public class PackageManager {
      public static final int COMPONENT_ENABLED_STATE_ENABLED=1, COMPONENT_ENABLED_STATE_DISABLED=2,DONT_KILL_APP=1;
      public boolean fail=false; public final Map<String,Integer> states=new LinkedHashMap<>();
      public void setComponentEnabledSetting(ComponentName n,int state,int flags){if(fail)throw new SecurityException("denied");states.put(n.name,state);}
      public int getComponentEnabledSetting(ComponentName n){return states.getOrDefault(n.name,0);}
    }`,
  'com/getcapacitor/JSObject.java': `package com.getcapacitor; public class JSObject extends java.util.HashMap<String,Object>{}`,
  'com/getcapacitor/Plugin.java': `package com.getcapacitor; import android.content.Context;
    public class Plugin {public static Context context; public Context getContext(){return context;} }`,
  'com/getcapacitor/PluginCall.java': `package com.getcapacitor;
    public class PluginCall {
      public final JSObject input=new JSObject(); public JSObject output;
      public String getString(String k,String f){return (String)input.getOrDefault(k,f);}
      public Boolean getBoolean(String k,boolean f){return (Boolean)input.getOrDefault(k,f);}
      public int getInt(String k,int f){return (Integer)input.getOrDefault(k,f);}
      public void resolve(JSObject o){output=o;}
    }`,
  'com/getcapacitor/PluginMethod.java': `package com.getcapacitor; public @interface PluginMethod {}`,
  'com/getcapacitor/annotation/CapacitorPlugin.java': `package com.getcapacitor.annotation; public @interface CapacitorPlugin {String name();}`,
  'com/sunshinecampus/app/BuildConfig.java': `package com.sunshinecampus.app; public class BuildConfig {public static String SC_SHELL="user";}`,
  'com/sunshinecampus/app/IconMoodWorker.java': `package com.sunshinecampus.app; public class IconMoodWorker {public static final String UNIQUE="sc_icon_mood_daily";}`,
  'androidx/work/ExistingPeriodicWorkPolicy.java': `package androidx.work; public enum ExistingPeriodicWorkPolicy {KEEP}`,
  'androidx/work/PeriodicWorkRequest.java': `package androidx.work; public class PeriodicWorkRequest {public static class Builder {
    public Builder(Class<?> c,int n,java.util.concurrent.TimeUnit u){} public PeriodicWorkRequest build(){return new PeriodicWorkRequest();} } }`,
  'androidx/work/OneTimeWorkRequest.java': `package androidx.work; public class OneTimeWorkRequest {public static class Builder {
    public Builder(Class<?> c){} public OneTimeWorkRequest build(){return new OneTimeWorkRequest();} } }`,
  'androidx/work/WorkManager.java': `package androidx.work; import android.content.Context;
    public class WorkManager {
      public static WorkManager instance=new WorkManager(); public int scheduled=0,cancelled=0; public boolean fail=false;
      public static WorkManager getInstance(Context ctx){return instance;}
      public void enqueueUniquePeriodicWork(String n,ExistingPeriodicWorkPolicy p,PeriodicWorkRequest r){if(fail)throw new IllegalStateException();scheduled++;}
      public void cancelUniqueWork(String n){cancelled++;} public void enqueue(OneTimeWorkRequest r){scheduled++;}
    }`,
  'com/sunshinecampus/app/LauncherMoodHarness.java': `package com.sunshinecampus.app;
    import android.content.*; import com.getcapacitor.*; import androidx.work.WorkManager;
    public class LauncherMoodHarness {
      static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
      static PluginCall enabled(LauncherIconPlugin plugin,boolean value){PluginCall call=new PluginCall();call.input.put("enabled",value);plugin.setEnabled(call);return call;}
      static PluginCall sync(LauncherIconPlugin plugin,String name){PluginCall call=new PluginCall();call.input.put("lastActiveDate",IconMoodPrefs.today());call.input.put("lastCheckinDate",IconMoodPrefs.today());call.input.put("streakCurrent",3);call.input.put("iconState",name);plugin.syncMood(call);return call;}
      static String ago(int days){java.util.Calendar c=java.util.Calendar.getInstance();c.add(java.util.Calendar.DATE,-days);return String.format(java.util.Locale.US,"%04d-%02d-%02d",c.get(1),c.get(2)+1,c.get(5));}
      public static void main(String[] args){
        Context ctx=new Context();Plugin.context=ctx;LauncherIconPlugin plugin=new LauncherIconPlugin();
        check(!IconMoodPrefs.isEnabled(ctx),"fresh install must be off");
        IconMoodScheduler.ensure(ctx);IconMoodScheduler.runNow(ctx);
        check(WorkManager.instance.scheduled==0,"off default must not schedule work");
        check(WorkManager.instance.cancelled>0,"off default cleans old scheduled work");
        PluginCall disabledSync=sync(plugin,"streak_3");
        check(Boolean.TRUE.equals(disabledSync.output.get("ok")),"off sync succeeds honestly");
        check(IconMoodPrefs.streakCurrent(ctx)==3,"off still records current activity");
        check("default".equals(disabledSync.output.get("name")),"off cannot select mood icon");
        PluginCall direct=new PluginCall();direct.input.put("name","away_30");plugin.setIcon(direct);
        check(Boolean.FALSE.equals(direct.output.get("ok")),"legacy setIcon cannot bypass opt-in");
        check(WorkManager.instance.scheduled==0,"disabled direct request schedules nothing");
        LauncherIconSwitcher.setAppInForeground(true);
        PluginCall on=enabled(plugin,true);
        check(Boolean.TRUE.equals(on.output.get("ok")),"explicit opt-in works");
        check(Boolean.TRUE.equals(on.output.get("pending")),"foreground reports deferred application");
        check(IconMoodPrefs.isEnabled(ctx),"explicit consent persists");
        PluginCall reset=new PluginCall(); plugin.resetMood(reset);
        check(Boolean.TRUE.equals(reset.output.get("ok")),"account reset succeeds");
        check(IconMoodPrefs.isEnabled(ctx),"account reset preserves opt-in");
        check(IconMoodPrefs.lastActiveDate(ctx).isEmpty() && IconMoodPrefs.streakCurrent(ctx)==0,"account reset clears previous history");
        check("default".equals(IconMoodPrefs.iconState(ctx)),"account reset returns to default");
        LauncherIconSwitcher.setAppInForeground(false);LauncherIconSwitcher.onAppBackground(ctx);
        check(!LauncherIconSwitcher.isPending(),"background applies queued icon");
        check(ctx.pm.states.entrySet().stream().filter(e->e.getValue()==1).count()==1,"exactly one alias stays enabled");
        enabled(plugin,false);check(!IconMoodPrefs.isEnabled(ctx),"disable persists");
        ctx.pm.fail=true;PluginCall denied=enabled(plugin,true);
        check(Boolean.FALSE.equals(denied.output.get("ok")),"system denial cannot report success");
        check(!IconMoodPrefs.isEnabled(ctx),"failed opt-in rolls back");
        check(!IconMoodPrefs.lastError(ctx).isEmpty(),"system denial is available to UI");
        ctx.pm.fail=false;WorkManager.instance.fail=true;
        check(Boolean.FALSE.equals(enabled(plugin,true).output.get("ok")),"scheduler failure cannot report success");
        check(!IconMoodPrefs.isEnabled(ctx),"scheduler failure leaves opt-in off");
        WorkManager.instance.fail=false;
        check("default".equals(LauncherIconSwitcher.resolve("","",0)),"no record stays neutral");
        for(int n:new int[]{1,2,3,7,15,30}){
          String expect=n==1?"away_2":n==2?"away_5":n==3?"away_8":n==7?"away_12":n==15?"away_15":"away_30";
          check(expect.equals(LauncherIconSwitcher.resolve(ago(n),"",0)),"V1 away threshold "+n);
        }
        check("streak_7".equals(LauncherIconSwitcher.resolve(IconMoodPrefs.today(),IconMoodPrefs.today(),14)),"day14 does not claim day30 art");
        check("streak_14".equals(LauncherIconSwitcher.resolve(IconMoodPrefs.today(),IconMoodPrefs.today(),30)),"legacy alias supports actual day30");
        System.out.println("Native opt-in, deferred state, real failures and V1 thresholds verified.");
      }
    }`,
}

test('real native launcher code respects explicit consent and reports failures', { skip: !jdk ? 'Requires an installed JDK; no dependencies are downloaded' : false }, () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ohu-launcher-native-'))
  try {
    for (const [name, source] of Object.entries(fixtures)) {
      const file = path.join(scratch, name)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, source)
    }
    const classes = path.join(scratch, 'classes')
    fs.mkdirSync(classes)
    const actual = ['IconMoodPrefs.java', 'LauncherIconSwitcher.java', 'LauncherIconPlugin.java', 'IconMoodScheduler.java']
      .map(name => path.join(root, 'android/app/src/main/java/com/sunshinecampus/app', name))
    execFileSync('javac', ['-encoding', 'UTF-8', '-d', classes, ...Object.keys(fixtures).map(name => path.join(scratch, name)), ...actual], { stdio: 'pipe' })
    const output = execFileSync('java', ['-cp', classes, 'com.sunshinecampus.app.LauncherMoodHarness'], { encoding: 'utf8', stdio: 'pipe' })
    assert.match(output, /verified/)
  } catch (error) {
    if (error.stderr) process.stderr.write(error.stderr.toString())
    throw error
  } finally {
    const target = path.resolve(scratch)
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('ohu-launcher-native-'))
    fs.rmSync(target, { recursive: true, force: true })
  }
})

test('all V1 native aliases have opaque PNG resources at every platform density', () => {
  const mapping = JSON.parse(fs.readFileSync(path.join(root, 'public/launcher-icon-previews/v1-mapping.json'), 'utf8'))
  assert.equal(Object.keys(mapping.states).length, 13)
  assert.equal(mapping.source_canvas_fraction, 0.82)
  for (const [density, side] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    for (const state of Object.keys(mapping.states)) {
      const name = state === 'default' ? 'ic_mood_default' : `ic_${state}`
      const png = fs.readFileSync(path.join(root, `android/app/src/main/res/mipmap-${density}/${name}.png`))
      assert.equal(png.readUInt32BE(16), side)
      assert.equal(png.readUInt32BE(20), side)
      assert.equal(png[25], 2, 'RGB encoding has no transparent platform pixels')
    }
  }
})
