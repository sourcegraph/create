#!/usr/bin/env node

import chalk from 'chalk'
import exec from 'execa'
import { exists, mkdir, readFile, writeFile } from 'mz/fs'
import * as path from 'path'
import { createBuildkiteClient, initBuildkite } from './buildkite'
import { CodecovRepo, createCodecovClient, getCodecovBadge } from './codecov'
import { createGitHubClient } from './github'
import { JsonSchemaForNpmPackageJsonFiles } from './package-schema'
import * as prompt from './prompt'
import { JsonSchemaForRenovateConfigFilesHttpsRenovatebotCom } from './renovate-schema'
import { initGitHubWorkflow } from './github-workflow'
import { JsonSchemaForTheTypeScriptCompilersConfigurationFile } from './tsconfig-schema'
import { JSONSchemaForESLintConfigurationFiles } from './eslintrc-schema'
import mkdirp from 'mkdirp-promise'
import { HTTPError } from 'got'

const createCLIError = (message: string): Error => Object.assign(new Error(message), { showStack: false })

async function main(): Promise<void> {
    if (!process.env.GITHUB_TOKEN) {
        throw createCLIError('No GITHUB_TOKEN env var set. Create one at https://github.com/settings/tokens')
    }
    console.log('Using GITHUB_TOKEN from env var')
    const githubClient = createGitHubClient({ token: process.env.GITHUB_TOKEN })

    if (!process.env.CODECOV_TOKEN) {
        throw createCLIError(
            `No CODECOV_TOKEN env var set. Create one at https://codecov.io/account/gh/${chalk.bold('USERNAME')}/access`
        )
    }
    console.log('Using CODECOV_TOKEN from env var')
    const codecovClient = createCodecovClient({ token: process.env.CODECOV_TOKEN })

    if (!process.env.BUILDKITE_TOKEN) {
        throw createCLIError(
            'No BUILDKITE_TOKEN env var set. Create one at https://buildkite.com/user/api-access-tokens/new'
        )
    }
    console.log('Using BUILDKITE_TOKEN from env var')
    const buildkiteClient = createBuildkiteClient({ token: process.env.BUILDKITE_TOKEN })

    console.log('*️⃣ Welcome to the Sourcegraph npm package initializer')

    if (!(await exists('.git'))) {
        console.log('📘 .git directory not found, initializing git repository')
        await exec('git', ['init'])
    }

    let packageName: string | undefined
    let description: string | undefined
    try {
        ;({ name: packageName, description } = JSON.parse(await readFile('package.json', 'utf-8')))
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error
        }
    }
    if (packageName) {
        console.log(`Package name is "${packageName}"`)
    } else {
        packageName = await prompt.input({
            message:
                'What should the name of the package be? Examples: @sourcegraph/codeintellify, @sourcegraph/react-loading-spinner, cxp',
            default: '@sourcegraph/' + path.basename(process.cwd()),
        })
    }
    if (description) {
        console.log(`Description is "${description}"`)
    } else {
        description = await prompt.input('Description')
    }

    enum Visibility {
        Public = 'Public',
        Private = 'Private',
    }
    const visibility = await prompt.choices({
        message: '🔐 Should this package be public or private?',
        choices: [Visibility.Public, Visibility.Private],
    })

    let repoName = packageName.replace(/^@sourcegraph\//, '')
    if (!(await exec('git', ['remote'])).stdout) {
        repoName = await prompt.input({ message: 'Repository name', default: repoName })
        try {
            await githubClient.post('orgs/sourcegraph/repos', {
                json: {
                    name: repoName,
                    private: visibility === Visibility.Private,
                    description,
                    has_wiki: false,
                    has_projects: false,
                    allow_merge_commit: false,
                },
            })
            console.log(`📘 Created https://github.com/sourcegraph/${repoName}`)
        } catch (error) {
            if (
                error instanceof HTTPError &&
                (error.response.body as any)?.errors?.some?.(
                    (error_: any) =>
                        error_?.resource === 'Repository' &&
                        error_?.field === 'name' &&
                        typeof error_?.message === 'string' &&
                        /already exists/i.test(error_.message)
                )
            ) {
                console.log(
                    `📘 Repository already exists at https://github.com/sourcegraph/${repoName}, skipping creation`
                )
            } else {
                throw error
            }
        }
        await exec('git', ['remote', 'add', 'origin', `https://github.com/sourcegraph/${repoName}.git`])
    } else {
        console.log('📘 Existing git remote detected, skipping GitHub repository creation')
    }
    console.log('🔑 Giving admin access to all team members')
    // This is the GitHub team in the "sourcegraph" org named "Everyone"; see
    // https://api.github.com/orgs/sourcegraph/teams.
    await githubClient.put(`teams/626894/repos/sourcegraph/${repoName}`, {
        json: {
            permission: 'admin',
        },
    })

    enum LicenseName {
        Unlicensed = 'UNLICENSED',
        Apache2 = 'Apache-2.0',
    }
    const licenseName = await prompt.choices({
        message: 'License?',
        choices: [LicenseName.Unlicensed, LicenseName.Apache2],
        default: { [Visibility.Private]: LicenseName.Unlicensed, [Visibility.Public]: LicenseName.Apache2 }[visibility],
    })
    if (licenseName !== 'UNLICENSED') {
        console.log('📄 Adding LICENSE')
        const license = await githubClient.get<{ body: string }>(`licenses/${licenseName}`, {
            responseType: 'json',
            resolveBodyOnly: true,
        })
        const licenseText = license.body
            .replace(/\[year]/g, new Date().getFullYear().toString())
            .replace(/\[fullname]/g, 'Sourcegraph')
        await writeFile('LICENSE', licenseText)
    }

    const hasTests = await prompt.confirm('Does this package have tests?')

    if (await exists('tsconfig.json')) {
        console.log('📄 tsconfig.json already exists, skipping creation')
    } else {
        const willRunInNode = await prompt.confirm(
            'Will this package be used in NodeJS, or only in the browser? If the package runs only in the browser, TypeScript will be configured to output ES6 modules.'
        )
        const tsconfigJson: JsonSchemaForTheTypeScriptCompilersConfigurationFile = {
            extends: '@sourcegraph/tsconfig',
            compilerOptions: {
                target: 'es2018',
                module: willRunInNode ? 'commonjs' : 'esnext',
                moduleResolution: 'node',
                sourceMap: true,
                declaration: true,
                declarationMap: true,
                inlineSources: true,
                outDir: 'dist',
                rootDir: 'src',
                esModuleInterop: true,
                allowSyntheticDefaultImports: true,
            },
        }
        console.log('📄 Adding tsconfig.json')
        await writeFile('tsconfig.json', JSON.stringify(tsconfigJson, null, 2))
    }

    if (await exists('.eslintrc.json')) {
        console.log('📄 .eslintrc.json already exists, skipping creation')
    } else {
        console.log('📄 Adding .eslintrc.json')
        const eslintJson: JSONSchemaForESLintConfigurationFiles = {
            extends: ['@sourcegraph/eslint-config'],
            parserOptions: {
                project: 'tsconfig.json',
            },
        }
        await writeFile('.eslintrc.json', JSON.stringify(eslintJson, null, 2))
    }

    if (await exists('.vscode/settings.json')) {
        console.log('📄 .vscode/settings.json already exists, skipping creation')
    } else {
        console.log('📄 Adding .vscode/settings.json')
        const vscodeSettings = {
            'editor.formatOnSave': true,
            'typescript.format.semicolons': 'remove',
            'eslint.validate': ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'],
            'editor.codeActionsOnSave': {
                'source.fixAll.eslint': true,
            },
        }
        await mkdirp('.vscode')
        await writeFile('.vscode/settings.json', JSON.stringify(vscodeSettings, null, 2))
    }

    console.log('📄 Adding .editorconfig')
    await writeFile(
        '.editorconfig',
        [
            '[*]',
            'insert_final_newline = true',
            'end_of_line = lf',
            'charset = utf-8',
            'trim_trailing_whitespace = true',
            'indent_style = space',
            'indent_size = 4',
            '',
            '[*.{json,js,yml}]',
            'indent_size = 2',
            '',
            '[*.md]',
            'trim_trailing_whitespace = false',
        ].join('\n')
    )

    console.log('📄 Adding prettier.config.js')
    await writeFile('prettier.config.js', "module.exports = require('@sourcegraph/prettierrc')\n")

    console.log('📄 Adding .prettierignore')
    await writeFile(
        '.prettierignore',
        ['package.json', 'package-lock.json', 'dist/', ...(hasTests ? ['.nyc_output/', 'coverage/'] : []), ''].join(
            '\n'
        )
    )

    console.log('📄 Adding .gitignore')
    await writeFile(
        '.gitignore',
        ['dist/', 'node_modules/', ...(hasTests ? ['coverage/', '.nyc_output/'] : []), ''].join('\n')
    )

    console.log('📄 Adding renovate.json')
    const renovateJson: JsonSchemaForRenovateConfigFilesHttpsRenovatebotCom = {
        extends: ['github>sourcegraph/renovate-config'],
        semanticCommits: true,
    }
    await writeFile('renovate.json', JSON.stringify(renovateJson, null, 2))

    let packageJson: JsonSchemaForNpmPackageJsonFiles
    try {
        packageJson = JSON.parse(await readFile('package.json', 'utf-8'))
        console.log('📄 package.json already exists, skipping creation')
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error
        }
        console.log('📄 Adding package.json')
        packageJson = {
            name: packageName,
            description,
            version: '0.0.0-DEVELOPMENT',
            license: licenseName,
            repository: {
                type: 'git',
                url: `https://github.com/sourcegraph/${repoName}.git`,
            },
            files: ['dist'],
            main: 'dist/index.js',
            types: 'dist/index.d.ts',
            scripts: {
                ...(hasTests ? { test: 'nyc mocha' } : {}),
                'semantic-release': 'semantic-release',
                prettier: "prettier '**/*.{js?(on),ts?(x),scss,md,yml}' --write --list-different",
                'prettier-check': 'npm run prettier -- --write=false',
                eslint: "eslint './src/*.ts?(x)' './*.ts?(x)'",
                build: 'tsc -p .',
                watch: 'tsc -p . -w',
            },
            commitlint: {
                extends: ['@commitlint/config-conventional'],
            },
            husky: {
                hooks: {
                    'commit-msg': 'commitlint -e $HUSKY_GIT_PARAMS',
                },
            },
            ...(hasTests
                ? {
                      nyc: {
                          include: ['src/**/*.ts?(x)'],
                          exclude: ['**/*.test.ts?(x)'],
                          extension: ['.tsx', '.ts'],
                      },
                      mocha: {
                          require: 'ts-node/register',
                          spec: 'src/**/*.test.ts',
                      },
                  }
                : {}),
        }
        await writeFile('package.json', JSON.stringify(packageJson, null, 2))
    }

    try {
        console.log('📂 Creating src directory')
        await mkdir('src')
    } catch (error) {
        if (error.code !== 'EEXIST') {
            throw error
        }
    }

    console.log('📦 Installing dependencies')
    const dependencyNames = [
        'prettier',
        'typescript',
        'eslint',
        'husky',
        'semantic-release',
        '@commitlint/cli',
        '@commitlint/config-conventional',
        '@sourcegraph/eslint-config',
        '@sourcegraph/tsconfig',
        '@sourcegraph/prettierrc',
        ...(hasTests ? ['mocha', 'nyc', 'ts-node', '@types/mocha', '@types/node'] : []),
    ]
    const existingDependencyNames = new Set(Object.keys(packageJson.devDependencies ?? {}))
    // Skip adding dependencies if already added for perf
    if (dependencyNames.some(depName => !existingDependencyNames.has(depName))) {
        await exec('yarn', ['add', '--dev', ...dependencyNames], { stdio: 'inherit' })
    } else {
        await exec('yarn', { stdio: 'inherit' })
    }

    console.log('🔑 Fetching Codecov repository tokens')
    const codecovRepo = await codecovClient.get<{ repo: CodecovRepo }>(`gh/sourcegraph/${repoName}`, {
        responseType: 'json',
        resolveBodyOnly: true,
    })
    if (!codecovRepo.repo || !codecovRepo.repo.upload_token) {
        throw Object.assign(
            new Error(`No Codecov upload token returned by Codecov for https://codecov.io/gh/sourcegraph/${repoName}`),
            { codecovRepo }
        )
    }
    const codecovUploadToken = codecovRepo.repo.upload_token
    if (!codecovRepo.repo.image_token) {
        throw Object.assign(
            new Error(
                `No Codecov graphing image token returned by Codecov for https://codecov.io/gh/sourcegraph/${repoName}`
            ),
            { codecovRepo }
        )
    }
    const codecovImageToken = codecovRepo.repo.image_token

    let buildBadge: string
    if (visibility === Visibility.Private) {
        const { badgeUrl, webUrl } = await initBuildkite({
            hasTests,
            repoName,
            codecovUploadToken,
            githubClient,
            buildkiteClient,
        })
        buildBadge = `[![build](${badgeUrl}?branch=master)](${webUrl})`
    } else {
        await initGitHubWorkflow({ repoName, hasTests, githubClient })
        buildBadge = `[![build](https://img.shields.io/github/workflow/status/sourcegraph/${repoName}/build/master)](https://github.com/sourcegraph/${repoName}/actions?query=branch%3Amaster+workflow%3Abuild)`
    }

    if (await exists('README.md')) {
        console.log('📄 README.md already exists, skipping creation.')
    } else {
        console.log('📄 Adding README')
        const readme = [
            `# ${packageName}`,
            '',
            ...(visibility === Visibility.Public
                ? [
                      `[![npm](https://img.shields.io/npm/v/${packageName}.svg)](https://www.npmjs.com/package/${packageName})`,
                      `[![downloads](https://img.shields.io/npm/dt/${packageName}.svg)](https://www.npmjs.com/package/${packageName})`,
                  ]
                : []),
            buildBadge,
            ...(hasTests ? [getCodecovBadge({ repoName, codecovImageToken })] : []),
            '[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)',
            '[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)',
            '',
            description,
            '',
            '## Install',
            '```',
            `npm install ${packageName}`,
            '# or',
            `yarn add ${packageName}`,
            '```',
            '',
            '## Build',
            '```',
            'yarn',
            'yarn build',
            '```',
            '',
            ...(hasTests ? ['## Test', '```', 'yarn test', '```'] : []),
            '',
            '## Release',
            'Releases are done automatically in CI when commits are merged into master by analyzing [Conventional Commit Messages](https://conventionalcommits.org/).',
            'After running `yarn`, commit messages will be linted automatically when committing though a git hook.',
            "The git hook can be circumvented for fixup commits with [git's `fixup!` autosquash feature](https://fle.github.io/git-tip-keep-your-branch-clean-with-fixup-and-autosquash.html), or by passing `--no-verify` to `git commit`.",
            'You may have to rebase a branch before merging to ensure it has a proper commit history, or squash merge with a manually edited commit message that conforms to the convention.',
        ].join('\n')
        await writeFile('README.md', readme)
    }

    console.log('💄 Prettifying')
    await exec('node_modules/.bin/prettier', ['**/*.{js?(on),ts?(x),md,yml}', '--write'])
    console.log('✨ Done')

    setTimeout(() => process.exit(0), 100)
}

main().catch(error => {
    if (error.showStack === false) {
        console.error('\n' + chalk.red(error.message) + '\n')
    } else {
        console.error(error)
    }
    setTimeout(() => process.exit(1), 100)
})
