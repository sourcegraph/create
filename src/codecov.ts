import got, { GotInstance, GotJSONFn } from 'got'

export type CodecovClient = GotInstance<GotJSONFn>

export interface CodecovRepo {
    upload_token: string
    image_token: string
}

export const createCodecovClient = ({ token }: { token: string }): CodecovClient =>
    got.extend({
        baseUrl: 'https://codecov.io/api/',
        json: true,
        headers: {
            Authorization: 'token ' + token,
        },
    })

export const getCodecovBadge = ({
    repoName,
    codecovImageToken,
}: {
    repoName: string
    codecovImageToken: string
}): string =>
    `[![codecov](https://codecov.io/gh/sourcegraph/${repoName}/branch/master/graph/badge.svg?token=${codecovImageToken})](https://codecov.io/gh/sourcegraph/${repoName})`
