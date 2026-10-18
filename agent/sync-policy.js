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
  const videosDir = path.resolve(localStorageRoot, 'videos');

  // Skip video uploads if SYNC_VIDEOS_TO_CLOUD is set to "0" (metadata-only mode)
  if (extension === '.mp4') {
    if (process.env.SYNC_VIDEOS_TO_CLOUD === '0') {
      return false;
    }
    return isWithinDirectory(resolvedPath, videosDir)
      && /_detected\.mp4$/i.test(filename);
  }

  if (extension === '.sqlite' || extension === '.db') return true;
  return extension === '.json' && isWithinDirectory(resolvedPath, resultsDir);
}
