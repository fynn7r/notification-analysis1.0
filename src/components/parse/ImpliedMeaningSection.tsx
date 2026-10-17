import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Lightbulb,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react';
import type { IImpliedMeaning } from '@/data/notification';

interface ImpliedMeaningSectionProps {
  impliedMeaning?: IImpliedMeaning | null;
  onGenerate?: () => void;
  isLoading?: boolean;
  unavailableReason?: string;
}

function ConfidenceBadge({ level }: { level: '高' | '中' | '低' }) {
  const config = {
    高: { icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    中: { icon: AlertCircle, className: 'bg-amber-50 text-amber-700 border-amber-200' },
    低: { icon: HelpCircle, className: 'bg-gray-50 text-gray-600 border-gray-200' },
  } as const;
  const { icon: Icon, className } = config[level];
  return (
    <Badge variant="outline" className={`flex items-center gap-1 text-[10px] ${className}`}>
      <Icon className="size-3" />
      {level}可信
    </Badge>
  );
}

export default function ImpliedMeaningSection({
  impliedMeaning,
  onGenerate,
  isLoading = false,
  unavailableReason,
}: ImpliedMeaningSectionProps) {
  const [expanded, setExpanded] = useState(true);

  // 未生成状态：只显示标题栏 + AI 解读按钮
  if (!impliedMeaning) {
    return (
      <Card className="border-purple-200/60 bg-gradient-to-br from-purple-50/60 via-card to-pink-50/40">
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-purple-500/15">
              <Lightbulb className="size-4 text-purple-600" />
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">
                话里有话 · 深度解读
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {unavailableReason || '点击 AI 解读，挖掘通知背后的潜台词与隐藏信息'}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onGenerate}
            disabled={isLoading || !!unavailableReason}
            className="border-purple-200 text-purple-700 hover:bg-purple-50 hover:text-purple-800 shrink-0"
          >
            {isLoading ? (
              <>
                <Sparkles className="mr-1.5 size-3.5 animate-spin" />
                解读中
              </>
            ) : (
              <>
                <Sparkles className="mr-1.5 size-3.5" />
                {unavailableReason ? '暂未接入' : 'AI 解读'}
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // 已生成状态：支持展开/收起
  return (
    <Card className="border-purple-200/60 bg-gradient-to-br from-purple-50/60 via-card to-pink-50/40">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-6 py-3 text-left transition-colors"
      >
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="flex size-7 items-center justify-center rounded-lg bg-purple-500/15">
            <Lightbulb className="size-4 text-purple-600" />
          </div>
          话里有话 · 深度解读
          <Badge
            variant="outline"
            className="ml-1 border-purple-200 text-purple-600 text-xs font-normal"
          >
            AI 解读
          </Badge>
        </CardTitle>
        {expanded ? (
          <ChevronUp className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <CardContent className="space-y-5 border-t pt-5">
              {/* 通知摘要 */}
              <div className="rounded-lg bg-white/70 p-4 ring-1 ring-purple-100">
                <div className="mb-1.5 text-xs font-medium text-purple-700">
                  📝 通知核心摘要
                </div>
                <p className="text-sm text-foreground leading-relaxed">
                  {impliedMeaning.original_notification_summary}
                </p>
              </div>

              {/* 解读条目 */}
              <div className="space-y-3">
                <div className="text-xs font-medium text-muted-foreground">
                  🔍 潜台词与言外之意
                </div>
                {impliedMeaning.interpretation_items.map((item, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.08 }}
                    className="rounded-lg border border-border/60 bg-white/80 p-4 shadow-sm"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <ConfidenceBadge level={item.confidence} />
                      {item.remarks && (
                        <Badge
                          variant="outline"
                          className="text-[10px] text-muted-foreground border-border"
                        >
                          {item.remarks}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-foreground leading-relaxed">
                      {item.interpretation_content}
                    </p>
                    {item.evidence && <p className="mt-2 text-xs text-muted-foreground">原文依据：{item.evidence}</p>}
                    <div className="mt-3 flex items-start gap-2 rounded-md bg-emerald-50/70 px-3 py-2">
                      <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                      <p className="text-xs text-emerald-700 leading-relaxed">
                        <span className="font-medium">行动建议：</span>
                        {item.action_suggestion}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* 综合建议 */}
              <div className="rounded-lg border border-purple-200/60 bg-gradient-to-r from-purple-100/50 to-pink-100/50 p-4">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-purple-800">
                  <Lightbulb className="size-3.5" />
                  综合行动建议
                </div>
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
                  {impliedMeaning.overall_suggestion}
                </p>
              </div>
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
