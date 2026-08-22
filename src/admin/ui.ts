/** Embedded admin panel — one self-contained page served by the daemon. */
export const ADMIN_HTML: string = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Control Room — Stream Deck Micro</title>
<style>
  :root {
    --bg: #0a0a0f; --bg2: #101018; --panel: #14141d; --panel2: #1a1a26;
    --line: #26263a; --line2: #32324a;
    --text: #ececf4; --dim: #8f8fa8; --faint: #5c5c74;
    --accent: #7c5cff; --accent2: #9d7bff;
    --ok: #22a34a; --err: #dc2626;
    --purple: #7c3aed; --purple-dim: #452394; --blue: #2563eb; --blue-dim: #16337f;
    --grey: #3a3f44; --empty: #202026; --green: #16a34a; --red: #dc2626;
    --radius: 14px;
  }
  * { box-sizing: border-box; }
  html { scrollbar-color: #2c2c40 transparent; }
  body { margin: 0; background:
      radial-gradient(1200px 500px at 20% -10%, #1a1030 0%, transparent 60%),
      radial-gradient(900px 400px at 100% 0%, #0d1a33 0%, transparent 55%),
      var(--bg);
      color: var(--text); font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, 'SF Pro Text', sans-serif;
      -webkit-font-smoothing: antialiased; }
  header { display: flex; align-items: center; gap: 14px; padding: 20px 28px 6px; max-width: 1240px; margin: 0 auto; }
  .logo { width: 34px; height: 34px; border-radius: 9px; flex: none;
          background: linear-gradient(135deg, var(--purple), var(--blue));
          box-shadow: 0 4px 18px rgba(124,92,255,.35); position: relative; }
  .logo::after { content: ''; position: absolute; inset: 9px; border-radius: 4px;
                 background: repeating-linear-gradient(90deg, #fff3 0 3px, transparent 3px 7px); }
  header h1 { font-size: 16px; margin: 0; font-weight: 650; letter-spacing: .2px; }
  header .meta { color: var(--dim); font-size: 12.5px; margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .livedot { width: 8px; height: 8px; border-radius: 50%; background: var(--faint); }
  .livedot.on { background: var(--ok); box-shadow: 0 0 8px var(--ok); }

  main { max-width: 1240px; margin: 14px auto 0; padding: 0 28px 90px;
         display: grid; grid-template-columns: minmax(560px, 1fr) minmax(400px, 480px);
         gap: 22px; align-items: start; }
  @media (max-width: 1080px) { main { grid-template-columns: 1fr; } }

  .card { background: linear-gradient(180deg, var(--panel) 0%, var(--bg2) 100%);
          border: 1px solid var(--line); border-radius: var(--radius); padding: 18px; }
  .card h2 { font-size: 11.5px; text-transform: uppercase; letter-spacing: 1.6px;
             color: var(--dim); margin: 0 0 14px; font-weight: 600; }

  /* ---------- the device ---------- */
  .device-shell { border-radius: 22px; padding: 26px 26px 30px;
      background: linear-gradient(180deg, #23232e 0%, #16161e 55%, #101017 100%);
      border: 1px solid #30303f; box-shadow: 0 30px 60px -30px rgba(0,0,0,.8),
      inset 0 1px 0 rgba(255,255,255,.06); position: relative; }
  .device-shell::before { content: ''; position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
      width: 54px; height: 5px; border-radius: 3px; background: #08080c;
      box-shadow: inset 0 1px 2px #000, 0 1px 0 rgba(255,255,255,.05); }
  .device-shell::after { content: ''; position: absolute; bottom: -9px; left: 50%; transform: translateX(-50%);
      width: 120px; height: 10px; border-radius: 0 0 8px 8px; background: #17171f;
      border: 1px solid #2b2b3a; border-top: 0; }
  .deck { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-top: 6px; }

  .key { position: relative; aspect-ratio: 1; border-radius: 12px; cursor: pointer;
         background: #0c0c12; padding: 4px;
         box-shadow: inset 0 2px 5px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.04);
         transition: transform .08s ease; -webkit-user-select: none; user-select: none; }
  .key:hover .cap { filter: brightness(1.12); }
  .key:active { transform: translateY(1px) scale(.97); }
  .key.selected .cap { box-shadow: inset 0 0 0 2.5px #fff, 0 0 14px -2px rgba(255,255,255,.25); }

  .cap { position: absolute; inset: 4px; border-radius: 9px; overflow: hidden;
         display: flex; flex-direction: column; align-items: center; justify-content: center;
         padding: 6px 5px; text-align: center; transition: background .35s ease, box-shadow .2s ease;
         background: var(--empty); }
  .cap .t { font-weight: 700; font-size: 13px; letter-spacing: .3px; line-height: 1.15;
            max-width: 100%; overflow: hidden; }
  .cap .t.two { font-size: 10.5px; }
  .cap .sub { font-size: 9px; color: rgba(255,255,255,.75); text-transform: uppercase;
              letter-spacing: 1px; margin-top: 3px; }
  .cap .corner { position: absolute; top: 4px; left: 7px; font-size: 9px; color: rgba(255,255,255,.55);
                 font-weight: 700; }

  .cap.st-idle { background: var(--grey); }
  .cap.st-done { background: var(--green); animation: glowOk 1s ease; }
  .cap.st-error { background: var(--red); animation: glowErr 1s ease; }
  .cap.pulse-thinking { animation: pulseThinking 900ms ease-in-out infinite; }
  .cap.pulse-running { animation: pulseRunning 900ms ease-in-out infinite; }
  .cap.wf { background: #37416e; }
  .cap.act { background: #167046; }
  .cap.act.stop { background: #a12626; }
  .cap.act.attach { background: #8a5c14; }
  .cap.act.sel { background: #475569; }
  .cap.act.doit { background: #167046; }

  @keyframes pulseThinking { 0%,100% { background: var(--purple-dim); } 50% { background: var(--purple); } }
  @keyframes pulseRunning { 0%,100% { background: var(--blue-dim); } 50% { background: var(--blue); } }
  @keyframes glowOk { 0% { box-shadow: 0 0 24px 2px rgba(22,163,74,.7); } 100% { box-shadow: 0 0 0 0 rgba(22,163,74,0); } }
  @keyframes glowErr { 0% { box-shadow: 0 0 24px 2px rgba(220,38,38,.7); } 100% { box-shadow: 0 0 0 0 rgba(220,38,38,0); } }

  .legend { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 16px; color: var(--faint);
            font-size: 11px; }
  .legend b { color: var(--dim); font-weight: 600; }
  .legend .sw { display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-right: 5px;
                vertical-align: -1px; }

  .feed { margin-top: 14px; border-top: 1px solid var(--line); padding-top: 10px;
          font-size: 12px; color: var(--dim); font-family: ui-monospace, 'SF Mono', monospace;
          max-height: 110px; overflow: auto; }
  .feed div { padding: 1.5px 0; }
  .feed .t { color: var(--faint); margin-right: 8px; }

  /* ---------- side panel ---------- */
  .tabs { display: flex; gap: 6px; margin-bottom: 16px; }
  .tab-btn { flex: 1; padding: 8px 0; border-radius: 10px; border: 1px solid var(--line);
             background: transparent; color: var(--dim); font-size: 12.5px; font-weight: 600;
             cursor: pointer; transition: all .15s ease; }
  .tab-btn:hover { color: var(--text); border-color: var(--line2); }
  .tab-btn.on { background: linear-gradient(180deg, var(--panel2), #1d1d2b); color: var(--text);
                border-color: var(--accent); box-shadow: 0 4px 14px -6px rgba(124,92,255,.5); }
  .tabpage { display: none; }
  .tabpage.on { display: block; }

  .inspector { background: var(--panel2); border: 1px solid var(--line); border-radius: 12px;
               padding: 14px; margin-bottom: 12px; }
  .inspector .title { display: flex; align-items: center; gap: 9px; margin-bottom: 4px; }
  .inspector .title .dot { width: 10px; height: 10px; border-radius: 50%; }
  .inspector .title h3 { margin: 0; font-size: 15px; }
  .inspector .sid { font-size: 11px; color: var(--faint); font-family: ui-monospace, monospace; }
  .inspector .detail { font-size: 12.5px; color: var(--dim); margin: 8px 0 0; }
  .inspector .msg { font-size: 12.5px; margin-top: 10px; padding: 10px 12px; background: #0e0e16;
               border: 1px solid var(--line); border-radius: 9px; color: #c6c6dc;
               max-height: 160px; overflow: auto; white-space: pre-wrap; }
  .inspector .empty-msg { color: var(--faint); font-style: italic; }
  .actions { display: flex; gap: 7px; margin-top: 12px; flex-wrap: wrap; }

  button.btn { background: var(--panel2); color: var(--text); border: 1px solid var(--line);
           border-radius: 9px; padding: 6px 12px; font-size: 12.5px; font-weight: 550;
           cursor: pointer; transition: all .12s ease; }
  button.btn:hover { border-color: var(--accent); color: #fff; }
  button.btn.primary { background: linear-gradient(180deg, var(--accent), #6347e8); border-color: var(--accent); color: #fff;
               box-shadow: 0 6px 18px -8px rgba(124,92,255,.7); }
  button.btn.danger:hover { border-color: var(--err); color: #ff8f8f; }
  button.btn:disabled { opacity: .4; cursor: default; }
  button.btn.mini { padding: 3px 8px; font-size: 11.5px; border-radius: 7px; }

  input[type=text], textarea, select { background: #0e0e16; color: var(--text);
        border: 1px solid var(--line); border-radius: 9px; padding: 7px 10px; font-size: 13px;
        outline: none; transition: border-color .15s ease; }
  input[type=text]:focus, textarea:focus { border-color: var(--accent); }
  textarea { width: 100%; min-height: 54px; resize: vertical; font-family: inherit; }
  .search { width: 100%; }

  .slotlist .row, .sessions .row { display: flex; align-items: center; gap: 10px; padding: 9px 8px;
          border-bottom: 1px solid var(--line); border-radius: 8px; }
  .slotlist .row:hover, .sessions .row:hover { background: #171724; }
  .row:last-child { border-bottom: 0; }
  .row .name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .row .when { color: var(--faint); font-size: 11px; flex: none; }
  .badge { font-size: 10px; background: #22223a; color: var(--dim); border-radius: 6px;
           padding: 2.5px 7px; flex: none; font-weight: 600; letter-spacing: .3px; }
  .badge.key { background: #1d2a4d; color: #8fb0ff; }
  .badge.pin { background: #1d4635; color: #7ee2a8; }
  .sessions { max-height: 420px; overflow: auto; }

  .wf { background: var(--panel2); border: 1px solid var(--line); border-radius: 11px;
        padding: 12px; margin-bottom: 10px; }
  .wf .head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
  .wf .head .grow { flex: 1; }
  .wf .name-input { width: 130px; }
  .hint { color: var(--faint); font-size: 12px; margin: 4px 0 12px; }

  .toast { position: fixed; bottom: 22px; right: 22px; display: flex; flex-direction: column;
           gap: 8px; z-index: 50; }
  .toast .t { background: #191926; border: 1px solid var(--line2); color: var(--text);
           border-radius: 10px; padding: 10px 16px; font-size: 13px; box-shadow: 0 12px 30px -10px #000;
           animation: slideIn .25s ease; }
  .toast .t.err { border-color: var(--err); }
  @keyframes slideIn { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }

  /* ---------- Control Room v2 ---------- */
  :root {
    --bg: #070806; --bg2: #0b0d0a; --panel: #10120f; --panel2: #151814;
    --line: #282c25; --line2: #3a4035;
    --text: #f3f1e9; --dim: #a5a99d; --faint: #6d7367;
    --accent: #c8ff63; --accent2: #e4ffae;
    --ok: #65dc84; --err: #ff6666;
    --purple: #9d72ff; --purple-dim: #553b94; --blue: #4f8cff; --blue-dim: #284d91;
    --grey: #454b43; --empty: #1b1e1a; --green: #32a85c; --red: #c83e3e;
    --radius: 20px;
  }
  body {
    min-height: 100vh;
    background:
      radial-gradient(900px 500px at 18% -12%, rgba(96, 122, 255, .18), transparent 62%),
      radial-gradient(820px 440px at 92% 0%, rgba(200, 255, 99, .10), transparent 58%),
      linear-gradient(180deg, #090a08 0%, var(--bg) 64%);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
  }
  body::before {
    content: ''; position: fixed; inset: 0; pointer-events: none; opacity: .16;
    background-image: linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
    background-size: 38px 38px; mask-image: linear-gradient(to bottom, #000, transparent 72%);
  }
  header {
    max-width: 1320px; padding: 30px 30px 12px; gap: 16px; position: relative; z-index: 2;
  }
  .brand-lockup { display: flex; align-items: center; gap: 13px; min-width: 0; }
  .logo {
    width: 42px; height: 42px; border-radius: 13px;
    background: #12160f; border: 1px solid #3c4435;
    box-shadow: inset 0 1px rgba(255,255,255,.06), 0 12px 30px rgba(0,0,0,.35);
  }
  .logo::before { content: ''; position: absolute; inset: 10px; border: 1px solid rgba(200,255,99,.55); border-radius: 6px; }
  .logo::after { inset: 15px 12px; border-radius: 2px; background: repeating-linear-gradient(90deg, var(--accent) 0 2px, transparent 2px 5px); }
  .brand-copy { min-width: 0; }
  header h1 { font-size: 15px; letter-spacing: -.1px; line-height: 1.15; }
  .brand-copy p { margin: 4px 0 0; color: var(--faint); font-size: 11px; letter-spacing: .11em; text-transform: uppercase; }
  header .meta {
    margin-left: auto; padding: 9px 13px; border: 1px solid var(--line); border-radius: 999px;
    background: rgba(15,17,14,.78); color: var(--dim); font-size: 11.5px;
    box-shadow: inset 0 1px rgba(255,255,255,.025); backdrop-filter: blur(14px);
  }
  .livedot { background: #50564c; }
  .livedot.on { background: var(--accent); box-shadow: 0 0 0 4px rgba(200,255,99,.08), 0 0 12px rgba(200,255,99,.55); }
  .local-badge { color: #82887b; font: 10px/1.2 ui-monospace, "SFMono-Regular", monospace; letter-spacing: .07em; text-transform: uppercase; }

  main {
    max-width: 1320px; margin: 18px auto 0; padding: 0 30px 80px;
    grid-template-columns: minmax(610px, 1.2fr) minmax(410px, .8fr); gap: 18px;
  }
  .card {
    background: linear-gradient(145deg, rgba(18,21,17,.94), rgba(10,12,9,.97));
    border: 1px solid var(--line); border-radius: 22px; padding: 20px;
    box-shadow: 0 28px 80px rgba(0,0,0,.24), inset 0 1px rgba(255,255,255,.035);
  }
  .panel-head { display: flex; align-items: flex-start; gap: 20px; margin-bottom: 18px; }
  .panel-kicker { margin: 0 0 5px; color: var(--accent); font: 10px/1.2 ui-monospace, "SFMono-Regular", monospace; text-transform: uppercase; letter-spacing: .14em; }
  .panel-head h2 { color: var(--text); margin: 0; font-size: 21px; text-transform: none; letter-spacing: -.45px; line-height: 1.1; font-weight: 620; }
  .panel-head p:last-child { color: var(--dim); max-width: 380px; margin: 8px 0 0; font-size: 12.5px; line-height: 1.5; }
  .panel-code { margin-left: auto; color: var(--faint); font: 10px/1.2 ui-monospace, "SFMono-Regular", monospace; white-space: nowrap; padding-top: 3px; }
  .deck-card { min-width: 0; }
  .control-card { position: sticky; top: 16px; min-width: 0; }

  .device-viewport { width: 100%; max-width: 100%; overflow-x: auto; scrollbar-width: thin; padding: 1px 1px 12px; }
  .device-shell {
    min-width: 560px; border-radius: 30px; padding: 34px 30px 36px;
    background:
      linear-gradient(145deg, rgba(255,255,255,.07), transparent 22%),
      linear-gradient(165deg, #30342d 0%, #20231f 48%, #121410 100%);
    border: 1px solid #444a40;
    box-shadow: 0 34px 70px -38px #000, inset 0 1px rgba(255,255,255,.1), inset 0 -1px #070807;
  }
  .device-shell::before { top: 13px; width: 66px; height: 5px; background: #090a08; box-shadow: inset 0 1px 2px #000, 0 1px rgba(255,255,255,.07); }
  .device-shell::after { width: 146px; height: 12px; bottom: -10px; background: #181b17; border-color: #353a31; }
  .deck { gap: 13px; margin-top: 4px; }
  .key {
    border-radius: 15px; padding: 5px; background: #070806;
    box-shadow: inset 0 2px 7px rgba(0,0,0,.95), 0 1px rgba(255,255,255,.05);
    transition: transform .11s ease, filter .15s ease;
  }
  .key:hover { transform: translateY(-2px); }
  .key:active { transform: translateY(1px) scale(.96); }
  .key.selected { background: var(--accent); box-shadow: 0 0 0 2px rgba(200,255,99,.18), 0 0 24px rgba(200,255,99,.16); }
  .key.selected .cap { box-shadow: inset 0 0 0 1px rgba(255,255,255,.86); }
  .cap {
    inset: 5px; border-radius: 11px; padding: 7px 6px;
    box-shadow: inset 0 1px rgba(255,255,255,.08), inset 0 -10px 24px rgba(0,0,0,.14);
  }
  .cap .t { font-size: 12px; letter-spacing: .015em; }
  .cap .t.two { font-size: 10px; }
  .cap .sub { margin-top: 4px; font-size: 8px; letter-spacing: .14em; opacity: .72; }
  .cap .corner { top: 5px; left: 7px; font: 8px/1 ui-monospace, monospace; opacity: .75; }
  .cap.wf { background: linear-gradient(145deg, #30395f, #222947); }
  .cap.act.doit { background: linear-gradient(145deg, #1f714e, #145037); }
  .cap.act.stop { background: linear-gradient(145deg, #a23737, #702424); }
  .cap.act.attach { background: linear-gradient(145deg, #956617, #6b470f); }
  .cap.act.sel { background: linear-gradient(145deg, #4f5e6d, #36414c); }

  .legend { margin-top: 12px; padding: 0 4px; gap: 13px; font-size: 10px; align-items: center; }
  .legend .sw { width: 7px; height: 7px; border-radius: 50%; }
  .deck-note { margin-left: auto; color: var(--faint); }
  .deck-note b { color: var(--dim); font-weight: 550; }
  .activity { border-top: 1px solid var(--line); margin-top: 14px; padding-top: 13px; }
  .activity-head { display: flex; justify-content: space-between; color: var(--faint); font: 9px/1.2 ui-monospace, monospace; letter-spacing: .13em; text-transform: uppercase; }
  .feed { margin-top: 7px; padding-top: 0; border: 0; min-height: 44px; max-height: 92px; }
  .feed:empty::before { content: 'State changes will appear here'; color: #53584f; font-family: inherit; }

  .tabs { gap: 4px; margin-bottom: 18px; padding: 4px; border: 1px solid var(--line); border-radius: 13px; background: #0b0d0a; }
  .tab-btn { padding: 9px 4px; border: 0; border-radius: 9px; font-size: 11.5px; }
  .tab-btn.on { border: 0; color: #11140d; background: var(--accent); box-shadow: none; }
  .inspector { padding: 16px; border-radius: 14px; background: #0d0f0c; }
  .inspector .title { flex-wrap: wrap; }
  .inspector .title h3 { font-size: 18px; letter-spacing: -.25px; }
  .inspector .sid { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .inspector .msg { background: #090a08; border-color: #242820; color: #d5d8ce; line-height: 1.55; }
  .actions { gap: 8px; }
  button.btn { border-color: var(--line); background: #171a15; border-radius: 9px; padding: 7px 11px; }
  button.btn:hover { border-color: #68735d; color: var(--accent2); background: #1c2019; }
  button.btn.primary { color: #11140d; background: var(--accent); border-color: var(--accent); box-shadow: none; }
  button.btn.primary:hover { color: #11140d; background: var(--accent2); }
  button.btn.danger:hover { color: #ff9696; border-color: #8e3c3c; }
  input[type=text], textarea, select { background: #090a08; border-color: var(--line); border-radius: 9px; }
  input[type=text]:focus, textarea:focus { border-color: #7d9a4d; box-shadow: 0 0 0 3px rgba(200,255,99,.06); }
  .slotlist .row, .sessions .row { padding: 11px 8px; border-color: #232620; }
  .slotlist .row:hover, .sessions .row:hover { background: #151813; }
  .badge { background: #22261f; color: var(--dim); }
  .badge.key { background: #202944; color: #9ab5ff; }
  .badge.pin { color: #16200e; background: #b8e96c; }
  .wf { background: #0d0f0c; border-color: var(--line); border-radius: 13px; }
  .toast .t { background: #181b16; border-color: #3a4034; }

  @media (max-width: 1080px) {
    main { grid-template-columns: 1fr; max-width: 760px; }
    header { max-width: 760px; }
    .control-card { position: static; }
  }
  @media (max-width: 620px) {
    header { padding: 20px 16px 8px; align-items: flex-start; flex-wrap: wrap; }
    .brand-lockup { width: 100%; }
    header .meta { margin-left: 0; max-width: 100%; }
    .local-badge { margin-left: auto; padding-top: 5px; }
    main { margin-top: 10px; padding: 0 12px 50px; gap: 12px; }
    .card { padding: 15px; border-radius: 18px; }
    .panel-head { margin-bottom: 14px; }
    .panel-head h2 { font-size: 18px; }
    .panel-head p:last-child { display: none; }
    .device-shell { min-width: 520px; padding: 31px 26px 32px; }
    .deck { gap: 11px; }
    .legend { gap: 9px; }
    .deck-note { display: none; }
    .tabs { overflow-x: auto; }
    .tab-btn { min-width: 80px; }
    .inspector .title h3 { font-size: 16px; }
    .sessions { max-height: 340px; }
  }
</style>
</head>
<body>
<header>
  <div class="brand-lockup">
    <div class="logo"></div>
    <div class="brand-copy">
      <h1>Stream Deck Micro</h1>
      <p>Local agent command center</p>
    </div>
  </div>
  <span class="local-badge">127.0.0.1 · local only</span>
  <div class="meta">
    <span class="livedot" id="livedot"></span>
    <span id="meta">connecting…</span>
  </div>
</header>

<main>
  <div class="card deck-card">
    <div class="panel-head">
      <div><p class="panel-kicker">Physical surface</p><h2>Your agents, at a glance.</h2><p>The virtual deck and the hardware share one command path. Click any key here to drive the same action.</p></div>
      <span class="panel-code">MK.2 / 15 KEY</span>
    </div>
    <div class="device-viewport">
      <div class="device-shell">
        <div class="deck" id="deck"></div>
      </div>
    </div>
    <div class="legend">
      <span><span class="sw" style="background:var(--grey)"></span>idle</span>
      <span><span class="sw" style="background:var(--purple)"></span>thinking</span>
      <span><span class="sw" style="background:var(--blue)"></span>working</span>
      <span><span class="sw" style="background:var(--green)"></span>done</span>
      <span><span class="sw" style="background:var(--red)"></span>error</span>
      <span class="deck-note"><b>Interactive</b> — clicks drive the real deck</span>
    </div>
    <div class="activity"><div class="activity-head"><span>Live activity</span><span>Newest first</span></div><div class="feed" id="feed"></div></div>
  </div>

  <div class="card control-card">
    <div class="panel-head">
      <div><p class="panel-kicker">Control Room</p><h2>Shape the surface.</h2><p>Inspect sessions, assign slots, and tune the prompts behind every workflow key.</p></div>
    </div>
    <div class="tabs">
      <button class="tab-btn on" data-tab="slots">Slots</button>
      <button class="tab-btn" data-tab="sessions">Sessions</button>
      <button class="tab-btn" data-tab="workflows">Keys</button>
      <button class="tab-btn" data-tab="library">Library</button>
    </div>

    <div class="tabpage on" id="tab-slots">
      <div id="inspector"></div>
      <div class="slotlist" id="slotlist"></div>
    </div>

    <div class="tabpage" id="tab-sessions">
      <input type="text" class="search" id="search" placeholder="search sessions by name or id…" style="margin-bottom:10px">
      <div class="hint" id="attachHint"></div>
      <div class="sessions" id="sessions"></div>
    </div>

    <div class="tabpage" id="tab-workflows">
      <div class="hint">do-it is pinned to its own key; the rest fill the workflow row in order (max 5 more). Saving rewrites config.json and repaints the physical deck instantly.</div>
      <div id="workflows"></div>
      <div class="actions" style="margin-top:10px">
        <button class="btn" id="wfAdd">＋ new</button>
        <button class="btn primary" id="wfSave">Save to deck</button>
      </div>
    </div>

    <div class="tabpage" id="tab-library">
      <div class="hint">Parked prompts. Activate moves one back onto the keys.</div>
      <div id="library"></div>
      <div class="actions" style="margin-top:10px">
        <button class="btn" id="libAdd">＋ add</button>
      </div>
    </div>
  </div>
</main>
<div class="toast" id="toast"></div>

<script>
'use strict';
var $ = function(id) { return document.getElementById(id); };
var apiToken = document.querySelector('meta[name="sdm-api-token"]').content;
var editing = false;
document.addEventListener('focusin', function(e) {
  editing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
});
document.addEventListener('focusout', function() { editing = false; });

var STATE_COLORS = { empty:'#202026', idle:'#3a3f44', thinking:'#7c3aed',
                     running:'#2563eb', done:'#16a34a', error:'#dc2626' };
var CAPTIONS = { empty:'empty', idle:'idle', thinking:'thinking', running:'working',
                 done:'done', error:'error' };

var lastStatus = null;
var allSessions = [];
var wfActive = [];
var wfLibrary = [];
var prevStates = {};
var feedLines = [];

function esc(s) {
  return String(s).replace(/[&<>"]/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
  });
}
function toast(msg, err) {
  var box = $('toast');
  var t = document.createElement('div');
  t.className = 't' + (err ? ' err' : '');
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(function() { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2200);
  setTimeout(function() { t.remove(); }, 2600);
}
function api(cmd, args, method) {
  var opts = args !== undefined
    ? { method: method || 'POST', headers: {'content-type':'application/json', 'x-stream-deck-micro-token':apiToken},
        body: JSON.stringify(args) }
    : { headers: {'x-stream-deck-micro-token':apiToken} };
  return fetch('/api/' + cmd, opts).then(function(res) {
    return res.json().catch(function() { return {}; }).then(function(data) {
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    });
  });
}

/* ---------- the device ---------- */
function keyEl(html, cls, onclick, tip) {
  var k = document.createElement('div');
  k.className = 'key';
  var cap = document.createElement('div');
  cap.className = 'cap ' + (cls || '');
  cap.innerHTML = html;
  k.appendChild(cap);
  if (tip) k.title = tip;
  if (onclick) k.addEventListener('click', function() {
    k.classList.add('pressed');
    setTimeout(function() { k.classList.remove('pressed'); }, 120);
    Promise.resolve(onclick()).then(refresh).catch(function(e) { toast(e.message, true); });
  });
  return { root: k, cap: cap };
}

function twoLines(label) {
  if (!label) return '';
  var words = String(label).split(' ');
  var lines = [], cur = '';
  for (var i = 0; i < words.length && lines.length < 2; i++) {
    var cand = cur ? cur + ' ' + words[i] : words[i];
    if (cand.length <= 12) cur = cand;
    else { if (cur) lines.push(cur); cur = words[i]; }
  }
  if (lines.length < 2 && cur) lines.push(cur);
  else if (lines.length === 2 && cur) lines[1] += '…';
  var cls = lines.length > 1 ? 't two' : 't';
  var out = '';
  for (var j = 0; j < lines.length; j++) out += '<span class="' + cls + '">' + esc(lines[j]) + '</span>';
  return out;
}

function renderDeck(status) {
  var deck = $('deck');
  deck.innerHTML = '';
  var slots = status.slots;
  var wfById = {};
  wfActive.forEach(function(w) { wfById[w.id] = w; });

  function slotClick(i) {
    if (slots[i].state === 'empty') { toast('slot ' + (i+1) + ' is empty — attach a session from the Sessions tab'); return null; }
    return api('select', { index: i });
  }

  slots.slice(0, 5).forEach(function(s, i) { deck.appendChild(mkSlotKey(s, i, function() { return slotClick(i); }).root); });
  var s6 = slots[5];
  var k6 = mkSlotKey(s6, 5, function() { return slotClick(5); });
  deck.appendChild(k6.root);

  var doit = wfById['do-it'];
  deck.appendChild(keyEl('<span class="t">DO IT</span><span class="sub">lets do it</span>',
    'act doit', function() { return api('workflow', { id: 'do-it' }).then(function() { toast('“lets do it” sent'); }); },
    doit ? doit.prompt : 'do-it workflow not configured').root);
  deck.appendChild(keyEl('<span class="t">STOP</span><span class="sub">interrupt</span>',
    'act stop', function() { return api('stop').then(function() { toast('interrupt sent'); }); },
    'interrupt the selected slot').root);
  deck.appendChild(keyEl('<span class="t">ATCH</span><span class="sub">pull in</span>',
    'act attach', function() { return api('attach', {}).then(function(r) { toast('attached “' + (r.name || '?') + '” → slot ' + (r.index+1) + ' (' + r.mode + ')'); }); },
    'attach the newest codex session to a free slot').root);

  var rest = wfActive.filter(function(w) { return w.id !== 'do-it'; });
  var restKeys = [10, 11, 12, 13, 9];
  var cells = [];
  for (var i = 0; i < 5; i++) {
    var w = rest[i];
    if (w) cells.push(keyEl('<span class="t">' + esc(w.name.slice(0,10)) + '</span>', 'wf',
      (function(wid) { return function() { return api('workflow', { id: wid }).then(function() { toast('workflow sent'); }); }; })(w.id),
      w.prompt).root);
    else cells.push(keyEl('<span class="sub">—</span>', 'wf', null, 'free workflow key').root);
  }
  cells.forEach(function(c) { deck.appendChild(c); });
  // SEL is the last cell (bottom-right corner, key 14)
  deck.appendChild(keyEl('<span class="t">SEL</span><span class="sub">cycle</span>',
    'act sel', function() {
      var occ = [];
      lastStatus.slots.forEach(function(s) { if (s.state !== 'empty') occ.push(s.index); });
      if (!occ.length) { toast('no sessions attached'); return null; }
      var cur = lastStatus.selectedIndex;
      var next = occ[(occ.indexOf(cur) + 1) % occ.length];
      return api('select', { index: next });
    }, 'cycle selection').root);
}

function mkSlotKey(s, i, onclick) {
  var selected = lastStatus && lastStatus.selectedIndex === i;
  var pulse = s.state === 'thinking' ? ' pulse-thinking' : s.state === 'running' ? ' pulse-running' : '';
  var html = s.state === 'empty'
    ? '<span class="corner">' + (i+1) + '</span><span class="sub">empty</span>'
    : '<span class="corner">' + (i+1) + '</span>' + twoLines(s.label) +
      '<span class="sub">' + CAPTIONS[s.state] + '</span>';
  var el = keyEl(html, 'st-' + s.state + pulse, onclick,
    s.state === 'empty' ? 'empty slot' : (s.label + ' — ' + s.state + (s.detail ? ' · ' + s.detail : '')));
  if (selected) el.root.classList.add('selected');
  return el;
}

function pushFeed(line) {
  feedLines.unshift('<div><span class="t">' + new Date().toLocaleTimeString() + '</span>' + esc(line) + '</div>');
  if (feedLines.length > 8) feedLines.pop();
  $('feed').innerHTML = feedLines.join('');
}

/* ---------- slots tab ---------- */
function renderInspector(status) {
  var i = status.selectedIndex;
  var s = status.slots[i];
  var el = $('inspector');
  if (!s || s.state === 'empty') {
    el.innerHTML = '<div class="inspector"><div class="title"><h3>Slot ' + (i+1) + ' — empty</h3></div>' +
      '<p class="detail">Nothing attached. Use <b>Sessions</b> to pull one in, or hit <b>ATCH</b> on the device.</p></div>';
    return;
  }
  el.innerHTML =
    '<div class="inspector">' +
    '<div class="title"><span class="dot" style="background:' + (STATE_COLORS[s.state]||'#888') + '"></span>' +
    '<h3>' + esc(s.label) + '</h3>' +
    '<span class="badge">slot ' + (s.index+1) + '</span>' +
    '<span class="badge">' + s.state + '</span></div>' +
    '<div class="sid">' + String(s.sessionId) + ' · ' + esc(s.cwd) + '</div>' +
    '<p class="detail">' + esc(s.detail || 'no activity recorded') + '</p>' +
    (s.lastMessage ? '<div class="msg">' + esc(s.lastMessage) + '</div>'
                   : '<div class="msg empty-msg">last agent message will appear here after the next turn</div>') +
    '<div class="actions" id="inspActions"></div></div>';

  var actions = $('inspActions');
  var renameBtn = mkBtn('Rename', 'btn', function() {
    var label = prompt('Custom label (leave empty to reset to automatic):', s.customLabel || s.label);
    if (label === null) return null;
    return api('rename', { index: s.index, label: label }).then(function() { toast(label ? 'renamed' : 'label reset'); });
  });
  var stopBtn = mkBtn('Stop turn', 'btn', function() { return api('stop'); });
  var removeBtn = mkBtn('Remove', 'btn danger', function() {
    return api('clear', { index: s.index }).then(function() { toast('slot ' + (s.index+1) + ' cleared'); });
  });
  actions.append(renameBtn, stopBtn, removeBtn);
}

function renderSlotList(status) {
  var el = $('slotlist');
  el.innerHTML = '';
  status.slots.forEach(function(s) {
    var row = document.createElement('div');
    row.className = 'row';
    var attached = s.state !== 'empty';
    row.innerHTML =
      '<span class="dot" style="width:9px;height:9px;border-radius:50%;background:' + (STATE_COLORS[s.state]||'#888') + ';flex:none"></span>' +
      '<div class="name">' + (attached ? esc(s.label) : '<span style="color:var(--faint)">slot ' + (s.index+1) + ' — empty</span>') + '</div>' +
      (s.index === status.selectedIndex ? '<span class="badge pin">selected</span>' : '');
    if (attached && s.index !== status.selectedIndex) {
      row.appendChild(mkBtn('select', 'btn mini', function() { return api('select', { index: s.index }); }));
    }
    el.appendChild(row);
  });
}

function mkBtn(text, cls, onClick) {
  var b = document.createElement('button');
  b.className = cls || 'btn';
  b.textContent = text;
  b.addEventListener('click', function(ev) {
    ev.stopPropagation();
    Promise.resolve(onClick()).then(refresh).catch(function(e) { toast(e.message, true); });
  });
  return b;
}

/* ---------- sessions tab ---------- */
function renderSessions() {
  var q = $('search').value.trim().toLowerCase();
  var rows = allSessions.filter(function(s) {
    return !q || (s.name || '').toLowerCase().indexOf(q) !== -1 || s.id.indexOf(q) !== -1;
  });
  var el = $('sessions');
  el.innerHTML = '';
  var free = lastStatus && lastStatus.slots.some(function(s) { return s.state === 'empty'; });
  $('attachHint').textContent = free ? '' : 'all slots busy — remove one from the Slots tab first';
  var attached = {};
  if (lastStatus) lastStatus.slots.forEach(function(s) { if (s.sessionId) attached[s.sessionId] = s.index; });
  rows.forEach(function(s) {
    var row = document.createElement('div');
    row.className = 'row';
    var badge = attached[s.id] !== undefined ? '<span class="badge pin">slot ' + (attached[s.id]+1) + '</span>' : '';
    row.innerHTML = '<div class="name">' + esc(s.name || s.id.slice(0, 10)) + '</div>' +
      '<span class="when">' + (s.updatedAt || '').replace('T',' ').slice(0, 16) + '</span>' + badge;
    if (attached[s.id] === undefined) {
      var btn = mkBtn('Attach', 'btn mini', function() {
        return api('attach', { id: s.id }).then(function(r) {
          toast('attached → slot ' + (r.index+1) + ' (' + r.mode + ')');
        });
      });
      btn.disabled = !free;
      row.appendChild(btn);
    }
    el.appendChild(row);
  });
  if (!rows.length) el.innerHTML = '<div class="hint">no sessions match</div>';
}

/* ---------- workflows & library ---------- */
function keyBadge(i) {
  if (i === 0 && wfActive[0] && wfActive[0].id === 'do-it') return '<span class="badge pin">DO IT key</span>';
  var keys = ['K10','K11','K12','K13','K9'];
  var off = (wfActive[0] && wfActive[0].id === 'do-it') ? i - 1 : i;
  return '<span class="badge key">' + (keys[off] || '—') + '</span>';
}

function renderWorkflows() {
  var el = $('workflows');
  el.innerHTML = '';
  wfActive.forEach(function(w, i) {
    var div = document.createElement('div');
    div.className = 'wf';
    div.innerHTML =
      '<div class="head">' + keyBadge(i) +
      '<input type="text" class="name-input" maxlength="10" value="' + esc(w.name) + '" data-i="' + i + '" data-f="name">' +
      '<span class="grow"></span>' +
      '<button class="btn mini" data-act="up" data-i="' + i + '"' + (i <= 1 ? ' disabled' : '') + '>↑</button>' +
      '<button class="btn mini" data-act="down" data-i="' + i + '"' + (i === wfActive.length - 1 ? ' disabled' : '') + '>↓</button>' +
      '<button class="btn mini" data-act="run" data-i="' + i + '">▶ run</button>' +
      '<button class="btn mini danger" data-act="toLib" data-i="' + i + '"' + (w.id === 'do-it' ? ' disabled' : '') + '>→ library</button></div>' +
      '<textarea data-i="' + i + '" data-f="prompt" placeholder="prompt sent to the selected slot…">' + esc(w.prompt) + '</textarea>';
    div.addEventListener('input', function(ev) {
      if (ev.target.dataset.f) wfActive[+ev.target.dataset.i][ev.target.dataset.f] = ev.target.value;
    });
    div.addEventListener('click', function(ev) {
      var act = ev.target.dataset && ev.target.dataset.act;
      if (!act) return;
      var i = +ev.target.dataset.i;
      if (act === 'up' && i > 1) { var t = wfActive[i-1]; wfActive[i-1] = wfActive[i]; wfActive[i] = t; renderWorkflows(); }
      if (act === 'down') { var t2 = wfActive[i+1]; wfActive[i+1] = wfActive[i]; wfActive[i] = t2; renderWorkflows(); }
      if (act === 'run') { api('workflow', { id: wfActive[i].id }).then(function() { toast('“' + wfActive[i].name + '” sent'); refresh(); }).catch(function(e) { toast(e.message, true); }); }
      if (act === 'toLib' && wfActive[i].id !== 'do-it') { wfLibrary.push(wfActive.splice(i, 1)[0]); renderWorkflows(); renderLibrary(); }
    });
    el.appendChild(div);
  });
}

function renderLibrary() {
  var el = $('library');
  el.innerHTML = '';
  if (!wfLibrary.length) el.innerHTML = '<div class="hint">library is empty</div>';
  wfLibrary.forEach(function(w, i) {
    var div = document.createElement('div');
    div.className = 'wf';
    div.innerHTML =
      '<div class="head"><input type="text" class="name-input" maxlength="10" value="' + esc(w.name) + '" data-i="' + i + '" data-f="name">' +
      '<span class="grow"></span>' +
      '<button class="btn mini" data-act="activate" data-i="' + i + '">Activate →</button>' +
      '<button class="btn mini danger" data-act="del" data-i="' + i + '">Delete</button></div>' +
      '<textarea data-i="' + i + '" data-f="prompt">' + esc(w.prompt) + '</textarea>';
    div.addEventListener('input', function(ev) {
      if (ev.target.dataset.f) wfLibrary[+ev.target.dataset.i][ev.target.dataset.f] = ev.target.value;
    });
    div.addEventListener('click', function(ev) {
      var act = ev.target.dataset && ev.target.dataset.act;
      if (!act) return;
      var i = +ev.target.dataset.i;
      if (act === 'activate') {
        if (wfActive.length >= 6) { toast('keys are full (do-it + 5)', true); return; }
        wfActive.push(wfLibrary.splice(i, 1)[0]); renderWorkflows(); renderLibrary();
      }
      if (act === 'del') { wfLibrary.splice(i, 1); renderLibrary(); }
    });
    el.appendChild(div);
  });
}

$('wfAdd').addEventListener('click', function() {
  if (wfActive.length >= 6) { toast('keys are full (do-it + 5)', true); return; }
  wfActive.push({ id: 'wf-' + Date.now().toString(36), name: 'NEW', prompt: '' });
  renderWorkflows();
});
$('libAdd').addEventListener('click', function() {
  wfLibrary.push({ id: 'lib-' + Date.now().toString(36), name: 'NEW', prompt: '' });
  renderLibrary();
});
$('wfSave').addEventListener('click', function() {
  api('workflows.set', { workflows: wfActive, workflowsLibrary: wfLibrary }, 'PUT')
    .then(function() { toast('saved — deck repainted'); refresh(); })
    .catch(function(e) { toast(e.message, true); });
});
$('search').addEventListener('input', renderSessions);

document.querySelectorAll('.tab-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('on'); });
    document.querySelectorAll('.tabpage').forEach(function(p) { p.classList.remove('on'); });
    btn.classList.add('on');
    $('tab-' + btn.dataset.tab).classList.add('on');
  });
});

/* ---------- refresh loop ---------- */
function refresh() {
  return api('status').then(function(status) {
    lastStatus = status;
    var active = status.slots.filter(function(s) { return s.state === 'thinking' || s.state === 'running'; }).length;
    $('livedot').classList.toggle('on', true);
    $('meta').textContent = status.harness + ' · ' +
      status.slots.filter(function(s) { return s.state !== 'empty'; }).length + '/6 sessions' +
      (active ? ' · ' + active + ' active' : '');
    status.slots.forEach(function(s) {
      var prev = prevStates[s.index];
      if (prev !== undefined && prev !== s.state) {
        pushFeed('slot ' + (s.index+1) + ' ' + s.label + ': ' + prev + ' → ' + s.state);
      }
      prevStates[s.index] = s.state;
    });
    renderDeck(status);
    if (!editing) { renderInspector(status); renderSlotList(status); renderSessions(); }
  }).catch(function(e) {
    $('livedot').classList.remove('on');
    $('meta').textContent = 'daemon unreachable: ' + e.message;
  });
}

function loadWorkflows() {
  return api('workflows.get').then(function(data) {
    wfActive = data.active || [];
    wfLibrary = data.library || [];
    renderWorkflows();
    renderLibrary();
  });
}
function loadSessions() {
  return api('sessions').then(function(s) { allSessions = s; if (!editing) renderSessions(); })
    .catch(function() {});
}

refresh().then(function() {
  return Promise.all([loadWorkflows(), loadSessions()]);
}).then(function() {
  renderDeck(lastStatus);
});
setInterval(function() {
  if (editing) return;
  refresh().then(function() {
    if (lastStatus) renderDeck(lastStatus); // deck always repaints: pulse stays alive
  });
  loadSessions();
}, 1500);
</script>
</body>
</html>
`;
