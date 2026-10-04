import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
const repo='/Users/shaashwatprasad/.codex/worktrees/a340/CalcInk';
const require=createRequire(`${repo}/package.json`);
const {chromium}=require('playwright');
const esbuild=require('esbuild');
const compiled=await esbuild.build({stdin:{contents:"export {mountProjection} from './src/render/mountProjection';",resolveDir:repo},bundle:true,format:'esm',write:false});
const moduleUrl=`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`;
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const report={browserVersion:browser.version(),cases:[]};
for(const dpr of [1,2]){
 const context=await browser.newContext({viewport:{width:1280,height:1000},deviceScaleFactor:dpr});
 const page=await context.newPage();
 await page.addInitScript(()=>{
  window.__audit={dimensions:[],errors:[]};
  for(const property of ['width','height']){const original=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,property);Object.defineProperty(HTMLCanvasElement.prototype,property,{...original,set(value){window.__audit.dimensions.push({property,value,before:original.get.call(this),className:this.className});original.set.call(this,value);}});}
  window.addEventListener('error',e=>window.__audit.errors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__audit.errors.push(String(e.reason)));
 });
 await page.goto('http://127.0.0.1:4175/');
 await page.getByText('Saved on this device',{exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.recognition-status')?.textContent.includes('Ready for handwriting'));
 await page.evaluate(()=>window.__audit.dimensions=[]);
 const points=[[112.3,112.7],[131.8,125.2],[148.9,110.6],[163.1,142.9]];
 let bounds=await page.getByLabel('Drawing canvas').boundingBox();
 await page.mouse.move(bounds.x+points[0][0],bounds.y+points[0][1]);await page.mouse.down();
 for(const [x,y]of points.slice(1)){await page.mouse.move(bounds.x+x,bounds.y+y);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
 const active=await page.locator('.active-layer').evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data));
 await page.mouse.up();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const committed=await page.locator('.ink-layer').evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data));
 let unequalPixels=0,maxAlphaDifference=0;for(let i=0;i<active.length;i+=4){if([0,1,2,3].some(k=>active[i+k]!==committed[i+k]))unequalPixels++;maxAlphaDifference=Math.max(maxAlphaDifference,Math.abs(active[i+3]-committed[i+3]));}
 await page.waitForFunction(()=>document.querySelector('.recognition-feedback'));
 const dimensions=await page.evaluate(()=>window.__audit.dimensions);
 await page.mouse.move(bounds.x+210,bounds.y+210);await page.mouse.down();await page.mouse.move(bounds.x+220,bounds.y+220);
 await page.setViewportSize({width:1000,height:900});
 bounds=await page.getByLabel('Drawing canvas').boundingBox();
 await page.mouse.move(bounds.x+230,bounds.y+230);await page.mouse.up();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const resizeInk=await page.locator('.ink-layer').evaluate(c=>{const ctx=c.getContext('2d');return [112,210,230].map((n,i)=>ctx.getImageData(Math.round(n*devicePixelRatio),Math.round((i===0?113:n)*devicePixelRatio),1,1).data[3]);});
 report.cases.push({dpr,unequalPixels,maxAlphaDifference,dimensionWritesAfterRecognition:dimensions,resizeInk,errors:await page.evaluate(()=>window.__audit.errors)});
 await context.close();
}
const page=await browser.newPage();
await page.goto('about:blank');
report.projectionLifecycle=await page.evaluate(async url=>{
 const {mountProjection}=await import(url);
 const canvas=document.createElement('canvas');document.body.append(canvas);canvas.style.width='100px';canvas.style.height='50px';
 let projections=[];let drawCalls=0;const ctx=canvas.getContext('2d');const original=ctx.fillText.bind(ctx);ctx.fillText=(...args)=>{drawCalls++;return original(...args);};
 const renderer=mountProjection(canvas,()=>projections);
 const wait=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 await wait();const b={minX:10,minY:10,maxX:25,maxY:20};projections=[{equationId:'a',equationRevision:1,expression:'1+1=',bounds:b,equalsBounds:b,answerBounds:b,answerText:'2',status:'valid'}];renderer.invalidate();renderer.invalidate();await wait();
 const alpha=()=>Array.from(ctx.getImageData(0,0,canvas.width,canvas.height).data).filter((v,i)=>i%4===3&&v>0).length;
 const before=alpha();projections=[];renderer.invalidate();await wait();const after=alpha();
 canvas.style.width='150px';await wait();await wait();const resized={width:canvas.width,height:canvas.height};
 renderer.dispose();const stoppedDraws=drawCalls;projections=[{equationId:'a',equationRevision:1,expression:'1+1=',bounds:b,equalsBounds:b,answerBounds:b,answerText:'2',status:'valid'}];renderer.invalidate();window.dispatchEvent(new Event('resize'));canvas.style.width='180px';await wait();await wait();
 return {beforePixels:before,emptyPixels:after,resized,drawCalls,stoppedDraws,disposedWidth:canvas.width};
},moduleUrl);
await browser.close();
await writeFile('/private/tmp/calcink-p1-review.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
