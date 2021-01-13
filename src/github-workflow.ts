/* eslint-disable no-template-curly-in-string */
import { HTTPError } from 'got'
import * as yaml from 'js-yaml'
import { exists, writeFile } from 'mz/fs'
import { GitHubClient } from './github'
import { createSourcegraphBotNpmToken } from './npm'
import * as sodium from 'tweetsodium'

const createGitHubSecret = async ({
    repoName,
    name,
    value,
    githubClient,
}: {
    repoName: string
    name: string
    value: string
    githubClient: GitHubClient
}): Promise<void> => {
    // Get public key for repository
    const { keyId, key } = await githubClient.get<{ keyId: string; key: string }>(
        `repos/sourcegraph/${repoName}/actions/secrets/public-key`,
        {
            responseType: 'json',
            resolveBodyOnly: true,
        }
    )

    // Convert the message and key to Uint8Array's (Buffer implements that interface)
    const messageBytes = Buffer.from(value)
    const keyBytes = Buffer.from(key, 'base64')

    // Encrypt using LibSodium.
    const encryptedBytes = sodium.seal(messageBytes, keyBytes)

    // Base64 the encrypted secret
    const encryptedValue = Buffer.from(encryptedBytes).toString('base64')

    await githubClient.post(`repos/sourcegraph/${repoName}/actions/secrets/${name}`, {
        json: {
            encrypted_value: encryptedValue,
            key_id: keyId,
        },
    })
}

export async function initGitHubWorkflow({
    hasTests,
    repoName,
    githubClient,
}: {
    hasTests: boolean
    repoName: string
    githubClient: GitHubClient
}): Promise<void> {
    console.log('⚙️ Setting up GitHub Actions Workflow')
    if (await exists('.github/workflows/build.yml')) {
        console.log('.github/workflows/build.yml already exists, skipping')
    } else {
        const workflowYaml = {
            name: 'build',
            on: ['push', 'pull_request'],
            env: {
                FORCE_COLOR: 3,
            },
            jobs: {
                build: {
                    'runs-on': 'ubuntu-latest',
                    steps: [
                        { uses: 'actions/checkout@v2' },
                        {
                            name: 'Use Node.js',
                            uses: 'actions/setup-node@v2',
                            with: {
                                'node-version': '14.x',
                            },
                        },
                        { run: 'yarn' },
                        { run: 'yarn run prettier-check' },
                        { run: 'yarn run eslint' },
                        { run: 'yarn run build' },
                        ...(hasTests
                            ? [
                                  { run: 'yarn test' },
                                  { run: 'nyc report --reporter json' },
                                  {
                                      name: 'Upload coverage to Codecov',
                                      uses: 'codecov/codecov-action@v1',
                                  },
                              ]
                            : []),
                        {
                            name: 'release',
                            if:
                                "github.repository_owner == 'sourcegraph' && github.event_name == 'push' && github.ref == 'refs/heads/master'",
                            run: 'yarn run semantic-release',
                            env: {
                                GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
                                NPM_TOKEN: '${{ secrets.NPM_TOKEN }}',
                            },
                        },
                    ],
                },
            },
        }
        await writeFile('.github/workflows/build.yml', yaml.dump(workflowYaml))
    }

    const secretName = 'NPM_TOKEN'
    try {
        await githubClient.get(`repos/sourcegraph/${repoName}/actions/secrets/${secretName}`, {
            responseType: 'json',
            resolveBodyOnly: true,
        })
        console.log('🔑 NPM_TOKEN already set in GitHub secrets, skipping creation')
    } catch (error) {
        if (!(error instanceof HTTPError) || error.response.statusCode !== 404) {
            throw error
        }
        const npmToken = await createSourcegraphBotNpmToken()
        console.log('🔑 Setting NPM_TOKEN GitHub secret')
        await createGitHubSecret({
            repoName,
            name: secretName,
            value: npmToken,
            githubClient,
        })
    }
}
