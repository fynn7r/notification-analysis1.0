import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { capabilityClient } from '@lark-apaas/client-toolkit-lite';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  Plus,
  Trash2,
  FileText,
  X,
  Tag as TagIcon,
  Sparkles,
  ClipboardPaste,
  Loader2,
  Share2,
  Download,
  QrCode,
  Copy,
  Check,
  Link as LinkIcon,
  Lightbulb,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
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
import { useRules } from '@/hooks/useRules';
import { useGoals } from '@/hooks/useGoals';
import { PLUGIN_DOC_PARSER } from '@/lib/plugin-instances';
import type { RuleDocumentParserOneOutput } from '@shared/plugin-types';
import { formatDate } from '@/lib/date-utils';
import { generateShareCode, parseShareCode } from '@/lib/share-code';
import type { IRule } from '@/data/rule';
import { IS_STANDALONE } from '@/lib/parse-api';
import { readRuleDocument } from '@/lib/rule-document-api';
import { storage } from '@/lib/storage';
import { MAX_RULE_CONTENT_CHARS } from '@shared/rule-document-contract';
import RuleDocumentEditor, { cleanRuleHtml } from '@/components/RuleDocumentEditor';
import { saveRuleLayout, getRuleLayout, deleteRuleLayout, type StoredRuleLayout } from '@/lib/rule-layout-storage';
import { genId } from '@/lib/utils';

