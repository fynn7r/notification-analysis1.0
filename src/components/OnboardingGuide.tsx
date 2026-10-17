import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Sparkles, Bell, X, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { storage } from '@/lib/storage';

const STEPS = [
  {
    icon: BookOpen,
    title: '第一步：导入规则库',
    description:
      '先在「规则库」导入你的规则文件（如综测加分细则），AI 会自动对照判断每条通知的重要程度。',
    target: 'rules',
  },
  {
    icon: Sparkles,
    title: '第二步：粘贴通知解析',
    description:
      '把群通知复制粘贴到首页的输入框，点击「智能解析」，AI 会自动提取关键信息并匹配规则。',
    target: 'parse',
  },
  {
    icon: Bell,
    title: '第三步：生成提醒',
    description:
      '解析完成后可一键添加提醒事项，不错过任何报名截止日期和重要时间节点。',
    target: 'reminder',
  },
];

export default function OnboardingGuide() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const onboarded = storage.getOnboarded();
    if (!onboarded) {
      // 延迟一点再显示，等页面渲染完
      const timer = setTimeout(() => setIsOpen(true), 600);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    storage.setOnboarded(true);
  }, []);

  const handleNext = useCallback(() => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleClose();
    }
  }, [currentStep, handleClose]);

  const handleSkip = useCallback(() => {
    handleClose();
  }, [handleClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-background/60 backdrop-blur-sm"
            onClick={handleSkip}
          />

          {/* 引导卡 */}
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed left-1/2 top-1/2 z-[101] w-[90%] max-w-md -translate-x-1/2 -translate-y-1/2"
          >
            <div className="relative rounded-2xl border border-border/60 bg-card p-6 shadow-xl">
              <button
                onClick={handleSkip}
                className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <X className="size-4" />
              </button>

              <AnimatePresence mode="wait">
                <motion.div
                  key={currentStep}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primary/10">
                    {(() => {
                      const Icon = STEPS[currentStep].icon;
                      return <Icon className="size-6 text-primary" />;
                    })()}
                  </div>
                  <h3 className="mb-2 text-lg font-semibold">
                    {STEPS[currentStep].title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {STEPS[currentStep].description}
                  </p>
                </motion.div>
              </AnimatePresence>

              {/* 进度指示 */}
              <div className="mt-6 flex items-center justify-between">
                <div className="flex gap-1.5">
                  {STEPS.map((_, idx) => (
                    <div
                      key={idx}
                      className={`h-1.5 rounded-full transition-all ${
                        idx === currentStep
                          ? 'w-6 bg-primary'
                          : idx < currentStep
                          ? 'w-1.5 bg-primary/60'
                          : 'w-1.5 bg-muted'
                      }`}
                    />
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={handleSkip}>
                    跳过
                  </Button>
                  <Button size="sm" onClick={handleNext}>
                    {currentStep < STEPS.length - 1 ? (
                      <>
                        下一步
                        <ChevronRight className="ml-1 size-4" />
                      </>
                    ) : (
                      '开始使用'
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
