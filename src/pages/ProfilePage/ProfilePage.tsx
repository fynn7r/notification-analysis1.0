import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import {
  User,
  School,
  GraduationCap,
  BookOpen,
  BellRing,
  Volume2,
  Mic,
  Save,
  RefreshCcw,
  Target,
  X,
  Plus,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useProfile } from '@/hooks/useProfile';
import { useGoals } from '@/hooks/useGoals';
import ModelSettings from '@/components/ModelSettings';
import { IS_STANDALONE } from '@/lib/parse-api';

export default function ProfilePage() {
  const { profile, updateProfile, requestNotificationPermission } = useProfileHook();
  const { goals, addGoal, removeGoal } = useGoals();
  const [newGoal, setNewGoal] = useState('');
  const [saved, setSaved] = useState(false);

  const handleFieldChange = useCallback(
    (field: keyof typeof profile, value: string | boolean) => {
      updateProfile({ [field]: value });
      setSaved(false);
    },
    [updateProfile]
  );

  const handleSave = useCallback(() => {
    setSaved(true);
    toast.success('个人信息已保存');
    setTimeout(() => setSaved(false), 2000);
  }, []);

  const handleEnableNotif = useCallback(async () => {
    const granted = await requestNotificationPermission();
    if (granted) {
      updateProfile({ browserNotifEnabled: true });
      toast.success('浏览器通知已开启');
    } else {
      toast.error('通知权限被拒绝，可在浏览器设置中开启');
    }
  }, [requestNotificationPermission, updateProfile]);

  const handleAddGoal = useCallback(() => {
    if (!newGoal.trim()) return;
    addGoal(newGoal.trim());
    setNewGoal('');
  }, [newGoal, addGoal]);

  return (
    <div className="w-full min-w-0 overflow-hidden">
      <div className="mx-auto max-w-2xl px-4 py-8 md:px-6 md:py-12">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">我的</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            管理个人信息、目标与提醒偏好
          </p>
        </div>

        {IS_STANDALONE && <ModelSettings />}

        {/* 个人信息 */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="size-4 text-primary" />
              个人信息
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  昵称
                </Label>
                <Input
                  placeholder="你的昵称"
                  value={profile.nickname}
                  onChange={(e) => handleFieldChange('nickname', e.target.value)}
                />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  学校
                </Label>
                <div className="relative">
                  <School className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="所在学校"
                    value={profile.school}
                    onChange={(e) => handleFieldChange('school', e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  专业
                </Label>
                <div className="relative">
                  <GraduationCap className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="所学专业"
                    value={profile.major}
                    onChange={(e) => handleFieldChange('major', e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  年级
                </Label>
                <div className="relative">
                  <BookOpen className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="如：大一 / 研二"
                    value={profile.grade}
                    onChange={(e) => handleFieldChange('grade', e.target.value)}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 个人目标标签 */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="size-4 text-primary" />
              个人目标
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              设置你的目标，AI 解析通知时会结合目标判断重要程度
            </p>
            <div className="mb-3 flex flex-wrap gap-2">
              {goals.length === 0 ? (
                <span className="text-xs text-muted-foreground">暂无目标</span>
              ) : (
                goals.map((goal) => (
                  <motion.div
                    key={goal}
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                  >
                    <Badge
                      variant="secondary"
                      className="flex items-center gap-1 px-3 py-1"
                    >
                      {goal}
                      <button
                        onClick={() => removeGoal(goal)}
                        className="ml-1 rounded-full hover:bg-foreground/10"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  </motion.div>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="添加目标，如：保研、评优、求职..."
                value={newGoal}
                onChange={(e) => setNewGoal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddGoal()}
              />
              <Button variant="secondary" onClick={handleAddGoal}>
                <Plus className="mr-1 size-4" />
                添加
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 提醒偏好 */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BellRing className="size-4 text-primary" />
              提醒偏好
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
              <div className="flex items-center gap-3">
                <Volume2 className="size-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">提示音</div>
                  <div className="text-xs text-muted-foreground">
                    提醒到达时播放提示音
                  </div>
                </div>
              </div>
              <Switch
                checked={profile.soundEnabled}
                onCheckedChange={(v) => handleFieldChange('soundEnabled', v)}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
              <div className="flex items-center gap-3">
                <Mic className="size-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">语音创建提醒</div>
                  <div className="text-xs text-muted-foreground">
                    说一句话快速创建提醒
                  </div>
                </div>
              </div>
              <Switch
                checked={profile.voiceReminderEnabled}
                onCheckedChange={(v) => handleFieldChange('voiceReminderEnabled', v)}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
              <div className="flex items-center gap-3">
                <BellRing className="size-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">浏览器系统通知</div>
                  <div className="text-xs text-muted-foreground">
                    最小化时也能收到系统通知
                  </div>
                </div>
              </div>
              {profile.browserNotifEnabled ? (
                <Badge variant="outline" className="border-emerald-200 text-emerald-600">
                  已开启
                </Badge>
              ) : (
                <Button variant="secondary" size="sm" onClick={handleEnableNotif}>
                  开启
                </Button>
              )}
            </div>

            <div>
              <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                默认提醒偏移
              </Label>
              <Select
                value={profile.defaultRemindOffset}
                onValueChange={(v) => handleFieldChange('defaultRemindOffset', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2d">截止前2天</SelectItem>
                  <SelectItem value="1d">截止前1天</SelectItem>
                  <SelectItem value="3h">截止前3小时</SelectItem>
                  <SelectItem value="1h">截止前1小时</SelectItem>
                  <SelectItem value="30m">截止前30分钟</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* 边界提示 */}
        <Card className="mb-4 border-amber-200 bg-amber-50/50">
          <CardContent className="p-4">
            <p className="flex items-start gap-2 text-xs leading-relaxed text-amber-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span><strong>提醒能力说明</strong>：网页应用在完全关闭时无法响铃。
              请保持页面打开，或开启「浏览器系统通知」以便在后台/最小化时接收提醒。
              系统通知需要浏览器保持运行状态。</span>
            </p>
          </CardContent>
        </Card>

        <Button onClick={handleSave} className="w-full">
          {saved ? (
            <>
              <RefreshCcw className="mr-2 size-4 text-emerald-300" />
              已保存
            </>
          ) : (
            <>
              <Save className="mr-2 size-4" />
              保存设置
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// 包装 hook 以扩展浏览器通知权限请求
function useProfileHook() {
  const base = useProfile();

  const requestNotificationPermission = useCallback(async (): Promise<boolean> => {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try {
      const perm = await Notification.requestPermission();
      return perm === 'granted';
    } catch {
      return false;
    }
  }, []);

  return { ...base, requestNotificationPermission };
}
