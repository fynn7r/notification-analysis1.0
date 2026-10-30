import { useEffect, useRef, useState } from 'react';
import { localStore } from '@/lib/local-store';
import { RefreshCcw, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const STORAGE_KEY = 'recurring_handle_top';
const DRAG_THRESHOLD = 5; // 像素，超过则视为拖动而非点击
const TOP_MARGIN = 16; // 顶部最小边距 px
const BOTTOM_MARGIN = 96; // 底部最小边距 px（避开底部导航，底部导航约 80px）
const HANDLE_HEIGHT = 40; // 把手大致高度

interface DraggableHandleProps {
  onOpen: () => void;
}

function clampTop(value: number) {
  const maxTop = window.innerHeight - HANDLE_HEIGHT - BOTTOM_MARGIN;
  return Math.min(Math.max(TOP_MARGIN, value), maxTop);
}

export default function DraggableHandle({ onOpen }: DraggableHandleProps) {
  const [top, setTop] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // 用 ref 存拖动状态，避免 useCallback 依赖 top 导致闭包陷阱
  const topRef = useRef<number>(0);
  const dragRef = useRef({
    startY: 0,
    startTop: 0,
    moved: false,
    active: false,
  });

  // 初始化：从 localStorage 读取位置
  useEffect(() => {
    const saved = localStore.getItem(STORAGE_KEY);
    let initialTop: number;
    if (saved) {
      const num = Number(saved);
      if (!Number.isNaN(num) && num >= 0) {
        initialTop = clampTop(num);
      } else {
        initialTop = Math.max(TOP_MARGIN, window.innerHeight / 2 - HANDLE_HEIGHT / 2);
      }
    } else {
      initialTop = Math.max(TOP_MARGIN, window.innerHeight / 2 - HANDLE_HEIGHT / 2);
    }
    topRef.current = initialTop;
    setTop(initialTop);
  }, []);

  // 同步 top 到 ref
  useEffect(() => {
    if (top !== null) topRef.current = top;
  }, [top]);

  const getClientY = (e: MouseEvent | TouchEvent) => {
    if (e.type.startsWith('touch')) {
      const touchEvent = e as TouchEvent;
      if (touchEvent.touches.length > 0) {
        return touchEvent.touches[0].clientY;
      }
      return 0;
    }
    return (e as MouseEvent).clientY;
  };

  const handleDragMove = (e: MouseEvent | TouchEvent) => {
    if (!dragRef.current.active) return;
    const currentY = getClientY(e);
    const delta = currentY - dragRef.current.startY;

    if (!dragRef.current.moved && Math.abs(delta) > DRAG_THRESHOLD) {
      dragRef.current.moved = true;
      setIsDragging(true);
    }

    if (dragRef.current.moved) {
      const newTop = clampTop(dragRef.current.startTop + delta);
      topRef.current = newTop;
      setTop(newTop);
      // 拖动时阻止页面滚动和默认行为
      if (e.cancelable) e.preventDefault();
    }
  };

  const handleDragEnd = () => {
    if (!dragRef.current.active) return;

    if (dragRef.current.moved) {
      localStore.setItem(STORAGE_KEY, String(topRef.current));
    }

    setIsDragging(false);
    dragRef.current.active = false;
    dragRef.current.moved = false;

    // 移除全局监听
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
    document.removeEventListener('touchmove', handleDragMove);
    document.removeEventListener('touchend', handleDragEnd);
    document.removeEventListener('touchcancel', handleDragEnd);
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (top === null) return;
    // 只响应鼠标左键（button === 0）
    if ('button' in e && e.button !== 0) return;

    dragRef.current = {
      startY: getClientY(e.nativeEvent),
      startTop: topRef.current,
      moved: false,
      active: true,
    };

    // 按下后才绑定全局移动/松开事件
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
    document.addEventListener('touchmove', handleDragMove, { passive: false });
    document.addEventListener('touchend', handleDragEnd);
    document.addEventListener('touchcancel', handleDragEnd);
  };

  const handleClick = (e: React.MouseEvent) => {
    // 拖动过程中不触发点击
    if (dragRef.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onOpen();
  };

  // 组件卸载时清理监听
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
      document.removeEventListener('touchmove', handleDragMove);
      document.removeEventListener('touchend', handleDragEnd);
      document.removeEventListener('touchcancel', handleDragEnd);
    };
  }, []);

  if (top === null) return null;

  return (
    <TooltipProvider>
      <Tooltip open={isDragging ? false : undefined}>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            onClick={handleClick}
            onMouseDown={handlePointerDown}
            onTouchStart={handlePointerDown}
            className={`fixed left-0 z-[60] select-none rounded-l-none rounded-r-xl border-l-0 bg-background/90 shadow-lg backdrop-blur transition-all hover:bg-primary hover:text-primary-foreground hover:pl-2 ${
              isDragging
                ? 'scale-110 opacity-80 shadow-xl cursor-grabbing'
                : 'cursor-grab'
            }`}
            style={{ top: `${top}px`, touchAction: 'none' }}
            title="周期提醒"
            aria-label="周期提醒（可上下拖动）"
          >
            <div className="flex items-center gap-0.5">
              <GripVertical className="size-3 text-muted-foreground/60" />
              <RefreshCcw className="size-4" />
            </div>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">周期提醒（可拖动）</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
