/* Shared, dependency-free data helpers. */
(function(root) {
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const entities = v => Array.isArray(v) && v.every(x=>object(x) && typeof x.id==='string') && new Set(v.map(x=>x.id)).size===v.length;
  function merge(base, local, remote, path='데이터') {
    if(equal(local,base)) return copy(remote);
    if(equal(remote,base) || equal(local,remote)) return copy(local);
    if(object(base) && object(local) && object(remote)) {
      const out={};
      for(const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])) {
        const value=merge(base[key],local[key],remote[key],path+'.'+key);
        if(value!==undefined) Object.defineProperty(out,key,{value,writable:true,enumerable:true,configurable:true});
      }
      return out;
    }
    if(entities(base) && entities(local) && entities(remote)) {
      const maps=[base,local,remote].map(items=>new Map(items.map(x=>[x.id,x])));
      const ids=[...new Set([...remote.map(x=>x.id),...local.map(x=>x.id)])];
      // Preserve a single author's reorder; reject competing reorders.
      const order=v=>v.filter(x=>maps[0].has(x.id)).map(x=>x.id);
      const common=base.filter(x=>maps[1].has(x.id)&&maps[2].has(x.id)).map(x=>x.id);
      const lo=order(local).filter(id=>common.includes(id)), ro=order(remote).filter(id=>common.includes(id));
      if(!equal(lo,common)&&!equal(ro,common)&&!equal(lo,ro)) throw new Error('다른 기기에서 순서를 변경했습니다: '+path);
      const ordered=!equal(lo,common) ? [...new Set([...local.map(x=>x.id),...remote.map(x=>x.id)])] : ids;
      return ordered.map(id=>merge(maps[0].get(id),maps[1].get(id),maps[2].get(id),path+'.'+id)).filter(x=>x!==undefined);
    }
    throw new Error('다른 기기에서 같은 항목을 수정했습니다: '+path);
  }
  function localDate(d=new Date()) {return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
  function weekday(date) {const d=new Date(date+'T12:00:00'); return Number.isNaN(d.getTime())?'':['일','월','화','수','목','금','토'][d.getDay()];}
  function pastePlan(text, students) {
    const rows=[], errors=[], seen=new Set();
    text.split(/\r?\n/).filter(l=>l.trim()).forEach((line,i)=>{
      const sep=line.includes('\t')?line.indexOf('\t'):line.indexOf(',');
      const key=line.slice(0,sep).trim(), content=line.slice(sep+1).trim();
      const byCode=students.filter(s=>s.code && s.code.trim()===key);
      const matches=byCode.length ? byCode : students.filter(s=>s.name.trim()===key);
      if(sep<0||!content||matches.length!==1||seen.has(matches[0]?.id)) {errors.push((i+1)+'행: 이름·코드가 없거나 중복되었거나 내용이 비어 있습니다.');return;}
      seen.add(matches[0].id);rows.push({id:matches[0].id,name:matches[0].name,content});
    });
    return {rows,errors};
  }
  function validate(data) {
    const fail=()=>{throw new Error('백업 구조가 올바르지 않습니다. 반·학생·기간·기록 항목을 확인해 주세요.');};
    if(!object(data)||!object(data.classes)||!Object.keys(data.classes).length||typeof data.brandName!=='string'||typeof data.adminPassword!=='string'||!Array.isArray(data.categories)||!data.categories.length||!data.categories.every(x=>typeof x==='string')||!Array.isArray(data.ratings)||!data.ratings.length||!data.ratings.every(x=>object(x)&&typeof x.key==='string'&&typeof x.label==='string')) fail();
    if(!entities(data.terms)||!data.terms.length||!data.terms.every(x=>typeof x.label==='string')||!data.terms.some(x=>x.id===data.currentTermId)) fail();
    const codes=new Set(), terms=new Set(data.terms.map(x=>x.id));
    for(const cls of Object.values(data.classes)) {
      if(!object(cls)||typeof cls.name!=='string'||!entities(cls.students)||!Array.isArray(cls.notices)||!cls.notices.every(x=>typeof x==='string')||!entities(cls.schedule)||!cls.schedule.every(x=>['date','day','content','homework'].every(k=>typeof x[k]==='string'))) fail();
      for(const s of cls.students) {
        if(typeof s.name!=='string'||typeof s.code!=='string'||!entities(s.feedbacks)||!s.feedbacks.every(f=>typeof f.content==='string'&&typeof f.date==='string'&&typeof f.rating==='string'&&typeof f.category==='string'&&terms.has(f.termId))||!object(s.termNotes)||!Object.values(s.termNotes).every(x=>typeof x==='string')) fail();
        for(const k of ['homeworkRate','attendanceRate']) if(s[k]!=null && (!Number.isFinite(s[k])||s[k]<0||s[k]>100)) fail();
        if(s.termMetrics!=null && (!object(s.termMetrics)||!Object.values(s.termMetrics).every(m=>object(m)&&['homeworkRate','attendanceRate'].every(k=>m[k]==null||(Number.isFinite(m[k])&&m[k]>=0&&m[k]<=100))))) fail();
        const code=s.code.trim();if(code&&codes.has(code)) throw new Error('중복된 학생 코드가 있습니다.');if(code) codes.add(code);
      }
    }
    return data;
  }
  function checkCodes(data) {
    const seen=new Set();
    for(const cls of Object.values(data.classes||{})) for(const s of cls.students||[]) {
      const code=(s.code||'').trim();
      if(code && seen.has(code)) throw new Error('중복된 학생 코드가 있습니다. 학생 관리에서 다른 코드를 지정해 주세요.');
      if(code)seen.add(code);
    }
  }

  // Apply explicit student operations to the latest transaction snapshot only.
  function studentOperation(remote, action) {
    if(!remote || !object(remote.classes))throw new Error('서버 데이터를 불러오지 못했습니다.');
    const data=copy(remote);
    const cls=data.classes[action.classId];
    if(action.type==='archive'){
      if(!cls)throw new Error('반이 삭제되었습니다. 최신 내용을 불러와 주세요.');
      const index=cls.students.findIndex(s=>s.id===action.studentId);
      if(index<0)return data; // already deleted, including uncertain-response retries
      data.studentTrash=data.studentTrash||[];
      const student=cls.students[index];
      data.studentTrash.push({id:action.id,classId:action.classId,className:cls.name,index,deletedAt:action.at,student:copy(student),terms:copy(data.terms||[])});
      cls.students.splice(index,1);
    } else if(action.type==='code'){
      const student=cls?.students.find(s=>s.id===action.studentId);
      if(!student)throw new Error('학생이 삭제되거나 이동했습니다. 최신 내용을 확인해 주세요.');
      const next=String(action.code||'').trim();
      if(!next && !action.allowEmpty)throw new Error('코드는 비워둘 수 없습니다.');
      if((student.code||'').trim()!==action.expectedCode && (student.code||'').trim()!==next)
        throw new Error('다른 기기에서 이미 코드를 변경했습니다. 최신 내용을 불러온 뒤 다시 시도해 주세요.');
      if(Object.values(data.classes).some(c=>c.students.some(s=>s!==student && next && (s.code||'').trim()===next)))
        throw new Error('이미 사용 중인 코드입니다.');
      student.code=next;
    } else if(action.type==='restore'){
      const entry=(data.studentTrash||[]).find(e=>e.id===action.trashId);
      if(!entry)return data;
      if(Object.values(data.classes).some(c=>c.students.some(s=>s.id===entry.student.id)))
        throw new Error('같은 학생이 이미 재적 명단에 있습니다. 복구할 수 없습니다.');
      const student=copy(entry.student);
      student.code=String(action.code ?? student.code ?? '').trim();
      if(student.code && Object.values(data.classes).some(c=>c.students.some(s=>(s.code||'').trim()===student.code)))
        throw new Error('복구할 학생의 코드를 다른 학생이 사용 중입니다. 다른 코드로 복구해 주세요.');
      if(!data.classes[entry.classId])data.classes[entry.classId]={name:entry.className,students:[],notices:[],schedule:[],board:[]};
      const target=data.classes[entry.classId];
      // Restore missing period labels so archived feedback remains visible. Keep all
      // existing periods and the current-period selection unchanged.
      for(const term of entry.terms||[])if(!data.terms.some(t=>t.id===term.id))data.terms.push(copy(term));
      target.students.splice(Math.min(entry.index,target.students.length),0,student);
      data.studentTrash=data.studentTrash.filter(e=>e.id!==entry.id);
    } else throw new Error('지원하지 않는 학생 작업입니다.');
    return data;
  }

  const api={merge,localDate,weekday,pastePlan,validate,checkCodes,studentOperation};
  if(typeof module!=='undefined') module.exports=api;
  root.JHTCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
