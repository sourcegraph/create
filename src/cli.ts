#!/usr/bin/env node
import 'source-map-support/register'

import chalk from 'chalk'
import exec = require('execa')
import { prompt } from 'inquirer'
import { exists, mkdir, readFile, writeFile } from 'mz/fs'
import * as path from 'path'
import { createBuildkiteClient, initBuildkite } from './buildkite'
import { CodeCovRepo, createCodeCovClient, getCodeCovBadge } from './codecov'
import { createGitHubClient } from './github'
import { JsonSchemaForNpmPackageJsonFiles } from './package-schema'
import { createTravisClient, initTravis } from './travis'
import { JsonSchemaForTheTypeScriptCompilersConfigurationFile } from './tsconfig-schema'
import { JsonSchemaForTheTsLintConfigurationFiles } from './tslint-schema'

const createCLIError = (message: string) => {
    throw Object.assign(new Error(message), { showStack: false })
}

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
    const codeCovClient = createCodeCovClient({ token: process.env.CODECOV_TOKEN })

    if (!process.env.BUILDKITE_TOKEN) {
        throw createCLIError(
            'No BUILDKITE_TOKEN env var set. Create one at https://buildkite.com/user/api-access-tokens/new'
        )
    }
    console.log('Using BUILDKITE_TOKEN from env var')
    const buildkiteClient = createBuildkiteClient({ token: process.env.BUILDKITE_TOKEN })

    if (!process.env.TRAVIS_TOKEN) {
        throw createCLIError(
            [
                'No TRAVIS_TOKEN env var set.',
                'Copy it from https://travis-ci.org/profile or create one with the Travis CLI by running',
                '',
                '    travis login --github-token $GITHUB_TOKEN',
                '    travis token',
            ].join('\n')
        )
    }
    const travisClient = createTravisClient({ token: process.env.TRAVIS_TOKEN })

    console.log('*️⃣ Welcome to the Sourcegraph npm package initializer')

    if (!(await exists('.git'))) {
        console.log('📘 .git directory not found, initilizing git repository')
        await exec('git', ['init'])
    }

    let packageName: string | undefined
    let description: string | undefined
    try {
        ;({ packageName, description } = JSON.parse(await readFile('package.json', 'utf-8')))
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err
        }
    }
    if (packageName) {
        console.log(`Package name is "${packageName}"`)
    } else {
        ;({ packageName } = await prompt<{ packageName: string }>({
            name: 'packageName',
            message:
                'What should the name of the package be? Examples: @sourcegraph/codeintellify, @sourcegraph/react-loading-spinner, cxp',
            default: '@sourcegraph/' + path.basename(process.cwd()),
        }))
    }
    if (description) {
        console.log(`Description is "${description}"`)
    } else {
        ;({ description } = await prompt<{ description: string }>({
            name: 'description',
            message: 'Description',
        }))
    }

    const { visibility } = await prompt<{ visibility: 'public' | 'private' }>({
        type: 'list',
        name: 'visibility',
        message: '🔐 Should this package be public or private?',
        choices: ['public', 'private'],
    })

    let repoName = packageName.replace(/^@sourcegraph\//, '')
    if (!(await exec('git', ['remote'])).stdout) {
        ;({ repoName } = await prompt<{ repoName: string }>({
            name: 'repoName',
            message: 'Repository name',
            default: repoName,
        }))
        try {
            await githubClient.post(`orgs/sourcegraph/repos`, {
                body: {
                    name: repoName,
                    private: visibility === 'private',
                    description,
                    has_wiki: false,
                    has_projects: false,
                    allow_merge_commit: false,
                },
            })
            console.log(`📘 Created https://github.com/sourcegraph/${repoName}`)
        } catch (err) {
            if (
                err.error &&
                Array.isArray(err.error.errors) &&
                err.error.errors.some(
                    (err: any) =>
                        err.resource === 'Repository' && err.field === 'name' && /already exists/i.test(err.message)
                )
            ) {
                console.log(
                    `📘 Repository already exists at https://github.com/sourcegraph/${repoName}, skipping creation`
                )
            } else {
                throw err
            }
        }
        await exec('git', ['remote', 'add', 'origin', `git@github.com:sourcegraph/${repoName}.git`])
    } else {
        console.log('📘 Existing git remote detected, skipping GitHub repository creation')
    }
    console.log('🔑 Giving all FTTs admin access')
    // FTTs, see https://api.github.com/orgs/sourcegraph/teams
    await githubClient.put(`/teams/626894/repos/sourcegraph/${repoName}`, {
        body: {
            permission: 'admin',
        },
    })

    const { licenseName } = await prompt<{ licenseName: string }>({
        message: 'License?',
        choices: ['UNLICENSED', 'MIT'],
        default: { private: 'UNLICENSED', public: 'MIT' }[visibility],
        name: 'licenseName',
    })
    if (licenseName !== 'UNLICENSED') {
        console.log('📄 Adding LICENSE')
        const license = (await githubClient.get(`licenses/${licenseName}`)).body
        const licenseText = license.body
            .replace(/\[year\]/g, new Date().getFullYear())
            .replace(/\[fullname\]/g, 'Sourcegraph')
        await writeFile('LICENSE', licenseText)
    }

    const { hasTests } = await prompt<{ hasTests: boolean }>({
        type: 'confirm',
        message: 'Does this package have tests?',
        name: 'hasTests',
    })

    if (await exists('tsconfig.json')) {
        console.log('📄 tsconfig.json already exists, skipping creation')
    } else {
        const tsconfigJson: JsonSchemaForTheTypeScriptCompilersConfigurationFile = {
            extends: './node_modules/@sourcegraph/tsconfig/tsconfig.json',
            compilerOptions: {
                target: 'es2016',
                module: 'esnext',
                sourceMap: true,
                declaration: true,
                outDir: 'dist',
                rootDir: 'src',
                esModuleInterop: true,
                allowSyntheticDefaultImports: true,
            },
        }
        console.log('📄 Adding tsconfig.json')
        await writeFile('tsconfig.json', JSON.stringify(tsconfigJson, null, 2))
    }

    if (await exists('tslint.json')) {
        console.log('📄 tslint.json already exists, skipping creation')
    } else {
        console.log('📄 Adding tslint.json')
        const tslintJson: JsonSchemaForTheTsLintConfigurationFiles = {
            extends: ['@sourcegraph/tslint-config'],
        }
        await writeFile('tslint.json', JSON.stringify(tslintJson, null, 2))
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
    await writeFile('.prettierignore', ['package.json', 'package-lock.json', 'dist/', ''].join('\n'))

    console.log('📄 Adding .gitignore')
    await writeFile('.gitignore', ['dist/', 'node_modules/', ...(hasTests ? ['coverage/'] : []), ''].join('\n'))

    if (await exists('package.json')) {
        console.log('📄 package.json already exists, skipping creation')
    } else {
        console.log('📄 Adding package.json')
        const packageJson: JsonSchemaForNpmPackageJsonFiles = {
            name: packageName,
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
                ...(hasTests ? { test: 'mocha --require ts-node/register "src/**/*.test.ts"' } : {}),
                commitmsg: 'commitlint -e $GIT_PARAMS',
                'semantic-release': 'semantic-release',
                prettier: "prettier '**/{*.{js?(on),ts?(x),scss},.*.js?(on)}' --write --list-different",
                tslint: "tslint -c tslint.json -p tsconfig.json './src/*.ts?(x)' './*.ts?(x)'",
                build: 'tsc -p .',
                watch: 'tsc -p . -w',
            },
            commitlint: {
                extends: ['@commitlint/config-conventional'],
            },
            ...(hasTests
                ? {
                      nyc: {
                          include: ['src/**/*.ts?(x)'],
                          exclude: ['**/*.test.ts?(x)'],
                          extension: ['.tsx', '.ts'],
                      },
                  }
                : {}),
        }
        await writeFile('package.json', JSON.stringify(packageJson, null, 2))
    }

    try {
        console.log('📂 Creating src directory')
        await mkdir('src')
    } catch (err) {
        if (err.code !== 'EEXIST') {
            throw err
        }
    }

    console.log('📦 Installing dependencies')
    await exec(
        'npm',
        [
            'install',
            '--save-dev',
            'prettier',
            'typescript',
            'tslint',
            'husky',
            'semantic-release',
            '@commitlint/cli',
            '@commitlint/config-conventional',
            '@sourcegraph/tslint-config',
            '@sourcegraph/tsconfig',
            '@sourcegraph/prettierrc',
            ...(hasTests ? ['mocha', 'nyc'] : []),
        ],
        { stdio: 'inherit' }
    )

    console.log('🔑 Fetching CodeCov repository tokens')
    const codeCovRepo: { repo: CodeCovRepo } = (await codeCovClient.get(`gh/sourcegraph/${repoName}`)).body
    if (!codeCovRepo.repo || !codeCovRepo.repo.upload_token) {
        throw Object.assign(
            new Error(`No CodeCov upload token returned by CodeCov for https://codecov.io/gh/sourcegraph/${repoName}`),
            { codeCovRepo }
        )
    }
    const codeCovUploadToken = codeCovRepo.repo.upload_token
    if (!codeCovRepo.repo.image_token) {
        throw Object.assign(
            new Error(
                `No CodeCov graphing image token returned by CodeCov for https://codecov.io/gh/sourcegraph/${repoName}`
            ),
            { codeCovRepo }
        )
    }
    const codeCovImageToken = codeCovRepo.repo.image_token

    let buildBadge: string
    if (visibility === 'private') {
        const { badgeUrl, webUrl } = await initBuildkite({
            hasTests,
            repoName,
            codeCovUploadToken,
            githubClient,
            buildkiteClient,
        })
        buildBadge = `[![build](${badgeUrl}?branch=master)](${webUrl})`
    } else {
        await initTravis({ repoName, hasTests, travisClient, githubClient })
        buildBadge = `[![build](https://travis-ci.org/sourcegraph/${repoName}.svg?branch=master)](https://travis-ci.org/sourcegraph/${repoName})`
    }

    if (await exists('README.md')) {
        console.log('📄 README.md already exists, skipping creation.')
    } else {
        console.log('📄 Adding README')
        const readme = [
            `# ${packageName}`,
            '',
            ...(visibility === 'public'
                ? [
                      `[![npm](https://img.shields.io/npm/v/${packageName}.svg)](https://www.npmjs.com/package/${packageName})`,
                      `[![downloads](https://img.shields.io/npm/dt/${packageName}.svg)](https://www.npmjs.com/package/${packageName})`,
                  ]
                : []),
            buildBadge,
            ...(hasTests ? [await getCodeCovBadge({ repoName, codeCovImageToken })] : []),
            '[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)',
            '[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)',
            '',
            description,
            '',
            '## Install',
            '```',
            `npm install ${packageName}`,
            '```',
            '',
            '## Build',
            '```',
            'npm install',
            'npm run build',
            '```',
            '',
            ...(hasTests ? ['## Test', '```', 'npm test', '```'] : []),
            '',
            '## Release',
            'Releases are done automatically in CI when commits are merged into master by analyzing [Conventional Commit Messages](https://conventionalcommits.org/).',
            'After running `npm install`, commit messages will be linted automatically when committing though a git hook.',
            "The git hook can be circumvented for fixup commits with [git's `fixup!` autosquash feature](https://fle.github.io/git-tip-keep-your-branch-clean-with-fixup-and-autosquash.html), or by passing `--no-verify` to `git commit`.",
            'You may have to rebase a branch before merging to ensure it has a proper commit history, or squash merge with a manually edited commit message that conforms to the convention.',
        ].join('\n')
        await writeFile('README.md', readme)
    }

    console.log('💄 Prettifying')
    await exec('node_modules/.bin/prettier', ['**/{*.{js?(on),ts?(x),md},.*.js?(on)}', '--write'])
    console.log('✨ Done')

    setTimeout(() => process.exit(0), 100)
}

main().catch(err => {
    if (err.showStack === false) {
        console.error('\n' + chalk.red(err.message) + '\n')
    } else {
        console.error(err)
    }
    setTimeout(() => process.exit(1), 100)
})
