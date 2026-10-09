// Conservative, session-local rules over validated final ASR; not a semantic judge.
export const TEACHING_POLICY_VERSION='kai-teaching-v1';
export const TEACHING_COOLDOWN_TURNS=2;
export const TEACHING_ACTIONS=Object.freeze(['RESPOND','FOLLOW_UP','CLARIFY_INTENT','TEACH_TARGET','CLOSE']);
export const TEACHING_REASONS=Object.freeze(['student_end','student_declined','student_changed_topic','student_requested_practice','student_requested_help','unclear_input','clarification_limit','teaching_paused','teaching_cooldown','goal_attempt_observed','relevant_short_answer','ordinary_question','conversation_first']);
export const NATURAL_TEACHING_INSTRUCTIONS=`自然教学策略 ${TEACHING_POLICY_VERSION}：每个完整学生回合只选一个主要动作，先回应当前意图，再考虑目标。
学生明确结束：简短告别，不追加问题或练习；不要把提到“再见”、翻译请求或引语当成结束。学生拒绝练习或换题：跟随选择，暂停原目标，不要求理由；只有学生明确求助于原目标或恢复练习才重新邀请。新话题的表达求助只处理该表达，不激活旧目标。
意思不清楚：先问一个简短澄清问题，不猜意图、不先纠错；如果仍不清楚，给低压回应并等待，不连续追问。单词、英文或混合回答都有效，不等于表达能力差。
主题对话只围绕一个主要目标；Mission 只取可信任务的第一个目标，承接到生活，不照读所有目标；开放对话以交流为先，不预设运动目标。明确求助可给一个与当前表达相关的短示范；普通问题先回答，不附加知识点。
学生已尝试目标句：转入内容交流，减少支架，不反复让学生跟读；最终转写不能证明掌握或发音。只有相关短答案且学生愿意时才轻量引出目标。一次至多一个新点、一个短示范；主动引导同一目标最多一次，之后由学生求助决定。
教学或示范后至少隔两个完整学生回合再引入新点；中间继续交流、接住求助或给低压选择，避免重复解释。不给沉默安排定时催促。
服务端决策是有来源的建议，不是已经播出的教学事实。它只对应所标注的学生话轮；如果出现更新的输入，必须按当前学生意图重新选择，不能照搬旧动作或旧示范。所有动作继续遵守短中文后紧接对应短英文、共用预算与安全规则。`;

