import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Run the real Java launcher and Capacitor method against an inert Android OS.
// No third-party app is opened and no device, credentials or network is used.
const root = fileURLToPath(new URL('../', import.meta.url))
let dir
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohhu-express-'))
  const files = {
    'android/net/Uri.java': `package android.net; public class Uri {
      private final String value; private Uri(String value){this.value=value;}
      public static Uri parse(String value){return new Uri(value);}
      public String toString(){return value;}
    }`,
    'android/content/Intent.java': `package android.content; public class Intent {
      public static final String ACTION_VIEW="android.intent.action.VIEW", ACTION_MAIN="android.intent.action.MAIN";
      public static final int FLAG_ACTIVITY_NEW_TASK=0x10000000;
      public final String action; public final android.net.Uri uri; public String pkg; public int flags;
      public Intent(String action,android.net.Uri uri){this.action=action;this.uri=uri;}
      public Intent setPackage(String pkg){this.pkg=pkg;return this;}
      public Intent addFlags(int flags){this.flags|=flags;return this;}
    }`,
    'android/content/pm/PackageManager.java': `package android.content.pm; public class PackageManager {
      public static final int MATCH_DEFAULT_ONLY=1;
      public final java.util.Set<String> installed=new java.util.HashSet<>();
      public boolean denyLookup;
      public android.content.Intent getLaunchIntentForPackage(String pkg){
        if(denyLookup)throw new SecurityException("denied");
        return installed.contains(pkg)?new android.content.Intent(android.content.Intent.ACTION_MAIN,null).setPackage(pkg):null;
      }
      public java.util.List<Object> queryIntentActivities(android.content.Intent intent,int flags){return java.util.Collections.emptyList();}
    }`,
    'android/content/Context.java': `package android.content; public class Context {
      public final android.content.pm.PackageManager pm=new android.content.pm.PackageManager();
      public final java.util.List<Intent> attempts=new java.util.ArrayList<>(), successes=new java.util.ArrayList<>();
      public final java.util.Set<String> accepted=new java.util.HashSet<>(), denied=new java.util.HashSet<>();
      public boolean acceptAll;
      public android.content.pm.PackageManager getPackageManager(){return pm;}
      public static String key(Intent intent){return (intent.pkg==null?"web":intent.pkg)+"|"+(intent.uri==null?"home":intent.uri.toString());}
      public void startActivity(Intent intent){
        attempts.add(intent);
        if((intent.flags&Intent.FLAG_ACTIVITY_NEW_TASK)==0)throw new AssertionError("missing NEW_TASK");
        if(intent.flags!=Intent.FLAG_ACTIVITY_NEW_TASK)throw new AssertionError("unexpected task flags");
        String key=key(intent);
        if(denied.contains(key))throw new SecurityException("denied");
        if(!acceptAll&&!accepted.contains(key))throw new IllegalStateException("no activity");
        successes.add(intent);
      }
    }`,
    'com/getcapacitor/JSObject.java': `package com.getcapacitor; public class JSObject extends java.util.HashMap<String,Object> {}`,
    'com/getcapacitor/Plugin.java': `package com.getcapacitor; public class Plugin {
      public android.content.Context context;
      public android.content.Context getContext(){return context;}
    }`,
    'com/getcapacitor/PluginCall.java': `package com.getcapacitor; public class PluginCall {
      public final java.util.Map<String,String> options=new java.util.HashMap<>();
      public final java.util.List<String> reads=new java.util.ArrayList<>(); public JSObject resolved;
      public String getString(String key,String fallback){reads.add(key);return options.getOrDefault(key,fallback);}
      public void resolve(JSObject result){if(resolved!=null)throw new AssertionError("double resolve");resolved=result;}
    }`,
    'com/getcapacitor/PluginMethod.java': 'package com.getcapacitor; public @interface PluginMethod {}',
    'com/getcapacitor/annotation/CapacitorPlugin.java': 'package com.getcapacitor.annotation; public @interface CapacitorPlugin {String name();}',
    'com/sunshinecampus/app/Harness.java': `package com.sunshinecampus.app;
      import android.content.Context;
      import android.content.Intent;
      public class Harness {
        static final String CN="com.cainiao.wireless",TB="com.taobao.taobao",PDD="com.xunmeng.pinduoduo",
          DY="com.ss.android.ugc.aweme",LITE="com.ss.android.ugc.aweme.lite",JD="com.jingdong.app.mall";
        static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
        static void result(ExpressQuickJump.Result result,boolean ok,String route,String pkg){
          check(result.ok==ok,"ok mismatch");check(route.equals(result.route),"route mismatch: "+result.route);
          check(java.util.Objects.equals(pkg,result.packageName),"package mismatch: "+result.packageName);
        }
        static void oneLaunch(Context context,int attempts){
          check(context.attempts.size()==attempts,"wrong attempted count: "+context.attempts.size());
          check(context.successes.size()==1,"launch must stop at first success");
          for(Intent intent:context.attempts){
            if(intent.pkg==null)check(intent.uri!=null&&intent.uri.toString().startsWith("https://"),"unscoped non-HTTPS launch");
            else check(java.util.Arrays.asList(CN,TB,PDD,DY,LITE,JD).contains(intent.pkg),"unlisted package");
          }
        }
        static void allFirst(){
          String[] ids={"cainiao-code","taobao-code","taobao-pending","pdd-code","pdd-pending","douyin-orders","jd-orders"};
          String[] packages={CN,TB,TB,PDD,PDD,DY,JD};
          String[] prefixes={"cainiao://desktop/station_code","taobao://","taobao://","pinduoduo://","pinduoduo://","snssdk1128://ecom_order_list","openjd://"};
          for(int i=0;i<ids.length;i++){
            Context context=new Context();context.acceptAll=true;
            result(ExpressQuickJump.open(context,ids[i]),true,"direct",packages[i]);oneLaunch(context,1);
            check(context.attempts.get(0).uri.toString().startsWith(prefixes[i]),"wrong primary destination");
          }
        }
        static void appCandidates(){
          String[] ids={"cainiao-code","pdd-code","douyin-orders","douyin-orders"};
          String[] packages={CN,PDD,DY,LITE};
          String[] urls={"cainiao://client.main","pinduoduo://com.xunmeng.pinduoduo/mdkd/package","snssdk1128://wallet","snssdk2329://wallet"};
          int[] counts={2,3,2,4};
          for(int i=0;i<ids.length;i++){
            Context context=new Context();context.accepted.add(packages[i]+"|"+urls[i]);
            result(ExpressQuickJump.open(context,ids[i]),true,"app",packages[i]);oneLaunch(context,counts[i]);
          }
          Context lite=new Context();lite.accepted.add(LITE+"|snssdk2329://ecom_order_list");
          result(ExpressQuickJump.open(lite,"douyin-orders"),true,"direct",LITE);oneLaunch(lite,3);
        }
        static void alternateAndExceptions(){
          Context discover=new Context();discover.acceptAll=true;ExpressQuickJump.open(discover,"taobao-code");
          String primary=Context.key(discover.attempts.get(0));
          Context context=new Context();context.acceptAll=true;context.denied.add(primary);
          result(ExpressQuickJump.open(context,"taobao-code"),true,"direct",TB);oneLaunch(context,2);
          check(context.successes.get(0).uri.toString().startsWith("tbopen://"),"alternate scheme was skipped");
        }
        static void homes(){
          String[] ids={"cainiao-code","taobao-code","taobao-pending","pdd-code","pdd-pending","douyin-orders","jd-orders"};
          String[] packages={CN,TB,TB,PDD,PDD,LITE,JD};int[] counts={3,3,3,4,2,5,2};
          for(int i=0;i<ids.length;i++){
            Context context=new Context();context.pm.installed.add(packages[i]);context.accepted.add(packages[i]+"|home");
            result(ExpressQuickJump.open(context,ids[i]),true,"app",packages[i]);oneLaunch(context,counts[i]);
            check(Intent.ACTION_MAIN.equals(context.successes.get(0).action),"not an app homepage");
          }
        }
        static void webs(){
          String[] ids={"cainiao-code","taobao-code","taobao-pending","pdd-code","pdd-pending","jd-orders"};
          int[] counts={3,3,3,4,2,2};
          String[] urls={
            "https://market.m.taobao.com/app/cn-yz/multi-activity/authCode.html?bizEntry=ALIPAY_GUOGUO",
            "https://pages-fast.m.taobao.com/wow/z/uniapp/1011717/last-mile-fe/end-collect-platform/identity-code?x-ssr=true",
            "https://pages-fast.m.taobao.com/wow/z/uniapp/1100333/last-mile-fe/m-end-school-tab/home",
            "https://m.pinduoduo.net/mdkd/package?entry_source=18&extra_params=from_wx_jump%3D1&p_channel=0",
            "https://m.pinduoduo.net/mdkd/package?entry_source=18&extra_params=from_wx_jump%3D1&p_channel=0",
            "https://order.jd.com/center/list.action"};
          for(int i=0;i<ids.length;i++){
            Context context=new Context();context.pm.denyLookup=true;context.accepted.add("web|"+urls[i]);
            result(ExpressQuickJump.open(context,ids[i]),true,"web",null);oneLaunch(context,counts[i]);
            check(context.successes.get(0).pkg==null,"web fallback unexpectedly scoped");
          }
        }
        static void unavailable(){
          Context missing=new Context();result(ExpressQuickJump.open(missing,"douyin-orders"),false,"unavailable",null);
          check(missing.attempts.size()==4&&missing.successes.isEmpty(),"Douyin must not invent a web fallback");
          Context noBrowser=new Context();result(ExpressQuickJump.open(noBrowser,"taobao-code"),false,"unavailable",null);
          check(noBrowser.attempts.size()==3&&noBrowser.successes.isEmpty(),"all failures must be reported");
          String[] unknown={null,"","unknown","Taobao-code","taobao-code&url=evil","intent://evil#Intent;component=evil;end"};
          for(String id:unknown){Context context=new Context();context.acceptAll=true;
            result(ExpressQuickJump.open(context,id),false,"unavailable",null);check(context.attempts.isEmpty(),"unknown entry launched");}
        }
        static void bridge(){
          AppProbePlugin plugin=new AppProbePlugin();Context context=new Context();context.acceptAll=true;plugin.context=context;
          com.getcapacitor.PluginCall call=new com.getcapacitor.PluginCall();
          call.options.put("entryId","taobao-code");call.options.put("url","intent://evil");
          call.options.put("packageName","evil.pkg");call.options.put("component","evil.Activity");call.options.put("extras","evil");
          plugin.openExpressEntry(call);oneLaunch(context,1);
          check(call.reads.equals(java.util.Collections.singletonList("entryId")),"bridge read caller routing configuration");
          check(Boolean.TRUE.equals(call.resolved.get("ok"))&&"direct".equals(call.resolved.get("route"))&&TB.equals(call.resolved.get("packageName")),"bridge result mismatch");
          com.getcapacitor.PluginCall invalid=new com.getcapacitor.PluginCall();invalid.options.put("entryId","intent://evil");
          plugin.openExpressEntry(invalid);check(context.attempts.size()==1,"invalid entry launched");
          check(Boolean.FALSE.equals(invalid.resolved.get("ok"))&&"unavailable".equals(invalid.resolved.get("route"))&&!invalid.resolved.containsKey("packageName"),"invalid bridge result mismatch");
        }
        public static void main(String[] args){
          switch(args[0]){case "all":allFirst();break;case "app-candidates":appCandidates();break;
            case "alternate":alternateAndExceptions();break;case "homes":homes();break;case "webs":webs();break;
            case "unavailable":unavailable();break;case "bridge":bridge();break;default:throw new AssertionError("unknown test");}
          System.out.println("passed "+args[0]);
        }
      }`,
  }
  const sources = []
  for (const [name, content] of Object.entries(files)) {
    const destination = path.join(dir, name)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, content)
    sources.push(destination)
  }
  for (const name of ['ExpressQuickJump', 'AppProbePlugin']) sources.push(path.join(root, 'android/app/src/main/java/com/sunshinecampus/app', `${name}.java`))
  try { execFileSync('javac', ['-encoding', 'UTF-8', '-d', dir, ...sources], { stdio: 'pipe' }) }
  catch (error) { if (error.stderr) process.stderr.write(error.stderr); throw error }
})
after(() => {
  if (!dir) return
  assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(dir).startsWith('ohhu-express-'))
  fs.rmSync(dir, { recursive: true, force: true })
})

