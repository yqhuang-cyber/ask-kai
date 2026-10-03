/** Reply ownership fence for playback + progressively revealed subtitles. No provider event names here. */
export class Presentation {
  constructor({render,play,stopAudio,schedule=setTimeout,unschedule=clearTimeout}) {
    Object.assign(this,{render,play,stopAudio,schedule,unschedule});this.used=new Set();this.current=null;this.visible='';this.pending='';
  }
  begin(id) {
    if(this.used.has(id))return false;
    if(this.used.size>=10000)throw new Error('REPLY_LIMIT');
    this.clear();this.used.add(id);this.current=id;this.accepting=true;return true;
  }
  append(id,text) {
    if(id!==this.current || !this.accepting)return false;
    if(typeof text!=='string' || this.visible.length+this.pending.length+text.length>4000)throw new Error('CAPTION_LIMIT');
    this.pending+=text;this.tick();return true;
  }
  tick() {
    if(this.timer || !this.pending)return;
    const id=this.current;
    this.timer=this.schedule(()=> {
      this.timer=null;if(id!==this.current)return;
      const take=this.pending.match(/^.{1,3}[，。？！,.?!]?/u)?.[0] ?? this.pending.slice(0,2);
      this.visible+=take;this.pending=this.pending.slice(take.length);this.render(this.visible);this.tick();
    },70);
  }
  audio(id,base64,rate) {if(id!==this.current || !this.accepting)return false;this.play(base64,rate);return true;}
  done(id) {if(id===this.current)this.accepting=false;}
  stop(id) {if(id===this.current || id===undefined){this.clear();return true;}return false;}
  clear() {if(this.timer)this.unschedule(this.timer);this.timer=null;this.current=null;this.accepting=false;this.visible='';this.pending='';this.stopAudio();this.render('');}
  reset() {this.clear();this.used.clear();}
}
