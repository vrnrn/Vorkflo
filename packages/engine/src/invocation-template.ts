const placeholderNamePattern = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export interface InvocationTemplateAnalysis {
  readonly placeholders: readonly string[];
  readonly malformed: boolean;
}

export function analyzeInvocationTemplate(
  template: string,
): InvocationTemplateAnalysis {
  const placeholders: string[] = [];
  let malformed = false;
  let cursor = 0;

  while (cursor < template.length) {
    const opening = template.indexOf('{{', cursor);
    const strayClosing = template.indexOf('}}', cursor);
    if (strayClosing !== -1 && (opening === -1 || strayClosing < opening)) {
      malformed = true;
      cursor = strayClosing + 2;
      continue;
    }
    if (opening === -1) break;

    const closing = template.indexOf('}}', opening + 2);
    if (closing === -1) {
      malformed = true;
      break;
    }

    const name = template.slice(opening + 2, closing);
    if (!placeholderNamePattern.test(name)) {
      malformed = true;
    } else {
      placeholders.push(name);
    }
    cursor = closing + 2;
  }

  return { placeholders, malformed };
}

export function renderInvocationTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(
    /\{\{([A-Za-z_][A-Za-z0-9_-]*)\}\}/g,
    (_placeholder, name: string) => values[name] ?? '',
  );
}
