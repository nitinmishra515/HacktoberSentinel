const core = require('@actions/core');
const github = require('@actions/github');

function parseBoolean(value, defaultValue = false) {
  if (!value) return defaultValue;
  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
}

function buildRegex(pattern) {
  if (!pattern) {
    return null;
  }

  const trimmed = pattern.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length > MAX_CUSTOM_REGEX_LENGTH) {
    core.warning(
      `Custom regex exceeds ${MAX_CUSTOM_REGEX_LENGTH} characters and was ignored to avoid potential performance issues.`,
    );
    return null;
  }

  const delimiterMatch = trimmed.match(/^\/(.*)\/(\w*)$/);
  if (delimiterMatch) {
    try {
      return new RegExp(delimiterMatch[1], delimiterMatch[2]);
    } catch (error) {
      core.warning(`Failed to parse custom regex '${pattern}': ${error.message}`);
      return null;
    }
  }

  try {
    return new RegExp(trimmed, 'i');
  } catch (error) {
    core.warning(`Failed to parse custom regex '${pattern}': ${error.message}`);
    return null;
  }
}

const CONTRIBUTOR_REGEX = /\+\s*(?:[-*]\s*)?(?:\[[^\]\n]{1,60}\]\s*)?@?[\w-]{2,40}/i;
const GENERIC_BODY_PATTERNS = [
  /fixed typo/i,
  /minor (change|fix)/i,
  /added my name/i,
  /add(?:ed)?\s+me/i,
  /update(?:d)? readme/i,
  /docs? update/i,
  /test commit/i,
  /hacktoberfest/i,
  /contribution/i,
];
const MAX_CUSTOM_REGEX_LENGTH = 200;

async function ensureLabel(octokit, owner, repo, labelName) {
  try {
    await octokit.rest.issues.getLabel({ owner, repo, name: labelName });
    return true;
  } catch (error) {
    if (error.status === 404) {
      core.info(`Label '${labelName}' not found. Creating it.`);
      const created = await withPermissionWarning(
        () =>
          octokit.rest.issues.createLabel({
            owner,
            repo,
            name: labelName,
            color: 'B60205',
            description: 'Flagged by HacktoberSentinel as potential spam.',
          }),
        'create labels in this repository',
      );

      return Boolean(created);
    }

    throw error;
  }
}

async function withPermissionWarning(fn, description) {
  try {
    return await fn();
  } catch (error) {
    if (error && error.status === 403) {
      core.warning(
        `Missing permissions to ${description}. Grant pull-requests: write and issues: write in the workflow permissions block.`,
      );
      return null;
    }

    throw error;
  }
}

function evaluateRules({
  files,
  diffText,
  bodyText,
  authorIsNewbie,
  customRegex,
  options,
}) {
  const {
    enableReadmeOnly,
    enableContributorRegex,
    enableGenericBody,
    enableNewContributor,
    enableCustomRegex,
  } = options;

  const matchedRules = [];
  let score = 0;

  if (enableReadmeOnly) {
    const readmeOnly = files.length === 1 && files[0].filename.toLowerCase() === 'readme.md';
    core.info(`Rule readme-only: ${readmeOnly}`);
    if (readmeOnly) {
      score += 1;
      matchedRules.push('readme-only');
    }
  }

  if (enableContributorRegex) {
    const addsContributor = CONTRIBUTOR_REGEX.test(diffText);
    core.info(`Rule contributor-regex: ${addsContributor}`);
    if (addsContributor) {
      score += 1;
      matchedRules.push('contributor-regex');
    }
  }

  if (enableGenericBody) {
    const genericBody = GENERIC_BODY_PATTERNS.some((regex) => regex.test(bodyText));
    core.info(`Rule generic-body: ${genericBody}`);
    if (genericBody) {
      score += 1;
      matchedRules.push('generic-body');
    }
  }

  if (enableNewContributor) {
    core.info(`Rule new-contributor: ${authorIsNewbie}`);
    if (authorIsNewbie) {
      score += 1;
      matchedRules.push('new-contributor');
    }
  }

  if (enableCustomRegex && customRegex) {
    const customMatched = customRegex.test(diffText) || customRegex.test(bodyText);
    core.info(`Rule custom-regex: ${customMatched}`);
    if (customMatched) {
      score += 1;
      matchedRules.push('custom-regex');
    }
  }

  return { score, matchedRules };
}

