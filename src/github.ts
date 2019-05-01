import got, { GotInstance, GotJSONFn } from 'got'
import * as prompt from './prompt'

export type GitHubClient = GotInstance<GotJSONFn>

export const createGitHubClient = ({ token }: { token: string }) =>
    got.extend({
        baseUrl: 'https://api.github.com/',
        json: true,
        headers: {
            Authorization: 'Bearer ' + token,
            'User-Agent': 'NodeJS',
        },
    })

export async function createSourcegraphBotGitHubToken({
    repoName,
    githubClient,
}: {
    repoName: string
    githubClient: GitHubClient
}): Promise<string> {
    console.log(
        'See credentials in https://team-sourcegraph.1password.com/vaults/dnrhbauihkhjs5ag6vszsme45a/allitems/7s46bqcnl5hxzbutupu44va7gu'
    )
    const password = await prompt.password('@sourcegraph-bot GitHub password')
    const otp = await prompt.input('@sourcegraph-bot GitHub 2FA code')

    const response = await githubClient.post('authorizations', {
        headers: {
            Authorization: 'Basic ' + Buffer.from('sourcegraph-bot:' + password).toString('base64'),
            'X-GitHub-OTP': otp,
        },
        json: true,
        body: {
            note: `semantic-release Travis CI for repo ${repoName}`,
            scopes: ['repo', 'read:org', 'user:email', 'repo_deployment', 'repo:status', 'write:repo_hook'],
        },
    })
    console.log('🔑 Created GitHub token for @sourcegraph-bot')
    return response.body.token
}
