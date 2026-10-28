/**
 * @file notification.ts
 * @description 通知数据模型与类型定义文件
 * 定义了校园通知解析相关的所有 TypeScript 接口和类型，包括：
 * - 通知类型枚举（比赛竞赛/讲座分享/作业任务等）
 * - 重要程度分级（高/中/低）
 * - 完整通知对象 INotification（含原始文本、解析结果、匹配规则、深度解读等）
 * - 历史记录精简版与完整版结构
 * - 内置示例数据 MOCK_NOTIFICATION（数模竞赛通知，用于演示和测试）
 * @exports INotification, IMatchedRule, IHistoryItem, IHistoryFullItem, IImpliedMeaning, IInterpretationItem, MOCK_NOTIFICATION, MOCK_HISTORY, MOCK_HISTORY_FULL
 */

import { getFutureDate } from '@/lib/date-utils';
import type { knowledgeAnalysisSchema } from '@shared/parse-contract';
import type { z } from 'zod';

/** 服务端校验后的知识引用；只在登录并使用知识库时出现。 */
export type IKnowledgeAnalysis = z.infer<typeof knowledgeAnalysisSchema>;

export type NotificationType =
  | '比赛竞赛'
  | '讲座分享'
  | '作业任务'
  | '缴费事务'
  | '活动会议'
  | '招募报名'
  | '其他';

export type ImportanceLevel = 'high' | 'medium' | 'low';

export interface IInterpretationItem {
  interpretation_content: string;
  action_suggestion: string;
  confidence: '高' | '中' | '低';
  remarks?: string;
  evidence?: string;
}

export interface IImpliedMeaning {
  original_notification_summary: string;
  interpretation_items: IInterpretationItem[];
  overall_suggestion: string;
  source: 'mock' | 'real';
  knowledge?: IKnowledgeAnalysis;
}

export interface IMatchedRule {
  ruleId: string;
  ruleTitle: string;
  category: string;
  score?: string;
  matchReason: string;
  worthAttending: boolean;
}

export interface ISupplementRecord {
  id: string;
  content: string;
  addedAt: number;
}

export interface IMediaAttachment {
  id: string;
  type: 'image' | 'video';
  source: 'link' | 'local';
  url?: string;
  dataUrl?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  addedAt: number;
}

export interface INotification {
  id: string;
  rawText: string;
  type: NotificationType;
  title?: string;
  primaryAction?: { title: string; deadline?: string; remindAt?: string };
  parseContext?: { referenceDate: string; timezone: string };
  timeWarnings?: string[];
  registrationDeadline?: string;
  eventStartTime?: string;
  location?: string;
  targetAudience?: string;
  requirements?: string;
  contact?: string;
  links?: string[];
  importance: ImportanceLevel;
  importanceReason: string;
  matchedRules?: IMatchedRule[];
  summary?: string;
  impliedMeaning?: IImpliedMeaning;
  supplements?: ISupplementRecord[];
  mediaAttachments?: IMediaAttachment[];
  detectedMediaLinks?: string[];
  source: 'mock' | 'real';
  parsedAt: number;
  knowledge?: IKnowledgeAnalysis;
}

export interface IHistoryItem {
  id: string;
  title: string;
  type: string;
  importance: ImportanceLevel;
  parsedAt: number;
  source: 'mock' | 'real';
}

// 完整历史记录（含解析详情，用于历史详情页展示）
export type IHistoryFullItem = INotification;

// —— 基于当前日期的示例数据（未来 7~30 天，保证演示时未过期） ——

const deadlineDate = getFutureDate(20, 23, 59); // 20 天后 23:59
const eventStartDate = getFutureDate(40, 9, 0); // 40 天后 09:00

