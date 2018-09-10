import * as inquirer from 'inquirer'

interface BaseOptions<T> {
    message: string
    default?: T
}

interface InputOptions extends BaseOptions<string> {}

export async function input(question: string | InputOptions): Promise<string> {
    if (typeof question === 'string') {
        question = { message: question }
    }
    const { answer } = await inquirer.prompt<{ answer: string }>({ ...question, name: 'answer' })
    return answer
}

export async function password(question: string | InputOptions): Promise<string> {
    if (typeof question === 'string') {
        question = { message: question }
    }
    const { answer } = await inquirer.prompt<{ answer: string }>({ ...question, name: 'answer', type: 'password' })
    return answer
}

interface ChoicesOptions<T extends string> extends BaseOptions<T> {
    choices: ReadonlyArray<T>
}

export async function choices<T extends string>(question: ChoicesOptions<T>): Promise<T> {
    const { answer } = await inquirer.prompt<{ answer: T }>({ ...question, name: 'answer', type: 'list' })
    return answer
}

interface ConfirmOptions extends BaseOptions<boolean> {}

export async function confirm(question: string | ConfirmOptions): Promise<boolean> {
    if (typeof question === 'string') {
        question = { message: question }
    }
    const { answer } = await inquirer.prompt<{ answer: boolean }>({ ...question, name: 'answer', type: 'confirm' })
    return answer
}
