import type { App } from 'obsidian';

import { appendBuchesContext } from '@/core/prompt/promptContext';
import type { ComposerDropdownValueItem } from '@/shared/composer-dropdown/types';

import { findComposerWikilinks } from './composerWikilinks';

interface BuchesMention {
  readonly ref: string;
  readonly title: string;
  readonly kind: string;
  readonly book: string;
}

interface BuchesTools {
  readonly version: number;
  context(path: string, chapter: string, block?: string, query?: string): Promise<unknown>;
  mentions?(query: string): Promise<readonly BuchesMention[]>;
  mentionContext?(refs: string[]): Promise<readonly unknown[]>;
}

export function getBuchesTools(app: App): BuchesTools | undefined {
  const host = app as App & { plugins?: { getPlugin(id: string): { bookTools?: BuchesTools } | null } };
  const tools = host.plugins?.getPlugin('buches')?.bookTools;
  return tools?.version === 1 ? tools : undefined;
}

const icons: Record<string, string> = {
  book: 'book-open', concept: 'file-text', section: 'heading',
  definition: 'book-marked', theorem: 'square-function', exercise: 'clipboard-list', solution: 'file-check',
};

export async function listBuchesMentions(app: App, query: string): Promise<readonly ComposerDropdownValueItem[]> {
  const rows = await getBuchesTools(app)?.mentions?.(query);
  return (rows ?? []).map(({ ref, title, kind, book }) => ({
    id: 'buches:' + ref,
    kind: 'value',
    label: title,
    detail: kind + ' · ' + book,
    icon: Object.hasOwn(icons, kind) ? icons[kind] : 'bookmark',
    replacement: `[[${ref}|${title.replace(/[\r\n|\]]/g, ' ')}]] `,
  }));
}

export async function attachBuchesMentions(app: App, displayText: string, prompt: string): Promise<string> {
  const refs = findComposerWikilinks(displayText).map(link => link.linkTarget).filter(ref => ref.startsWith('Buches/'));
  if (!refs.length) return prompt;
  const passages = await getBuchesTools(app)?.mentionContext?.(refs);
  return passages?.length
    ? appendBuchesContext(prompt, 'Explicitly mentioned Bücher objects (reference material):\n' + JSON.stringify(passages, null, 2))
    : prompt;
}
