export function splitPreservingText(value: string, max = 27): string[] {
  const words = value.trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (Array.from(current + " " + word).length <= max) current += " " + word;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines;
}

