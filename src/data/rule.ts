/**
 * @file rule.ts
 * @description 综测加分规则数据模型定义文件
 * 定义了综测加分规则相关的 TypeScript 接口和类型：
 * - 加分规则 IRule（含分类、内容、加分标准、来源等）
 * - 规则来源类型（文件导入 / 手动输入 / 内置示例）
 * - 内置示例规则数据（学科竞赛、文体活动、志愿服务、社会实践四大类加分标准）
 * 这些规则用于通知解析时自动匹配，判断通知对应的活动能加多少综测分。
 * @exports IRule, MOCK_RULES
 */

export interface IRule {
  id: string;
  title: string;
  category: string;
  content: string;
  score?: string;
  source: 'file' | 'text' | 'mock';
  createdAt: number;
  richDocumentId?: string;
}

export const MOCK_RULES: IRule[] = [
  {
    id: 'mock-rule-001',
    title: '学科竞赛类加分',
    category: '学科竞赛',
    content:
      '学生参加学科竞赛活动获奖，按下列标准加分：\n（一）国家级：一等奖加5分，二等奖加4分，三等奖加3分\n（二）省级：一等奖加3分，二等奖加2分，三等奖加1分\n（三）校级：一等奖加1分，二等奖加0.5分，三等奖加0.3分\n学科竞赛包括：数学建模、挑战杯、互联网+、程序设计、英语竞赛等经学校认定的竞赛项目。',
    score: '国家级5/4/3分 · 省级3/2/1分 · 校级1/0.5/0.3分',
    source: 'mock',
    createdAt: Date.now() - 86400_000 * 7,
  },
  {
    id: 'mock-rule-002',
    title: '文体活动类加分',
    category: '文体活动',
    content:
      '学生参加文化、体育、艺术活动获奖或担任职务，按下列标准加分：\n（一）文体竞赛国家级获奖加4分，省级加2分，校级加1分\n（二）担任学生会、社团主要干部加1-2分（按任职考核结果）\n（三）参加文艺汇演、运动会等集体活动加0.5分',
    score: '国家级4分 · 省级2分 · 校级1分',
    source: 'mock',
    createdAt: Date.now() - 86400_000 * 7,
  },
  {
    id: 'mock-rule-003',
    title: '志愿服务类加分',
    category: '志愿服务',
    content:
      '学生参加志愿服务活动，按下列标准加分：\n（一）每累计20小时志愿服务加0.5分，累计加分不超过2分\n（二）获校级以上优秀志愿者称号加1分\n（三）参加重大赛事、大型会议志愿服务加0.5-1分',
    score: '每20小时+0.5分 · 上限2分',
    source: 'mock',
    createdAt: Date.now() - 86400_000 * 7,
  },
  {
    id: 'mock-rule-004',
    title: '社会实践类加分',
    category: '社会实践',
    content:
      '学生参加社会实践活动，按下列标准加分：\n（一）社会实践团队获国家级表彰加3分，省级加2分，校级加1分\n（二）个人社会实践报告获优秀加0.5分\n（三）参加暑期三下乡等实践活动加0.5分',
    score: '国家级3分 · 省级2分 · 校级1分',
    source: 'mock',
    createdAt: Date.now() - 86400_000 * 7,
  },
];
