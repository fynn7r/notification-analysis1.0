import { useAlarm } from '@/hooks/useAlarm';
import { motion, AnimatePresence } from 'framer-motion';
import { BellRing, X, Clock3, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ImportanceBadge from '@/components/common/ImportanceBadge';
import { formatDateTime } from '@/lib/date-utils';

export default function AlarmOverlay() {
  const { activeAlarm, dismissAlarm, snoozeAlarm } = useAlarm();

  return (
    <AnimatePresence>
      {activeAlarm && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={dismissAlarm}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: 20, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="w-full max-w-md overflow-hidden rounded-2xl bg-card shadow-2xl ring-1 ring-border"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 顶部彩色条 */}
            <div className="relative h-2 bg-gradient-to-r from-red-400 via-amber-400 to-red-400">
              <motion.div
                animate={{ x: ['-100%', '100%'] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute inset-y-0 w-1/3 bg-white/40"
              />
            </div>

            <div className="p-6">
              {/* 标题区 */}
              <div className="mb-4 flex items-start gap-3">
                <div className="relative flex size-12 shrink-0 items-center justify-center rounded-full bg-red-100">
                  <BellRing className="size-6 text-red-600" />
                  <motion.div
                    animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="absolute inset-0 rounded-full bg-red-300"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <ImportanceBadge
                      level={activeAlarm.importance}
                      className="text-xs"
                    />
                    <Badge variant="outline" className="text-xs">
                      {activeAlarm.type}
                    </Badge>
                  </div>
                  <h3 className="mt-2 text-lg font-semibold tracking-tight">
                    {activeAlarm.title}
                  </h3>
                  {activeAlarm.note && (
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                      {activeAlarm.note}
                    </p>
                  )}
                </div>
              </div>

              {/* 时间信息 */}
              <div className="mb-5 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <Clock3 className="size-4 text-muted-foreground" />
                <span className="text-muted-foreground">提醒时间：</span>
                <span className="font-medium tabular-nums">
                  {formatDateTime(activeAlarm.remindAt, activeAlarm.timezone)}
                </span>
              </div>

              {/* 按钮区 */}
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={snoozeAlarm}
                  className="flex-1"
                >
                  <AlertTriangle className="mr-2 size-4" />
                  稍后提醒
                </Button>
                <Button onClick={dismissAlarm} className="flex-1">
                  <X className="mr-2 size-4" />
                  我知道了
                </Button>
              </div>

              <p className="mt-3 text-center text-[11px] text-muted-foreground">
                点击遮罩或"我知道了"关闭提醒
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
