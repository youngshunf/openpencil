import { useCallback, useEffect, useState } from 'react';
import { appStorage, initAppStorage } from '@/utils/app-storage';
import { PanelLeft, Folder, ChevronDown, Sun, Moon, Maximize, Minimize } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import FigmaLogo from '@/components/icons/figma-logo';
import FileMenu from '@/components/shared/file-menu';
import LanguageSelector from '@/components/shared/language-selector';
import { GitButton } from '@/components/editor/git-button';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useCanvasStore } from '@/stores/canvas-store';
import { useDocumentStore } from '@/stores/document-store';
import {
  supportsFileSystemAccess,
  isElectron,
  openDocumentFS,
  openDocument,
} from '@/utils/file-operations';
import { syncCanvasPositionsToStore } from '@/canvas/skia-engine-ref';
import { zoomToFitContent } from '@/canvas/skia-engine-ref';
import { parseAndPrepareImportedDocument } from '@/utils/import-pen-document';
import { addRecentFile } from '@/utils/recent-files';
import type { PenDocument } from '@/types/pen';

/**
 * Derive a human title for the editor top bar: the project name, not the `.op` file path.
 *
 * Priority: document `name` (the daemon stamps it = 唤星 project name when creating the `.op`,
 * survives pen-mcp saves since normalize preserves top-level fields) → first top-level frame
 * name (the design's own title, set when the agent draws) → '' (caller falls back to fileName).
 * Returned as a plain string so the Zustand selector only re-renders the title on actual change.
 */
function deriveProjectTitle(doc: PenDocument): string {
  const docName = doc.name?.trim();
  if (docName) return docName;
  const firstNode =
    (doc.pages && doc.pages.length > 0 ? doc.pages[0]?.children?.[0] : undefined) ??
    doc.children?.[0];
  return firstNode?.name?.trim() ?? '';
}

/** Convert a computed CSS color value (oklch/rgb/etc.) to #rrggbb via an offscreen canvas. */
function cssToHex(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = v;
    const hex = ctx.fillStyle; // browser normalises to #rrggbb
    return hex.startsWith('#') ? hex : null;
  } catch {
    return null;
  }
}

