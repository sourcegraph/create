import { prompt } from 'inquirer'
// @ts-ignore
import NpmRegistryClient = require('npm-registry-client')

export async function createSourcegraphBotNpmToken(): Promise<string> {
    const client = new NpmRegistryClient()
    console.log(
        'See credentials in https://team-sourcegraph.1password.com/vaults/dnrhbauihkhjs5ag6vszsme45a/allitems/oye4u4faaxmxxesugzqxojr4q4'
    )
    const { password, otp } = await prompt<{ password: string; otp: string }>([
        { name: 'password', type: 'password', message: '@sourcegraph-bot npm password' },
        { name: 'otp', message: '@sourcegraph-bot npm 2FA code' },
    ])

    const body = {
        _id: `org.couchdb.user:sourcegraph-bot`,
        name: 'sourcegraph-bot',
        password,
        type: 'user',
        roles: [],
        date: new Date().toISOString(),
    }

    const uri = 'https://registry.npmjs.org/-/user/org.couchdb.user:sourcegraph-bot'
    const response = await new Promise<{ token: string }>((resolve, reject) =>
        client.request(
            uri,
            {
                method: 'PUT',
                body,
                auth: { otp },
            },
            (err: any, data: any, raw: any, response: any) =>
                err ? reject(Object.assign(err, { response })) : resolve(data)
        )
    )
    if (!response.token) {
        throw Object.assign(new Error(`Could not get a token from npm`), { response })
    }

    console.log('🔑 Created @sourcegraph-bot npm token')
    return response.token
}