async function run() {
  try {
    const eventName = github.context.eventName;
    if (eventName !== 'pull_request' && eventName !== 'pull_request_target') {
      core.info(`Event '${eventName}' is unsupported. Exiting.`);
      return;
    }

    const pullRequest = github.context.payload.pull_request;
    if (!pullRequest) {
      throw new Error('No pull request payload found.');
    }

    const token = core.getInput('github-token', { required: true });
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const pullNumber = pullRequest.number;

    const closeSpam = parseBoolean(core.getInput('close-spam'));
    const rawMinScore = Number.parseInt(core.getInput('min-score'), 10);
    const minScore = Number.isFinite(rawMinScore) && rawMinScore > 0 ? rawMinScore : 2;
    const labelName = core.getInput('label-name') || 'spam';
    const commentMessage =
      core.getInput('comment-message') ||
      'This PR looks low-effort (e.g., README tweak). Please take another pass and use our contribution guide for context. Hacktoberfest tips: https://hacktoberfest.com/participation/#spam';

    const customRegex = buildRegex(core.getInput('custom-regex'));
    const enableReadmeOnly = parseBoolean(core.getInput('enable-readme-only') || 'true', true);
    const enableContributorRegex = parseBoolean(
      core.getInput('enable-contributor-regex') || 'true',
      true,
    );
    const enableGenericBody = parseBoolean(core.getInput('enable-generic-body') || 'true', true);
    const enableNewContributor = parseBoolean(core.getInput('enable-new-contributor') || 'true', true);
    const enableCustomRegex = parseBoolean(core.getInput('enable-custom-regex') || 'true', true);

    core.info(`Evaluating PR #${pullNumber} in ${owner}/${repo}`);

    const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });

    const diffText = files
      .map((file) => file.patch)
      .filter(Boolean)
      .join('\n');

    const bodyText = `${pullRequest.title || ''}\n${pullRequest.body || ''}`;
    const author = pullRequest.user.login;
    let authorIsNewbie = false;
    const newbieThreshold = Number.parseInt(core.getInput('new-contributor-threshold') || '5', 10) || 5;

    if (enableNewContributor) {
      try {
        const { data: user } = await octokit.rest.users.getByUsername({ username: author });
        authorIsNewbie = (user.public_repos || 0) < newbieThreshold;
      } catch (error) {
        core.warning(`Unable to look up author profile for '${author}': ${error.message}`);
        authorIsNewbie = false;
      }
    }

    const { score, matchedRules } = evaluateRules({
      files,
      diffText,
      bodyText,
      authorIsNewbie,
      customRegex,
      options: {
        enableReadmeOnly,
        enableContributorRegex,
        enableGenericBody,
        enableNewContributor,
        enableCustomRegex,
      },
    });

    core.info(`Rule new-contributor (<${newbieThreshold} public repos): ${authorIsNewbie}`);
    core.info(`Spam score: ${score} (threshold: ${minScore})`);

    if (score >= minScore) {
      const labelReady = await ensureLabel(octokit, owner, repo, labelName);

      if (labelReady) {
        await withPermissionWarning(
          () =>
            octokit.rest.issues.addLabels({
              owner,
              repo,
              issue_number: pullNumber,
              labels: [labelName],
            }),
          'add labels to pull requests',
        );
      }

      await withPermissionWarning(
        () =>
          octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: pullNumber,
            body: commentMessage,
          }),
        'post review comments on pull requests',
      );

      if (closeSpam) {
        const closed = await withPermissionWarning(
          () =>
            octokit.rest.pulls.update({
              owner,
              repo,
              pull_number: pullNumber,
              state: 'closed',
            }),
          'close pull requests automatically',
        );

        if (closed) {
          core.info('PR closed due to spam threshold.');
        }
      }

      core.setOutput('flagged', 'true');
    } else {
      core.info('PR not flagged.');
      core.setOutput('flagged', 'false');
    }

    core.setOutput('score', String(score));
    core.setOutput('matched-rules', matchedRules.join(','));
  } catch (error) {
    core.error(`Action failed: ${error.message}`);
    core.setOutput('flagged', 'false');
    core.setOutput('score', '0');
    core.setOutput('matched-rules', '');
    core.setFailed(error.message);
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  parseBoolean,
  buildRegex,
  ensureLabel,
  withPermissionWarning,
  evaluateRules,
  run,
};
