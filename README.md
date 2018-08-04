# Sourcegraph package creator

[![npm](https://img.shields.io/npm/v/@sourcegraph/create.svg)](https://www.npmjs.com/package/@sourcegraph/create)
[![downloads](https://img.shields.io/npm/dt/@sourcegraph/create.svg)](https://www.npmjs.com/package/@sourcegraph/create)
[![build](https://travis-ci.org/sourcegraph/create.svg?branch=master)](https://travis-ci.org/sourcegraph/create)
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
