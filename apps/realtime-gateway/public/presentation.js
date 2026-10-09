/** Reply ownership fence for playback + progressively revealed subtitles. No provider event names here. */
import { safeObserve } from './diagnostics.js';
export class Presentation {
  constructor({render,play,stopAudio,schedule=setTimeout,unschedule=clearTimeout,onObserve,now=()=>performance.now()}) {
    Object.assign(this,{render,play,stopAudio,schedule,unschedule,onObserve,now});this.used=new Set();this.current=null;this.visible='';this.pending='';
  }
  begin(id) {
    if(this.used.has(id))return false;
    if(this.used.size>=10000)throw new Error('REPLY_LIMIT');
    this.clear();this.used.add(id);this.current=id;this.accepting=true;this.lastReveal=null;return true;
  }
  append(id,text) {
    if(id!==this.current || !this.accepting){safeObserve(this.onObserve,'presentation.dropped',{response_id:id,reason:'ownership'});return false;}
    if(typeof text!=='string' || this.visible.length+this.pending.length+text.length>4000)throw new Error('CAPTION_LIMIT');
    this.pending+=text;safeObserve(this.onObserve,'caption.received',{response_id:id,chars:Array.from(text).length,pending_chars:Array.from(this.pending).length,caption_interval_ms:70});this.tick();return true;
  }
  tick() {
    if(this.timer || !this.pending)return;
    const id=this.current;
    this.timer=this.schedule(()=> {
      this.timer=null;if(id!==this.current)return;
      const take=this.pending.match(/^.{1,3}[，。？！,.?!]?/u)?.[0] ?? this.pending.slice(0,2);
      this.visible+=take;this.pending=this.pending.slice(take.length);this.render(this.visible);this.tick();
      if(this.lastReveal===null || this.now()-this.lastReveal>=250 || !this.pending) {
        this.lastReveal=this.now();safeObserve(this.onObserve,'caption.revealed',{response_id:id,visible_chars:Array.from(this.visible).length,pending_chars:Array.from(this.pending).length});
      }
    },70);
  }
  audio(id,base64,rate) {if(id!==this.current || !this.accepting){safeObserve(this.onObserve,'presentation.dropped',{response_id:id,reason:'ownership'});return false;}this.play(base64,rate,id);return true;}
  done(id) {if(id===this.current)this.accepting=false;}
  stop(id) {if(id===this.current || id===undefined){this.clear();return true;}return false;}
  clear() {if(this.current)safeObserve(this.onObserve,'caption.cleared',{response_id:this.current,visible_chars:Array.from(this.visible).length,pending_chars:Array.from(this.pending).length});if(this.timer)this.unschedule(this.timer);this.timer=null;this.current=null;this.accepting=false;this.visible='';this.pending='';this.stopAudio();this.render('');}
  reset() {this.clear();this.used.clear();}
}
