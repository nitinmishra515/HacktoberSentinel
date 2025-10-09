/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 599:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 219:
/***/ ((module) => {

module.exports = eval("require")("@actions/github");


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
const core = __nccwpck_require__(599);
const github = __nccwpck_require__(219);

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
    } else {
      throw error;
    }
  }

  return true;
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
    core.setFailed(error.message);
  }
}

run();

module.exports = __webpack_exports__;
/******/ })()
;