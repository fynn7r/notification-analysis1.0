import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Toaster } from 'sonner';
import BottomNav from '@/components/BottomNav';
import OnboardingGuide from '@/components/OnboardingGuide';
import RecurringDrawer from '@/components/reminder/RecurringDrawer';
import AlarmOverlay from '@/components/reminder/AlarmOverlay';
import DraggableHandle from '@/components/DraggableHandle';
import { TooltipProvider } from '@/components/ui/tooltip';

export const Layout = () => {
  const [recurringOpen, setRecurringOpen] = useState(false);

  return (
    <TooltipProvider>
      <div className="flex min-h-screen flex-col bg-background overflow-x-hidden">
        <main className="flex-1 w-full min-w-0 overflow-x-hidden pt-4 pb-28">
          <Outlet />
        </main>
        <Toaster position="top-right" richColors closeButton />
        <OnboardingGuide />
        <BottomNav />
        <RecurringDrawer open={recurringOpen} onClose={() => setRecurringOpen(false)} />
        <AlarmOverlay />

        {/* 左侧可拖动抽屉把手 - 周期提醒入口 */}
        {!recurringOpen && (
          <DraggableHandle onOpen={() => setRecurringOpen(true)} />
        )}
      </div>
    </TooltipProvider>
  );
};