export default function RulesPage() {
  const { rules, addRule, updateRule, deleteRule, clearMockRules, loading: rulesLoading } = useRules();
  const { goals, addGoal, removeGoal, loading: goalsLoading } = useGoals();

  const [textInput, setTextInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [categoryInput, setCategoryInput] = useState('');
  const [parsingFile, setParsingFile] = useState(false);
  const [importTab, setImportTab] = useState('file');
  const [isDragging, setIsDragging] = useState(false);
  const [importError, setImportError] = useState('');
  const [importedFilename, setImportedFilename] = useState('');
  const [fileWarnings, setFileWarnings] = useState<string[]>([]);
  const [richDocument, setRichDocument] = useState<StoredRuleLayout | null>(null);
  const richDocumentRef = useRef<StoredRuleLayout | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [savingRule, setSavingRule] = useState(false);
  const savingRuleRef = useRef(false);
  const [newGoal, setNewGoal] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const readingFileRef = useRef(false);

  // 分享相关状态
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareCode, setShareCode] = useState('');
  const [shareCodeCopied, setShareCodeCopied] = useState(false);

  // 导入相关状态
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importCode, setImportCode] = useState('');
  const [importMode, setImportMode] = useState<'merge' | 'overwrite' | 'select'>('merge');
  const [parsedImportRules, setParsedImportRules] = useState<IRule[] | null>(null);
  const [selectedImportIds, setSelectedImportIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  const hasMockRules = rules.some((r) => r.source === 'mock');

  // 生成分享码
  const handleGenerateShare = useCallback(() => {
    if (rules.length === 0) {
      toast.error('规则库为空，无法生成分享码');
      return;
    }
    const code = generateShareCode(rules);
    setShareCode(code);
    setShareDialogOpen(true);
  }, [rules]);

  // 复制分享码
  const handleCopyShareCode = useCallback(async () => {
    if (!shareCode) return;
    try {
      await navigator.clipboard.writeText(shareCode);
      setShareCodeCopied(true);
      toast.success('分享码已复制');
      setTimeout(() => setShareCodeCopied(false), 2000);
    } catch {
      toast.error('复制失败');
    }
  }, [shareCode]);

  // 解析导入码
  const handleParseImport = useCallback(() => {
    const code = importCode.trim();
    if (!code) {
      toast.error('请输入分享码');
      return;
    }
    const parsed = parseShareCode(code);
    if (!parsed || parsed.length === 0) {
      toast.error('分享码无效，请检查后重试');
      return;
    }
    setParsedImportRules(parsed);
    setSelectedImportIds(new Set(parsed.map((r) => r.id)));
    toast.success(`解析成功，共 ${parsed.length} 条规则`);
  }, [importCode]);

  // 切换选择性导入的勾选
  const toggleSelectRule = useCallback((id: string) => {
    setSelectedImportIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 执行导入
  const handleConfirmImport = useCallback(async () => {
    if (!parsedImportRules) return;
    setImporting(true);

    try {
      let toImport: IRule[];
      if (importMode === 'select') {
        toImport = parsedImportRules.filter((r) => selectedImportIds.has(r.id));
      } else {
        toImport = parsedImportRules;
      }

      if (toImport.length === 0) {
        toast.error('请至少选择一条规则');
        return;
      }

      if (importMode === 'overwrite') {
        // 覆盖模式：先清空再添加
        await Promise.all(rules.map((r) => deleteRule(r.id)));
      }

      for (const rule of toImport) {
        addRule(rule);
      }

      toast.success(`成功导入 ${toImport.length} 条规则`);
      setImportDialogOpen(false);
      setImportCode('');
      setParsedImportRules(null);
      setSelectedImportIds(new Set());
    } finally {
      setImporting(false);
    }
  }, [parsedImportRules, importMode, selectedImportIds, rules, deleteRule, addRule]);

  // 重置导入弹窗
  const resetImportDialog = useCallback(() => {
    setImportCode('');
    setParsedImportRules(null);
    setSelectedImportIds(new Set());
    setImportMode('merge');
  }, []);

  // 文件上传解析
  const handleFileUpload = useCallback(
    async (file: File) => {
      if (!file || readingFileRef.current || savingRuleRef.current) return;
      readingFileRef.current = true;
      setParsingFile(true);
      setImportError('');
      try {
        if (IS_STANDALONE) {
          const document = await readRuleDocument(file);
          setTextInput(document.content);
          setTitleInput(document.title);
          setCategoryInput('自定义规则');
          setImportedFilename(document.filename);
          setFileWarnings(document.warnings);
          const layout = document.layout ? { ...document.layout, html: cleanRuleHtml(document.layout.html), filename: document.filename } : null;
          setRichDocument(layout);
          richDocumentRef.current = layout;
          setEditingRuleId(null);
          setImportTab('text');
          toast.success('文档已读取，请核对内容后保存规则');
          return;
        }
        const result = await capabilityClient
          .load(PLUGIN_DOC_PARSER)
          .call<RuleDocumentParserOneOutput>('parseDocToMarkdown', {
            rule_file: [file],
          });

        if (result.content) {
          addRule({
            title: file.name.replace(/\.[^.]+$/, ''),
            category: '自定义规则',
            content: result.content,
            score: undefined,
            source: 'file',
          });
          toast.success('规则文件解析成功');
        }
      } catch (error) {
        const message = IS_STANDALONE && error instanceof Error ? error.message : '文件解析失败，请重试或使用文本粘贴';
        setImportError(message);
        toast.error(message);
      } finally {
        readingFileRef.current = false;
        setParsingFile(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [addRule]
  );

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    if (readingFileRef.current || savingRuleRef.current) return;
    if (event.dataTransfer.files.length > 1) {
      setImportError('每次请只拖入一个规则文件。');
      return;
    }
    const file = event.dataTransfer.files[0];
    if (file) {
      void handleFileUpload(file);
      return;
    }
    const text = event.dataTransfer.getData('text/plain');
    if (!text.trim()) {
      setImportError('没有接收到文件或文字，请点击选择文件，或使用“粘贴文本”。');
      return;
    }
    if (text.length > MAX_RULE_CONTENT_CHARS) {
      setImportError('规则内容暂限20万字以内，请拆分后导入。');
      return;
    }
    setTextInput(text);
    setTitleInput('');
    setCategoryInput('');
    setImportedFilename('');
    setFileWarnings([]);
    setRichDocument(null);
    richDocumentRef.current = null;
    setEditingRuleId(null);
    setImportError('');
    setImportTab('text');
    toast.success('文字已填入，请核对后保存规则');
  }, [handleFileUpload]);

  // 文本粘贴保存
  const handleSaveText = useCallback(async () => {
    if (savingRuleRef.current || readingFileRef.current) return;
    if (!textInput.trim()) {
      toast.error('请输入规则内容');
      return;
    }
    if (textInput.trim().length > MAX_RULE_CONTENT_CHARS) {
      setImportError('规则内容暂限20万字以内，请拆分后保存。');
      return;
    }
    const previous = editingRuleId ? rules.find((rule) => rule.id === editingRuleId) : undefined;
    if (editingRuleId && !previous) {
      setImportError('这条规则已删除，请重新导入后保存。');
      return;
    }
    savingRuleRef.current = true;
    setSavingRule(true);
    setImportError('');
    let documentId: string | undefined;
    let layoutSaved = false;
    let committed = false;
    try {
      if (richDocumentRef.current) {
        documentId = genId('rule-doc');
        await saveRuleLayout(documentId, richDocumentRef.current);
        layoutSaved = true;
      }
      const fields: Omit<IRule, 'id' | 'createdAt'> = {
        title: titleInput.trim() || '自定义规则', category: categoryInput.trim() || '自定义',
        content: textInput.trim(), score: previous?.score,
        source: previous?.source || (importedFilename ? 'file' : 'text'), richDocumentId: documentId,
      };
      const saved = previous ? { ...previous, ...fields } : addRule(fields);
      if (previous) updateRule(previous.id, fields);
      const persisted = storage.getRules<IRule[]>([]).find((rule) => rule.id === saved.id);
      if (IS_STANDALONE && (!persisted || persisted.content !== fields.content || persisted.title !== fields.title
        || persisted.category !== fields.category || persisted.richDocumentId !== documentId)) {
        if (previous) updateRule(previous.id, previous);
        else await deleteRule(saved.id);
        throw new Error('规则未保存，请释放浏览器存储空间后重试；填写内容已保留。');
      }
      committed = true;
      if (previous?.richDocumentId) await deleteRuleLayout(previous.richDocumentId).catch(() => undefined);
      setTextInput(''); setTitleInput(''); setCategoryInput(''); setImportedFilename('');
      setFileWarnings([]); setRichDocument(null); richDocumentRef.current = null; setEditingRuleId(null);
      toast.success(previous ? '规则修改已保存' : '规则已保存');
    } catch (error) {
      if (layoutSaved && !committed && documentId) await deleteRuleLayout(documentId).catch(() => undefined);
      setImportError(error instanceof Error ? error.message : '规则未保存，填写内容已保留，请重试。');
    } finally {
      savingRuleRef.current = false;
      setSavingRule(false);
    }
  }, [textInput, titleInput, categoryInput, importedFilename, editingRuleId, rules, addRule, updateRule, deleteRule]);

  const handleLayoutChange = useCallback((html: string, text: string) => {
    if (!richDocumentRef.current || savingRuleRef.current) return;
    richDocumentRef.current = { ...richDocumentRef.current, html };
    setTextInput(text);
  }, []);

  const handleEditLayout = useCallback(async (rule: IRule) => {
    if (!rule.richDocumentId || readingFileRef.current || savingRuleRef.current) return;
    readingFileRef.current = true;
    setParsingFile(true);
    setImportError('');
    try {
      const layout = await getRuleLayout(rule.richDocumentId);
      setRichDocument(layout); richDocumentRef.current = layout;
      setTextInput(rule.content); setTitleInput(rule.title); setCategoryInput(rule.category);
      setImportedFilename(layout.filename); setFileWarnings([]); setEditingRuleId(rule.id); setImportTab('text');
      document.getElementById('rule-import-form')?.scrollIntoView({ block: 'start' });
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '无法读取排版内容，请重新导入。');
    } finally {
      readingFileRef.current = false;
      setParsingFile(false);
    }
  }, []);

  // 添加目标标签
  const handleAddGoal = useCallback(() => {
    if (!newGoal.trim()) return;
    addGoal(newGoal.trim());
    setNewGoal('');
  }, [newGoal, addGoal]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddGoal();
      }
    },
    [handleAddGoal]
  );

  if (rulesLoading || goalsLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      <div className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">规则库</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {IS_STANDALONE ? '导入规则文件或粘贴规则文本，核对后保存到本机规则库；AI 规则匹配待后续接入' : '导入规则文件或粘贴规则文本，AI 解析通知时会自动对照判断重要程度'}
          </p>
        </div>

        <div className="grid min-w-0 gap-6 overflow-hidden lg:grid-cols-3">
          {/* 左侧：添加规则 */}
          <div className="space-y-6 min-w-0 lg:col-span-2">
            <Card id="rule-import-form">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{editingRuleId ? '编辑规则' : '添加规则'}</CardTitle>
              </CardHeader>
              <CardContent className="min-w-0">
                <Tabs value={importTab} onValueChange={(tab) => !savingRule && setImportTab(tab)}>
                  <TabsList className="mb-4 flex w-full gap-1 overflow-x-auto">
                    <TabsTrigger value="file" className="shrink-0">导入文件</TabsTrigger>
                    <TabsTrigger value="text" className="shrink-0">粘贴文本</TabsTrigger>
                    <TabsTrigger value="share" className="shrink-0">分享导入</TabsTrigger>
                  </TabsList>

                  <TabsContent value="file" className="mt-0 space-y-4">
                    <div
                      role="button"
                      aria-label="导入规则文件"
                      aria-busy={parsingFile}
                      aria-disabled={parsingFile}
                      tabIndex={0}
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleDrop}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (!parsingFile) fileInputRef.current?.click();
                        }
                      }}
                      onClick={() => !parsingFile && fileInputRef.current?.click()}
                      className={`flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-dashed p-6 text-center transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline focus-visible:outline-primary ${isDragging ? 'border-primary bg-primary/5' : 'border-border/60 bg-muted/30'}`}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        aria-label="选择规则文件"
                        accept=".pdf,.doc,.docx,.txt"
                        disabled={parsingFile}
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFileUpload(file);
                        }}
                      />
                      {parsingFile ? (
                        <>
                          <Loader2 className="mb-3 size-8 animate-spin text-primary" />
                          <p className="text-sm font-medium">{IS_STANDALONE ? '正在读取文档文字...' : '正在解析文件...'}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {IS_STANDALONE ? '读取完成后请核对并保存规则' : 'PDF/Word 文档可能需要 1-3 分钟'}
                          </p>
                        </>
                      ) : (
                        <>
                          <Upload className="mb-3 size-8 text-muted-foreground" />
                          <p className="text-center text-sm font-medium break-normal">点击选择或拖入文件，也可拖入选中文字</p>
                          <p className="mt-1 text-center text-xs text-muted-foreground break-normal">
                            支持 PDF、DOC、DOCX、TXT{IS_STANDALONE && '（≤10MB）'}
                          </p>
                          {IS_STANDALONE && <p className="mt-2 text-xs text-muted-foreground">扫描版 PDF、图片中的文字需先进行 OCR</p>}
                        </>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="text" className="mt-0 space-y-3">
                    {importedFilename && <p role="status" className="break-all text-xs text-muted-foreground">已读取：{importedFilename}。请核对内容后保存。</p>}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                          规则名称
                        </label>
                        <Input
                          aria-label="规则名称"
                          disabled={parsingFile || savingRule}
                          placeholder="如：综测加分细则"
                          value={titleInput}
                          onChange={(e) => setTitleInput(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                          分类
                        </label>
                        <Input
                          aria-label="规则分类"
                          disabled={parsingFile || savingRule}
                          placeholder="如：学科竞赛"
                          value={categoryInput}
                          onChange={(e) => setCategoryInput(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                        规则内容
                      </label>
                      {richDocument ? (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">{richDocument.format === 'pdf' ? '点击文字直接修改；页面可左右滚动，表格线和分页保留。' : '点击段落或表格单元格直接编辑，保留现有样式。'}</p>
                          <fieldset disabled={savingRule} className={savingRule ? 'pointer-events-none opacity-60' : ''}>
                            <RuleDocumentEditor document={richDocument} onChange={handleLayoutChange} disabled={savingRule} />
                          </fieldset>
                          <Button variant="ghost" size="sm" disabled={parsingFile || savingRule} onClick={() => {
                            setRichDocument(null); richDocumentRef.current = null;
                            setFileWarnings(['已切换为纯文字编辑，保存后将不保留原排版。']);
                          }}>改用纯文字（舍弃排版）</Button>
                        </div>
                      ) : <Textarea
                         aria-label="规则内容"
                         disabled={parsingFile || savingRule}
                         placeholder="粘贴规则文本内容..."
                         className="min-h-[160px] resize-y text-sm break-all"
                         value={textInput}
                         onChange={(e) => setTextInput(e.target.value)}
                       />}
                    </div>
                    {fileWarnings.map((warning) => <p key={warning} className="text-xs text-amber-700">{warning}</p>)}
                    <div className="flex justify-end">
                      {editingRuleId && <Button variant="ghost" disabled={savingRule || parsingFile} onClick={() => {
                        setEditingRuleId(null); setRichDocument(null); richDocumentRef.current = null;
                        setTextInput(''); setTitleInput(''); setCategoryInput(''); setImportedFilename(''); setFileWarnings([]); setImportError('');
                      }}>取消编辑</Button>}
                      <Button onClick={handleSaveText} disabled={parsingFile || savingRule}>
                        <ClipboardPaste className="mr-2 size-4" />
                        {savingRule ? '正在保存...' : editingRuleId ? '保存修改' : '保存规则'}
                      </Button>
                    </div>
                  </TabsContent>

                  <TabsContent value="share" className="mt-0 space-y-4">
                    <div className="rounded-lg border border-dashed border-border/60 bg-muted/30 p-6">
                      <div className="mb-3 flex items-center gap-2">
                        <QrCode className="size-5 text-primary" />
                        <h3 className="text-sm font-medium">通过分享码导入规则库</h3>
                      </div>
                      <p className="mb-4 text-xs text-muted-foreground">
                        输入好友分享的分享码，即可导入其规则库。支持合并导入、覆盖导入、选择性导入三种模式。
                      </p>
                      <div className="space-y-3">
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                            分享码
                          </label>
                           <Textarea
                             placeholder="粘贴分享码（以 NTZR:v1: 开头）"
                             className="min-h-[80px] resize-y font-mono text-xs break-all"
                             value={importCode}
                             onChange={(e) => setImportCode(e.target.value)}
                           />
                        </div>
                        <Button onClick={handleParseImport} className="w-full">
                          <Download className="mr-2 size-4" />
                          解析分享码
                        </Button>
                      </div>
                    </div>

                    {parsedImportRules && (
                      <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            解析成功：共 {parsedImportRules.length} 条规则
                          </span>
                          <Badge variant="outline" className="text-xs">
                            准备导入
                          </Badge>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">
                            导入模式
                          </label>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                            {[
                              { value: 'merge', label: '合并导入', desc: '保留双方' },
                              { value: 'overwrite', label: '覆盖导入', desc: '替换全部' },
                              { value: 'select', label: '选择性导入', desc: '手动勾选' },
                            ].map((m) => (
                              <button
                                key={m.value}
                                onClick={() => setImportMode(m.value as 'merge' | 'overwrite' | 'select')}
                                className={`rounded-md border p-2 text-center text-xs transition-all ${importMode === m.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:border-primary/50'}`}
                              >
                                <div className="font-medium">{m.label}</div>
                                <div className={`mt-0.5 ${importMode === m.value ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                                  {m.desc}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>

                        {importMode === 'select' && (
                          <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-border/60 bg-card p-2">
                            {parsedImportRules.map((r) => (
                              <label
                                key={r.id}
                                className="flex cursor-pointer items-start gap-2 rounded p-2 hover:bg-muted/50"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedImportIds.has(r.id)}
                                  onChange={() => toggleSelectRule(r.id)}
                                  className="mt-0.5 size-4"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-xs font-medium">{r.title}</div>
                                  <div className="truncate text-[10px] text-muted-foreground">
                                    {r.category}
                                  </div>
                                </div>
                              </label>
                            ))}
                          </div>
                        )}

                        <Button
                          onClick={handleConfirmImport}
                          className="w-full"
                          disabled={importing}
                        >
                          {importing ? (
                            <>
                              <Loader2 className="mr-2 size-4 animate-spin" />
                              导入中...
                            </>
                          ) : (
                            <>确认导入</>  
                          )}
                        </Button>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
                {importError && <p role="alert" className="mt-3 text-sm text-destructive">{importError}</p>}
              </CardContent>
            </Card>

            {/* 规则列表 */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">
                  规则列表 <span className="ml-1 text-sm font-normal text-muted-foreground">({rules.length} 条)</span>
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
                    <DialogTrigger asChild>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleGenerateShare}
                      >
                        <Share2 className="mr-1.5 size-4" />
                        分享
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <QrCode className="size-5 text-primary" />
                          分享我的规则库
                        </DialogTitle>
                        <DialogDescription>
                          将你的规则库生成为分享码，复制后发给好友即可导入，对齐判断标准
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-2">
                        {/* 分享码 */}
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                            分享码
                          </label>
                          <div className="flex gap-2">
                            <div className="flex-1 overflow-hidden rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                              <code className="block max-h-32 overflow-auto break-all text-[11px] text-foreground/80">
                                {shareCode}
                              </code>
                            </div>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={handleCopyShareCode}
                              className="shrink-0"
                            >
                              {shareCodeCopied ? (
                                <Check className="size-4 text-emerald-500" />
                              ) : (
                                <Copy className="size-4" />
                              )}
                            </Button>
                          </div>
                        </div>

                        <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-700 ring-1 ring-amber-100">
                          对方在「规则库 - 导入分享码」中粘贴此分享码，即可导入你的规则库
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                  {hasMockRules && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearMockRules}
                      className="text-xs text-muted-foreground"
                    >
                      清除示例
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="min-w-0 space-y-3">
                {rules.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    暂无规则，导入文件或粘贴文本开始添加
                  </div>
                ) : (
                  rules.map((rule, idx) => (
                    <motion.div
                      key={rule.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.04 }}
                      className="rounded-lg border border-border/60 p-4 transition-colors hover:border-border min-w-0"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <FileText className="size-4 shrink-0 text-muted-foreground" />
                            <span className="truncate font-medium">{rule.title}</span>
                            <Badge variant="outline" className="shrink-0 text-xs">
                              {rule.category}
                            </Badge>
                            {rule.source === 'mock' && (
                              <Badge variant="secondary" className="shrink-0 text-xs">
                                示例
                              </Badge>
                            )}
                          </div>
                          {rule.score && (
                            <div className="mt-1.5 text-xs text-primary font-medium">
                              {rule.score}
                            </div>
                          )}
                          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground leading-relaxed">
                            {rule.content}
                          </p>
                          <div className="mt-2 text-xs text-muted-foreground/70">
                            {formatDate(rule.createdAt)}
                          </div>
                          {IS_STANDALONE && rule.richDocumentId && (
                            <Button variant="outline" size="sm" className="mt-3" disabled={parsingFile || savingRule}
                              onClick={() => handleEditLayout(rule)}>查看 / 编辑排版</Button>
                          )}
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`删除规则 ${rule.title}`}
                              className="shrink-0 text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>确认删除</AlertDialogTitle>
                              <AlertDialogDescription>
                                删除后该规则将不再参与通知匹配，此操作不可恢复。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>取消</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteRule(rule.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                删除
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </motion.div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* 右侧：个人目标 */}
          <div className="space-y-6 min-w-0">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="size-4 text-primary" />
                  个人目标
                </CardTitle>
              </CardHeader>
              <CardContent className="min-w-0 space-y-4">
                 <p className="text-xs text-muted-foreground">
                  设置你的目标，AI 会结合目标调整通知重要程度判断
                </p>

                <div className="flex flex-wrap gap-2">
                  <AnimatePresence>
                    {goals.map((goal) => (
                      <motion.div
                        key={goal}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                      >
                        <Badge
                          variant="secondary"
                          className="flex items-center gap-1.5 pl-2.5 pr-1 py-1"
                        >
                          <TagIcon className="size-3" />
                          {goal}
                          <button
                            onClick={() => removeGoal(goal)}
                            className="ml-1 rounded-full p-0.5 hover:bg-accent"
                          >
                            <X className="size-3" />
                          </button>
                        </Badge>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>

                <Separator />

                <div className="flex gap-2">
                  <Input
                    placeholder="添加目标标签..."
                    value={newGoal}
                    onChange={(e) => setNewGoal(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="text-sm"
                  />
                  <Button variant="secondary" size="icon" onClick={handleAddGoal}>
                    <Plus className="size-4" />
                  </Button>
                </div>

                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                    <Lightbulb className="mt-0.5 size-3.5 shrink-0" />
                    <span>例如：提高综测、保研、评优、求职、技能提升等</span>
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