export default function TopBar() {
  const { t } = useTranslation();
  const toggleLayerPanel = useCanvasStore((s) => s.toggleLayerPanel);
  const layerPanelOpen = useCanvasStore((s) => s.layerPanelOpen);
  const fileName = useDocumentStore((s) => s.fileName);
  const projectTitle = useDocumentStore((s) => deriveProjectTitle(s.document));
  const isDirty = useDocumentStore((s) => s.isDirty);

  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [saveIndicator, setSaveIndicator] = useState(false);

  // Read computed CSS --card and --card-foreground as hex for Electron overlay
  const syncOverlayColors = useCallback((t: 'dark' | 'light') => {
    if (!window.electronAPI?.setTheme) return;
    // Allow a frame for CSS to apply after class toggle
    requestAnimationFrame(() => {
      const s = getComputedStyle(document.documentElement);
      const bg = cssToHex(s.getPropertyValue('--card'));
      const fg = cssToHex(s.getPropertyValue('--card-foreground'));
      window.electronAPI!.setTheme(t, bg && fg ? { bg, fg } : undefined);
    });
  }, []);

  // Restore saved theme after hydration.
  // initAppStorage() must run first in Electron to populate the IPC cache,
  // since appStorage.getItem is synchronous.
  useEffect(() => {
    const restore = async () => {
      await initAppStorage();
      const saved = appStorage.getItem('openpencil-theme');
      if (saved === 'light') {
        document.documentElement.classList.add('light');
        setTheme('light');
        syncOverlayColors('light');
      } else {
        syncOverlayColors('dark');
      }
    };
    restore();
  }, [syncOverlayColors]);

  // Listen to fullscreen changes
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    if (next === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
    setTheme(next);
    syncOverlayColors(next);
    appStorage.setItem('openpencil-theme', next);
  }, [theme, syncOverlayColors]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }, []);

  // Bare save: delegates to the store. Used by handleNew/handleOpenRecent
  // when they need to save before discarding the current doc; the indicator
  // flash is owned by handleSaveWithFeedback below.
  const handleSave = useCallback(async (): Promise<string | null> => {
    try {
      syncCanvasPositionsToStore();
    } catch (err) {
      console.error('[Save] syncCanvasPositionsToStore failed:', err);
    }
    return useDocumentStore.getState().save();
  }, []);

  const handleSaveWithFeedback = useCallback(async () => {
    const savedName = await handleSave();
    if (!savedName) {
      // User cancelled the save dialog or save failed.
      // Critically: do NOT add to recent files and do NOT flash the indicator.
      return;
    }
    const filePath = useDocumentStore.getState().filePath;
    addRecentFile({ fileName: savedName, filePath: filePath ?? null });
    setSaveIndicator(true);
    setTimeout(() => setSaveIndicator(false), 2000);
  }, [handleSave]);

  const handleSaveAs = useCallback(async () => {
    try {
      syncCanvasPositionsToStore();
    } catch (err) {
      console.error('[SaveAs] syncCanvasPositionsToStore failed:', err);
    }
    // Direct saveAs() — does NOT pre-mutate filePath/fileHandle. The store
    // action handles the dialog and only updates state on confirmed success.
    const savedName = await useDocumentStore.getState().saveAs();
    if (!savedName) return;
    const filePath = useDocumentStore.getState().filePath;
    addRecentFile({ fileName: savedName, filePath: filePath ?? null });
    setSaveIndicator(true);
    setTimeout(() => setSaveIndicator(false), 2000);
  }, []);

  const handleNew = useCallback(async () => {
    if (useDocumentStore.getState().isDirty) {
      const showDialog = (window as any).__showUnsavedDialog;
      if (showDialog) {
        const result = await showDialog(
          useDocumentStore.getState().fileName || t('common.untitled'),
        );
        if (result === 'cancel') return;
        if (result === 'save') await handleSaveWithFeedback();
      }
    }
    useDocumentStore.getState().newDocument();
    requestAnimationFrame(() => zoomToFitContent());
  }, [t, handleSaveWithFeedback]);

  const handleOpenRecent = useCallback(
    async (filePath: string) => {
      if (!isElectron()) return;
      if (useDocumentStore.getState().isDirty) {
        const showDialog = (window as any).__showUnsavedDialog;
        if (showDialog) {
          const result = await showDialog(
            useDocumentStore.getState().fileName || t('common.untitled'),
          );
          if (result === 'cancel') return;
          if (result === 'save') await handleSaveWithFeedback();
        }
      }
      window.electronAPI!.readFile(filePath).then((result) => {
        if (!result) return;
        try {
          const name = result.filePath.split(/[/\\]/).pop() || 'untitled.op';
          const prepared = parseAndPrepareImportedDocument(result.content, {
            fileName: name,
            filePath: result.filePath,
          });
          if (!prepared) return;
          const { doc } = prepared;
          useDocumentStore.getState().loadDocument(doc, name, null, result.filePath);
          requestAnimationFrame(() => zoomToFitContent());
        } catch {
          /* invalid file */
        }
      });
    },
    [t, handleSaveWithFeedback],
  );

  const handleOpen = useCallback(async () => {
    if (useDocumentStore.getState().isDirty) {
      const showDialog = (window as any).__showUnsavedDialog;
      if (showDialog) {
        const result = await showDialog(
          useDocumentStore.getState().fileName || t('common.untitled'),
        );
        if (result === 'cancel') return;
        if (result === 'save') await handleSaveWithFeedback();
      }
    }
    if (isElectron()) {
      window.electronAPI!.openFile().then((result) => {
        if (!result) return;
        try {
          const name = result.filePath.split(/[/\\]/).pop() || 'untitled.op';
          const prepared = parseAndPrepareImportedDocument(result.content, {
            fileName: name,
            filePath: result.filePath,
          });
          if (!prepared) return;
          const { doc } = prepared;
          useDocumentStore.getState().loadDocument(doc, name, null, result.filePath);
          requestAnimationFrame(() => zoomToFitContent());
        } catch {
          /* invalid file */
        }
      });
    } else if (supportsFileSystemAccess()) {
      openDocumentFS().then((result) => {
        if (result) {
          useDocumentStore.getState().loadDocument(result.doc, result.fileName, result.handle);
          requestAnimationFrame(() => zoomToFitContent());
        }
      });
    } else {
      openDocument().then((result) => {
        if (result) {
          useDocumentStore.getState().loadDocument(result.doc, result.fileName);
          requestAnimationFrame(() => zoomToFitContent());
        }
      });
    }
  }, [t, handleSaveWithFeedback]);

  // 顶栏显示项目名（document.name → 根帧名），无则回落文件名，仍无则「未命名」。
  const displayName = projectTitle || fileName || t('common.untitled');

  return (
    <div className="h-10 bg-card border-b border-border flex items-center px-2 shrink-0 select-none app-region-drag">
      {/* Left section */}
      <div className="flex items-center gap-0.5 app-region-no-drag electron-traffic-light-pad">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleLayerPanel}
              className={layerPanelOpen ? 'text-foreground' : 'text-muted-foreground'}
            >
              <PanelLeft size={15} strokeWidth={1.5} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {layerPanelOpen ? t('topbar.hideLayers') : t('topbar.showLayers')}
          </TooltipContent>
        </Tooltip>

        <div className="w-px h-3.5 bg-border/60 mx-1" />

        {/* File menu dropdown trigger */}
        <div className="relative">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground h-7 px-1.5 gap-0.5"
                onClick={() => setFileMenuOpen((v) => !v)}
              >
                <Folder size={15} strokeWidth={1.5} />
                <ChevronDown size={10} className="text-muted-foreground/60" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('topbar.open')}</TooltipContent>
          </Tooltip>
          <FileMenu
            open={fileMenuOpen}
            onClose={() => setFileMenuOpen(false)}
            onNew={handleNew}
            onOpen={handleOpen}
            onSave={handleSaveWithFeedback}
            onSaveAs={handleSaveAs}
            onExport={() => useCanvasStore.getState().setExportDialogOpen(true)}
            onOpenRecent={handleOpenRecent}
          />
        </div>

        <div className="w-px h-3.5 bg-border/60 mx-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              onClick={() => useCanvasStore.getState().setFigmaImportDialogOpen(true)}
            >
              <FigmaLogo className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('topbar.importFigma')}</TooltipContent>
        </Tooltip>
      </div>

      {/* Center section — file name + git indicator */}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
        <span className="truncate text-xs leading-none text-foreground" suppressHydrationWarning>
          {displayName}
        </span>
        {isDirty && (
          <span className="text-xs leading-none text-muted-foreground">{t('topbar.edited')}</span>
        )}
        {saveIndicator && (
          <span className="text-[10px] leading-none text-emerald-500 animate-pulse">
            {t('fileMenu.saved')}
          </span>
        )}
        <div className="app-region-no-drag flex items-center">
          <GitButton />
        </div>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-0.5 app-region-no-drag electron-win-controls-pad">
        <LanguageSelector />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              onClick={toggleTheme}
            >
              {theme === 'dark' ? (
                <Sun size={15} strokeWidth={1.5} />
              ) : (
                <Moon size={15} strokeWidth={1.5} />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {theme === 'dark' ? t('topbar.lightMode') : t('topbar.darkMode')}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              onClick={toggleFullscreen}
            >
              {isFullscreen ? (
                <Minimize size={15} strokeWidth={1.5} />
              ) : (
                <Maximize size={15} strokeWidth={1.5} />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {isFullscreen ? t('topbar.exitFullscreen') : t('topbar.fullscreen')}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
