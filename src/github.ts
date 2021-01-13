import got, { Got } from 'got'

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
