import { afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ install: null as null | {autoConnect:boolean}, apply: vi.fn(), prepare: vi.fn(async()=>({state:'dashboard',message:'fixture'})) }));
vi.mock('./sharedRuntime.js',()=>({readSharedInstall:()=>fixture.install}));
vi.mock('./desktopAutoconnect.js',()=>({applyDesktopAutoconnect:fixture.apply}));
vi.mock('./nativeSetup.js',()=>({setupNativeApp:vi.fn()}));
vi.mock('./desktopLauncher.js',()=>({prepareControlCenter:fixture.prepare,launchDesktop:vi.fn()}));
const originalArgs=process.argv;
afterEach(()=>{process.argv=originalArgs;vi.restoreAllMocks();});
it.each([true,false,null])('restores GUI defaults on dashboard startup only when enabled (%s)',async enabled=>{
 vi.resetModules();vi.clearAllMocks();vi.spyOn(console,'log').mockImplementation(()=>{});
 fixture.install=enabled===null?null:{autoConnect:enabled};
 process.argv=['node','desktop-launcher.js','--control-center'];
 await import('./cli/desktop-launcher.js');
 expect(fixture.apply).toHaveBeenCalledTimes(enabled===true?1:0);
 if(enabled===true)expect(fixture.apply).toHaveBeenCalledWith(false);
 expect(fixture.prepare).toHaveBeenCalledOnce();
});
