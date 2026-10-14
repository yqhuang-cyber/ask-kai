// Epoch fences are independent of connection generation: switching entries can
// cancel preparation without pretending voice was ever connected.
export class PreparationClient {
  constructor({fetcher,onView=()=>{},onStatus=()=>{}}){Object.assign(this,{fetcher,onView,onStatus});this.epoch=0;this.id=null;this.controller=null;}
  cancel(){this.epoch++;this.controller?.abort();const id=this.id;this.id=null;if(id)void this.fetcher(`/api/conversation-preparations/${id}`,{method:'DELETE'}).catch(()=>{});}
  async prepare(entry) {
    this.cancel();const epoch=this.epoch,controller=new AbortController();this.controller=controller;this.onStatus('preparing');let timedOut=false;
    const deadline=setTimeout(()=>{timedOut=true;controller.abort();},15000);
    const current=()=>epoch===this.epoch&&!controller.signal.aborted;
    try {
      const response=await this.fetcher('/api/conversation-preparations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(entry),signal:controller.signal});
      if(!response.ok)throw new Error('PREPARATION_FAILED');const created=await response.json();
      if(!current()){void this.fetcher(`/api/conversation-preparations/${created.preparation_id}`,{method:'DELETE'}).catch(()=>{});if(timedOut&&epoch===this.epoch)this.onStatus('failed');return null;}
      this.id=created.preparation_id;
      for(let attempt=0;attempt<120;attempt++) {
        if(!current())return null;
        const poll=await this.fetcher(`/api/conversation-preparations/${this.id}`,{signal:controller.signal});if(!poll.ok)throw new Error('PREPARATION_FAILED');const result=await poll.json();
        if(!current())return null;
        if(result.status==='ready'){this.onView(result.view);this.onStatus('ready',result.view.planning);return this.id;}
        if(result.status!=='preparing')throw new Error('PREPARATION_FAILED');
        await new Promise(resolve=>{const done=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,100);controller.signal.addEventListener('abort',done,{once:true});});
      }
      throw new Error('PREPARATION_FAILED');
    }catch{if(current()||timedOut&&epoch===this.epoch)this.onStatus('failed');return null;}
    finally{clearTimeout(deadline);}
  }
}
