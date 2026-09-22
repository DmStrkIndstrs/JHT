const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const core=require('./jht-core');
const babel=require(process.env.JHT_BABEL_PATH || '@babel/standalone');
const {chromium}=require('playwright');
const asset=(file,pkg)=>process.env.JHT_TEST_ASSETS?path.join(process.env.JHT_TEST_ASSETS,file):path.join(path.dirname(require.resolve(pkg+'/package.json')),'umd',pkg+'.development.js');
const fixture={classes:{a:{name:'A',students:[{id:'s1',code:'1111',name:'학생1',feedbacks:[]},{id:'s2',code:'2222',name:'학생2',feedbacks:[]}],board:[{id:'board',content:'유지'}]}},terms:[{id:'t1',label:'1학기'}],currentTermId:'t1'};
const action={type:'archive',classId:'a',studentId:'s1',id:'archive1',at:'2026-09-22T00:00:00Z'};
const changed=structuredClone(fixture);changed.classes.a.students[0].feedbacks.push({id:'new',content:'서버 최신 기록'});changed.classes.a.students[1].summary='다른 학생 최신 기록';
const archived=core.studentOperation(changed,action);
assert.equal(archived.classes.a.students.length,1);
assert.equal(archived.studentTrash[0].student.feedbacks[0].content,'서버 최신 기록');
assert.deepEqual(archived.classes.a.students[0],changed.classes.a.students[1]);
assert.deepEqual(archived.classes.a.board,changed.classes.a.board);
assert.deepEqual(core.studentOperation(archived,action),archived);
const restored=core.studentOperation(archived,{type:'restore',trashId:'archive1',code:'1111'});
assert.deepEqual(restored.classes.a.students,changed.classes.a.students);
const reused=structuredClone(archived);reused.classes.a.students[0].code='1111';
assert.throws(()=>core.studentOperation(reused,{type:'restore',trashId:'archive1',code:'1111'}));
assert.equal(core.studentOperation(reused,{type:'restore',trashId:'archive1',code:'3333'}).classes.a.students[0].code,'3333');
assert.throws(()=>core.studentOperation(changed,{type:'code',classId:'a',studentId:'s1',code:'2222',expectedCode:'1111'}));
assert.throws(()=>core.studentOperation(changed,{type:'code',classId:'a',studentId:'s1',code:'3333',expectedCode:'old'}));
assert.throws(()=>core.studentOperation(archived,{type:'code',classId:'a',studentId:'s1',code:'3333',expectedCode:'1111'}));
assert.throws(()=>core.studentOperation(changed,{type:'code',classId:'a',studentId:'s1',code:'',expectedCode:'1111'}));
const changedCode=core.studentOperation(changed,{type:'code',classId:'a',studentId:'s1',code:'3333',expectedCode:'1111'});
const expected=structuredClone(changed);expected.classes.a.students[0].code='3333';assert.deepEqual(changedCode,expected);
assert.deepEqual(core.studentOperation(changedCode,{type:'code',classId:'a',studentId:'s1',code:'3333',expectedCode:'1111'}),expected);

