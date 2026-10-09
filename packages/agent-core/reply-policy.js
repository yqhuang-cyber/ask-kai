export const REPLY_POLICY_VERSION = 'kai-reply-v1';
export const REPLY_BUDGET = Object.freeze({pairs:2,chinese_chars:36,english_words:24,spoken_units:48,text_chars:180,questions:1,new_points:1,examples:1});

export const REPLY_INSTRUCTIONS = `回复策略版本：${REPLY_POLICY_VERSION}。
语言规则：先说中文，再说英文。每个中文短句后立即给出对应的自然、简短英文整句；完成这一中英句对后才说下一句中文。即使学生说英文或偏好数据含 zh，也遵守此顺序。英文只传达前一句中文的含义，不添加新知识、新问题或第二轮讲解。
默认只用一个中英句对；需要反馈加追问时，一到两句中文各配一句英文，整轮最多 ${REPLY_BUDGET.pairs} 个句对。两种语言共用一个预算：汉字最多 ${REPLY_BUDGET.chinese_chars} 个、英文最多 ${REPLY_BUDGET.english_words} 词、汉字数加英文词数加数字组数最多 ${REPLY_BUDGET.spoken_units}，含标点和空格总计最多 ${REPLY_BUDGET.text_chars} 字符。先把中文说短，再用短英文对应，不能把英文当作额外讲解空间。
每轮最多一个主要问题或练习任务，同一问题的英文翻译不算第二个问题。不必每次都追问。需要澄清时只问一个容易回答的问题，不同时回答所有可能意思。
教学密度：普通聊天可以零个新知识点；需要教学时最多 ${REPLY_BUDGET.new_points} 个新词或句型、${REPLY_BUDGET.examples} 个短示范，示范也占上述句对和总预算。回答、纠错、示范、练习选一个主要动作，不叠加词义、语法、拼音、多个例句和练习要求。学生要详细解释时，本轮先解释一个点，等学生回应再继续。不主动逐词拆解，不朗读 HSK 等级、教学标签或这些规则。
只说自然可朗读的正文，使用句末标点分隔中英文；不要语言标签、Markdown、列表或舞台说明。安全规则优先，不能为了简短省略必要的安全帮助。
短回复示例：你喜欢足球吗？ Do you like football?
短示范示例：可以说：我喜欢足球。 You can say: I like football.`;

// Surface checks only. Translation equivalence, HSK difficulty, new concepts and
// question/task intent require a human or semantic Judge; script counts cannot prove them.
function sentences(text) {
  const result=[];let current='',quote=null;
  const closing={'“':'”','「':'」','『':'』','"':'"'};
  const chars=Array.from(text);
  for(let i=0;i<chars.length;i++) {
    const char=chars[i];current+=char;
    if(quote===char){
      quote=null;
      const next=chars.slice(i+1).find(c=>! /\s/u.test(c));
      if(/[。！？.!?]/u.test(chars[i-1]??'') && (next===undefined || /\p{Script=Latin}/u.test(next))){result.push(current);current='';}
      continue;
    }
    if(!quote && closing[char]){quote=closing[char];continue;}
    const decimal=char==='.' && /\p{N}/u.test(chars[i-1]??'') && /\p{N}/u.test(chars[i+1]??'');
    if(!quote && !decimal && /[。！？.!?\n]/u.test(char)) {
      while(i+1<chars.length && /[。！？.!?\n]/u.test(chars[i+1]))current+=chars[++i];
      if(/[\p{L}\p{N}]/u.test(current))result.push(current);
      current='';
    }
  }
  if(/[\p{L}\p{N}]/u.test(current))result.push(current);
  return result;
}

export function measureReply(text,{complete=true}={}) {
  if(typeof text!=='string')throw new Error('INVALID_REPLY_TEXT');
  const chinese_chars=(text.match(/\p{Script=Han}/gu)??[]).length;
  const english_words=(text.match(/\p{Script=Latin}[\p{Script=Latin}\p{M}]*(?:['’\-]\p{Script=Latin}[\p{Script=Latin}\p{M}]*)*/gu)??[]).length;
  const numeric_units=(text.match(/\p{N}+(?:[.,]\p{N}+)*/gu)??[]).length;
  const spoken_units=chinese_chars+english_words+numeric_units;
  const text_chars=Array.from(text).length;
  const parts=sentences(text).map(value=>({language:/\p{Script=Han}/u.test(value)?'zh':/\p{Script=Latin}/u.test(value)?'en':'other',question:/[?？]/u.test(value)}));
  const zh=parts.filter(p=>p.language==='zh'),en=parts.filter(p=>p.language==='en');
  let pair_count=0;
  for(let i=0;i<parts.length-1;i++)if(parts[i].language==='zh' && parts[i+1].language==='en')pair_count++;
  const orderOk=parts.length>0 && parts.length%2===0 && parts.every((part,i)=>part.language===(i%2?'en':'zh'));
  // A translated question counts once, not as two independent question intents.
  const question_pairs=Math.max(zh.filter(p=>p.question).length,en.filter(p=>p.question).length);
  return {reply_policy_version:REPLY_POLICY_VERSION,audit_complete:complete,text_chars,chinese_chars,english_words,numeric_units,spoken_units,chinese_sentences:zh.length,english_sentences:en.length,pair_count,question_pairs,
    budget_exceeded:chinese_chars>REPLY_BUDGET.chinese_chars || english_words>REPLY_BUDGET.english_words || spoken_units>REPLY_BUDGET.spoken_units || text_chars>REPLY_BUDGET.text_chars || zh.length>REPLY_BUDGET.pairs || en.length>REPLY_BUDGET.pairs,
    language_order_issue:complete?!orderOk:null,question_budget_exceeded:question_pairs>REPLY_BUDGET.questions,
    translation_review_required:true,teaching_density_review_required:true};
}

// Opt-in diagnostics keep a bounded transient prefix, cleared at every terminal
// reply. Interrupted/failed/truncated replies cannot establish a language violation.
export class ReplyAudit {
  constructor(){this.text='';this.chars=0;this.truncated=false;}
  append(delta) {
    const chars=Array.from(delta);this.chars+=chars.length;
    const remaining=4096-Array.from(this.text).length;
    this.text+=chars.slice(0,remaining).join('');
    if(chars.length>remaining)this.truncated=true;
  }
  finish(state) {
    const result=measureReply(this.text,{complete:state==='done' && !this.truncated && this.chars>0});
    result.text_chars=this.chars;result.audit_truncated=this.truncated;
    result.budget_exceeded ||= this.chars>REPLY_BUDGET.text_chars;
    this.text='';this.chars=0;this.truncated=false;return result;
  }
}
