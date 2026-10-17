import { useState, useRef, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Calendar,
  Clock,
  MapPin,
  Users,
  FileText,
  Phone,
  Link as LinkIcon,
  Target,
  Award,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Plus,
  Image as ImageIcon,
  Video,
  Upload,
  X,
  PlayCircle,
  ExternalLink,
  RefreshCw,
  FilePlus,
  History,
  AlertCircle,
  Copy,
  Check,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { INotification, ISupplementRecord, IMediaAttachment } from '@/data/notification';
import ImportanceBadge from '@/components/common/ImportanceBadge';
import ImpliedMeaningSection from '@/components/parse/ImpliedMeaningSection';
import { formatDateTime } from '@/lib/date-utils';
import { extractMediaLinks, detectMediaType, formatFileSize } from '@/lib/recurring-utils';
import { genId } from '@/lib/utils';
import { Image } from '@/components/ui/image';
import { cn } from '@/lib/utils';
import { UniversalLink } from '@lark-apaas/client-toolkit-lite';
import { IS_STANDALONE } from '@/lib/parse-api';

interface ParseResultCardProps {
  notification: INotification;
  onSupplement?: (content: string) => void;
  onReParse?: () => void;
  onAddMedia?: (attachments: IMediaAttachment[]) => void;
  onRemoveMedia?: (id: string) => void;
  onGenerateImpliedMeaning?: () => void;
  impliedMeaningLoading?: boolean;
  impliedMeaningError?: string;
}

// 本地附件以 base64 存入 localStorage，超限会静默失败（配额约 5MB），
// 因此限制单张图片大小；视频体积通常远超配额，仅支持以链接方式添加
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Calendar;
  label: string;
  value?: string;
}) {
  if (!value) return null;
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 shrink-0 text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm text-foreground break-all whitespace-pre-wrap">{value}</div>
      </div>
    </div>
  );
}

