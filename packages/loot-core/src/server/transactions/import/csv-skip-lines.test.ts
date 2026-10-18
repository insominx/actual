import { csvLinesWithoutTrailingBlank } from './parse-file';

describe('csvLinesWithoutTrailingBlank', () => {
  it('does not count the empty string after a final newline', () => {
    expect(csvLinesWithoutTrailingBlank('header\nrow\nfooter\n')).toEqual([
      'header',
      'row',
      'footer',
    ]);
  });

  it('keeps a file that does not end with a newline', () => {
    expect(csvLinesWithoutTrailingBlank('header\nrow\nfooter')).toEqual([
      'header',
      'row',
      'footer',
    ]);
  });

  it('drops the footer when the last line is skipped, even with a trailing newline', () => {
    const lines = csvLinesWithoutTrailingBlank('header\nrow\nfooter\n');
    expect(lines.slice(0, lines.length - 1)).toEqual(['header', 'row']);
  });
});
