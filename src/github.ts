import got, { Got } from 'got'
import * as prompt from './prompt'

export type GitHubClient = Got

export const createGitHubClient = ({ token }: { token: string }): GitHubClient =>
    got.extend({
        prefixUrl: 'https://api.github.com/',
        headers: {
            Authorization: 'Bearer ' + token,
            'User-Agent': 'NodeJS',
        },
        responseType: 'json',
        resolveBodyOnly: true,
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

    const response = await githubClient.post<{ token: string }>('authorizations', {
        headers: {
            Authorization: 'Basic ' + Buffer.from('sourcegraph-bot:' + password).toString('base64'),
            'X-GitHub-OTP': otp,
        },
        json: {
            note: `semantic-release Travis CI for repo ${repoName}`,
            scopes: ['repo', 'read:org', 'user:email', 'repo_deployment', 'repo:status', 'write:repo_hook'],
        },
        responseType: 'json',
        resolveBodyOnly: true,
    })
    console.log('🔑 Created GitHub token for @sourcegraph-bot')
    return response.token
}
