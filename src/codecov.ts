import got, { Got } from 'got'

export type CodecovClient = Got

export interface CodecovRepo {
    upload_token: string
    image_token: string
}

export const createCodecovClient = ({ token }: { token: string }): CodecovClient =>
    got.extend({
        prefixUrl: 'https://codecov.io/api/',
        headers: {
            Authorization: 'token ' + token,
        },
        responseType: 'json',
        resolveBodyOnly: true,
    })

export const getCodecovBadge = ({
    repoName,
    codecovImageToken,
}: {
    repoName: string
    codecovImageToken: string
}): string =>
    `[![codecov](https://codecov.io/gh/sourcegraph/${repoName}/branch/master/graph/badge.svg?token=${codecovImageToken})](https://codecov.io/gh/sourcegraph/${repoName})`