// 媒体附件预览组件
function MediaAttachmentItem({
  attachment,
  onRemove,
}: {
  attachment: IMediaAttachment;
  onRemove?: () => void;
}) {
  const [videoError, setVideoError] = useState(false);
  const [imageError, setImageError] = useState(false);

  const src = attachment.source === 'local' ? attachment.dataUrl : attachment.url;
  if (!src) return null;

  if (attachment.type === 'image') {
    return (
      <div className="relative group overflow-hidden rounded-lg border border-border">
        {imageError ? (
          <div className="flex aspect-video flex-col items-center justify-center gap-1 bg-muted p-4 text-center">
            <AlertCircle className="size-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">图片加载失败</p>
            {attachment.source === 'link' && attachment.url && (
              <UniversalLink
                to={attachment.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline"
              >
                原链接打开 <ExternalLink className="size-3" />
              </UniversalLink>
            )}
          </div>
        ) : (
          <Image
            src={src}
            alt={attachment.name || '附件图片'}
            className="block w-full object-cover"
            onError={() => setImageError(true)}
          />
        )}
        {onRemove && (
          <Button
            size="icon"
            variant="secondary"
            className="!absolute right-2 top-2 z-20 size-7 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
            onClick={onRemove}
          >
            <X className="size-3.5" />
          </Button>
        )}
        {attachment.name && (
          <div className="truncate bg-background/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur">
            {attachment.name}
          </div>
        )}
      </div>
    );
  }

  // video
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-black">
      {videoError ? (
        <div className="flex aspect-video flex-col items-center justify-center gap-2 p-4 text-center">
          <Video className="size-6 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">视频无法直接播放</p>
          {attachment.source === 'link' && attachment.url && (
            <UniversalLink
              to={attachment.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              原链接打开 <ExternalLink className="size-3" />
            </UniversalLink>
          )}
        </div>
      ) : (
        <video
          src={src}
          controls
          className="block w-full"
          onError={() => setVideoError(true)}
        />
      )}
      {onRemove && (
        <Button
          size="icon"
          variant="secondary"
          className="!absolute right-2 top-2 z-20 size-7 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
          onClick={onRemove}
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

export default function ParseResultCard({
  notification,
  onSupplement,
  onReParse,
  onAddMedia,
  onRemoveMedia,
  onGenerateImpliedMeaning,
  impliedMeaningLoading = false,
  impliedMeaningError,
}: ParseResultCardProps) {
  const [rawExpanded, setRawExpanded] = useState(false);
  const [supplementExpanded, setSupplementExpanded] = useState(false);
  const [mediaExpanded, setMediaExpanded] = useState(false);
  const [supplementText, setSupplementText] = useState('');
  const [showSupplementInput, setShowSupplementInput] = useState(false);
  const [rawCopied, setRawCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 合并检测到的媒体链接 + 手动添加的附件
  const allAttachments: IMediaAttachment[] = useMemo(
    () => [
      ...(notification.detectedMediaLinks || []).map((url, idx): IMediaAttachment => ({
        id: `detected-${idx}`,
        type: detectMediaType(url) === 'video' ? 'video' : 'image',
        source: 'link',
        url,
        name: url.split('/').pop()?.split('?')[0] || '媒体链接',
        addedAt: notification.parsedAt,
      })),
      ...(notification.mediaAttachments || []),
    ],
    [notification.detectedMediaLinks, notification.mediaAttachments, notification.parsedAt]
  );

  const imageCount = useMemo(
    () => allAttachments.filter((a) => a.type === 'image').length,
    [allAttachments]
  );
  const videoCount = useMemo(
    () => allAttachments.filter((a) => a.type === 'video').length,
    [allAttachments]
  );

  const handleAddSupplement = useCallback(() => {
    if (!supplementText.trim()) {
      toast.error('请输入补充内容');
      return;
    }
    onSupplement?.(supplementText.trim());
    setSupplementText('');
    setShowSupplementInput(false);
    setSupplementExpanded(true);
    toast.success('补充已添加，建议点击「重新解析」更新结果');
  }, [supplementText, onSupplement]);

  const handleCopyRawText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(notification.rawText);
      setRawCopied(true);
      toast.success('已复制通知原文');
      setTimeout(() => setRawCopied(false), 2000);
    } catch {
      toast.error('复制失败');
    }
  }, [notification.rawText]);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      // 重置 input 以允许重复上传相同文件
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (files.length === 0) return;

      const accepted: File[] = [];
      let skippedVideo = 0;
      let skippedLarge = 0;
      let skippedOther = 0;

      for (const file of files) {
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');
        if (isVideo) {
          skippedVideo++;
        } else if (!isImage) {
          skippedOther++;
        } else if (file.size > MAX_IMAGE_BYTES) {
          skippedLarge++;
        } else {
          accepted.push(file);
        }
      }

      if (skippedVideo > 0) {
        toast.warning('视频体积较大无法本地保存，请通过通知原文中的链接添加');
      }
      if (skippedLarge > 0) {
        toast.error(`有 ${skippedLarge} 张图片超过 2MB，已跳过`);
      }
      if (skippedOther > 0) {
        toast.warning('仅支持图片和视频文件');
      }
      if (accepted.length === 0) return;

      const newAttachments: IMediaAttachment[] = [];
      let processed = 0;

      accepted.forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => {
          newAttachments.push({
            id: genId('media'),
            type: 'image',
            source: 'local',
            dataUrl: reader.result as string,
            name: file.name,
            mimeType: file.type,
            size: file.size,
            addedAt: Date.now(),
          });
          processed++;
          // 全部文件读取完毕后一次性回调，避免重复追加
          if (processed === accepted.length && newAttachments.length > 0) {
            onAddMedia?.(newAttachments);
            setMediaExpanded(true);
            toast.success(`已添加 ${newAttachments.length} 个附件`);
          }
        };
        reader.onerror = () => {
          processed++;
          toast.error(`读取「${file.name}」失败`);
        };
        reader.readAsDataURL(file);
      });
    },
    [onAddMedia]
  );

  return (
    <div className="space-y-5">
      {/* 顶部标题区 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {notification.type}
            </Badge>
            <ImportanceBadge level={notification.importance} />
            {allAttachments.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {imageCount > 0 && (
                  <span className="mr-1 inline-flex items-center gap-1">
                    <ImageIcon className="size-3" /> {imageCount}
                  </span>
                )}
                {videoCount > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Video className="size-3" /> {videoCount}
                  </span>
                )}
              </Badge>
            )}
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">
            {notification.title || '通知解析结果'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {notification.importanceReason}
          </p>
        </div>
        {onReParse && (
          <Button variant="outline" size="sm" onClick={onReParse}>
            <RefreshCw className="mr-1.5 size-3.5" />
            重新解析
          </Button>
        )}
      </div>

      {/* 关键信息卡 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">关键信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <InfoRow
              icon={Clock}
              label={notification.primaryAction ? '待办截止时间' : '报名截止时间'}
              value={
                notification.registrationDeadline
                  ? formatDateTime(notification.registrationDeadline, notification.parseContext?.timezone)
                  : IS_STANDALONE ? '待补齐具体截止日期/时间' : undefined
              }
            />
            <InfoRow
              icon={Calendar}
              label="活动时间"
              value={
                notification.eventStartTime
                  ? formatDateTime(notification.eventStartTime, notification.parseContext?.timezone)
                  : IS_STANDALONE ? '尚未确定完整活动日期/时间，请核对原文' : undefined
              }
            />
            <InfoRow icon={MapPin} label="提交位置/地点" value={notification.location || (IS_STANDALONE ? '尚未提取到提交位置/地点，请核对原文' : undefined)} />
            <InfoRow icon={Users} label="参加对象" value={notification.targetAudience} />
          </div>

          {!!notification.timeWarnings?.length && (
            <ul className="list-disc space-y-1 pl-4 text-sm text-amber-700">
              {notification.timeWarnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}

          {(notification.requirements || notification.contact || notification.links?.length) && (
            <>
              <Separator />
              <div className="space-y-4">
                <InfoRow icon={FileText} label="作品要求与规范" value={notification.requirements} />
                <InfoRow icon={Phone} label="联系方式" value={notification.contact} />
                {notification.links && notification.links.length > 0 && (
                  <InfoRow icon={LinkIcon} label="相关链接" value={notification.links.join('\n')} />
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 图片/视频附件区 */}
      {allAttachments.length > 0 && (
        <Card>
          <button
            onClick={() => setMediaExpanded(!mediaExpanded)}
            className="flex w-full items-center justify-between px-6 py-3 text-left"
          >
            <div className="flex items-center gap-2">
              <ImageIcon className="size-4 text-primary" />
              <span className="text-sm font-medium">附件与媒体</span>
              <Badge variant="outline" className="text-xs">
                {allAttachments.length}
              </Badge>
            </div>
            {mediaExpanded ? (
              <ChevronUp className="size-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-4 text-muted-foreground" />
            )}
          </button>
          <AnimatePresence initial={false}>
            {mediaExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <CardContent className="border-t pt-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {allAttachments.map((att) => (
                      <MediaAttachmentItem
                        key={att.id}
                        attachment={att}
                        onRemove={
                          att.source === 'local' && onRemoveMedia
                            ? () => onRemoveMedia(att.id)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                </CardContent>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      )}

      {/* 上传附件按钮 */}
      {onAddMedia && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileUpload}
          />
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-2 size-4" />
            上传图片附件（≤2MB）
          </Button>
        </div>
      )}

      {/* 话里有话深度解读 */}
      <ImpliedMeaningSection
        impliedMeaning={notification.impliedMeaning}
        onGenerate={onGenerateImpliedMeaning}
        isLoading={impliedMeaningLoading}
      />
      {impliedMeaningError && <p role="alert" className="text-sm text-destructive">{impliedMeaningError}</p>}

      {/* 规则匹配卡 */}
      {notification.matchedRules && notification.matchedRules.length > 0 && (
        <Card className="border-primary/20 bg-primary/[0.02]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="size-4 text-primary" />
              规则库匹配结果
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {notification.matchedRules.map((rule, idx) => (
              <motion.div
                key={rule.ruleId + idx}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.08 }}
                className="rounded-lg border border-border/60 bg-card p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Award className="size-4 text-amber-500" />
                    <span className="font-medium text-foreground">{rule.ruleTitle}</span>
                    <Badge variant="outline" className="text-xs">
                      {rule.category}
                    </Badge>
                  </div>
                  {rule.worthAttending && (
                    <div className="flex items-center gap-1 text-xs text-emerald-600">
                      <TrendingUp className="size-3.5" />
                      值得参加
                    </div>
                  )}
                </div>
                {rule.score && (
                  <div className="mt-2 text-sm text-primary font-medium">{rule.score}</div>
                )}
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {rule.matchReason}
                </p>
              </motion.div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 补充记录区 */}
      <Card>
        <button
          onClick={() => setSupplementExpanded(!supplementExpanded)}
          className="flex w-full items-center justify-between px-6 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <History className="size-4 text-amber-500" />
            <span className="text-sm font-medium">补充记录</span>
            <Badge variant="outline" className="text-xs">
              {(notification.supplements?.length || 0)} 条
            </Badge>
          </div>
          {supplementExpanded ? (
            <ChevronUp className="size-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" />
          )}
        </button>
        <AnimatePresence initial={false}>
          {supplementExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <CardContent className="space-y-3 border-t pt-4">
                {notification.supplements && notification.supplements.length > 0 && (
                  notification.supplements.map((supp, idx) => (
                    <div
                      key={supp.id}
                      className="rounded-lg border border-amber-200/60 bg-amber-50/40 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <Badge
                          variant="outline"
                          className="border-amber-300 text-amber-700"
                        >
                          补充 {idx + 1}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(supp.addedAt).toLocaleString('zh-CN')}
                        </span>
                      </div>
                      <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans text-foreground/90 break-all">
                        {supp.content}
                      </pre>
                    </div>
                  ))
                )}

                {/* 追加补充输入 */}
                {onSupplement && (
                  <div className="pt-1">
                    {showSupplementInput ? (
                      <div className="space-y-2 rounded-lg border border-border/60 p-3">
                        <Textarea
                          placeholder="粘贴负责人后续补充的通知内容..."
                          className="min-h-[80px] resize-y text-sm"
                          value={supplementText}
                          onChange={(e) => setSupplementText(e.target.value)}
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setShowSupplementInput(false);
                              setSupplementText('');
                            }}
                          >
                            取消
                          </Button>
                          <Button size="sm" onClick={handleAddSupplement}>
                            添加补充
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowSupplementInput(true)}
                        className="w-full"
                      >
                        <Plus className="mr-2 size-4" />
                        追加补充内容
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </div>
  );
}
