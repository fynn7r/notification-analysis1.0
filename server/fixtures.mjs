export const signupRequest = {
  text: 'QQ社团群通知：本周四晚20:00开展青马学堂线下分享会，需要提前填写在线报名表报名，截止时间是本周三中午12点，不报名无法入场。',
  referenceDate: '2026-10-05',
  timezone: 'Asia/Shanghai',
};

// 与首页静态竞赛示例原文一致；日期占位词没有具体日期，必须由用户补齐。
export const competitionRequest = {
  text: '【重要通知】关于举办全国大学生数学建模竞赛校内选拔赛的通知\n\n各学院、各年级同学：\n\n为选拔优秀学生参加全国大学生数学建模竞赛，学校决定举办校内选拔赛。现将有关事项通知如下：\n\n一、竞赛时间\n竞赛当天上午9:00 开始，共72小时\n\n二、报名方式\n1. 以团队形式报名，每队3人\n2. 报名截止时间：报名截止日 23:59\n3. 报名链接：https://mathcomp.example.edu.cn/signup\n\n三、提交要求\n1. 参赛队伍需在竞赛结束前提交电子版论文（PDF格式）\n2. 提交位置：数模竞赛管理系统-作品提交栏\n3. 论文格式参照《全国大学生数学建模竞赛论文格式规范》\n\n四、参赛对象\n全校全日制本科生、研究生，不限专业\n\n五、奖励与加分\n1. 校内赛设一、二、三等奖\n2. 获奖队伍可获综测加分（学科竞赛类）\n3. 优秀队伍将代表学校参加全国赛\n\n六、联系方式\n联系人：李老师\n邮箱：mathcomp@example.edu.cn\n电话：010-12345678\n\n教务处 数学学院',
  referenceDate: '2026-10-06',
  timezone: 'Asia/Shanghai',
};

// 仅供自动化测试使用；生产接口始终请求真实模型。
export const signupModelOutput = {
  title: '青马学堂线下分享会', type: '讲座分享', actionTitle: '填写青马学堂报名表',
  deadline: { date: '2026-10-07', time: '12:00', evidence: '本周三中午12点' },
  eventTime: { date: '2026-10-08', time: '20:00', evidence: '本周四晚20:00' },
  location: '', targetAudience: '', requirements: '不报名无法入场', contact: '', links: [],
};
// 通知生成联调输入；仅含公开示例信息，不是模型生成结果。
export const generationRequest = {
  topic: '青马学堂线下分享会报名', activityType: '讲座分享',
  time: '2026年10月8日 20:00', location: '学生活动中心201室', participants: '本校社团成员',
  registrationMethod: '填写社团群置顶报名表', deadline: '2026年10月7日 12:00',
  requirements: '提前报名，凭报名确认入场', notes: '不报名无法入场，请提前10分钟到场',
  style: '社团活动风', enableEmoji: true,
};

