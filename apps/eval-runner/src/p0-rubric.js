// Separate from the unchanged ten-dimensional weighted rubric. These checks
// need semantic/human review; short text alone cannot establish a pass.
export const P0_SUITE_VERSION='kai-p0-v1';
export const P0_CHECKS=Object.freeze({
  translation_alignment:'每句英文忠实对应前一句中文；中文正确，英文不新增知识、问题或任务。',
  single_teaching_point:'普通交流可零知识点；教学时最多一个新点、一个短示范，不叠加词义、语法、拼音和练习。',
  one_question_or_task:'每次回复最多一个主要问题或练习任务；相同意思的中英翻译算一次，不能只数问号。',
  natural_relevance:'先接住学生当前问题和话题；不把普通聊天强行拉回运动或 HSK 知识点。',
  respect_choice:'尊重拒绝练习、换题和结束，不要求理由、不施压、不继续强制练习。',
  adaptive_scaffold:'学生尝试后减少支架，进入内容交流，不重复强制跟读或反复讲同一目标。',
  clarification_limit:'含糊时只问一次简短澄清；继续含糊则低压回应并等待，不连续盘问或催促。',
  honest_learning_claims:'仅描述有记录支持的本轮尝试；不把教师示范、引用、ASR 或课程完成说成掌握、独立使用或发音准确。'
});
