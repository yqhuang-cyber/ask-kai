// Internal Web audio contract: mono PCM s16le, 20ms frames. Provider rates are reviewed server-side.
export class PCMResampler {
  constructor(sourceRate,targetRate) {this.ratio=sourceRate/targetRate;this.position=0;this.pending=[];}
  push(input) {
    this.pending.push(...input);
    const output=[];
    while (this.position+1 < this.pending.length) {
      const index=Math.floor(this.position),fraction=this.position-index;
      const value=this.pending[index]*(1-fraction)+this.pending[index+1]*fraction;
      output.push(Math.round(Math.max(-1,Math.min(1,value))*(value<0 ? 32768:32767)));
      this.position+=this.ratio;
    }
    const consumed=Math.floor(this.position);
    this.pending.splice(0,consumed);this.position-=consumed;
    const bytes=new Uint8Array(output.length*2),view=new DataView(bytes.buffer);
    output.forEach((value,index)=>view.setInt16(index*2,value,true));
    return bytes;
  }
}
export class AudioIO {
  constructor({onFrame,onFailure}) {this.onFrame=onFrame;this.onFailure=onFailure;this.sources=new Set();this.generation=0;this.pending=new Uint8Array(0);}
  async prepare() {
    if (!window.isSecureContext) throw new Error('MICROPHONE_REQUIRES_SECURE_CONTEXT');
    this.context=new AudioContext();this.gain=this.context.createGain();this.gain.connect(this.context.destination);
    await this.context.resume();
  }
  async start(audio) {
    const generation=this.generation;
    const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    if (generation!==this.generation) {stream.getTracks().forEach(t=>t.stop());return;}
    this.stream=stream;
    stream.getAudioTracks()[0].addEventListener('ended',()=>this.onFailure('麦克风已断开，请重新开始。'));
    this.resampler=new PCMResampler(this.context.sampleRate,audio.input_rate);this.frameSize=audio.input_rate*2/50;
    await this.context.audioWorklet.addModule('/capture-worklet.js');
    if (generation!==this.generation) return;
    this.input=this.context.createMediaStreamSource(stream);
    this.capture=new AudioWorkletNode(this.context,'kai-capture');
    this.silent=this.context.createGain();this.silent.gain.value=0;
    this.capture.connect(this.silent).connect(this.context.destination);this.input.connect(this.capture);
    this.capture.port.onmessage=event => {
      if (generation!==this.generation) return;
      const bytes=this.resampler.push(event.data);
      const combined=new Uint8Array(this.pending.length+bytes.length);combined.set(this.pending);combined.set(bytes,this.pending.length);
      let offset=0;
      while(offset+this.frameSize<=combined.length) {this.onFrame(combined.slice(offset,offset+this.frameSize));offset+=this.frameSize;}
      this.pending=combined.slice(offset);
    };
    await this.context.resume();
  }
  play(base64,rate) {
    const raw=atob(base64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    if (!bytes.length || bytes.length%2 || bytes.length>65536) throw new Error('INVALID_AUDIO');
    const buffer=this.context.createBuffer(1,bytes.length/2,rate),channel=buffer.getChannelData(0),view=new DataView(bytes.buffer);
    for(let i=0;i<channel.length;i++)channel[i]=view.getInt16(i*2,true)/32768;
    const at=Math.max(this.context.currentTime+0.03,this.nextAt ?? 0);
    if(at-this.context.currentTime>3)throw new Error('PLAYBACK_BACKLOG');
    const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.gain);this.sources.add(source);
    source.onended=()=>this.sources.delete(source);source.start(at);this.nextAt=at+buffer.duration;
  }
  mute(value) {if(this.gain)this.gain.gain.value=value?0:1;}
  stopPlayback() {for(const source of this.sources){try{source.stop();}catch{}}this.sources.clear();this.nextAt=0;}
  async close() {
    this.generation++;this.stopPlayback();this.capture?.disconnect();this.input?.disconnect();this.stream?.getTracks().forEach(t=>t.stop());
    this.pending=new Uint8Array(0);const context=this.context;this.context=null;if(context && context.state!=='closed')await context.close();
  }
}
