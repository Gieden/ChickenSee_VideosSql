import path from 'path';

function isWithinDirectory(filePath, directory) {
  const relativePath = path.relative(directory, filePath);
  return relativePath !== ''
    && relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath);
}

export function isSyncCandidate(filePath, localStorageRoot) {
  const resolvedPath = path.resolve(filePath);
  const filename = path.basename(resolvedPath);
  const extension = path.extname(filename).toLowerCase();
  const resultsDir = path.resolve(localStorageRoot, 'results');

  if (extension === '.mp4') return false;

  if (extension === '.sqlite' || extension === '.db') return true;
  return extension === '.json' && isWithinDirectory(resolvedPath, resultsDir);
}

export function isUploadCurrent(previousUpload, stats) {
  return Boolean(
    previousUpload?.url
    && previousUpload.size === stats.size
    && previousUpload.mtime === stats.mtimeMs,
  );
}
