const core = require('@actions/core');
const { evaluateRules, buildRegex, parseBoolean } = require('..');

describe('evaluateRules', () => {
  const defaultOptions = {
    enableReadmeOnly: true,
    enableContributorRegex: true,
    enableGenericBody: true,
    enableNewContributor: true,
    enableCustomRegex: true,
  };

  beforeEach(() => {
    jest.spyOn(core, 'info').mockImplementation(() => {});
    jest.spyOn(core, 'warning').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('scores README-only changes with generic body and newbie author', () => {
    const files = [{ filename: 'README.md', patch: '+ Added contributor entry' }];
    const diffText = '+ Added contributor entry';
    const bodyText = 'Fixed typo\nPlease merge for Hacktoberfest';

    const { score, matchedRules } = evaluateRules({
      files,
      diffText,
      bodyText,
      authorIsNewbie: true,
      customRegex: null,
      options: defaultOptions,
    });

    expect(score).toBe(4);
    expect(matchedRules).toEqual(
      expect.arrayContaining(['readme-only', 'generic-body', 'new-contributor', 'contributor-regex']),
    );
  });

  it('detects contributor list additions with custom regex', () => {
    const files = [
      { filename: 'README.md', patch: '+ * [Jane Doe](https://github.com/janedoe) - Docs' },
      { filename: 'CONTRIBUTORS.md', patch: '+ @janedoe joined' },
    ];
    const diffText = files.map((file) => file.patch).join('\n');
    const bodyText = 'Adding my name';
    const customRegex = buildRegex('joined');

    const { score, matchedRules } = evaluateRules({
      files,
      diffText,
      bodyText,
      authorIsNewbie: false,
      customRegex,
      options: defaultOptions,
    });

    expect(score).toBeGreaterThanOrEqual(2);
    expect(matchedRules).toEqual(expect.arrayContaining(['contributor-regex', 'custom-regex']));
  });

  it('ignores README rule when multiple files changed', () => {
    const files = [
      { filename: 'README.md', patch: '+ Added docs link' },
      { filename: 'src/index.js', patch: '+ console.log("hello")' },
    ];
    const diffText = files.map((file) => file.patch).join('\n');
    const bodyText = 'Minor docs tweak';

    const { score, matchedRules } = evaluateRules({
      files,
      diffText,
      bodyText,
      authorIsNewbie: false,
      customRegex: null,
      options: defaultOptions,
    });

    expect(score).toBeGreaterThanOrEqual(1);
    expect(matchedRules).not.toContain('readme-only');
  });

  it('respects disabled rules', () => {
    const files = [{ filename: 'README.md', patch: '+ Added badge' }];
    const diffText = '+ Added badge';
    const bodyText = 'Updated README';

    const { score, matchedRules } = evaluateRules({
      files,
      diffText,
      bodyText,
      authorIsNewbie: false,
      customRegex: null,
      options: {
        ...defaultOptions,
        enableReadmeOnly: false,
        enableGenericBody: false,
      },
    });

    expect(score).toBe(1);
    expect(matchedRules).toEqual(expect.arrayContaining(['contributor-regex']));
    expect(matchedRules).not.toEqual(expect.arrayContaining(['readme-only', 'generic-body']));
  });

  it('ignores custom regex when parsing fails', () => {
    const files = [{ filename: 'src/app.js', patch: '+ console.log("hi")' }];
    const diffText = '+ console.log("hi")';
    const bodyText = 'Implemented feature';

    const { score, matchedRules } = evaluateRules({
      files,
      diffText,
      bodyText,
      authorIsNewbie: false,
      customRegex: null,
      options: {
        ...defaultOptions,
        enableContributorRegex: false,
      },
    });

    expect(score).toBe(0);
    expect(matchedRules).toHaveLength(0);
  });
});

describe('buildRegex', () => {
  it('returns null when pattern exceeds safety limit', () => {
    const longPattern = 'a'.repeat(201);
    expect(buildRegex(longPattern)).toBeNull();
  });

  it('parses slash-delimited patterns', () => {
    const regex = buildRegex('/hello/i');
    expect(regex.test('Hello there')).toBe(true);
  });

  it('returns case-insensitive regex by default', () => {
    const regex = buildRegex('hacktoberfest');
    expect(regex.test('Hacktoberfest')).toBe(true);
  });
});

describe('parseBoolean', () => {
  it('interprets truthy strings', () => {
    expect(parseBoolean('true')).toBe(true);
    expect(parseBoolean('YES')).toBe(true);
    expect(parseBoolean('1')).toBe(true);
  });

  it('falls back to default when empty', () => {
    expect(parseBoolean('', true)).toBe(true);
    expect(parseBoolean(undefined, false)).toBe(false);
  });

  it('treats unknown strings as false', () => {
    expect(parseBoolean('nope')).toBe(false);
  });
});
