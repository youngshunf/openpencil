import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { isHuanxingProjectContext } from '@/lib/huanxing-context';

interface QuickAction {
  emoji: string;
  labelKey: string;
  descKey: string;
  promptKey: string;
}

// 独立 OpenPencil（无 `?project=`）默认体验：从零新建设计。
const CREATE_QUICK_ACTIONS: QuickAction[] = [
  {
    emoji: '📱',
    labelKey: 'ai.quickAction.loginScreen',
    descKey: 'ai.quickAction.loginScreenDesc',
    promptKey: 'ai.quickAction.loginScreenPrompt',
  },
  {
    emoji: '🍕',
    labelKey: 'ai.quickAction.foodApp',
    descKey: 'ai.quickAction.foodAppDesc',
    promptKey: 'ai.quickAction.foodAppPrompt',
  },
  {
    emoji: '⬇️',
    labelKey: 'ai.quickAction.bottomNav',
    descKey: 'ai.quickAction.bottomNavDesc',
    promptKey: 'ai.quickAction.bottomNavPrompt',
  },
  {
    emoji: '🎨',
    labelKey: 'ai.quickAction.colorPalette',
    descKey: 'ai.quickAction.colorPaletteDesc',
    promptKey: 'ai.quickAction.colorPalettePrompt',
  },
];

// 唤星编辑器语境（带 `?project=`）：画布上往往已有设计，引导在现有设计上协作改图。
const COLLAB_QUICK_ACTIONS: QuickAction[] = [
  {
    emoji: '🎨',
    labelKey: 'ai.quickAction.collabColor',
    descKey: 'ai.quickAction.collabColorDesc',
    promptKey: 'ai.quickAction.collabColorPrompt',
  },
  {
    emoji: '📐',
    labelKey: 'ai.quickAction.collabSpacing',
    descKey: 'ai.quickAction.collabSpacingDesc',
    promptKey: 'ai.quickAction.collabSpacingPrompt',
  },
  {
    emoji: '✨',
    labelKey: 'ai.quickAction.collabPolish',
    descKey: 'ai.quickAction.collabPolishDesc',
    promptKey: 'ai.quickAction.collabPolishPrompt',
  },
  {
    emoji: '➕',
    labelKey: 'ai.quickAction.collabModule',
    descKey: 'ai.quickAction.collabModuleDesc',
    promptKey: 'ai.quickAction.collabModulePrompt',
  },
];

interface AIChatQuickActionsProps {
  onSend: (prompt: string) => void;
  disabled: boolean;
}

export function AIChatQuickActions({ onSend, disabled }: AIChatQuickActionsProps) {
  const { t } = useTranslation();

  // 唤星语境下引导协作改图；独立 OpenPencil 保留原「从零新建」默认。
  const collaborate = isHuanxingProjectContext();
  const actions = collaborate ? COLLAB_QUICK_ACTIONS : CREATE_QUICK_ACTIONS;
  const titleKey = collaborate ? 'ai.collabTitle' : 'ai.startDesigning';

  return (
    <div className="flex flex-col items-center justify-center py-6 px-1">
      <p className="text-xs text-muted-foreground mb-4">{t(titleKey)}</p>
      <div className="grid grid-cols-2 gap-2 w-full">
        {actions.map((action) => (
          <button
            key={action.labelKey}
            type="button"
            onClick={() => onSend(t(action.promptKey))}
            disabled={disabled}
            className={cn(
              'flex flex-col items-start gap-0.5 p-3 rounded-lg border border-border bg-secondary/30 text-left transition-colors',
              disabled ? 'cursor-default opacity-60' : 'hover:bg-secondary hover:border-border/80',
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-sm">{action.emoji}</span>
              <span className="text-xs font-medium text-foreground">{t(action.labelKey)}</span>
            </div>
            <span className="text-[10px] text-muted-foreground leading-tight">
              {t(action.descKey)}
            </span>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground/50 mt-5">{t('ai.tipSelectElements')}</p>
    </div>
  );
}