export const MOCK_NOTIFICATION: INotification = {
  id: 'mock-notice-001',
  rawText:
    '【重要通知】关于举办全国大学生数学建模竞赛校内选拔赛的通知\n\n各学院、各年级同学：\n\n为选拔优秀学生参加全国大学生数学建模竞赛，学校决定举办校内选拔赛。现将有关事项通知如下：\n\n一、竞赛时间\n竞赛当天上午9:00 开始，共72小时\n\n二、报名方式\n1. 以团队形式报名，每队3人\n2. 报名截止时间：报名截止日 23:59\n3. 报名链接：https://mathcomp.example.edu.cn/signup\n\n三、提交要求\n1. 参赛队伍需在竞赛结束前提交电子版论文（PDF格式）\n2. 提交位置：数模竞赛管理系统-作品提交栏\n3. 论文格式参照《全国大学生数学建模竞赛论文格式规范》\n\n四、参赛对象\n全校全日制本科生、研究生，不限专业\n\n五、奖励与加分\n1. 校内赛设一、二、三等奖\n2. 获奖队伍可获综测加分（学科竞赛类）\n3. 优秀队伍将代表学校参加全国赛\n\n六、联系方式\n联系人：李老师\n邮箱：mathcomp@example.edu.cn\n电话：010-12345678\n\n教务处 数学学院',
  type: '比赛竞赛',
  title: '全国大学生数学建模竞赛校内选拔赛',
  registrationDeadline: deadlineDate,
  eventStartTime: eventStartDate,
  location: '数模竞赛管理系统-作品提交栏',
  targetAudience: '全校全日制本科生、研究生，不限专业',
  requirements:
    '以团队形式报名，每队3人；参赛队伍需在竞赛结束前提交电子版论文（PDF格式）；论文格式参照《全国大学生数学建模竞赛论文格式规范》',
  contact: '李老师 / mathcomp@example.edu.cn / 010-12345678',
  links: ['https://mathcomp.example.edu.cn/signup'],
  importance: 'high',
  importanceReason:
    '涉及综测加分（学科竞赛类），时间紧迫（距报名截止约20天），国家级竞赛含金量高，值得投入准备',
  matchedRules: [
    {
      ruleId: 'mock-rule-001',
      ruleTitle: '学科竞赛类加分',
      category: '学科竞赛',
      score: '国家级一等奖加5分 / 二等奖加4分 / 三等奖加3分；省级一等奖加3分 / 二等奖加2分 / 三等奖加1分',
      matchReason:
        '通知明确为"全国大学生数学建模竞赛"，属于国家级学科竞赛，获奖可按学科竞赛类标准加分；校内选拔赛为全国赛的前置环节',
      worthAttending: true,
    },
  ],
  summary:
    '【比赛竞赛·高优】全国大学生数学建模竞赛校内选拔赛\n报名截止：' + deadlineDate + '\n提交位置：数模竞赛管理系统\n加分项：学科竞赛类（国家级最高+5分）\n组队3人，72小时赛程，值得参加！',
  impliedMeaning: {
    original_notification_summary:
      '学校举办全国大学生数学建模竞赛校内选拔赛，以团队形式报名（3人/队），报名截止约20天后，竞赛时间在报名后约20天，共72小时，获奖队伍可获综测加分并有机会代表学校参加全国赛。',
    interpretation_items: [
      {
        interpretation_content:
          '通知明确标有「重要通知」字样且为教务处联合数学学院发布，说明学校对此次竞赛高度重视，获奖含金量高，综测加分权重较大。',
        action_suggestion: '建议将此比赛列为高优先级事项，尽早组队并开始准备',
        confidence: '高',
      },
      {
        interpretation_content:
          '报名截止时间较紧（距当前约20天），且需3人组队，意味着寻找队友+协商报名需要时间，不宜拖延到最后一天。',
        action_suggestion: '建议本周内完成组队和报名，避免临近截止因系统繁忙或队友凑不齐而错过',
        confidence: '高',
      },
      {
        interpretation_content:
          '提到「获奖队伍可获综测加分（学科竞赛类）」和「优秀队伍将代表学校参加全国赛」，暗示校内赛是全国赛的前置门槛，校内获奖是基础目标，冲击全国赛才是加分最大化的路径。',
        action_suggestion: '建议目标不仅是参与，更要争取进入获奖名单乃至全国赛资格，综测收益最大',
        confidence: '高',
      },
      {
        interpretation_content:
          '参赛对象写「不限专业」，说明跨专业组队被鼓励且可能有优势（数学+计算机+写作的经典组合），不必局限于同班同学。',
        action_suggestion: '建议跨学院/跨专业寻找队友，能力互补更易获奖',
        confidence: '中',
      },
      {
        interpretation_content:
          '竞赛时长72小时，意味着这三天需要整块时间投入，要提前协调课程、实习等其他安排。',
        action_suggestion: '建议提前查看这三天的课程安排，必要时向老师请假或做好课业预案',
        confidence: '高',
      },
      {
        interpretation_content:
          '「只需提交电子版论文（PDF格式）」暗示参赛成本较低，不需要实物制作或现场答辩，时间投入可控。',
        action_suggestion: '时间成本相对可控，建议即使是零基础也可以尝试组队参加',
        confidence: '中',
      },
    ],
    overall_suggestion:
      '优先级：⭐⭐⭐⭐⭐ 强烈推荐参加。\n行动顺序：① 本周内完成组队（建议跨专业搭配）→ ② 截止日前完成报名 → ③ 赛前每周抽时间学习往年赛题和建模方法 → ④ 提前协调竞赛期间的时间安排 → ⑤ 比赛期间合理分工、注重论文质量。\n注意：这是综测加分性价比很高的国家级赛事，投入产出比优秀。',
    source: 'mock',
  },
  supplements: [
    {
      id: 'supp-001',
      content: '【补充通知】由于报名人数超预期，报名截止时间延后5天，请同学们合理安排时间。——数学学院',
      addedAt: Date.now() - 86400_000,
    },
  ],
  detectedMediaLinks: [],
  mediaAttachments: [],
  source: 'mock',
  parsedAt: Date.now() - 3600_000 * 2,
};

export const MOCK_HISTORY: IHistoryItem[] = [
  {
    id: 'mock-notice-001',
    title: '全国大学生数学建模竞赛校内选拔赛',
    type: '比赛竞赛',
    importance: 'high',
    parsedAt: Date.now() - 3600_000 * 2,
    source: 'mock',
  },
];

export const MOCK_HISTORY_FULL: IHistoryFullItem[] = [MOCK_NOTIFICATION];
