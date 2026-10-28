/**
 * 知识引用展示。
 * 只显示服务端确认过的引用；冲突要并列展示双方依据，不能默认选边。
 */
import { BookOpen, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { IKnowledgeAnalysis } from '@/data/notification';

const scopeLabel = (scope: 'personal' | 'application') => (scope === 'application' ? '应用库' : '个人库');

export default function KnowledgeCitationCard({ knowledge }: { knowledge: IKnowledgeAnalysis }) {
  const hasCitations = knowledge.citations.length > 0;
  const hasConflicts = knowledge.conflicts.length > 0;

  if (!knowledge.used && !hasConflicts) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-start gap-2 py-3 text-sm text-muted-foreground">
          <BookOpen className="mt-0.5 size-4 shrink-0" />
          <span>{knowledge.summary || knowledge.note || '本次分析没有使用知识库内容。'}</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">知识库参考</span>
          {knowledge.partial && (
            <Badge variant="outline" className="text-[11px] font-normal">仅部分纳入</Badge>
          )}
        </div>

        {knowledge.summary && <p className="text-sm leading-relaxed">{knowledge.summary}</p>}

        {hasCitations && (
          <ul className="space-y-2">
            {knowledge.citations.map((citation) => (
              <li key={`${citation.chunkId}-${citation.locationLabel}`} className="rounded-md bg-muted/60 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="text-[11px] font-normal">{scopeLabel(citation.scope)}</Badge>
                  <span className="font-medium text-foreground">{citation.title}</span>
                  <span>v{citation.version}</span>
                  <span>{citation.locationLabel}</span>
                </div>
                <p className="mt-1 text-sm leading-relaxed">{citation.quote}</p>
              </li>
            ))}
          </ul>
        )}

        {hasConflicts && (
          <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
              <AlertTriangle className="size-4" />
              两处资料说法不一致，需确认
            </div>
            {knowledge.conflicts.map((conflict) => (
              <div key={conflict.topic} className="space-y-1 text-sm">
                <p className="font-medium text-amber-900">{conflict.topic}</p>
                {conflict.sides.map((side, index) => (
                  <p key={`${side.title}-${index}`} className="text-amber-900/90">
                    <Badge variant="outline" className="mr-1 text-[11px] font-normal">{scopeLabel(side.scope)}</Badge>
                    <span className="font-medium">{side.title}</span>：{side.quote}
                  </p>
                ))}
                <p className="text-xs text-amber-800">{conflict.note}</p>
              </div>
            ))}
          </div>
        )}

        {knowledge.note && !hasConflicts && (
          <p className="text-xs text-muted-foreground">{knowledge.note}</p>
        )}
      </CardContent>
    </Card>
  );
}