async function run(){
 const browser=await chromium.launch({executablePath:process.env.JHT_BROWSER_PATH || undefined,headless:true});
 try { for(const file of ['index.html','go1.html']) {
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],dialogs=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());await d.accept();});
  await page.setContent('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
  await page.addScriptTag({path:asset('react.js','react')});await page.addScriptTag({path:asset('react-dom.js','react-dom')});await page.addScriptTag({path:path.join(__dirname,'jht-core.js')});
  await page.evaluate(()=>{
   window.__writes=0;window.__fail=false;window.__retryNext=false;
   const snap=()=>({exists:true,data:()=>structuredClone(window.__remote)});
   const ref={onSnapshot(fn){setTimeout(()=>{window.__remote=structuredClone(window.__seed);fn(snap());},0);return ()=>{};}};
   window.firebase={apps:[{}],firestore:()=>({collection:()=>({doc:()=>ref}),runTransaction:async fn=>{
    if(window.__fail)throw Error('연결 실패 테스트');
    let queued;const tx={get:async()=>snap(),set:(_,data)=>{queued=structuredClone(data);}};
    let result=await fn(tx);
    if(window.__retryNext){window.__retryNext=false;Object.values(window.__remote.classes)[0].students[0].feedbacks.push({id:'retry-record',date:'2026-09-22',termId:window.__remote.currentTermId,category:'개념 이해',rating:'good',content:'재시도 중 추가된 기록'});result=await fn(tx);}
    if(window.__hold){window.__hold=false;await new Promise(resolve=>{window.__release=resolve;});}
    window.__remote=queued;window.__writes++;return result;
   }})};
  });
  const source=fs.readFileSync(path.join(__dirname,file),'utf8').match(/<script type="text\/babel">([\s\S]*?)<\/script>/)[1].replace('  const seed=()=>','  window.__testUpdate=updateData;\n  const seed=()=>');
  const code=babel.transform(source,{presets:['react']}).code.replace('ReactDOM.createRoot','window.__seed=normalize(initialAppData);Object.values(window.__seed.classes).forEach((c,i)=>c.students.forEach((s,j)=>s.code=String(1111+i*100+j)));ReactDOM.createRoot');
  await page.addScriptTag({content:code});
  await page.getByPlaceholder('학생 코드 입력').fill('1111');await page.getByRole('button',{name:'조회',exact:true}).click();
  await page.getByRole('button',{name:'내 조회 코드 변경',exact:true}).click();
  await page.getByLabel('열람 코드',{exact:true}).fill('3333');await page.getByRole('button',{name:'취소',exact:true}).click();
  assert.equal(await page.evaluate(()=>__writes),0,'Cancel must not save on blur');
  await page.getByRole('button',{name:'내 조회 코드 변경',exact:true}).click();await page.getByLabel('열람 코드',{exact:true}).fill('3333');
  await page.evaluate(()=>{__fail=true;});await page.getByRole('button',{name:'코드 저장',exact:true}).click();
  assert.equal(await page.evaluate(()=>Object.values(__remote.classes)[0].students[0].code),'1111');
  assert.equal(dialogs.some(x=>x.includes('로 저장했습니다')),false);
  assert.equal(await page.getByText('학생 작업을 완료하지 못했습니다.',{exact:true}).count(),1);
  await page.evaluate(()=>{__fail=false;__hold=true;const c=Object.values(__remote.classes)[0];c.students[0].summary='내 최신 기록 유지';c.students[1].summary='다른 학생 최신 기록 유지';c.board.push({id:'new-board',content:'게시판 유지',date:'2026-09-22',replies:[]});});
  await page.getByRole('button',{name:'코드 저장',exact:true}).click();
  await page.waitForFunction(()=>typeof __release==='function');
  await page.evaluate(()=>{__testUpdate(prev=>{const d=structuredClone(prev);Object.values(d.classes)[0].board.push({id:'async-board',content:'업로드 완료 후 도착한 글',date:'2026-09-22',replies:[]});return d;});__release();});
  await page.waitForFunction(()=>Object.values(__remote.classes)[0].students[0].code==='3333');
  await page.waitForFunction(()=>Object.values(__remote.classes)[0].board.some(p=>p.id==='async-board'));
  assert.equal(await page.evaluate(()=>Object.values(__remote.classes)[0].students[0].summary),'내 최신 기록 유지');
  assert.equal(await page.evaluate(()=>Object.values(__remote.classes)[0].students[1].summary),'다른 학생 최신 기록 유지');
  assert.equal(await page.evaluate(()=>Object.values(__remote.classes)[0].board[0].content),'게시판 유지');
  await page.getByRole('button',{name:'내 조회 코드 변경',exact:true}).click();
  await page.evaluate(()=>{Object.values(__remote.classes)[0].students[1].code='4444';});
  await page.getByLabel('열람 코드',{exact:true}).fill('4444');await page.getByRole('button',{name:'코드 저장',exact:true}).click();
  assert.equal(await page.evaluate(()=>Object.values(__remote.classes)[0].students[0].code),'3333','Server-side duplicate rejects stale client');
  await page.getByRole('button',{name:'닫기',exact:true}).click();await page.getByRole('button',{name:'취소',exact:true}).click();
  await page.getByRole('button',{name:'선생님 관리자',exact:true}).click();await page.getByPlaceholder('비밀번호',{exact:true}).fill('1234');await page.getByRole('button',{name:'들어가기',exact:true}).click();
  await page.getByRole('button',{name:'학생 관리',exact:true}).click();await page.getByLabel('학생 검색',{exact:true}).fill('3333');
  await page.evaluate(()=>{__fail=true;});await page.getByRole('button',{name:'삭제',exact:true}).click();
  await page.getByText('학생 작업을 완료하지 못했습니다.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'삭제',exact:true}).count(),1,'Failed deletion leaves student visible');
  assert.equal(await page.evaluate(()=>Object.values(__remote.classes)[0].students.length),2);
  await page.evaluate(()=>{__fail=false;__retryNext=true;});await page.getByRole('button',{name:'학생 작업 다시 시도',exact:true}).click();
  await page.waitForFunction(()=>Object.values(__remote.classes)[0].students.length===1);
  assert.equal(await page.evaluate(()=>__remote.studentTrash.length),1,'Transaction retries must not duplicate trash');
  assert.equal(await page.evaluate(()=>__remote.studentTrash[0].student.feedbacks.at(-1).content),'재시도 중 추가된 기록');
  assert.equal(await page.evaluate(()=>Object.values(__remote.classes)[0].students[0].summary),'다른 학생 최신 기록 유지');
  await page.getByRole('button',{name:'학생 휴지통',exact:true}).click();
  await page.evaluate(()=>{Object.values(__remote.classes)[0].students[0].code='3333';});
  await page.getByRole('button',{name:'복구',exact:true}).click();
  assert.equal(await page.evaluate(()=>__remote.studentTrash.length),1,'Duplicate restore keeps archive');
  await page.locator('input[aria-label$="복구 코드"]').fill('5555');await page.getByRole('button',{name:'복구',exact:true}).click();
  await page.waitForFunction(()=>__remote.studentTrash.length===0);
  assert.equal(await page.evaluate(()=>Object.values(__remote.classes)[0].students[0].code),'5555');
  assert.equal(await page.evaluate(()=>Object.values(__remote.classes)[0].students[0].feedbacks.at(-1).content),'재시도 중 추가된 기록');
  // A targeted deletion cannot swallow or overwrite a separate unsaved conflict.
  await page.getByRole('button',{name:'기록 관리',exact:true}).click();
  await page.evaluate(()=>{const s=Object.values(__remote.classes)[0].students[0];s.termNotes[__remote.currentTermId]='새 서버 종합 기록';});
  await page.locator('textarea').first().fill('충돌한 로컬 종합 기록');
  await page.getByRole('button',{name:'학생 관리',exact:true}).click();await page.getByLabel('학생 검색',{exact:true}).fill('5555');
  await page.getByRole('button',{name:'삭제',exact:true}).click();
  await page.getByText('학생 작업을 완료하지 못했습니다.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>Object.values(__remote.classes)[0].students.length),2);
  assert.equal(await page.evaluate(()=>Object.values(__remote.classes)[0].students[0].termNotes[__remote.currentTermId]),'새 서버 종합 기록');
  assert.equal(await page.getByRole('button',{name:'지금 화면 내용으로 덮어쓰기',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log(file+': targeted code update, cancel, failure/retry, stale duplicate, archive transaction retry, latest-record recovery, restore collision passed');
  await page.close();
 }} finally {await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
