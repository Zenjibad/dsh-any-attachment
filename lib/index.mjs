import { createChannelHandler, defaultStoreRoot } from './handler.mjs'
import * as fs from 'node:fs/promises'

export const name = 'dsh-any-attachment'
export const inject = ['connection']

export function apply(ctx) {
  const connection = ctx.get('connection')
  const handler = createChannelHandler({
    fs,
    resolveCwd: (sessionId) => ctx.get('sessions')?.get(sessionId)?.header?.cwd,
  })
  ctx.effect(
    () => connection.rpc.handle('/attachments-any', handler, { authority: 'trusted-host' }),
    'dsh-any-attachment: /attachments-any channel',
  )
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'app:dsh-any-attachment',
      order: -97,
      text: () => 'A file the user references as @name lives at ./<name> relative to your working directory when that file exists there, '
        + `otherwise at ${defaultStoreRoot()}/<name>. Read it with your tools before answering anything about it.`,
    })
  })
}
