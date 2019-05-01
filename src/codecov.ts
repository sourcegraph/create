import got, { GotInstance, GotJSONFn } from 'got'

export type CodeCovClient = GotInstance<GotJSONFn>

export interface CodeCovRepo {
    upload_token: string
    image_token: string
}

export const createCodeCovClient = ({ token }: { token: string }) =>
    got.extend({
        baseUrl: 'https://codecov.io/api/',
        json: true,
        headers: {
            Authorization: 'token ' + token,
        },
    })

export const getCodeCovBadge = async ({
    repoName,
    codeCovImageToken,
}: {
    repoName: string
    codeCovImageToken: string
}) =>
    `[![codecov](https://codecov.io/gh/sourcegraph/${repoName}/branch/master/graph/badge.svg?token=${codeCovImageToken})](https://codecov.io/gh/sourcegraph/${repoName})`
