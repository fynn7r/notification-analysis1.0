// ---- plugin:rule_document_parser_1 ----
// ============================================================
// 插件 rule_document_parser_1 (规则文档解析) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface RuleDocumentParserOneInput {
  /** 规则文件Url，支持PDF、DOC、DOCX、TXT格式 */
  rule_file: string[];
}

/**
 * capabilityClient.load('rule_document_parser_1').call<RuleDocumentParserOneOutput>('parseDocToMarkdown', input)
 * 直接返回此类型，无 .data 包装，直接解构使用：
 * const { content } = result;
 * 返回值形如：
 *   {"content":"示例文本"}
 */
export interface RuleDocumentParserOneOutput {
  /** [object Object] */
  content: string;
}
// ---- end:rule_document_parser_1 ----

// ---- plugin:notification_summary_generator_1 ----
// ============================================================
// 插件 notification_summary_generator_1 (通知摘要生成) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface NotificationSummaryGeneratorOneInput {
  /** 待处理的原始通知内容（包含解析结果和规则匹配结果） */
  raw_notification_content: string;
}

/**
 * capabilityClient.load('notification_summary_generator_1').callStream<NotificationSummaryGeneratorOneOutput>('textSummary', input)
 * 每个 chunk 就是下面这个扁平对象，字段名与 NotificationSummaryGeneratorOneOutput 一致，外面没有 data / choices / message 包装：
 *   {"summary":"示例文本"}
 * 返回值可能是 AsyncIterable<chunk>，也可能是 { output: AsyncIterable<chunk> }，取流前先归一化。
 * 逐段累加：
 *   for await (const chunk of stream) { result += chunk.summary ?? ''; }
 */
export interface NotificationSummaryGeneratorOneOutput {
  /** [object Object] */
  summary: string;
}
// ---- end:notification_summary_generator_1 ----

// ---- plugin:notification_rule_match_analysis_1 ----
// ============================================================
// 插件 notification_rule_match_analysis_1 (通知规则库匹配分析) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface NotificationRuleMatchAnalysisOneInput {
  /** 待分析的通知文本内容 */
  notification_content: string;
}

/**
 * capabilityClient.load('notification_rule_match_analysis_1').call<NotificationRuleMatchAnalysisOneOutput>('aiCategorize', input)
 * 直接返回此类型，无 .data 包装，直接解构使用：
 * const { categories } = result;
 * 返回值形如：
 *   {"categories":["学科竞赛"]}
 */
export interface NotificationRuleMatchAnalysisOneOutput {
  /** 匹配到的分类列表 */
  categories: string[];
  categories_string?: string;
}
// ---- end:notification_rule_match_analysis_1 ----

// ---- plugin:notification_structured_parse_1 ----
// ============================================================
// 插件 notification_structured_parse_1 (通知结构化解析) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface NotificationStructuredParseOneInput {
  /** 待解析的通知原文内容 */
  notification_content: string;
}

/**
 * capabilityClient.load('notification_structured_parse_1').call<NotificationStructuredParseOneOutput>('textToJson', input)
 * 直接返回此类型，无 .data 包装，直接解构使用：
 * const { notification_type, submission_location, participants, ... } = result;
 * 返回值形如：
 *   {"notification_type":"示例文本","submission_location":"示例文本","participants":"示例文本","contact_information":"示例文本","registration_deadline":"示例文本","activity_time":"示例文本","work_requirements":"示例文本","related_links":"示例文本"}
 */
export interface NotificationStructuredParseOneOutput {
  /** 通知类型，如活动报名、赛事通知、会议通知、培训通知等 */
  notification_type: string;
  /** 材料提交位置或活动举办地点 */
  submission_location: string;
  /** 参加对象或适用人群 */
  participants: string;
  /** 联系方式，包括联系人、电话、邮箱等 */
  contact_information: string;
  /** 报名截止时间 */
  registration_deadline: string;
  /** 活动举办时间 */
  activity_time: string;
  /** 作品要求或参与要求 */
  work_requirements: string;
  /** 相关链接或附件地址 */
  related_links: string;
}
// ---- end:notification_structured_parse_1 ----

// ---- plugin:notification_implied_meaning_interpretation_1 ----
// ============================================================
// 插件 notification_implied_meaning_interpretation_1 (话里有话深度解读插件实例) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface NotificationImpliedMeaningInterpretationOneInput {
  /** 需要解读的通知原文内容 */
  notification_content: string;
  /** 相关规则库上下文信息，用于辅助解读 */
  rule_base_context?: string;
}

/**
 * capabilityClient.load('notification_implied_meaning_interpretation_1').call<NotificationImpliedMeaningInterpretationOneOutput>('textToJson', input)
 * 直接返回此类型，无 .data 包装，直接解构使用：
 * const { original_notification_summary, interpretation_items, overall_suggestion } = result;
 * 返回值形如：
 *   {"original_notification_summary":"示例文本","interpretation_items":[],"overall_suggestion":"示例文本"}
 */
export interface NotificationImpliedMeaningInterpretationOneOutput {
  /** 通知原文的核心内容摘要，简要概括通知的主要事项 */
  original_notification_summary: string;
  /** 解读条目列表，items schema: {interpretation_content: string(解读内容，包含潜台词、言外之意、关键暗示), action_suggestion: string(对应行动建议), confidence: string(可信度：高/中/低), remarks: string(备注说明，如待确认等)} */
  interpretation_items: unknown[];
  /** 针对整个通知的综合行动建议，给出优先级排序和注意事项 */
  overall_suggestion: string;
}
// ---- end:notification_implied_meaning_interpretation_1 ----

// ---- plugin:notification_copy_generator_1 ----
// ============================================================
// 插件 notification_copy_generator_1 (通知文案智能生成) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface NotificationCopyGeneratorOneInput {
  /** 活动地点 */
  location: string;
  /** 活动类型 */
  activity_type?: string;
  /** 活动时间 */
  time: string;
  /** 参加对象 */
  participants: string;
  /** 报名方式 */
  registration_method?: string;
  /** 注意事项 */
  notes?: string;
  /** 通知主题 */
  topic: string;
  /** 活动要求 */
  requirements?: string;
  /** 通知风格（可选值：官方正式风、班级通知风、社团活动风、社区通知风） */
  style: string;
  /** 是否启用活泼风模式（加入表情符号装饰），可选值：是/否 */
  enable_emoji?: string;
}

/**
 * capabilityClient.load('notification_copy_generator_1').callStream<NotificationCopyGeneratorOneOutput>('textGenerate', input)
 * 每个 chunk 就是下面这个扁平对象，字段名与 NotificationCopyGeneratorOneOutput 一致，外面没有 data / choices / message 包装：
 *   {"content":"示例文本","response":"示例文本"}
 * 返回值可能是 AsyncIterable<chunk>，也可能是 { output: AsyncIterable<chunk> }，取流前先归一化。
 * 逐段累加：
 *   for await (const chunk of stream) { result += chunk.content ?? ''; }
 */
export interface NotificationCopyGeneratorOneOutput {
  /** [object Object] */
  content: string;
  /** [object Object] */
  response?: string;
}
// ---- end:notification_copy_generator_1 ----