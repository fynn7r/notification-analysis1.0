import { z } from 'zod';

export const generateStyles = ['官方正式风', '班级通知风', '社团活动风', '社区通知风'] as const;
const required = (label: string) => z.string().trim().min(1, `请填写${label}`).max(1000, `${label}暂限1000字以内`);
const optional = z.string().trim().max(5000, '单项详情暂限5000字以内').default('');

export const generateRequestSchema = z.object({
  topic: required('通知主题'),
  activityType: optional,
  time: required('活动时间'),
  location: required('活动地点'),
  participants: required('参加对象'),
  registrationMethod: optional,
  deadline: optional,
  requirements: optional,
  notes: optional,
  style: z.enum(generateStyles),
  enableEmoji: z.boolean(),
});

export const generateModelOutputSchema = z.object({
  content: z.string().trim().min(1, '通知正文不能为空').max(12000),
});
export const generateResponseSchema = generateModelOutputSchema.extend({ source: z.literal('real') });
export type GenerateRequest = z.infer<typeof generateRequestSchema>;
