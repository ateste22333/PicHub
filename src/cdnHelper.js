/**
 * CDN URL generation helpers for GitHub-hosted files.
 * Supports multiple CDN providers: jsDelivr, Statically, ChinaJsDelivr.
 */

/** Available CDN providers and their URL templates */
export const CDN_PROVIDERS = {
  jsDelivr: {
    label: 'jsDelivr',
    urlTemplate: (owner, repo, branch, path) =>
      `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`,
  },
  Statically: {
    label: 'Statically',
    urlTemplate: (owner, repo, branch, path) =>
      `https://cdn.statically.io/gh/${owner}/${repo}/${branch}/${path}`,
  },
  ChinaJsDelivr: {
    label: 'ChinaJsDelivr',
    urlTemplate: (owner, repo, branch, path) =>
      `https://jsd.cdn.zzko.cn/gh/${owner}/${repo}@${branch}/${path}`,
  },
};

/**
 * Normalizes a file path for use in CDN URLs.
 * Converts Windows backslashes to forward slashes, removes leading slashes,
 * and encodes each path segment.
 *
 * @param {string} filePath
 * @returns {string}
 */
function normalizePath(filePath) {
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return normalizedPath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

/**
 * Generates a CDN acceleration URL for a file in a GitHub repository
 * using the specified CDN provider.
 *
 * @param {Object} options
 * @param {string} options.owner - GitHub Owner / Username
 * @param {string} options.repo - GitHub Repository
 * @param {string} [options.branch='main'] - Branch name
 * @param {string} options.filePath - Path inside repository
 * @param {string} [options.cdnProvider='jsDelivr'] - CDN provider key
 * @param {string} [options.customCdnTemplate] - Custom URL template (used when cdnProvider is 'Custom')
 * @returns {string} CDN URL
 */
export function getCdnUrl({ owner, repo, branch = 'main', filePath, cdnProvider = 'jsDelivr', customCdnTemplate = '' }) {
  const encodedPath = normalizePath(filePath);

  // Custom CDN template: replace {owner}, {repo}, {branch}, {path} placeholders
  if (cdnProvider === 'Custom' && customCdnTemplate) {
    return customCdnTemplate
      .replace(/\{owner\}/g, owner)
      .replace(/\{repo\}/g, repo)
      .replace(/\{branch\}/g, branch)
      .replace(/\{path\}/g, encodedPath);
  }

  const provider = CDN_PROVIDERS[cdnProvider] || CDN_PROVIDERS.jsDelivr;
  return provider.urlTemplate(owner, repo, branch, encodedPath);
}

/**
 * Generates jsDelivr CDN acceleration URL (backward-compatible wrapper).
 *
 * @param {Object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {string} [options.branch='main']
 * @param {string} options.filePath
 * @returns {string} CDN URL
 */
export function getJsDelivrUrl({ owner, repo, branch = 'main', filePath }) {
  return getCdnUrl({ owner, repo, branch, filePath, cdnProvider: 'jsDelivr' });
}

/**
 * Generates raw GitHub user content URL (as reference fallback).
 *
 * @param {Object} options
 * @returns {string} Raw GitHub URL
 */
export function getRawGithubUrl({ owner, repo, branch = 'main', filePath }) {
  const encodedPath = normalizePath(filePath);
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodedPath}`;
}
