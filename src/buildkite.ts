import * as yaml from 'js-yaml'
import { exists, writeFile } from 'mz/fs'
import _request = require('request-promise')
import { GitHubClient } from './github'
const request = _request.defaults({ resolveWithFullResponse: true })

export type BuildkiteClient = typeof request

export const createBuildkiteClient = ({ token }: { token: string }): BuildkiteClient =>
    request.defaults({
        baseUrl: 'https://api.buildkite.com/v2/',
        json: true,
        headers: {
            Authorization: 'Bearer ' + token,
        },
    })

export async function initBuildkite({
    hasTests,
    repoName,
    codeCovUploadToken,
    githubClient,
    buildkiteClient,
}: {
    hasTests: boolean
    repoName: string
    codeCovUploadToken: string
    githubClient: GitHubClient
    buildkiteClient: BuildkiteClient
}): Promise<{ badgeUrl: string; webUrl: string }> {
    console.log('⚙️ Setting up Buildkite CI')
    if (await exists('buildkite.yml')) {
        console.log('buildkite.yml already exists')
    } else {
        const buildkiteYaml = {
            env: {
                FORCE_COLOR: 1,
            },
            steps: [
                {
                    label: ':typescript:',
                    command: [
                        'npm ci',
                        'npm run prettier',
                        'npm run tslint',
                        'npm run build',
                        ...(hasTests ? ['npm test', 'bash <(curl -s https://codecov.io/bash)'] : []),
                    ].join('\n'),
                },
                'wait',
                {
                    label: ':npm:',
                    command: ['npm ci', 'npm run build', 'npm run semantic-release'],
                    branches: 'master',
                },
            ],
        }
        await writeFile('buildkite.yml', yaml.dump(buildkiteYaml))
    }

    console.log('Creating Buildkite pipeline')
    const buildkitePipeline = {
        name: repoName,
        repository: `git@github.com:sourcegraph/${repoName}.git`,
        steps: [
            {
                type: 'script',
                name: ':pipeline:',
                command: 'buildkite-agent pipeline upload buildkite.yml',
            },
        ],
        env: {
            CODECOV_TOKEN: codeCovUploadToken,
        },
    }

    let pipeline: { provider: { webhook_url: string }; badge_url: string; web_url: string }
    try {
        pipeline = (await buildkiteClient.post('organizations/sourcegraph/pipelines', {
            body: buildkitePipeline,
            json: true,
        })).body
    } catch (err) {
        if (
            err.error &&
            err.error.errors &&
            err.error.errors[0] &&
            err.error.errors[0].field === 'name' &&
            err.error.errors[0].code === 'already_exists'
        ) {
            console.log(`Buildkite pipeline "${repoName}" already exists, skipping creation`)
            pipeline = (await buildkiteClient.get(`organizations/sourcegraph/pipelines/${repoName}`)).body
        } else {
            throw err
        }
    }

    console.log('🔗 Creating GitHub webhook for pipeline')
    try {
        await githubClient.post(`/repos/sourcegraph/${repoName}/hooks`, {
            body: {
                name: 'web',
                events: ['push', 'pull_request', 'deployment'],
                config: {
                    url: pipeline.provider.webhook_url,
                    content_type: 'json',
                },
            },
        })
    } catch (err) {
        if (
            err.error &&
            Array.isArray(err.error.errors) &&
            err.error.errors.some((err: any) => /hook already exists/i.test(err.message))
        ) {
            console.log('Webhook already exists')
        } else {
            throw err
        }
    }

    console.log('🔐 Granting Buildkite team pull access to repo')
    // buildkite team, see https://api.github.com/orgs/sourcegraph/teams
    await githubClient.put(`/teams/2444623/repos/sourcegraph/${repoName}`, {
        body: {
            permission: 'pull',
        },
    })

    return { badgeUrl: pipeline.badge_url, webUrl: pipeline.web_url }
}
