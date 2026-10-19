(() => {
  const TOKEN_KEY = 'jsstudy_sync_token_v1';
  const STATE_KEY = 'museumStudyState_v1';
  let token = localStorage.getItem(TOKEN_KEY) || '';
  let timer = null;
  let syncing = false;

  function tokenOk(v){ return /^[A-Za-z0-9_-]{32,256}$/.test(v || ''); }
  function newToken(){
    const b = new Uint8Array(24); crypto.getRandomValues(b);
    return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function status(msg){
    let el=document.getElementById('syncStatus');
    if(!el){
      el=document.createElement('button'); el.id='syncStatus'; el.type='button';
      el.style.cssText='position:fixed;right:12px;bottom:12px;z-index:9999;padding:7px 10px;border:1px solid #ccc;border-radius:999px;background:#fff;font-size:12px;cursor:pointer';
      el.onclick=showPanel; document.body.appendChild(el);
    }
    el.textContent=msg;
  }
  async function rpc(name, body){
    const r=await fetch('/api/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body)});
    if(!r.ok) throw new Error(await r.text());
    return r.status===204 ? null : r.json();
  }
  async function pull(){
    if(!tokenOk(token)) return;
    syncing=true; status('동기화 확인 중…');
    try{
      const rows=await rpc('sync_get',{p_token:token});
      if(rows && rows[0] && rows[0].state){
        const remote=rows[0].state;
        const local=JSON.parse(localStorage.getItem(STATE_KEY)||'null');
        if(!local || JSON.stringify(local)!==JSON.stringify(remote)){
          localStorage.setItem(STATE_KEY,JSON.stringify(remote));
          status('서버 기록 적용됨 · 새로고침');
          setTimeout(()=>location.reload(),500); return;
        }
      } else {
        await pushNow();
      }
      status('서버 동기화됨');
    }catch(e){ console.warn('sync pull failed',e); status('로컬 저장 · 동기화 재시도'); }
    finally{ syncing=false; }
  }
  async function pushNow(){
    if(!tokenOk(token)) return;
    const raw=localStorage.getItem(STATE_KEY); if(!raw) return;
    await rpc('sync_put',{p_token:token,p_state:JSON.parse(raw)});
    status('서버 동기화됨');
  }
  function queuePush(){
    if(!tokenOk(token) || syncing) return;
    clearTimeout(timer); timer=setTimeout(()=>pushNow().catch(e=>{console.warn('sync push failed',e);status('로컬 저장 · 동기화 재시도')}),500);
  }
  function showPanel(){
    const current=token || '';
    const v=prompt('동기화 코드\n\n다른 기기에서 같은 코드를 입력하면 학습상황을 공유합니다. 코드를 잃으면 서버 기록을 찾을 수 없으니 안전하게 보관하세요.\n\n비워두고 확인하면 새 코드를 만듭니다.', current);
    if(v===null) return;
    const next=v.trim() || newToken();
    if(!tokenOk(next)){ alert('동기화 코드는 영문/숫자/_/- 조합 32자 이상이어야 합니다.'); return; }
    token=next; localStorage.setItem(TOKEN_KEY,token);
    navigator.clipboard?.writeText(token).catch(()=>{});
    alert('동기화 코드가 설정되었습니다. 다른 기기에서도 우측 하단 동기화 버튼을 눌러 같은 코드를 입력하세요.');
    pull();
  }
  window.JSStudySync={showPanel,pull,push:pushNow};
  const nativeSet=Storage.prototype.setItem;
  Storage.prototype.setItem=function(k,v){ nativeSet.call(this,k,v); if(this===localStorage && k===STATE_KEY) queuePush(); };
  window.addEventListener('online',pull);
  window.addEventListener('beforeunload',()=>{ if(tokenOk(token)) queuePush(); });
  if(tokenOk(token)) setTimeout(pull,100); else status('기기 간 동기화 설정');
})();
