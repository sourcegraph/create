import delay from 'delay'
import got, { Got, HTTPError } from 'got'
import * as yaml from 'js-yaml'
import { exists, writeFile } from 'mz/fs'
import { createSourcegraphBotGitHubToken, GitHubClient } from './github'
import { createSourcegraphBotNpmToken } from './npm'
import { JsonSchemaForTravisCiConfigurationFiles } from './travis-schema'

export type TravisClient = Got

export const createTravisClient = ({ token }: { token: string }): TravisClient =>
    got.extend({
        prefixUrl: 'https://api.travis-ci.org/',
        headers: {
            Authorization: 'token ' + token,
            'Travis-API-Version': '3',
        },
    })

const createTravisEnvVar = async ({
    repoName,
    name,
    value,
    branch,
    travisClient,
}: {
    repoName: string
    name: string
    value: string
    branch?: string
    travisClient: TravisClient
}): Promise<void> => {
    await travisClient.post(`repo/github/sourcegraph%2F${repoName}/env_vars`, {
        json: {
            'env_var.name': name,
            'env_var.value': value,
            'env_var.public': false,
            'env_var.branch': branch,
        },
    })
}

interface TravisUser {
    id: number
    login: string
    name: string
    github_id: number
    avatar_url: string
    education: boolean
    is_syncing: boolean
    synced_at: string
}

interface TravisEnvVarsResult {
    env_vars: {
        name: string
    }[]
}

const getCurrentTravisUser = async ({ travisClient }: { travisClient: TravisClient }): Promise<TravisUser> =>
    travisClient.get<TravisUser>('user', { responseType: 'json', resolveBodyOnly: true })

export async function initTravis({
    hasTests,
    repoName,
    travisClient,
    githubClient,
}: {
    hasTests: boolean
    repoName: string
    travisClient: TravisClient
    githubClient: GitHubClient
}): Promise<void> {
    console.log('⚙️ Setting up Travis CI')
    if (await exists('.travis.yml')) {
        console.log('.travis.yml already exists, skipping')
    } else {
        const travisYaml: JsonSchemaForTravisCiConfigurationFiles = {
            language: 'node_js',
            node_js: '12',
            cache: 'yarn',
            env: {
                global: ['FORCE_COLOR=3'],
            },
            install: ['yarn'],
            jobs: {
                include: [
                    {
                        stage: 'test',
                        script: [
                            'yarn run prettier-check',
                            'yarn run eslint',
                            'yarn run build',
                            ...(hasTests
                                ? ['yarn test', 'nyc report --reporter json', 'bash <(curl -s https://codecov.io/bash)']
                                : []),
                        ],
                    },
                    {
                        stage: 'release',
                        script: ['yarn run build', 'yarn run semantic-release'],
                    },
                ],
            },
            stages: [
                'test',
                {
                    name: 'release',
                    if: 'branch = master AND type = push AND fork = false',
                },
            ],
            branches: {
                only: ['master', /^renovate\//.toString()],
            },
        }
        await writeFile('.travis.yml', yaml.dump(travisYaml))
    }

    const travisUser = await getCurrentTravisUser({ travisClient })
    console.log('Triggering Travis sync of repositories')
    await travisClient.post(`user/${travisUser.id}/sync`)
    while ((await getCurrentTravisUser({ travisClient })).is_syncing) {
        console.log('Waiting for sync to finish...')
        await delay(1000)
    }

    // Retry activating while repository is not found (404)
    while (true) {
        try {
            await delay(1000)
            console.log(`Activating repository at https://travis-ci.org/sourcegraph/${repoName}`)
            await travisClient.post(`repo/github/sourcegraph%2F${repoName}/activate`)
            break
        } catch (err) {
            console.log(err.response)
            if (!(err instanceof HTTPError) || err.response.statusCode !== 404) {
                throw err
            }
        }
    }

    const envVars = await travisClient.get<TravisEnvVarsResult>(`repo/github/sourcegraph%2F${repoName}/env_vars`, {
        responseType: 'json',
        resolveBodyOnly: true,
    })
    if (envVars.env_vars.some(envVar => envVar.name === 'NPM_TOKEN')) {
        console.log('🔑 NPM_TOKEN already set in Travis, skipping creation')
    } else {
        const npmToken = await createSourcegraphBotNpmToken()
        console.log('🔑 Setting NPM_TOKEN env var in Travis')
        await createTravisEnvVar({ repoName, name: 'NPM_TOKEN', value: npmToken, branch: 'master', travisClient })
    }

    if (envVars.env_vars.some(envVar => envVar.name === 'GITHUB_TOKEN')) {
        console.log('🔑 GITHUB_TOKEN already set in Travis, skipping creation')
    } else {
        const githubToken = await createSourcegraphBotGitHubToken({ repoName, githubClient })
        console.log('🔑 Setting GITHUB_TOKEN env var in Travis')
        await createTravisEnvVar({ repoName, name: 'GITHUB_TOKEN', value: githubToken, branch: 'master', travisClient })
    }
}
