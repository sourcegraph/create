# Sourcegraph package creator

[![build](https://badge.buildkite.com/da1855cc6c9b02ddfa1df69599aacecd1317db8f6765edfa8b.svg?branch=master)](https://buildkite.com/sourcegraph/codeintellify)
[![codecov](https://codecov.io/gh/sourcegraph/codeintellify/branch/master/graph/badge.svg?token=1Xk7sdvG0y)](https://codecov.io/gh/sourcegraph/codeintellify)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

CLI tool to interactively create a repo for a `@sourcegraph` npm package, add all the needed boilerplate and set up CI.

It's idempotent, so you can run it on half-initialized repositories too and it will skip steps already done.

## Use it

```
mkdir my-new-package
cd my-new-package
npm init @sourcegraph
```
