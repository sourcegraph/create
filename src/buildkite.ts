import got, { Got, HTTPError } from 'got'
import * as yaml from 'js-yaml'
import { exists, writeFile } from 'mz/fs'
import { GitHubClient } from './github'

export type BuildkiteClient = Got

export const createBuildkiteClient = ({ token }: { token: string }): BuildkiteClient =>
    got.extend({
        prefixUrl: 'https://api.buildkite.com/v2/',
        headers: {
            Authorization: 'Bearer ' + token,
        },
    })

interface BuildkitePipeline {
    provider: { webhook_url: string }
    badge_url: string
    web_url: string
}

export async function initBuildkite({
    hasTests,
    repoName,
    codecovUploadToken,
    githubClient,
    buildkiteClient,
}: {
    hasTests: boolean
    repoName: string
    codecovUploadToken: string
    githubClient: GitHubClient
    buildkiteClient: BuildkiteClient
}): Promise<{ badgeUrl: string; webUrl: string }> {
    console.log('⚙️ Setting up Buildkite CI')
    if (await exists('buildkite.yml')) {
        console.log('buildkite.yml already exists')
    } else {
        const buildkiteYaml = {
            env: {
                FORCE_COLOR: 3,
            },
            steps: [
                {
                    label: ':typescript:',
                    command: [
                        'npm ci',
                        'npm run prettier',
                        'npm run eslint',
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
            CODECOV_TOKEN: codecovUploadToken,
        },
    }

    let pipeline: BuildkitePipeline
    try {
        pipeline = await buildkiteClient.post<BuildkitePipeline>('organizations/sourcegraph/pipelines', {
            json: buildkitePipeline,
            responseType: 'json',
            resolveBodyOnly: true,
        })
    } catch (error) {
        if (
            error instanceof HTTPError &&
            (error.response.body as any)?.errors?.some?.(
                (error_: any) => error_?.field === 'name' && error_?.code === 'already_exists'
            )
        ) {
            console.log(`Buildkite pipeline "${repoName}" already exists, skipping creation`)
            pipeline = await buildkiteClient.get<BuildkitePipeline>(`organizations/sourcegraph/pipelines/${repoName}`, {
                responseType: 'json',
                resolveBodyOnly: true,
            })
        } else {
            throw error
        }
    }

    console.log('🔗 Creating GitHub webhook for pipeline')
    try {
        await githubClient.post(`/repos/sourcegraph/${repoName}/hooks`, {
            json: {
                name: 'web',
                events: ['push', 'pull_request', 'deployment'],
                config: {
                    url: pipeline.provider.webhook_url,
                    content_type: 'json',
                },
            },
        })
    } catch (error) {
        if (
            error instanceof HTTPError &&
            (error.response.body as any)?.errors?.some?.(
                (error_: any) => typeof error_?.message === 'string' && /hook already exists/i.test(error_.message)
            )
        ) {
            console.log('Webhook already exists')
        } else {
            throw error
        }
    }

    console.log('🔐 Granting Buildkite team pull access to repo')
    // buildkite team, see https://api.github.com/orgs/sourcegraph/teams
    await githubClient.put(`/teams/2444623/repos/sourcegraph/${repoName}`, {
        json: {
            permission: 'pull',
        },
    })

    return { badgeUrl: pipeline.badge_url, webUrl: pipeline.web_url }
}
