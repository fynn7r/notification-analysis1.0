import { useState, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Trash2,
  FileText,
  X,
  ChevronRight,
  Clock,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useHistory } from '@/hooks/useHistory';
import { useRules } from '@/hooks/useRules';
import { INotification, type NotificationType, MOCK_NOTIFICATION } from '@/data/notification';
import ParseResultCard from '@/components/parse/ParseResultCard';
import ImportanceBadge from '@/components/common/ImportanceBadge';
import { formatDate } from '@/lib/date-utils';

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: '全部类型' },
  { value: '比赛竞赛', label: '比赛竞赛' },
  { value: '讲座分享', label: '讲座分享' },
  { value: '作业任务', label: '作业任务' },
  { value: '缴费事务', label: '缴费事务' },
  { value: '活动会议', label: '活动会议' },
  { value: '招募报名', label: '招募报名' },
  { value: '其他', label: '其他' },
];

export default function HistoryPage() {
  const { history, loading, deleteHistory, clearHistory, getHistoryById } = useHistory();
  const { rules } = useRules();
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selected, setSelected] = useState<INotification | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);

  const filtered = useMemo(() => {
    return history.filter((item) => {
      if (typeFilter !== 'all' && item.type !== typeFilter) return false;
      if (keyword.trim()) {
        // 搜索范围：标题、类型、原文、要求、地点、联系人
        const kw = keyword.trim().toLowerCase();
        const hay = [
          item.title,
          item.type,
          item.rawText,
          item.requirements,
          item.location,
          item.targetAudience,
          item.contact,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(kw);
      }
      return true;
    });
  }, [history, keyword, typeFilter]);

  const handleViewDetail = useCallback(
    (item: INotification) => {
      const full = getHistoryById(item.id);
      if (full) {
        setSelected(full);
      } else if (item.source === 'mock') {
        setSelected(MOCK_NOTIFICATION);
      } else {
        setSelected(item);
      }
      setDetailOpen(true);
    },
    [getHistoryById]
  );

  const handleClearAll = useCallback(() => {
    clearHistory();
    setClearConfirm(false);
    toast.success('已清空历史记录');
  }, [clearHistory]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 overflow-hidden">
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-12">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">历史记录</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              所有解析过的通知，支持搜索和筛选
            </p>
          </div>
          {history.length > 0 && (
            <AlertDialog open={clearConfirm} onOpenChange={setClearConfirm}>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                  <Trash2 className="mr-1.5 size-3.5" />
                  清空
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>清空所有历史记录</AlertDialogTitle>
                  <AlertDialogDescription>
                    清空后将无法恢复，确认继续吗？
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleClearAll}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    确认清空
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {/* 搜索筛选区 */}
        <Card className="mb-6">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索通知标题..."
                className="pl-9"
              />
              {keyword && (
                <button
                  onClick={() => setKeyword('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <div className="w-full sm:w-40">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* 历史列表 */}
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-muted">
                <FileText className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">暂无历史记录</p>
              <p className="mt-1 text-xs text-muted-foreground">
                解析的通知会自动保存在这里
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {filtered.map((item, idx) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20, height: 0, marginBottom: 0 }}
                  transition={{ delay: idx * 0.02 }}
                >
                  <Card className="cursor-pointer transition-colors hover:border-primary/30 hover:bg-card/80">
                    <CardContent
                      className="flex items-center gap-4 p-4"
                      onClick={() => handleViewDetail(item)}
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <FileText className="size-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium text-sm">
                            {item.title}
                          </span>
                          {item.source === 'mock' && (
                            <Badge variant="secondary" className="text-xs shrink-0">
                              示例
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                              {item.type}
                            </Badge>
                          </span>
                          <ImportanceBadge level={item.importance} className="text-[10px] h-4 px-1.5" />
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" />
                            {formatDate(item.parsedAt)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>确认删除</AlertDialogTitle>
                              <AlertDialogDescription>
                                删除后将从历史记录中移除，此操作不可恢复。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>取消</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => {
                                  deleteHistory(item.id);
                                  toast.success('已删除');
                                }}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                删除
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* 详情弹窗 */}
        <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
          <DialogContent className="max-h-[85vh] overflow-y-auto overflow-x-hidden sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>解析详情</DialogTitle>
              <DialogDescription>查看完整的通知解析结果</DialogDescription>
            </DialogHeader>
            {selected && <ParseResultCard notification={selected} />}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
