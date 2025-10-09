const core = require('@actions/core');
const { evaluateRules, buildRegex } = require('..');

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
});

describe('buildRegex', () => {
  it('returns null when pattern exceeds safety limit', () => {
    const longPattern = 'a'.repeat(201);
    expect(buildRegex(longPattern)).toBeNull();
  });
});
