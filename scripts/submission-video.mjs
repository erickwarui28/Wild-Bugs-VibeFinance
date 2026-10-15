import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium, expect as baseExpect } from '@playwright/test';
import { scenes } from './submission-video-plan.mjs';
const expect = baseExpect.configure({ timeout: 45000 });

const output = path.resolve(process.env.VF_VIDEO_OUTPUT || 'test-results/submission-video');
const ffmpeg = process.env.VF_VIDEO_FFMPEG;
const ffprobe = ffmpeg?.replace(/ffmpeg\.exe$/i, 'ffprobe.exe');
const command = process.argv[2];
await fs.mkdir(output, { recursive: true });
function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: output, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Media command failed').slice(-5000));
  return result.stdout;
}
function duration(file) { return Number(run(ffprobe, ['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',file]).trim()); }
function phrases(text) {
  const words = text.split(/\s+/); const result=[];
  while(words.length) { let count=Math.min(17,words.length); if(words.length>17) {
    for(let i=16;i>=9;i--) if(/[,.!?;]$/.test(words[i])) {count=i+1;break;}
  } result.push(words.splice(0,count).join(' ')); }
  return result;
}
const time = seconds => { const ms=Math.round(seconds*1000); return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`; };
if(command==='prepare') {
  let index=0;
  const plan={voice:'Installed Microsoft Zira desktop voice; local synthetic narration',scenes:scenes.map(scene=>({...scene,
    captions:phrases(scene.text).map(text=>({text,wav:path.join(output,`voice-${String(index++).padStart(3,'0')}.wav`)}))}))};
  await fs.writeFile(path.join(output,'plan.json'),JSON.stringify(plan,null,2));
  console.log(JSON.stringify({plan:path.join(output,'plan.json'),words:scenes.map(s=>s.text.split(/\s+/).length).reduce((a,b)=>a+b,0),captions:index}));
} else if(command==='audio') {
  const plan=JSON.parse(await fs.readFile(path.join(output,'plan.json'),'utf8')); let start=0;const subtitles=[];
  for(const scene of plan.scenes) {
    let cursor=1.5;
    const input=[];
    for(const caption of scene.captions) {
      caption.duration=duration(caption.wav); caption.start=cursor;
      subtitles.push({start:start+cursor,end:start+cursor+caption.duration,text:caption.text});
      cursor+=caption.duration; input.push(`file '${path.basename(caption.wav)}'`);
    }
    scene.duration=Math.max(scene.seconds,cursor+1.5);scene.start=start;start+=scene.duration;
    await fs.writeFile(path.join(output,`${scene.id}-audio.txt`),input.join('\n'));
    run(ffmpeg,['-y','-v','error','-f','concat','-safe','0','-i',`${scene.id}-audio.txt`,'-af',`adelay=1500:all=1,apad=whole_dur=${scene.duration}`,'-t',String(scene.duration),`${scene.id}.wav`]);
  }
  if(start>300) throw new Error(`Narration is ${start.toFixed(1)} seconds; shorten the plan before recording.`);
  plan.duration=start;
  await fs.writeFile(path.join(output,'timing.json'),JSON.stringify(plan,null,2));
  await fs.writeFile(path.join(output,'VibeFinance-Live-Submission-Demo.srt'),subtitles.map((s,i)=>`${i+1}\n${time(s.start)} --> ${time(s.end)}\n${s.text}\n`).join('\n'));
  await fs.writeFile(path.join(output,'audio-concat.txt'),plan.scenes.map(scene=>`file '${scene.id}.wav'`).join('\n'));
  run(ffmpeg,['-y','-v','error','-f','concat','-safe','0','-i','audio-concat.txt','-af','loudnorm=I=-16:TP=-1.5:LRA=11','narration.wav']);
  await fs.writeFile(path.join(output,'Narration-and-YouTube-chapters.md'),'# VibeFinance submission demo\n\n'+plan.scenes.map(scene=>`## ${time(scene.start).slice(3,8)} ${scene.title}\n\n${scene.text}\n`).join('\n')+'\nRecorded from the deployed app. Live source dates and coverage are disclosed. Synthetic segments are explicitly labelled. Local synthetic narration. No music. Not financial advice.\n');
  console.log(JSON.stringify({durationSeconds:start,chapters:plan.scenes.length}));
} else if(command==='record') {
  const plan=JSON.parse(await fs.readFile(path.join(output,'timing.json'),'utf8'));
  const browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1440,height:810},recordVideo:{dir:output,size:{width:1440,height:810}}});
  await context.addInitScript(()=>localStorage.setItem('vf-run-mode','live'));
  let executions=0,liveResult=null,compareResult=null;const errors=[];
  await context.route(/\/api\/(analyze|compare)$/,async route=>{
    const body=route.request().postDataJSON(); executions++;
    if(executions>12||!['live','demo'].includes(body?.mode)) {errors.push('Blocked unexpected/excess analysis');await route.abort();}
    else await route.continue();
  });
  const before=Date.now();const page=await context.newPage();const video=page.video();
  page.setDefaultTimeout(45000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',async response=>{ if(response.url().endsWith('/api/analyze')&&response.ok()) {const body=await response.json();if(body.dataMode==='live'||body.dataMode==='cached')liveResult=body;} if(response.url().endsWith('/api/compare')&&response.ok())compareResult=await response.json(); });
  const hold=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,ms)));
  const nav=async name=>{await page.getByRole('link',{name,exact:true}).click();};
  const scroll=async locator=>{await locator.scrollIntoViewIfNeeded();await hold(650);};
  const at=async(start,seconds)=>hold(start+seconds*1000-Date.now());
  try {
    await page.goto('https://erickwarui28.github.io/vibefinance/',{waitUntil:'domcontentloaded'});
    await expect(page.getByRole('button',{name:'Save research note',exact:true})).toBeVisible();
    await expect(page.locator('.recharts-line-curve')).toBeVisible();
    if(!liveResult||liveResult.provenance==='SYNTHETIC')throw Error('A genuine connected Live result is required; do not fake this recording.');
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await hold(800);
    const trimStart=(Date.now()-before)/1000;const timeline=Date.now();
    for(const scene of plan.scenes) {
      const start=timeline+scene.start*1000;await at(start,0);
      console.log(`Recording chapter: ${scene.title}`);
      if(scene.id==='live-overview') {
        await at(start,13);await scroll(page.locator('.bento-signals').first());await at(start,24);await page.evaluate(()=>window.scrollTo({top:0,behavior:'smooth'}));
      } else if(scene.id==='live-sources') {
        await scroll(page.getByRole('region',{name:'Source freshness and coverage'}));
        await page.getByText('Details: Institutional flows',{exact:true}).click();await at(start,12);
        await page.getByText('Details: Institutional flows',{exact:true}).click();
        await page.getByRole('button',{name:/ret20@/}).first().click();await at(start,27);await page.keyboard.press('Escape');
      } else if(scene.id==='live-compare') {
        await nav('Compare');await expect(page.getByRole('main').getByText('Asha · Conservative',{exact:true})).toBeVisible();
        await scroll(page.getByRole('main').getByText('Asha · Conservative',{exact:true}));await at(start,25);await page.evaluate(()=>window.scrollTo({top:0,behavior:'smooth'}));
      } else if(scene.id==='live-trace') {
        if(!compareResult)throw Error('Compare result missing');
        await page.evaluate(id=>{location.hash=`/trace/${id}`;},liveResult.runId);
        await expect(page.getByRole('region',{name:'Reasoning overview'})).toBeVisible();await at(start,13);
        await scroll(page.getByText('Total elapsed:',{exact:false}));await page.mouse.wheel(0,500);await at(start,26);await page.evaluate(()=>window.scrollTo({top:0,behavior:'smooth'}));
      } else if(scene.id==='demo-retrieval') {
        await page.getByRole('button',{name:'Demo',exact:true}).click();await nav('Dashboard');
        await expect(page.getByRole('button',{name:'Run demo: INFY · moderate',exact:true})).toBeEnabled();
        await expect(page.getByRole('button',{name:/DOC-INFY-Q2-T#c0/}).first()).toBeVisible();await at(start,9);
        await page.getByRole('button',{name:/DOC-INFY-Q2-T#c0/}).first().click();await at(start,18);
        await page.getByRole('link',{name:'Open document',exact:true}).click();await expect(page.getByText('SYNTHETIC DOCUMENT',{exact:true})).toBeVisible();
        await scroll(page.getByText('SYNTHETIC DOCUMENT',{exact:true}));
      } else if(scene.id==='demo-failures') {
        await nav('Dashboard');await page.getByRole('button',{name:/^Degrade ·/}).click();
        const missing=page.waitForResponse(r=>r.url().endsWith('/api/analyze')&&r.request().postDataJSON()?.degrade?.includes('missingFiling'));
        await page.getByRole('switch',{name:'Missing filing',exact:true}).click();await page.keyboard.press('Escape');
        const absent=await(await missing).json();if(absent.agents.find(a=>a.agent==='sentiment')?.label!=='insufficient_evidence')throw Error('Missing evidence demonstration failed');
        await scroll(page.locator('.bento-signals').first());await at(start,15);
        await page.getByRole('button',{name:/^Degrade ·/}).click();
        const conflict=page.waitForResponse(r=>r.url().endsWith('/api/analyze')&&r.request().postDataJSON()?.degrade?.includes('conflictingAgents')&&!r.request().postDataJSON()?.degrade?.includes('missingFiling'));
        await page.getByRole('switch',{name:'Missing filing',exact:true}).click();await page.getByRole('switch',{name:'Conflicting agents',exact:true}).click();await page.keyboard.press('Escape');await conflict;
        await scroll(page.locator('.bento-summary').first());
      } else if(scene.id==='journal') {
        await page.getByRole('button',{name:/^Degrade ·/}).click();
        const clear=page.waitForResponse(r=>r.url().endsWith('/api/analyze')&&r.request().postDataJSON()?.mode==='demo'&&r.request().postDataJSON()?.degrade?.length===0);
        await page.getByRole('switch',{name:'Conflicting agents',exact:true}).click();await page.keyboard.press('Escape');await clear;
        await page.getByRole('button',{name:'Save research note',exact:true}).click();await nav('Journal');
        await page.getByRole('textbox',{name:'Your research note',exact:true}).fill('Review source coverage and conflicting signals before changing exposure.');
        await at(start,15);await page.getByText('Saved source coverage',{exact:true}).click();
      } else if(scene.id==='evaluation') {
        await nav('Eval');await expect(page.getByRole('heading',{name:'Same-sample baselines and methodology'})).toBeVisible();
        await at(start,13);await scroll(page.getByRole('heading',{name:'Retrieval grounding checks'}));
        await at(start,23);await scroll(page.getByRole('heading',{name:'Engine workload benchmark'}));
      } else if(scene.id==='closing') {
        await nav('Dashboard');await expect(page.getByRole('button',{name:'Save research note',exact:true})).toBeVisible();await page.evaluate(()=>window.scrollTo({top:0,behavior:'smooth'}));
      }
      if(Date.now()>start+(scene.duration-0.3)*1000)throw Error(`Chapter overran planned narration: ${scene.id}`);
      await at(start,scene.duration);
      await page.screenshot({path:path.join(output,`${scene.id}-check.png`)});
    }
    if(errors.length)throw Error(errors.join('\n'));
    await context.close();await video.saveAs(path.join(output,'browser-recording.webm'));
    await fs.writeFile(path.join(output,'capture.json'),JSON.stringify({trimStart,duration:plan.duration,executions,
      live:{dataMode:liveResult.dataMode,provenance:liveResult.provenance,asOf:liveResult.asOf},source:'https://erickwarui28.github.io/vibefinance/',syntheticScenesExplicit:true},null,2));
    console.log(JSON.stringify({recorded:true,duration:plan.duration,executions,liveMode:liveResult.dataMode}));
  } finally {await browser.close();}
} else if(command==='render') {
  const plan=JSON.parse(await fs.readFile(path.join(output,'timing.json'),'utf8'));
  const capture=JSON.parse(await fs.readFile(path.join(output,'capture.json'),'utf8'));
  run(ffmpeg,['-y','-v','warning','-ss',String(capture.trimStart),'-i','browser-recording.webm','-i','narration.wav',
    '-vf',"scale=1920:1080,subtitles=VibeFinance-Live-Submission-Demo.srt:force_style='FontName=Arial,FontSize=12,PrimaryColour=&HFFFFFF,OutlineColour=&H90000000,BorderStyle=3,Outline=2,Shadow=0,MarginV=12'",
    '-t',String(plan.duration),'-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-r','25','-c:a','aac','-ar','48000','-b:a','160k','-movflags','+faststart',
    '-metadata','title=VibeFinance Live Submission Demo','-metadata','comment=Live-first walkthrough with clearly labelled synthetic demonstrations; local synthetic narration; not financial advice.',
    'VibeFinance-Live-Submission-Demo.mp4']);
  console.log(JSON.stringify({video:path.join(output,'VibeFinance-Live-Submission-Demo.mp4'),duration:duration('VibeFinance-Live-Submission-Demo.mp4')}));
} else throw new Error('Use prepare, audio, record or render');
