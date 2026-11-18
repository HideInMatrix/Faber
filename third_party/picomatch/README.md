# Faber's hardened picomatch copy

The JavaScript and MIT license come from the upstream [picomatch 4.0.7 npm tarball](https://registry.npmjs.org/picomatch/-/picomatch-4.0.7.tgz), integrity `sha512-qcJu88Q2IWqJsDD529JKMdwGm/dvInW4HvQnRwiH9JtihJvzGOscDtHE3x1pBKeUOTysQ8kVmLnJ2kJu7yhcGA==`. The local manifest retains the upstream package name and version so npm can still report advisories for that release.

The guard in `lib/parse.js` rejects `+` and `*` extglob groups before compiling them. Ordinary filename wildcards and non-repeating extglob groups still work. Faber does not use repeated extglobs. This mitigates [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) while upstream has no published fix.

The release audit accepts that advisory only for this local copy after verifying the lockfile, installed package and guard. Other high or critical findings still fail the release. When a compatible patched upstream release is available, remove this copy, the local override and the advisory-specific verification.
