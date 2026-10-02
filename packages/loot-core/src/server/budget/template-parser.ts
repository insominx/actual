import type { Template } from '#types/models/templates';

import { parse } from './goal-template.pegjs';

export const TEMPLATE_PREFIX = '#template';
export const GOAL_PREFIX = '#goal';
const CLEANUP_PREFIX = '#cleanup';

export function parseTemplateNote(note: string): Template[] {
  const parsedTemplates: Template[] = [];
  // Non-directive lines directly above a template line are kept as that
  // template's description. A blank line or a different directive ends the
  // block.
  let descriptionLines: string[] = [];

  note.split('\n').forEach(line => {
    const trimmedLine = line.substring(line.indexOf('#')).trim();
    const isTemplateLine =
      trimmedLine.startsWith(TEMPLATE_PREFIX) ||
      trimmedLine.startsWith(GOAL_PREFIX);

    if (!isTemplateLine) {
      if (line.trim() === '' || trimmedLine.startsWith(CLEANUP_PREFIX)) {
        descriptionLines = [];
      } else {
        descriptionLines.push(line.trimEnd());
      }
      return;
    }

    const description =
      descriptionLines.length > 0 ? descriptionLines.join('\n') : undefined;
    descriptionLines = [];

    try {
      const parsedTemplate: Template = parse(trimmedLine);

      // Validate schedule adjustments
      if (
        (parsedTemplate.type === 'average' ||
          parsedTemplate.type === 'schedule') &&
        parsedTemplate.adjustment !== undefined
      ) {
        if (parsedTemplate.adjustmentType === 'percent') {
          if (
            parsedTemplate.adjustment <= -100 ||
            parsedTemplate.adjustment > 1000
          ) {
            throw new Error(
              `Invalid adjustment percentage (${parsedTemplate.adjustment}%). Must be between -100% and 1000%`,
            );
          }
        } else if (parsedTemplate.adjustmentType === 'fixed') {
          //placeholder for potential validation of amount/fixed adjustments
        }
      }

      parsedTemplates.push(
        description ? { ...parsedTemplate, description } : parsedTemplate,
      );
    } catch (e: unknown) {
      const errorTemplate: Template = {
        type: 'error',
        directive: 'error',
        line,
        error: (e as Error).message,
      };
      parsedTemplates.push(
        description ? { ...errorTemplate, description } : errorTemplate,
      );
    }
  });

  return parsedTemplates;
}
