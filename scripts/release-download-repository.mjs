// v1.0.1 and earlier accept only the original repository path. GitHub redirects
// that alias to the renamed repository; keep update download URLs compatible.
export function releaseDownloadRepository(repository) {
  if (!/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(repository)) throw new Error('Invalid release repository')
  return repository === 'HideInMatrix/Faber' ? 'HideInMatrix/micromatrix-workbench' : repository
}