for (const [name, scenario] of [
  ['all seven fixed entries stop at their first successful package-scoped destination', 'all'],
  ['generic Cainiao, PDD and Douyin destinations are reported as app fallbacks', 'app-candidates'],
  ['a rejected primary destination tries only the next fixed scheme', 'alternate'],
  ['failed deep links fall back to the fixed official app launcher', 'homes'],
  ['missing apps or package lookup failures fall back once to the fixed HTTPS page', 'webs'],
  ['missing handlers and unknown entry identifiers report unavailable without invented navigation', 'unavailable'],
  ['the Capacitor bridge ignores injected URL, package, component and extra fields', 'bridge'],
]) {
  test(name, () => {
    const output = execFileSync('java', ['-cp', dir, 'com.sunshinecampus.app.Harness', scenario], { encoding: 'utf8' })
    assert.match(output, new RegExp(`passed ${scenario}`))
  })
}

test('Android package visibility covers the six fixed target packages without a broad query permission', () => {
  const manifest = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8')
  const queries = manifest.match(/<queries>([\s\S]*?)<\/queries>/)?.[1] ?? ''
  for (const name of ['com.cainiao.wireless', 'com.taobao.taobao', 'com.xunmeng.pinduoduo', 'com.ss.android.ugc.aweme', 'com.ss.android.ugc.aweme.lite', 'com.jingdong.app.mall']) {
    assert.ok(queries.includes(`<package android:name="${name}" />`), name)
  }
  assert.doesNotMatch(manifest, /QUERY_ALL_PACKAGES/)
})
