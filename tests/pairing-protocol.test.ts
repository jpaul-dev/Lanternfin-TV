import { describe, expect, it } from 'vitest'
import { CODE_ALPHABET, createIdentity, decode64, decryptAccount, encode64, encryptAccount, serviceOrigin, sharedSecret, validateAccount } from '../src/shared/pairing/protocol'

const account = { version: 1 as const, kind: 'xtream' as const, name: 'Living room', url: 'https://provider.example', username: 'alice', password: 'private-password', epgUrl: '' }
const code = 'ABCDEFGH'

describe('phone pairing encryption', () => {
  it('round trips account data with matching confirmation digits and non-exportable keys', async () => {
    expect(CODE_ALPHABET.length).toBe(32)
    const tv = await createIdentity(), phone = await createIdentity()
    const sender = await sharedSecret(phone, tv.publicKey, code, tv.publicKey, phone.publicKey)
    const receiver = await sharedSecret(tv, phone.publicKey, code, tv.publicKey, phone.publicKey)
    expect(sender.confirmation).toMatch(/^\d{6}$/)
    expect(sender.confirmation).toBe(receiver.confirmation)
    expect(tv.privateKey.extractable).toBe(false)
    expect(sender.key.extractable).toBe(false)
    const envelope = await encryptAccount(account, sender, code, tv.publicKey, phone.publicKey)
    expect(JSON.stringify(envelope)).not.toContain(account.password)
    expect(JSON.stringify(envelope)).not.toContain(account.url)
    expect(await decryptAccount(envelope, receiver, code, tv.publicKey, phone.publicKey)).toEqual(account)
    const second = await encryptAccount(account, sender, code, tv.publicKey, phone.publicKey)
    expect(second.iv).not.toBe(envelope.iv)
    const altered = decode64(envelope.ciphertext); altered[0] ^= 1
    await expect(decryptAccount({ ...envelope, ciphertext: encode64(altered) }, receiver, code, tv.publicKey, phone.publicKey)).rejects.toThrow('could not be verified')
    await expect(decryptAccount(envelope, receiver, 'ABCDEFGJ', tv.publicKey, phone.publicKey)).rejects.toThrow('could not be verified')
    const stranger = await createIdentity(), wrongKey = await sharedSecret(stranger, phone.publicKey, code, stranger.publicKey, phone.publicKey)
    await expect(decryptAccount(envelope, wrongKey, code, tv.publicKey, phone.publicKey)).rejects.toThrow('could not be verified')
  })

  it('extracts full provider links and preserves explicitly entered credentials', () => {
    expect(validateAccount({ ...account, url: 'https://provider.example/panel/get.php?username=link-user&password=link-pass', username: '', password: '' })).toMatchObject({ url: 'https://provider.example/panel', username: 'link-user', password: 'link-pass' })
    expect(validateAccount({ ...account, url: 'http://provider.example/player_api.php?username=other&password=other' })).toMatchObject({ url: 'http://provider.example', username: 'alice', password: 'private-password' })
  })

  it('validates provider addresses and clears unused M3U credentials', () => {
    expect(validateAccount({ ...account, kind: 'm3u', url: 'provider.example/list.m3u?token=test' })).toMatchObject({ url: 'https://provider.example/list.m3u?token=test', username: '', password: '' })
    for (const url of ['javascript:alert(1)', 'ftp://provider.example', 'https://u:p@provider.example']) expect(() => validateAccount({ ...account, url })).toThrow()
    expect(() => validateAccount({ ...account, name: 'x'.repeat(81) })).toThrow()
  })

  it('requires HTTPS for public relays and allows loopback development only', () => {
    expect(serviceOrigin('https://pair.example/')).toBe('https://pair.example')
    expect(serviceOrigin('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787')
    for (const url of ['http://pair.example', 'http://192.168.1.5:8787', 'https://pair.example/path', 'https://u:p@pair.example', 'https://pair.example/?token=test']) expect(() => serviceOrigin(url)).toThrow()
  })
})
