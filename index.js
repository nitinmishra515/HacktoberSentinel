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

async function ensureLabel(octokit, owner, repo, labelName) {
  try {
    await octokit.rest.issues.getLabel({ owner, repo, name: labelName });
  } catch (error) {
    if (error.status === 404) {
      core.info(`Label '${labelName}' not found. Creating it.`);
      await octokit.rest.issues.createLabel({
        owner,
        repo,
        name: labelName,
        color: 'B60205',
        description: 'Flagged by HacktoberSentinel as potential spam.',
      });
    } else {
      throw error;
    }
  }
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
    const minScore = Number(core.getInput('min-score') || '2');
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
    const enableNewContributor = parseBoolean(
      core.getInput('enable-new-contributor') || 'true',
      true,
    );
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
      const contributorRegex = /\+\s*[-*]\s*\[.+?\]\(@.+?\)/;
      const addsContributor = contributorRegex.test(diffText);
      core.info(`Rule contributor-regex: ${addsContributor}`);
      if (addsContributor) {
        score += 1;
        matchedRules.push('contributor-regex');
      }
    }

    if (enableGenericBody) {
      const bodyText = `${pullRequest.title || ''}\n${pullRequest.body || ''}`;
      const genericPatterns = [
        /fixed typo/i,
        /minor (change|fix)/i,
        /added my name/i,
        /update(?:d)? readme/i,
        /test commit/i,
        /hacktoberfest/i,
      ];
      const genericBody = genericPatterns.some((regex) => regex.test(bodyText));
      core.info(`Rule generic-body: ${genericBody}`);
      if (genericBody) {
        score += 1;
        matchedRules.push('generic-body');
      }
    }

    if (enableNewContributor) {
      const author = pullRequest.user.login;
      const { data: user } = await octokit.rest.users.getByUsername({ username: author });
      const newbieThreshold = Number(core.getInput('new-contributor-threshold') || '5');
      const newbie = (user.public_repos || 0) < newbieThreshold;
      core.info(`Rule new-contributor (<${newbieThreshold} public repos): ${newbie}`);
      if (newbie) {
        score += 1;
        matchedRules.push('new-contributor');
      }
    }

    if (enableCustomRegex && customRegex) {
      const customMatched = customRegex.test(diffText) || customRegex.test(pullRequest.body || '');
      core.info(`Rule custom-regex: ${customMatched}`);
      if (customMatched) {
        score += 1;
        matchedRules.push('custom-regex');
      }
    }

    core.info(`Spam score: ${score} (threshold: ${minScore})`);

    if (score >= minScore) {
      await ensureLabel(octokit, owner, repo, labelName);
      await octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: pullNumber,
        labels: [labelName],
      });

      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pullNumber,
        body: commentMessage,
      });

      if (closeSpam) {
        await octokit.rest.pulls.update({ owner, repo, pull_number: pullNumber, state: 'closed' });
        core.info('PR closed due to spam threshold.');
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
    core.setFailed(error.message);
  }
}

run();