// Quoted examples cannot operate the conversation controls. These patterns are
// intentionally narrow; unmatched language stays with the realtime model.
function controlText(text) {
  return text.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"|(?<![\p{L}\p{N}])'[^'\n]+'(?![\p{L}\p{N}])|‘[^’]*’/gu,' ').trim();
}
const endIntent=/^(?:(?:我(?:要|想)?|我们)?(?:不聊了|结束(?:对话|聊天|这轮)|先聊到这里)|(?:今天)?(?:就)?到这里|(?:我要走了|再见|拜拜|先这样)|(?:bye|goodbye|stop chatting|end (?:the )?(?:chat|conversation)|i (?:want to end|have to go)|that'?s all))(?:[。.!！,，\s]|$)/iu;
const declineIntent=/(?:^|[，,。.!！;；\s])(?:我)?(?:先)?(?:不想|不愿意|不要|不用|不)(?:再)?(?:练习|学习|复习|跟读|重说|纠正)|(?:不练了|不学了|跳过(?:练习|复习|这个目标)|只想(?:聊天|聊聊)|(?:不要|不用|别)(?:再)?(?:教我|考我))|\b(?:i (?:do not|don'?t|don’t) want to (?:practice|learn|review)|(?:don'?t|don’t|stop) (?:teach|teaching|correct|correcting) me|skip (?:the )?(?:lesson|practice|review)|no (?:more )?(?:practice|lessons)|just (?:chat|talk))\b/iu;
const changeIntent=/(?:换(?:个|一个)?话题|换题|聊点别的|(?:我想|我要|我们来)聊)|\b(?:let'?s (?:talk|chat) about|can we (?:talk|chat) about|change (?:the )?(?:topic|subject)|talk about something else)\b/iu;
const keepTopic=/(?:不(?:要|想)?|别)换(?:个|一个)?(?:话题|题)|\b(?:do not|don'?t|don’t|not) change (?:the )?(?:topic|subject)\b/iu;
const practiceIntent=/(?:继续(?:练习|学习|复习)|我(?:想|要|愿意)(?:练习|学习|复习))|\b(?:let'?s (?:practice|learn)|i want to (?:practice|learn|review))\b/iu;
const helpIntent=/(?:中文怎么(?:说|讲)|怎么用中文(?:说|讲)|这(?:个)?(?:句子|词|表达)怎么说|教我(?:说|一句|中文)|不会说|说不出来)|\b(?:how (?:do|can|would) (?:i|you|we) say|how to say|teach me|help me say)\b/iu;
const languageQuestion=/(?:什么意思|是什么(?:意思)?|怎么说|怎么讲)|\b(?:what does\b.*\bmean|how (?:do|can|would) (?:i|you|we) say|how to say)\b/iu;
const unclearInput=/^(?:那个|这个|那个什么|不知道|我不知道|不确定|听不懂|什么意思|你说什么|没听清|嗯|啊|呃|what|huh|i don'?t know|not sure|it|that|this)[。.!！?？\s]*$/iu;
const questionInput=/[?？]|(?:为什么|什么时候|怎么|什么|如何|哪里|哪儿|吗[。！!\s]*$)|^(?:what|why|when|where|who|how|can|do|does|is|are|will|would|could)\b/iu;
const sportsWord=/(?:足球|篮球|跑步|游泳)|\b(?:football|soccer|basketball|running|swimming)\b/iu;
const preferenceCue=/^(?:(?:我)?(?:很)?喜欢)?(?:足球|篮球|跑步|游泳)[。.!！\s]*$|^(?:(?:i (?:really )?like|i love)(?: playing)? )?(?:football|soccer|basketball|running|swimming)[。.!！\s]*$/iu;
export function sportsAttempt(text) {
  // Only a direct affirmative first-person statement; no quoted/teacher examples.
  return /(?:^|[。！!，,；;\n])\s*我(?:很)?喜欢(?:踢足球|打篮球|足球|篮球|跑步|游泳)(?:[。！!，,；;]|$)/u.test(controlText(text));
}

export class NaturalTeaching {
  constructor({mode,mission}) {
    this.mode=mode;
    this.goal=mode==='sports'?{id:'express-likes',source:'ask-kai-authored-curriculum'}:mode==='mission'?{id:'mission-target-1',source:'authorized-hskai-mission'}:null;
    this.likesGoal=mode==='sports' || (mode==='mission' && /我喜欢|表达喜好/.test(mission.targets[0]));
    this.turns=0;this.paused=false;this.clarificationPending=false;this.goalAttempted=false;
    this.lastTeachingTurn=null;this.autoTeachingUsed=false;this.decision=null;
  }
  select(event,contextVersion) {
    this.turns++;
    const text=controlText(event.payload.text),help=helpIntent.test(text),practice=practiceIntent.test(text);
    const clauses=text.split(/[，,。？！!?；;\n]/u).filter(c=>!languageQuestion.test(c));
    const ended=clauses.some(c=>endIntent.test(c.trim()) && !questionInput.test(c.trim()));
    const declined=clauses.some(c=>declineIntent.test(c)),changed=clauses.some(c=>!keepTopic.test(c) && changeIntent.test(c));
    const relatedHelp=help && !!this.goal && ((this.likesGoal && sportsWord.test(text)) || /(?:这(?:个)?(?:句子|表达|目标))|\bthis (?:sentence|expression|goal)\b/iu.test(text));
    const cooldown=this.lastTeachingTurn===null?0:Math.max(0,TEACHING_COOLDOWN_TURNS+1-(this.turns-this.lastTeachingTurn));
    const attempted=!!this.goal && this.likesGoal && sportsAttempt(event.payload.text);
    if(attempted)this.goalAttempted=true;
    let action='RESPOND',reason='conversation_first',support='none';
    if(ended){action='CLOSE';reason='student_end';}
    else if(declined || changed){this.paused=true;reason=declined?'student_declined':'student_changed_topic';}
    else {
      if(relatedHelp || practice)this.paused=false;
      if(unclearInput.test(text) || !text) {
        if(this.clarificationPending){reason='clarification_limit';support='choice';}
        else{action='CLARIFY_INTENT';reason='unclear_input';support='choice';}
      } else if(help || practice) {
        reason=help?'student_requested_help':'student_requested_practice';
        if(cooldown){reason='teaching_cooldown';support='choice';}
        else{action='TEACH_TARGET';support='model';}
      } else if(this.paused)reason='teaching_paused';
      else if(questionInput.test(text))reason='ordinary_question';
      else if(attempted){action='FOLLOW_UP';reason='goal_attempt_observed';}
      else if(this.goal && this.likesGoal && preferenceCue.test(text) && !this.goalAttempted && !this.autoTeachingUsed && !cooldown) {
        action='TEACH_TARGET';reason='relevant_short_answer';support='model';this.autoTeachingUsed=true;
      } else if(sportsWord.test(text)){action='FOLLOW_UP';}
    }
    // Keep the clarification limit until a substantive answer or new intent,
    // rather than alternating repeated requests to clarify.
    this.clarificationPending=reason==='clarification_limit' || action==='CLARIFY_INTENT';
    if(action==='TEACH_TARGET')this.lastTeachingTurn=this.turns;
    const goal=help && !relatedHelp?null:this.goal;
    this.decision={policy_version:TEACHING_POLICY_VERSION,session_id:event.session_id,source_event_id:event.event_id,turn_id:event.turn_id,context_version:contextVersion,turn_count:this.turns,mode:this.mode,action,reason,interaction:action==='TEACH_TARGET'?'teach':'chat',support_level:support,new_points:action==='TEACH_TARGET'?1:0,goal_id:goal?.id??null,goal_source:goal?.source??null,goal_attempt_observed:this.goalAttempted,teaching_paused:this.paused,clarification_pending:this.clarificationPending,teaching_cooldown:action==='TEACH_TARGET'?TEACHING_COOLDOWN_TURNS:cooldown,advisory:true};
    return {...this.decision};
  }
  context() {
    if(!this.decision)return '尚无已确认学生回合；按当前输入选择动作。';
    const {action,reason,support_level,turn_count,teaching_paused,clarification_pending,teaching_cooldown,goal_attempt_observed,goal_id,context_version,turn_id}=this.decision;
    return `以下 JSON 仅为最近一次已确认话轮的状态；不要求下一轮重复该动作。学生最新意图优先：${JSON.stringify({action,reason,support_level,turn_count,teaching_paused,clarification_pending,teaching_cooldown,goal_attempt_observed,goal_id,context_version,source_turn_id:turn_id})}`;
  }
}
