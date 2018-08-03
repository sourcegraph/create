import _request = require('request-promise')
const request = _request.defaults({ resolveWithFullResponse: true })

export type CodeCovClient = typeof request

export interface CodeCovRepo {
    upload_token: string
    image_token: string
}

export const createCodeCovClient = ({ token }: { token: string }) =>
    request.defaults({
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
