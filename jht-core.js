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
  const api={merge,localDate,weekday,pastePlan,validate,checkCodes};
  if(typeof module!=='undefined') module.exports=api;
  root.JHTCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
