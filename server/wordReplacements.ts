const replacements: Record<string, string> = {
  'BPC-157': 'BPC157',
  'BPC 157': 'BPC157',
  'peptid': 'Peptid HR',
  'peptidi': 'Peptidi HR',
  'peptidima': 'Peptidima HR',
  'TB-500': 'TB500',
  'TB 500': 'TB500',
  'GHK-Cu': 'GHKCu',
  'GHK Cu': 'GHKCu',
  'IGF-1': 'IGF1',
  'IGF 1': 'IGF1',
  'HGH fragment': 'HGH Fragment',
  'Ipamorelin': 'Ipamorelin HR',
  'CJC-1295': 'CJC1295',
  'CJC 1295': 'CJC1295',
  'Sermorelin': 'Sermorelin HR',
  'DSIP': 'DSIP HR',
  'Melanotan': 'Melanotan HR',
};

export function applyReplacements(text: string): string {
  let result = text;
  // Sort by length descending to replace longer phrases first
  const sortedKeys = Object.keys(replacements).sort(
    (a, b) => b.length - a.length
  );
  for (const key of sortedKeys) {
    const regex = new RegExp(key.replace(/[-\s]/g, '[-\\s]?'), 'gi');
    result = result.replace(regex, (match) => {
      // Preserve original capitalisation style if possible
      const replacement = replacements[key];
      if (match[0] === match[0].toUpperCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return replacement;
    });
  }
  return result;
}
