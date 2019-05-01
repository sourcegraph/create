import * as yaml from 'js-yaml'
import { exists } from 'mz/fs'
import { writeFile } from 'mz/fs'
import _request = require('request-promise')
import { createSourcegraphBotGitHubToken, GitHubClient } from './github'
import { createSourcegraphBotNpmToken } from './npm'
import { JsonSchemaForTravisCiConfigurationFiles } from './travis-schema'
const request = _request.defaults({ resolveWithFullResponse: true })

export type TravisClient = typeof request

export const createTravisClient = ({ token }: { token: string }) =>
    request.defaults({
        baseUrl: 'https://api.travis-ci.org/',
        json: true,
        headers: {
            Authorization: 'token ' + token,
            'Travis-API-Version': '3',
        },
    })

const createTravisEnvVar = async ({
    repoName,
    name,
    value,
    travisClient,
}: {
    repoName: string
    name: string
    value: string
    travisClient: typeof request
}): Promise<void> => {
    await travisClient.post(`/repo/sourcegraph%2F${repoName}/env_vars`, {
        json: true,
        body: {
            'env_var.name': name,
            'env_var.value': value,
            'env_var.public': false,
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

const getCurrentTravisUser = async ({ travisClient }: { travisClient: TravisClient }): Promise<TravisUser> =>
    (await travisClient.get('user')).body

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
                global: ['FORCE_COLOR=1'],
            },
            install: ['yarn'],
            jobs: {
                include: [
                    {
                        stage: 'test',
                        script: [
                            'yarn run prettier-check',
                            'yarn run tslint',
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
        await new Promise<void>(resolve => setTimeout(resolve, 1000))
    }

    console.log(`Activating repository at https://travis-ci.org/sourcegraph/${repoName}`)
    await travisClient.post(`/repo/sourcegraph%2F${repoName}/activate`)

    const envVars = (await travisClient.get(`/repo/sourcegraph%2F${repoName}/env_vars`)).body
    if (envVars.env_vars.some((envVar: any) => envVar.name === 'NPM_TOKEN')) {
        console.log('🔑 NPM_TOKEN already set in Travis, skipping creation')
    } else {
        const npmToken = await createSourcegraphBotNpmToken()
        console.log('🔑 Setting NPM_TOKEN env var in Travis')
        await createTravisEnvVar({ repoName, name: 'NPM_TOKEN', value: npmToken, travisClient })
    }

    if (envVars.env_vars.some((envVar: any) => envVar.name === 'GITHUB_TOKEN')) {
        console.log('🔑 GITHUB_TOKEN already set in Travis, skipping creation')
    } else {
        const githubToken = await createSourcegraphBotGitHubToken({ repoName, githubClient })
        console.log('🔑 Setting GITHUB_TOKEN env var in Travis')
        await createTravisEnvVar({ repoName, name: 'GITHUB_TOKEN', value: githubToken, travisClient })
    }
}
