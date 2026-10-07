# Gitleaks runtime binary

The runtime image builds Gitleaks v8.30.1 from upstream commit
`83d9cd684c87d95d656c1458ef04895a7f1cbd8e`. The build downloads the official
Go 1.26.8 Linux amd64 archive and verifies SHA-256
`d0f743b33e8d8945e6b1f432edd15785c70507121d6e2a723b21285eddf8b57b` before
using it. The compiler and source checkout stay in the build stage; only the
stripped CGO-disabled Linux amd64 executable is copied into the final image.

The owned `go.mod` and `go.sum` pin patched transitive dependencies:

- `golang.org/x/crypto` v0.57.0, `golang.org/x/sys` v0.48.0, and `golang.org/x/text` v0.42.0.
- `github.com/nwaples/rardecode/v2` v2.2.0 and `github.com/ulikunitz/xz` v0.5.15.
- `github.com/klauspost/compress` v1.18.7, which fixes GO-2026-5841 in the S2 decoder pulled in by the compatible archive reader.
- `github.com/mholt/archives` v0.1.5, the first compatible release after rardecode v2.2.0 removed `io.WriterTo` from its reader types. Versions v0.1.3 and v0.1.4 still required that interface; v0.1.5 uses `io.Reader`.

`build-gitleaks.mjs` verifies the module checksums, runs the upstream Go tests
with `-mod=readonly`, rejects a binary dependency graph containing the deprecated
`golang.org/x/crypto/openpgp` package, then compiles with `-trimpath -s -w`.
The audited binary was built with CGO disabled, passed the complete upstream Go
test suite, and detected the three expected findings in Gitleaks' harmless
`testdata/repos/nogit` scanner fixture.
