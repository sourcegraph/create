declare module 'npm-registry-client' {
    class NpmRegistryClient {
        request(
            uri: string,
            options: {
                method?: string
                body?: any
                auth?: {
                    otp?: string
                }
            },
            cb: (err: any, data: any, raw: any, response: any) => void
        ): void
    }
    export = NpmRegistryClient
}
