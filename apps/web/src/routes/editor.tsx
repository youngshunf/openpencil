import { createFileRoute } from '@tanstack/react-router';
import EditorLayout from '@/components/editor/editor-layout';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useBeforeUnload } from '@/hooks/use-before-unload';
import { useProjectFileLoader } from '@/hooks/use-project-file-loader';

export const Route = createFileRoute('/editor')({
  component: EditorPage,
  ssr: false,
  head: () => ({
    meta: [{ title: 'OpenPencil Editor' }],
  }),
});

function EditorPage() {
  useKeyboardShortcuts();
  useBeforeUnload();
  // 按 URL `?file=` 加载唤星项目 `.op`（修空白画布）。不带参数时 no-op。
  useProjectFileLoader();

  return <EditorLayout />;
}
