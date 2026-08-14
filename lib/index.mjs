import { createChannelHandler } from './handler.mjs'
import * as fs from 'node:fs/promises'

export const name = 'dsh-any-attachment'
export const inject = ['connection']

export function apply(ctx) {
  const connection = ctx.get('connection')
  const handler = createChannelHandler({ fs })
  ctx.effect(
    () => connection.rpc.handle('/attachments-any', handler, { authority: 'trusted-host' }),
    'dsh-any-attachment: /attachments-any channel',
  )
}
